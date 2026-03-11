import { randomUUID } from "crypto";

import type { TrackedWorldUser, WorldSearchResult } from "@shared/schema";
import { WORLD_CHUNK_SIZE, chunkKey } from "@shared/schema";
import { PostgresCatalogStorage } from "./catalog-storage";
import type { CatalogUserProfile, IStorage } from "./storage-types";
import { assignWorldSlot, forEachChunkInRadius, hash32, normalizeUsername, slotKey } from "./world-grid";

export type { CatalogUserProfile, IStorage } from "./storage-types";
export type { WorldChunkWindow } from "./storage-types";

function githubIdForUsername(username: string) {
  return hash32(`github:${normalizeUsername(username)}`);
}

function worldSearchResultFromUser(user: TrackedWorldUser): WorldSearchResult {
  return {
    login: user.username,
    avatar_url: `https://github.com/${user.username}.png`,
    html_url: `https://github.com/${user.username}`,
    type: "User",
    source: user.source,
    inWorld: true,
    planted: user.planted,
    chunkX: user.chunkX,
    chunkZ: user.chunkZ,
    cell: user.cell,
  };
}

export class MemStorage implements IStorage {
  private readonly trackedUsers = new Map<string, TrackedWorldUser>();
  private readonly chunkIndex = new Map<string, TrackedWorldUser[]>();
  private readonly occupiedSlots = new Set<string>();
  private static readonly TARGET_USERS_PER_CHUNK = 6;
  private static readonly MIN_RADIUS_CHUNKS = 1;
  private static readonly MAX_RADIUS_CHUNKS = 72;

  constructor() {
    const defaultUsers = [
      "torvalds",
      "antirez",
      "gvanrossum",
      "matz",
      "dhh",
      "nikic",
      "gaearon",
      "yyx990803",
      "sindresorhus",
      "mrdoob",
      "paulirish",
      "ryanflorence",
      "Rich-Harris",
      "developit",
      "tannerlinsley",
      "bradfitz",
      "tiangolo",
      "dtolnay",
    ];

    const syntheticUsers = Math.max(0, parseInt(process.env.GITFOREST_SYNTHETIC_USERS || "0", 10) || 0);
    this.seedUsers(defaultUsers, "snapshot");
    if (syntheticUsers > 0) {
      this.seedUsers(
        Array.from({ length: syntheticUsers }, (_, index) => `synthetic-dev-${String(index + 1).padStart(5, "0")}`),
        "snapshot",
      );
    }
  }

  async getTrackedUsers(): Promise<TrackedWorldUser[]> {
    return Array.from(this.trackedUsers.values());
  }

  async getTrackedCount(): Promise<number> {
    return this.trackedUsers.size;
  }

  async getCatalogCount(): Promise<number> {
    return this.trackedUsers.size;
  }

  async getSuggestedInitialChunk(): Promise<{ cx: number; cz: number }> {
    let best = { cx: 0, cz: 0, count: -1, distance: Number.POSITIVE_INFINITY };

    this.chunkIndex.forEach((users, key) => {
      const [cxRaw, czRaw] = key.split(":");
      const cx = Number(cxRaw);
      const cz = Number(czRaw);
      const distance = Math.hypot(cx, cz);
      if (
        users.length > best.count
        || (users.length === best.count && distance < best.distance)
      ) {
        best = { cx, cz, count: users.length, distance };
      }
    });

    return { cx: best.cx, cz: best.cz };
  }

  async getSuggestedInitialFocus(chunk: { cx: number; cz: number }): Promise<{ chunkX: number; chunkZ: number; cell: number } | null> {
    const users = this.chunkIndex.get(chunkKey(chunk.cx, chunk.cz)) ?? [];
    if (users.length === 0) return null;

    const localCenter = (WORLD_CHUNK_SIZE - 1) / 2;
    const best = [...users].sort((left, right) => {
      const leftX = left.cell % WORLD_CHUNK_SIZE;
      const leftZ = Math.floor(left.cell / WORLD_CHUNK_SIZE);
      const rightX = right.cell % WORLD_CHUNK_SIZE;
      const rightZ = Math.floor(right.cell / WORLD_CHUNK_SIZE);
      const leftDistance = Math.hypot(leftX - localCenter, leftZ - localCenter);
      const rightDistance = Math.hypot(rightX - localCenter, rightZ - localCenter);
      return leftDistance - rightDistance || left.username.localeCompare(right.username);
    })[0];

    return {
      chunkX: best.chunkX,
      chunkZ: best.chunkZ,
      cell: best.cell,
    };
  }

  async addTrackedUser(username: string, profile?: CatalogUserProfile): Promise<TrackedWorldUser> {
    return this.insertTrackedUser(username, profile ? "live" : "snapshot", profile);
  }

