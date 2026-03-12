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
import { createPixelAtlas, groundSpriteKey, treeSpriteKey, type PixelStatus } from "./pixel-atlas";
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
  kind: "selected" | "hover" | "nearby" | "planted";
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
  planted: boolean;
  projectedX: number;
  projectedY: number;
  detail: boolean;
  footprint: IsometricFootprint | null;
}

interface CachedTree {
  username: string;
  worldX: number;
  worldZ: number;
  stage: number;
  status: PixelStatus;
  planted: boolean;
}

type AvatarFacing = "left" | "right";
type AvatarPose = "idle" | "walk-a" | "walk-b" | "walk-c" | "walk-d";

const WALK_POSES = ["walk-a", "walk-b", "walk-c", "walk-d"] as const satisfies readonly AvatarPose[];

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
    onHoverUserChange?: (username: string | null) => void;
    onSceneReady?: () => void;
  };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
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
  private movementEnabled = true;
  private avatarFacing: AvatarFacing = "right";
  private avatarPose: AvatarPose = "idle";
  private avatarWalkPhase = 0;
  private hoveredUser: string | null = null;
  private activeChunk: ChunkWindowChange = { cx: 0, cz: 0 };
  private visibleUserKey = "";
  private frameHandle = 0;
  private lastFrameTs = 0;
  private ready = false;
  private needsRender = true;
  private footprints: IsometricFootprint[] = [];
  private markerCount = 0;
  private detailedCount = 0;
  private renderLabels: ScreenLabel[] = [];
  private jumpFlashUser: string | null = null;
  private jumpFlashT = 0;
  private cachedTrees: CachedTree[] = [];

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
    this.requestFrame();
  }

  setWorldData(worldConfig: WorldConfig, chunks: WorldChunk[], statsMap: Record<string, UserStats>) {
    this.worldConfig = worldConfig;
    this.chunks = chunks;
    this.statsMap = statsMap;
    this.chunkMap.clear();
    chunks.forEach((chunk) => this.chunkMap.set(chunkKey(chunk.cx, chunk.cz), chunk));
    this.cachedTrees = this.buildCachedTrees(chunks, statsMap);
    this.invalidate();
  }

  setSelectedUser(selectedUser: string | null) {
    this.selectedUser = selectedUser;
    this.invalidate();
  }

  setSize(size: { w: number; h: number }) {
    this.size = size;
    this.canvas.width = size.w;
    this.canvas.height = size.h;
    this.offscreen = createOffscreen(size);
    this.invalidate();
  }

  setTouchVector(x: number, z: number) {
    this.touchVector = { x, z };
    this.requestFrame();
  }

  setMovementEnabled(enabled: boolean) {
    this.movementEnabled = enabled;
    if (!enabled) {
      this.keyboard.clear();
      this.touchVector = { x: 0, z: 0 };
    }
    this.requestFrame();
  }

  jumpToUser(target: SceneJumpTarget) {
    const world = worldPositionForCell(target.chunkX, target.chunkZ, target.cell);
    this.avatar.x = world.x;
    this.avatar.z = world.z;
    this.camera.x = world.x;
    this.camera.z = world.z;
    this.avatarPose = "idle";
    this.avatarWalkPhase = 0;
    this.selectedUser = target.username;
    this.hoveredUser = null;
    this.jumpFlashUser = target.username;
    this.jumpFlashT = 1.2;
    this.syncChunkWindow();
    this.invalidate();
  }

  getRenderState() {
    return {
      mode: "isometric",
      avatar: {
        x: Math.round(this.avatar.x * 100) / 100,
        z: Math.round(this.avatar.z * 100) / 100,
        facing: this.avatarFacing,
        pose: this.avatarPose,
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
    this.callbacks.onHoverUserChange?.(null);
  }

  private setHoveredUser(username: string | null) {
    if (this.hoveredUser === username) return;
    this.hoveredUser = username;
    this.callbacks.onHoverUserChange?.(username);
    this.invalidate();
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
    this.setHoveredUser(hitTestFootprints(this.footprints, point.x, point.y));
  };

  private readonly onPointerLeave = () => {
    this.setHoveredUser(null);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    const point = this.toLogicalPoint(event.clientX, event.clientY);
    const hit = hitTestFootprints(this.footprints, point.x, point.y);
    this.callbacks.onSelectUser(hit);
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.camera.zoom = Math.max(0.78, Math.min(2.3, this.camera.zoom - event.deltaY * 0.0012));
    this.invalidate();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.movementEnabled || isEditableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) return;
    event.preventDefault();
    const sizeBefore = this.keyboard.size;
    this.keyboard.add(key);
    if (this.keyboard.size !== sizeBefore) {
      this.requestFrame();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) return;
    const removed = this.keyboard.delete(event.key.toLowerCase());
    if (removed) {
      this.requestFrame();
    }
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

  private requestFrame() {
    if (this.frameHandle) return;
    this.frameHandle = requestAnimationFrame((ts) => this.runFrame(ts));
  }

  private invalidate() {
    this.needsRender = true;
    this.requestFrame();
  }

  private runFrame(ts: number) {
    this.frameHandle = 0;
    const delta = Math.min((ts - this.lastFrameTs || 16) / 1000, 1 / 20);
    this.lastFrameTs = ts;

    const changed = this.tick(delta);
    if (changed || this.needsRender || !this.ready) {
      this.render();
      this.needsRender = false;
      if (!this.ready) {
        this.ready = true;
        this.callbacks.onSceneReady?.();
      }
    }

    if (this.isAnimating()) {
      this.requestFrame();
    }
  }

  private tick(deltaSeconds: number) {
    let changed = false;
    const movement = this.getMovementVector();
    const speed = 22 * this.worldConfig.cellSize * 0.08;
    if (movement.x !== 0 || movement.z !== 0) {
      const deltaX = movement.x * speed * deltaSeconds;
      const deltaZ = movement.z * speed * deltaSeconds;
      this.avatar.x += deltaX;
      this.avatar.z += deltaZ;
      const strideDistance = Math.hypot(deltaX, deltaZ);
      this.avatarWalkPhase = (this.avatarWalkPhase + strideDistance / (this.worldConfig.cellSize * 0.75)) % 1;

      const nextFacing = this.getAvatarFacing(movement);
      if (nextFacing !== this.avatarFacing) {
        this.avatarFacing = nextFacing;
      }

      const nextPose = this.getAvatarWalkPose();
      if (nextPose !== this.avatarPose) {
        this.avatarPose = nextPose;
      }
      changed = true;
    } else if (this.avatarPose !== "idle" || this.avatarWalkPhase !== 0) {
      this.avatarPose = "idle";
      this.avatarWalkPhase = 0;
      changed = true;
    }

    const follow = Math.min(deltaSeconds * 5, 1);
    const nextCameraX = this.camera.x + (this.avatar.x - this.camera.x) * follow;
    const nextCameraZ = this.camera.z + (this.avatar.z - this.camera.z) * follow;
    if (Math.abs(nextCameraX - this.camera.x) > 0.001 || Math.abs(nextCameraZ - this.camera.z) > 0.001) {
      this.camera.x = nextCameraX;
      this.camera.z = nextCameraZ;
      changed = true;
    }

    if (this.jumpFlashT > 0) {
      this.jumpFlashT = Math.max(0, this.jumpFlashT - deltaSeconds);
      if (this.jumpFlashT === 0) this.jumpFlashUser = null;
      changed = true;
    }

    if (this.syncChunkWindow()) {
      changed = true;
    }

    return changed;
  }

  private getAvatarFacing(movement: { x: number; z: number }): AvatarFacing {
    return movement.x - movement.z < 0 ? "left" : "right";
  }

  private getAvatarWalkPose(): AvatarPose {
    const index = Math.floor(this.avatarWalkPhase * WALK_POSES.length) % WALK_POSES.length;
    return WALK_POSES[index];
  }

  private getAvatarSpriteKey() {
    return `avatar-${this.avatarPose}`;
  }

  private getAvatarLift() {
    return this.avatarPose === "walk-b" || this.avatarPose === "walk-d"
      ? 1.4 * this.camera.zoom
      : 0;
  }

  private syncChunkWindow() {
    const nextChunk = worldChunkForPoint(this.avatar.x, this.avatar.z);
    if (nextChunk.cx === this.activeChunk.cx && nextChunk.cz === this.activeChunk.cz) return false;
    this.activeChunk = nextChunk;
    this.callbacks.onChunkWindowChange(nextChunk);
    return true;
  }

  private isAnimating() {
    const movement = this.getMovementVector();
    return movement.x !== 0
      || movement.z !== 0
      || Math.abs(this.avatar.x - this.camera.x) > 0.01
      || Math.abs(this.avatar.z - this.camera.z) > 0.01
      || this.jumpFlashT > 0;
  }

  private buildCachedTrees(chunks: WorldChunk[], statsMap: Record<string, UserStats>) {
    const trees: CachedTree[] = [];
    chunks.forEach((chunk) => {
      chunk.users.forEach((summary) => {
        const tile = chunkCellToTile(summary.chunkX, summary.chunkZ, summary.cell, this.worldConfig.cellSize);
        trees.push({
          username: summary.username,
          worldX: tile.x,
          worldZ: tile.z,
          stage: getStage(getCommits(summary, statsMap)),
          status: getStatus(summary, statsMap),
          planted: summary.planted,
        });
      });
    });
    return trees;
  }

  private getMovementVector() {
    if (!this.movementEnabled) return { x: 0, z: 0 };
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

    this.cachedTrees.forEach((tree) => {
      const distance = tree.username === this.selectedUser
        ? -1
        : Math.hypot(tree.worldX - avatarTile.x, tree.worldZ - avatarTile.z);
      candidates.push({
        username: tree.username,
        worldX: tree.worldX,
        worldZ: tree.worldZ,
        distance,
        stage: tree.stage,
        status: tree.status,
        planted: tree.planted,
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
    gradient.addColorStop(0, "#d6eef7");
    gradient.addColorStop(0.34, "#eef3cf");
    gradient.addColorStop(0.62, "#bfd6a0");
    gradient.addColorStop(1, "#7da067");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, logical.width, logical.height);

    const sunX = logical.width * 0.82;
    const sunY = logical.height * 0.16;
    const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, logical.height * 0.16);
    glow.addColorStop(0, "rgba(255,244,183,0.95)");
    glow.addColorStop(0.45, "rgba(255,239,173,0.46)");
    glow.addColorStop(1, "rgba(255,239,173,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - logical.height * 0.16, 0, logical.height * 0.32, logical.height * 0.32);

    ctx.fillStyle = "#f7e39f";
    ctx.fillRect(logical.width - 54, 18, 14, 14);
    ctx.fillStyle = "#fff4c3";
    ctx.fillRect(logical.width - 51, 21, 8, 8);

    this.drawBackdropCloud(ctx, logical.width * 0.12, logical.height * 0.14, 56, 10, "rgba(255, 251, 235, 0.62)");
    this.drawBackdropCloud(ctx, logical.width * 0.28, logical.height * 0.11, 42, 8, "rgba(255, 250, 232, 0.48)");
    this.drawBackdropCloud(ctx, logical.width * 0.63, logical.height * 0.22, 48, 9, "rgba(255, 252, 238, 0.44)");

    this.drawBackdropRidge(ctx, logical, logical.height * 0.28, 8, 6, "#cfd8c0", 11);
    this.drawBackdropRidge(ctx, logical, logical.height * 0.35, 12, 6, "#a9bb96", 49);
    this.drawBackdropRidge(ctx, logical, logical.height * 0.43, 16, 5, "#829d76", 97);
    this.drawBackdropRidge(ctx, logical, logical.height * 0.52, 9, 4, "#5d7c58", 141);

    const mist = ctx.createLinearGradient(0, logical.height * 0.34, 0, logical.height * 0.58);
    mist.addColorStop(0, "rgba(243, 247, 225, 0.3)");
    mist.addColorStop(1, "rgba(243, 247, 225, 0)");
    ctx.fillStyle = mist;
    ctx.fillRect(0, logical.height * 0.28, logical.width, logical.height * 0.3);
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
        const surface = this.getGroundSpriteKey(tileX, tileZ);
        this.drawSprite(ctx, surface, projected.x, projected.y);
        this.drawAmbientTile(ctx, tileX, tileZ, projected.x, projected.y);
      }
    }
  }

  private drawBackdropCloud(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    ctx.fillRect(x + 8, y - 4, width * 0.44, height);
    ctx.fillRect(x + width * 0.52, y - 2, width * 0.3, height - 1);
  }

  private drawBackdropRidge(
    ctx: CanvasRenderingContext2D,
    logical: ViewportSize,
    baseY: number,
    amplitude: number,
    step: number,
    color: string,
    seed: number,
  ) {
    ctx.fillStyle = color;
    for (let x = 0; x <= logical.width + step; x += step) {
      const ridgeY = Math.round(
        baseY
        + Math.sin((x + seed) * 0.018) * amplitude
        + Math.sin((x + seed * 1.7) * 0.047) * amplitude * 0.38,
      );
      ctx.fillRect(x, ridgeY, step + 1, logical.height - ridgeY);
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
      if (drawable.planted) this.drawPlantedBadge(ctx, drawable.projectedX, drawable.projectedY - 8 * this.camera.zoom);
      return;
    }
    this.drawSprite(ctx, treeSpriteKey(drawable.stage, drawable.status), drawable.projectedX, drawable.projectedY);
    if (drawable.planted) this.drawPlantedBadge(ctx, drawable.projectedX, drawable.projectedY - 16 * this.camera.zoom);
  }

  private drawAvatar(ctx: CanvasRenderingContext2D, logical: ViewportSize, camera: IsometricCamera) {
    const avatarTile = {
      worldX: this.avatar.x / this.worldConfig.cellSize,
      worldZ: this.avatar.z / this.worldConfig.cellSize,
    };
    const projected = this.applyViewportOffset(projectToScreen(avatarTile, camera, logical, BASE_TILE), logical);
    this.drawHighlightTile(ctx, projected.x, projected.y, "__avatar__");
    this.drawSprite(ctx, this.getAvatarSpriteKey(), projected.x, projected.y - this.getAvatarLift(), {
      flipX: this.avatarFacing === "left",
    });
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
    nearby.forEach((item) => labels.push({
      username: item.username,
      kind: item.planted ? "planted" : "nearby",
      x: item.projectedX,
      y: item.projectedY - 24 * this.camera.zoom,
    }));

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
    } else if (label.kind === "planted") {
      ctx.fillStyle = "#f0d78f";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "#6d5c32";
    } else {
      ctx.fillStyle = "rgba(46, 66, 50, 0.82)";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "#9fc28d";
    }

    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.fillStyle = label.kind === "selected" || label.kind === "planted" ? "#2d2a18" : "#f2f6df";
    ctx.fillText(text, x + 6, y + 10);
    ctx.restore();
  }

  private drawPlantedBadge(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const size = 4 * this.camera.zoom;
    ctx.fillStyle = "#f6dc8a";
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#6d5c32";
    ctx.lineWidth = Math.max(1, this.camera.zoom * 0.8);
    ctx.stroke();
  }

  private drawSprite(
    ctx: CanvasRenderingContext2D,
    key: string,
    x: number,
    y: number,
    options?: { flipX?: boolean },
  ) {
    const sprite = this.atlas.sprites[key];
    if (!sprite) return;
    const drawWidth = sprite.sw * this.camera.zoom;
    const drawHeight = sprite.sh * this.camera.zoom;
    const drawX = x - sprite.anchorX * this.camera.zoom;
    const drawY = y - sprite.anchorY * this.camera.zoom;

    if (!options?.flipX) {
      ctx.drawImage(
        this.atlas.canvas,
        sprite.sx,
        sprite.sy,
        sprite.sw,
        sprite.sh,
        drawX,
        drawY,
        drawWidth,
        drawHeight,
      );
      return;
    }

    ctx.save();
    ctx.translate(drawX + drawWidth, drawY);
    ctx.scale(-1, 1);
    ctx.drawImage(
      this.atlas.canvas,
      sprite.sx,
      sprite.sy,
      sprite.sw,
      sprite.sh,
      0,
      0,
      drawWidth,
      drawHeight,
    );
    ctx.restore();
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

  private hasWaterNeighbor(tileX: number, tileZ: number) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetZ === 0) continue;
        if (this.isWaterTile(tileX + offsetX, tileZ + offsetZ)) {
          return true;
        }
      }
    }
    return false;
  }

  private getGroundSpriteKey(tileX: number, tileZ: number) {
    const water = this.isWaterTile(tileX, tileZ);
    const noise = rng(tileX * 29 + 17, tileZ * 31 + 13);
    if (water) {
      return noise > 0.58 ? groundSpriteKey("water-deep") : groundSpriteKey("water");
    }

    if (this.hasWaterNeighbor(tileX, tileZ)) {
      return groundSpriteKey("shore");
    }

    if (noise > 0.8) return groundSpriteKey("grass-sunlit");
    if (noise > 0.43) return groundSpriteKey("grass-clover");
    return groundSpriteKey("grass");
  }

  private applyViewportOffset<T extends { x: number; y: number }>(projected: T, logical: ViewportSize): T {
    return {
      ...projected,
      y: projected.y + logical.height * 0.18,
    };
  }

  private drawAmbientTile(ctx: CanvasRenderingContext2D, tileX: number, tileZ: number, x: number, y: number) {
    if (this.isWaterTile(tileX, tileZ)) return;
    const nearWater = this.hasWaterNeighbor(tileX, tileZ);
    const noise = rng(tileX * 17 + 91, tileZ * 13 + 27);
    if (nearWater) {
      if (noise <= 0.62) return;
      ctx.fillStyle = "#688b58";
      ctx.fillRect(x - 3, y - 7, 1, 3);
      ctx.fillRect(x - 1, y - 8, 1, 5);
      ctx.fillRect(x + 1, y - 7, 1, 4);
      ctx.fillStyle = "#d8c489";
      ctx.fillRect(x - 2, y - 5, 4, 1);
      if (noise > 0.87) {
        ctx.fillStyle = "#d8f8ff";
        ctx.fillRect(x + 2, y - 6, 1, 1);
      }
      return;
    }

    if (noise <= 0.66) return;

    if (noise > 0.93) {
      ctx.fillStyle = "#6f9951";
      ctx.fillRect(x - 2, y - 7, 1, 3);
      ctx.fillRect(x, y - 8, 1, 4);
      ctx.fillRect(x + 2, y - 7, 1, 3);
      ctx.fillStyle = "#ffd977";
      ctx.fillRect(x - 2, y - 9, 1, 1);
      ctx.fillRect(x + 2, y - 9, 1, 1);
      ctx.fillStyle = "#f7b5b4";
      ctx.fillRect(x, y - 10, 1, 1);
      return;
    }

    if (noise > 0.84) {
      ctx.fillStyle = "#557a44";
      ctx.fillRect(x - 3, y - 6, 6, 2);
      ctx.fillStyle = "#9ccf72";
      ctx.fillRect(x - 2, y - 7, 4, 1);
      ctx.fillRect(x - 1, y - 8, 2, 1);
      return;
    }

    if (noise > 0.76) {
      ctx.fillStyle = "#798b73";
      ctx.fillRect(x - 2, y - 5, 4, 2);
      ctx.fillStyle = "#aebda6";
      ctx.fillRect(x - 1, y - 6, 2, 1);
      return;
    }

    ctx.fillStyle = "#6d9950";
    ctx.fillRect(x - 2, y - 7, 1, 3);
    ctx.fillRect(x, y - 8, 1, 4);
    ctx.fillRect(x + 2, y - 7, 1, 3);
    ctx.fillStyle = "#d8ef9e";
    ctx.fillRect(x, y - 10, 1, 1);
  }

  private toLogicalPoint(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.offscreen.canvas.width,
      y: ((clientY - rect.top) / rect.height) * this.offscreen.canvas.height,
    };
  }
}
