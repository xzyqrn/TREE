import {
  chunkKey,
  worldChunkForPoint,
  worldPositionForCell,
  type UserStats,
  type WorldBootstrap,
  type WorldChunk,
  type WorldChunkUserSummary,
} from "@shared/schema";
import type { ChunkWindowChange, SceneJumpTarget } from "@/components/forest/types";

import {
  chunkCellToTile,
  hitTestFootprints,
  projectToScreen,
  sortByDepth,
  type IsometricCamera,
  type IsometricFootprint,
  type ViewportSize,
} from "./isometric-math";
import { createPixelAtlas, treeSpriteKey, type PixelStatus } from "./pixel-atlas";
import { rng } from "./random";

const BASE_TILE = { width: 20, height: 10 };
const MAX_DETAILED_TREES = 220;
const MAX_MARKERS = 720;
const VISIBLE_STATS_LIMIT = 24;
const MIN_LOGICAL_WIDTH = 320;
const MIN_LOGICAL_HEIGHT = 180;
const PLACEHOLDER_COMMITS = 180;

type WorldConfig = Pick<
  WorldBootstrap,
  "chunkSize" | "cellSize" | "renderRadiusChunks" | "preloadRadiusChunks" | "initialChunk" | "initialFocus"
>;

interface RenderLabel {
  username: string;
  kind: "selected" | "hover" | "nearby";
}

interface ScreenLabel extends RenderLabel {
  x: number;
  y: number;
}

interface TreeDrawable {
  username: string;
  worldX: number;
  worldZ: number;
  distance: number;
  stage: number;
  status: PixelStatus;
  projectedX: number;
  projectedY: number;
  detail: boolean;
  footprint: IsometricFootprint | null;
}

interface ControllerOptions {
  canvas: HTMLCanvasElement;
  size: { w: number; h: number };
  worldConfig: WorldConfig;
  chunks: WorldChunk[];
  statsMap: Record<string, UserStats>;
  selectedUser: string | null;
  callbacks: {
    onSelectUser: (username: string | null) => void;
    onChunkWindowChange: (center: ChunkWindowChange) => void;
    onVisibleTrackedUsersChange: (usernames: string[]) => void;
    onSceneReady?: () => void;
  };
}

function getStatus(summary: WorldChunkUserSummary, statsMap: Record<string, UserStats>): PixelStatus {
  return (statsMap[summary.username]?.status ?? summary.statusHint ?? "inactive") as PixelStatus;
}

function getCommits(summary: WorldChunkUserSummary, statsMap: Record<string, UserStats>) {
  return statsMap[summary.username]?.totalCommits ?? summary.totalCommitsHint ?? PLACEHOLDER_COMMITS;
}

function getStage(commits: number) {
  if (commits < 100) return 1;
  if (commits < 1000) return 2;
  if (commits < 10000) return 3;
  if (commits < 100000) return 4;
  return 5;
}