  async removeTrackedUser(username: string): Promise<void> {
    const normalized = normalizeUsername(username);
    const existing = this.trackedUsers.get(normalized);
    if (!existing) return;

    this.trackedUsers.delete(normalized);
    this.occupiedSlots.delete(slotKey(existing.chunkX, existing.chunkZ, existing.cell));

    const key = chunkKey(existing.chunkX, existing.chunkZ);
    const users = this.chunkIndex.get(key) ?? [];
    const nextUsers = users.filter((user) => user.username !== normalized);
    if (nextUsers.length > 0) {
      this.chunkIndex.set(key, nextUsers);
    } else {
      this.chunkIndex.delete(key);
    }
  }

  async isTracked(username: string): Promise<boolean> {
    return this.trackedUsers.has(normalizeUsername(username));
  }

  async getTrackedUserLocation(username: string): Promise<TrackedWorldUser | null> {
    return this.trackedUsers.get(normalizeUsername(username)) ?? null;
  }

  async getChunkWindow(cx: number, cz: number, radius: number) {
    const chunks: Array<{ cx: number; cz: number; users: TrackedWorldUser[] }> = [];

    forEachChunkInRadius(cx, cz, radius, (chunkX, chunkZ) => {
      const users = this.chunkIndex.get(chunkKey(chunkX, chunkZ)) ?? [];
      chunks.push({
        cx: chunkX,
        cz: chunkZ,
        users: [...users].sort((a, b) => a.cell - b.cell),
      });
    });

    return {
      center: { cx, cz },
      radius,
      chunks,
    };
  }

  async searchWorldUsers(query: string, limit: number): Promise<WorldSearchResult[]> {
    const normalized = normalizeUsername(query);
    const prefixMatches = Array.from(this.trackedUsers.values())
      .filter((user) => user.username.startsWith(normalized))
      .sort((left, right) => left.username.localeCompare(right.username));

    const containsMatches = Array.from(this.trackedUsers.values())
      .filter((user) => !user.username.startsWith(normalized) && user.username.includes(normalized))
      .sort((left, right) => left.username.localeCompare(right.username));

    return [...prefixMatches, ...containsMatches]
      .slice(0, limit)
      .map(worldSearchResultFromUser);
  }

  private seedUsers(usernames: string[], source: TrackedWorldUser["source"]) {
    const seen = new Set<string>();
    usernames.forEach((username) => {
      const normalized = normalizeUsername(username);
      if (seen.has(normalized) || this.trackedUsers.has(normalized)) return;
      seen.add(normalized);
      this.insertTrackedUser(normalized, source);
    });
  }

  private insertTrackedUser(
    username: string,
    source: TrackedWorldUser["source"],
    profile?: CatalogUserProfile,
  ): TrackedWorldUser {
    const normalized = normalizeUsername(username);
    const maxRadiusChunks = this.getRadiusCapForCount(this.trackedUsers.size + 1);
    const slot = assignWorldSlot(
      normalized,
      (chunkX, chunkZ, cell) => this.occupiedSlots.has(slotKey(chunkX, chunkZ, cell)),
      {
        minRadiusChunks: MemStorage.MIN_RADIUS_CHUNKS,
        maxRadiusChunks,
      },
    );
    const trackedUser: TrackedWorldUser = {
      id: randomUUID(),
      githubId: profile?.githubId ?? githubIdForUsername(normalized),
      username: normalized,
      addedAt: new Date().toISOString(),
      chunkX: slot.chunkX,
      chunkZ: slot.chunkZ,
      cell: slot.cell,
      worldSeed: slot.worldSeed,
      planted: true,
      source,
    };

    this.trackedUsers.set(normalized, trackedUser);
    this.occupiedSlots.add(slotKey(slot.chunkX, slot.chunkZ, slot.cell));

    const key = chunkKey(slot.chunkX, slot.chunkZ);
    const users = this.chunkIndex.get(key) ?? [];
    users.push(trackedUser);
    this.chunkIndex.set(key, users);

    return trackedUser;
  }

  private getRadiusCapForCount(count: number) {
    const requiredChunks = Math.max(1, Math.ceil(count / MemStorage.TARGET_USERS_PER_CHUNK));
    const radius = Math.ceil(Math.sqrt(requiredChunks / Math.PI));
    return Math.max(MemStorage.MIN_RADIUS_CHUNKS, Math.min(MemStorage.MAX_RADIUS_CHUNKS, radius));
  }
}

let storagePromise: Promise<IStorage> | null = null;

async function createStorage(): Promise<IStorage> {
  const pgStorage = await PostgresCatalogStorage.createFromEnv();
  return pgStorage ?? new MemStorage();
}

export function getStorage() {
  if (!storagePromise) {
    storagePromise = createStorage();
  }
  return storagePromise;
}