function createOffscreen(size: { w: number; h: number }) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(MIN_LOGICAL_WIDTH, Math.round(size.w / 3));
  canvas.height = Math.max(MIN_LOGICAL_HEIGHT, Math.round(size.h / 3));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas not available");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export class IsometricForestController {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly callbacks: ControllerOptions["callbacks"];
  private readonly atlas = createPixelAtlas();

  private size: { w: number; h: number };
  private offscreen = createOffscreen({ w: 1280, h: 720 });
  private worldConfig: WorldConfig;
  private chunks: WorldChunk[];
  private statsMap: Record<string, UserStats>;
  private selectedUser: string | null;
  private readonly chunkMap = new Map<string, WorldChunk>();

  private readonly avatar = { x: 0, z: 0 };
  private readonly camera = { x: 0, z: 0, zoom: 1.08 } satisfies IsometricCamera;
  private readonly keyboard = new Set<string>();
  private touchVector = { x: 0, z: 0 };
  private hoveredUser: string | null = null;
  private activeChunk: ChunkWindowChange = { cx: 0, cz: 0 };
  private visibleUserKey = "";
  private frameHandle = 0;
  private lastFrameTs = 0;
  private ready = false;
  private footprints: IsometricFootprint[] = [];
  private markerCount = 0;
  private detailedCount = 0;
  private renderLabels: ScreenLabel[] = [];
  private jumpFlashUser: string | null = null;
  private jumpFlashT = 0;

  constructor(options: ControllerOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not available");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.size = options.size;
    this.worldConfig = options.worldConfig;
    this.chunks = options.chunks;
    this.statsMap = options.statsMap;
    this.selectedUser = options.selectedUser;
    this.callbacks = options.callbacks;

    this.seedInitialOrigin();
    this.setSize(options.size);
    this.setWorldData(options.worldConfig, options.chunks, options.statsMap);
    this.bindEvents();
    this.scheduleLoop();
  }

  setWorldData(worldConfig: WorldConfig, chunks: WorldChunk[], statsMap: Record<string, UserStats>) {
    this.worldConfig = worldConfig;
    this.chunks = chunks;
    this.statsMap = statsMap;
    this.chunkMap.clear();
    chunks.forEach((chunk) => this.chunkMap.set(chunkKey(chunk.cx, chunk.cz), chunk));
  }

  setSelectedUser(selectedUser: string | null) {
    this.selectedUser = selectedUser;
  }

  setSize(size: { w: number; h: number }) {
    this.size = size;
    this.canvas.width = size.w;
    this.canvas.height = size.h;
    this.offscreen = createOffscreen(size);
  }

  setTouchVector(x: number, z: number) {
    this.touchVector = { x, z };
  }

  jumpToUser(target: SceneJumpTarget) {
    const world = worldPositionForCell(target.chunkX, target.chunkZ, target.cell);
    this.avatar.x = world.x;
    this.avatar.z = world.z;
    this.camera.x = world.x;
    this.camera.z = world.z;
    this.selectedUser = target.username;
    this.hoveredUser = null;
    this.jumpFlashUser = target.username;
    this.jumpFlashT = 1.2;
    this.syncChunkWindow();
  }

  getRenderState() {
    return {
      mode: "isometric",
      avatar: {
        x: Math.round(this.avatar.x * 100) / 100,
        z: Math.round(this.avatar.z * 100) / 100,
      },
      camera: {
        x: Math.round(this.camera.x * 100) / 100,
        z: Math.round(this.camera.z * 100) / 100,
        zoom: Math.round(this.camera.zoom * 100) / 100,
      },
      chunk: this.activeChunk,
      selectedUser: this.selectedUser,
      hoveredUser: this.hoveredUser,
      loadedChunks: this.chunkMap.size,
      visibleTrees: this.detailedCount,
      markerTrees: this.markerCount,
      labels: this.renderLabels.map(({ username, kind }) => ({ username, kind })),
    };
  }

  advanceTime(ms: number) {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let index = 0; index < steps; index += 1) {
      this.tick(1 / 60);
    }
    this.render();
  }

  dispose() {
    cancelAnimationFrame(this.frameHandle);
    this.unbindEvents();
  }

  private seedInitialOrigin() {
    const focus = this.worldConfig.initialFocus;
    const world = focus
      ? worldPositionForCell(focus.chunkX, focus.chunkZ, focus.cell)
      : {
          x: (this.worldConfig.initialChunk.cx + 0.5) * this.worldConfig.chunkSize * this.worldConfig.cellSize,
          z: (this.worldConfig.initialChunk.cz + 0.5) * this.worldConfig.chunkSize * this.worldConfig.cellSize,
        };
    this.avatar.x = world.x;
    this.avatar.z = world.z;
    this.camera.x = world.x;
    this.camera.z = world.z;
    this.activeChunk = { ...this.worldConfig.initialChunk };
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const point = this.toLogicalPoint(event.clientX, event.clientY);
    this.hoveredUser = hitTestFootprints(this.footprints, point.x, point.y);
  };

  private readonly onPointerLeave = () => {
    this.hoveredUser = null;
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    const point = this.toLogicalPoint(event.clientX, event.clientY);
    const hit = hitTestFootprints(this.footprints, point.x, point.y);
    this.callbacks.onSelectUser(hit);
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.camera.zoom = Math.max(0.78, Math.min(2.3, this.camera.zoom - event.deltaY * 0.0012));
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) return;
    event.preventDefault();
    this.keyboard.add(key);
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keyboard.delete(event.key.toLowerCase());
  };

  private bindEvents() {
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private unbindEvents() {
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private scheduleLoop() {
    const loop = (ts: number) => {
      const delta = Math.min((ts - this.lastFrameTs || 16) / 1000, 1 / 20);
      this.lastFrameTs = ts;
      this.tick(delta);
      this.render();
      if (!this.ready) {
        this.ready = true;
        this.callbacks.onSceneReady?.();
      }
      this.frameHandle = requestAnimationFrame(loop);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  private tick(deltaSeconds: number) {
    const movement = this.getMovementVector();
    const speed = 22 * this.worldConfig.cellSize * 0.08;
    this.avatar.x += movement.x * speed * deltaSeconds;
    this.avatar.z += movement.z * speed * deltaSeconds;

    const follow = Math.min(deltaSeconds * 5, 1);
    this.camera.x += (this.avatar.x - this.camera.x) * follow;
    this.camera.z += (this.avatar.z - this.camera.z) * follow;

    if (this.jumpFlashT > 0) {
      this.jumpFlashT = Math.max(0, this.jumpFlashT - deltaSeconds);
      if (this.jumpFlashT === 0) this.jumpFlashUser = null;
    }

    this.syncChunkWindow();
  }

  private syncChunkWindow() {
    const nextChunk = worldChunkForPoint(this.avatar.x, this.avatar.z);
    if (nextChunk.cx === this.activeChunk.cx && nextChunk.cz === this.activeChunk.cz) return;
    this.activeChunk = nextChunk;
    this.callbacks.onChunkWindowChange(nextChunk);
  }

  private getMovementVector() {
    let x = 0;
    let z = 0;

    if (this.keyboard.has("a") || this.keyboard.has("arrowleft")) x -= 1;
    if (this.keyboard.has("d") || this.keyboard.has("arrowright")) x += 1;
    if (this.keyboard.has("w") || this.keyboard.has("arrowup")) z -= 1;
    if (this.keyboard.has("s") || this.keyboard.has("arrowdown")) z += 1;

    x += this.touchVector.x;
    z += this.touchVector.z;

    if (x === 0 && z === 0) return { x: 0, z: 0 };

    const length = Math.hypot(x, z) || 1;
    return { x: x / length, z: z / length };
  }

  private render() {
    const logical = { width: this.offscreen.canvas.width, height: this.offscreen.canvas.height };
    const ctx = this.offscreen.ctx;

    ctx.clearRect(0, 0, logical.width, logical.height);
    this.drawBackdrop(ctx, logical);

    const cameraTile = {
      x: this.camera.x / this.worldConfig.cellSize,
      z: this.camera.z / this.worldConfig.cellSize,
      zoom: this.camera.zoom,
    };

    this.drawGround(ctx, logical, cameraTile);
    const treeDrawables = this.buildTreeDrawables(logical, cameraTile);
    const sorted = sortByDepth(treeDrawables);

    this.footprints = [];
    sorted.forEach((drawable) => {
      if (drawable.username === this.selectedUser || drawable.username === this.hoveredUser || drawable.username === this.jumpFlashUser) {
        this.drawHighlightTile(ctx, drawable.projectedX, drawable.projectedY, drawable.username);
      }
      this.drawTreeDrawable(ctx, drawable);
      if (drawable.footprint) {
        this.footprints.push(drawable.footprint);
      }
    });

    this.drawAvatar(ctx, logical, cameraTile);
    this.drawLabels(ctx, treeDrawables);
    this.blit();
  }

  private buildTreeDrawables(logical: ViewportSize, camera: IsometricCamera) {
    const candidates: Array<Omit<TreeDrawable, "projectedX" | "projectedY" | "detail" | "footprint">> = [];
    const avatarTile = {
      x: this.avatar.x / this.worldConfig.cellSize,
      z: this.avatar.z / this.worldConfig.cellSize,
    };

    this.chunks.forEach((chunk) => {
      chunk.users.forEach((summary) => {
        const tile = chunkCellToTile(summary.chunkX, summary.chunkZ, summary.cell, this.worldConfig.cellSize);
        const distance = summary.username === this.selectedUser
          ? -1
          : Math.hypot(tile.x - avatarTile.x, tile.z - avatarTile.z);
        candidates.push({
          username: summary.username,
          worldX: tile.x,
          worldZ: tile.z,
          distance,
          stage: getStage(getCommits(summary, this.statsMap)),
          status: getStatus(summary, this.statsMap),
        });
      });
    });

    const ranked = candidates.sort((left, right) => left.distance - right.distance);
    const detailedSet = new Set(ranked.slice(0, MAX_DETAILED_TREES).map((item) => item.username));
    const markerSet = new Set(
      ranked
        .slice(MAX_DETAILED_TREES, MAX_DETAILED_TREES + MAX_MARKERS)
        .map((item) => item.username),
    );
    const drawables: TreeDrawable[] = [];

    ranked.forEach((candidate) => {
      if (!detailedSet.has(candidate.username) && !markerSet.has(candidate.username)) return;

      const projected = this.applyViewportOffset(projectToScreen(candidate, camera, logical, BASE_TILE), logical);
      const onScreen = projected.x >= -60
        && projected.x <= logical.width + 60
        && projected.y >= -90
        && projected.y <= logical.height + 90;
      if (!onScreen) return;

      const detail = detailedSet.has(candidate.username);
      drawables.push({
        ...candidate,
        projectedX: projected.x,
        projectedY: projected.y,
        detail,
        footprint: detail
          ? {
              id: candidate.username,
              centerX: projected.x,
              baseY: projected.y + 2,
              width: 18 * camera.zoom,
              height: (22 + candidate.stage * 6) * camera.zoom,
              depth: projected.depth,
            }
          : null,
      });
    });

    this.detailedCount = drawables.filter((item) => item.detail).length;
    this.markerCount = drawables.length - this.detailedCount;

    const visibleUsers = drawables
      .filter((item) => item.detail)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, VISIBLE_STATS_LIMIT)
      .map((item) => item.username);
    const visibleKey = visibleUsers.join(",");
    if (visibleKey !== this.visibleUserKey) {
      this.visibleUserKey = visibleKey;
      this.callbacks.onVisibleTrackedUsersChange(visibleUsers);
    }

    return drawables;
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, logical: ViewportSize) {
    const gradient = ctx.createLinearGradient(0, 0, 0, logical.height);
    gradient.addColorStop(0, "#d8f0f4");
    gradient.addColorStop(0.5, "#dff0c0");
    gradient.addColorStop(1, "#98bf7b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, logical.width, logical.height);

    ctx.fillStyle = "#f6e7a3";
    ctx.fillRect(logical.width - 48, 22, 12, 12);
    ctx.fillStyle = "#fbeec1";
    ctx.fillRect(logical.width - 46, 24, 8, 8);

    ctx.fillStyle = "#9fbe96";
    ctx.fillRect(0, 42, logical.width, 12);
    ctx.fillStyle = "#7da175";
    ctx.fillRect(0, 54, logical.width, 10);
    ctx.fillStyle = "#65855f";
    ctx.fillRect(0, 64, logical.width, 8);
  }

  private drawGround(ctx: CanvasRenderingContext2D, logical: ViewportSize, camera: IsometricCamera) {
    const radiusX = Math.ceil(logical.width / (BASE_TILE.width * camera.zoom)) + 10;
    const radiusZ = Math.ceil(logical.height / (BASE_TILE.height * camera.zoom)) + 10;
    const startX = Math.floor(camera.x - radiusX);
    const endX = Math.ceil(camera.x + radiusX);
    const startZ = Math.floor(camera.z - radiusZ);
    const endZ = Math.ceil(camera.z + radiusZ);

    for (let tileZ = startZ; tileZ <= endZ; tileZ += 1) {
      for (let tileX = startX; tileX <= endX; tileX += 1) {
        const projected = this.applyViewportOffset(
          projectToScreen(
            { worldX: tileX + 0.5, worldZ: tileZ + 0.5 },
            camera,
            logical,
            BASE_TILE,
          ),
          logical,
        );
        if (projected.y < logical.height * 0.24) continue;
        const surface = this.isWaterTile(tileX, tileZ) ? "ground-water" : "ground-grass";
        this.drawSprite(ctx, surface, projected.x, projected.y);
        this.drawAmbientTile(ctx, tileX, tileZ, projected.x, projected.y);
      }
    }
  }

  private drawHighlightTile(ctx: CanvasRenderingContext2D, x: number, y: number, username: string) {
    const pulse = username === this.jumpFlashUser
      ? 0.35 + Math.sin((1.2 - this.jumpFlashT) * 14) * 0.12
      : username === this.selectedUser
        ? 0.28
        : 0.14;
    const width = 22 * this.camera.zoom;
    const height = 10 * this.camera.zoom;
    ctx.fillStyle = `rgba(255, 245, 181, ${pulse})`;
    ctx.beginPath();
    ctx.moveTo(x, y - height / 2);
    ctx.lineTo(x + width / 2, y);
    ctx.lineTo(x, y + height / 2);
    ctx.lineTo(x - width / 2, y);
    ctx.closePath();
    ctx.fill();
  }

  private drawTreeDrawable(ctx: CanvasRenderingContext2D, drawable: TreeDrawable) {
    if (!drawable.detail) {
      this.drawSprite(ctx, "marker", drawable.projectedX, drawable.projectedY);
      return;
    }
    this.drawSprite(ctx, treeSpriteKey(drawable.stage, drawable.status), drawable.projectedX, drawable.projectedY);
  }

  private drawAvatar(ctx: CanvasRenderingContext2D, logical: ViewportSize, camera: IsometricCamera) {
    const avatarTile = {
      worldX: this.avatar.x / this.worldConfig.cellSize,
      worldZ: this.avatar.z / this.worldConfig.cellSize,
    };
    const projected = this.applyViewportOffset(projectToScreen(avatarTile, camera, logical, BASE_TILE), logical);
    this.drawHighlightTile(ctx, projected.x, projected.y, "__avatar__");
    this.drawSprite(ctx, "avatar", projected.x, projected.y - 2 * Math.abs(Math.sin(this.lastFrameTs / 210)));
  }

  private drawLabels(ctx: CanvasRenderingContext2D, drawables: TreeDrawable[]) {
    const selected = this.selectedUser ? drawables.find((item) => item.username === this.selectedUser) : undefined;
    const hovered = this.hoveredUser ? drawables.find((item) => item.username === this.hoveredUser) : undefined;
    const nearby = drawables
      .filter((item) => item.detail && item.username !== selected?.username && item.username !== hovered?.username)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3);

    const labels: ScreenLabel[] = [];
    if (selected) labels.push({ username: selected.username, kind: "selected", x: selected.projectedX, y: selected.projectedY - 28 * this.camera.zoom });
    if (hovered && hovered.username !== selected?.username) {
      labels.push({ username: hovered.username, kind: "hover", x: hovered.projectedX, y: hovered.projectedY - 28 * this.camera.zoom });
    }
    nearby.forEach((item) => labels.push({ username: item.username, kind: "nearby", x: item.projectedX, y: item.projectedY - 24 * this.camera.zoom }));

    this.renderLabels = labels;
    labels.forEach((label) => this.drawLabel(ctx, label));
  }

  private drawLabel(ctx: CanvasRenderingContext2D, label: ScreenLabel) {
    const text = `@${label.username}`;
    ctx.save();
    ctx.font = "8px Silkscreen, monospace";
    const width = Math.ceil(ctx.measureText(text).width) + 12;
    const height = 14;
    const x = Math.round(label.x - width / 2);
    const y = Math.round(label.y - height);

    if (label.kind === "selected") {
      ctx.fillStyle = "#f7efc4";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "#6d5c32";
    } else if (label.kind === "hover") {
      ctx.fillStyle = "#34523d";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "#c5e4ae";
    } else {
      ctx.fillStyle = "rgba(46, 66, 50, 0.82)";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "#9fc28d";
    }

    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.fillStyle = label.kind === "selected" ? "#2d2a18" : "#f2f6df";
    ctx.fillText(text, x + 6, y + 10);
    ctx.restore();
  }

  private drawSprite(ctx: CanvasRenderingContext2D, key: string, x: number, y: number) {
    const sprite = this.atlas.sprites[key];
    if (!sprite) return;
    const drawWidth = sprite.sw * this.camera.zoom;
    const drawHeight = sprite.sh * this.camera.zoom;
    ctx.drawImage(
      this.atlas.canvas,
      sprite.sx,
      sprite.sy,
      sprite.sw,
      sprite.sh,
      x - sprite.anchorX * this.camera.zoom,
      y - sprite.anchorY * this.camera.zoom,
      drawWidth,
      drawHeight,
    );
  }

  private blit() {
    this.ctx.clearRect(0, 0, this.size.w, this.size.h);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offscreen.canvas, 0, 0, this.size.w, this.size.h);
  }

  private isWaterTile(tileX: number, tileZ: number) {
    const clusterX = Math.floor(tileX / 18);
    const clusterZ = Math.floor(tileZ / 18);
    const centerX = Math.floor(rng(clusterX * 17 + clusterZ * 13, 1) * 8) + 5;
    const centerZ = Math.floor(rng(clusterX * 31 + clusterZ * 7, 2) * 8) + 5;
    const localX = ((tileX % 18) + 18) % 18;
    const localZ = ((tileZ % 18) + 18) % 18;
    const dx = localX - centerX;
    const dz = localZ - centerZ;
    return dx * dx + dz * dz * 1.2 < 7 && rng(tileX * 19, tileZ * 23) > 0.28;
  }

  private applyViewportOffset<T extends { x: number; y: number }>(projected: T, logical: ViewportSize): T {
    return {
      ...projected,
      y: projected.y + logical.height * 0.18,
    };
  }

  private drawAmbientTile(ctx: CanvasRenderingContext2D, tileX: number, tileZ: number, x: number, y: number) {
    if (this.isWaterTile(tileX, tileZ)) return;
    const noise = rng(tileX * 17 + 91, tileZ * 13 + 27);
    if (noise <= 0.84) return;

    ctx.fillStyle = noise > 0.95 ? "#f8d97f" : "#6c964f";
    ctx.fillRect(x - 2, y - 7, 1, 3);
    ctx.fillRect(x, y - 8, 1, 4);
    ctx.fillRect(x + 2, y - 7, 1, 3);
    if (noise > 0.95) {
      ctx.fillStyle = "#f7a3a3";
      ctx.fillRect(x, y - 10, 1, 1);
    }
  }

  private toLogicalPoint(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.offscreen.canvas.width,
      y: ((clientY - rect.top) / rect.height) * this.offscreen.canvas.height,
    };
  }
}
