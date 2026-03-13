import type {
  TrackedWorldUser,
  UserStats,
  WorldSearchResult,
  WorldUserSource,
} from "@shared/schema";
import { WORLD_CHUNK_SIZE } from "@shared/schema";
import { AppwriteClient, AppwriteQuery } from "./appwrite-client";
import type {
  CachedGithubProfile,
  CachedGithubStatsRecord,
  CatalogUserProfile,
  IStorage,
  WorldChunkWindow,
} from "./storage-types";
import {
  candidateWorldSlots,
  normalizeUsername,
  slotKey,
} from "./world-grid";
import { readAppwriteEnv, stableRowId, type AppwriteEnv } from "./runtime-env";

interface WorldUserRow {
  $id?: string;
  loginLower: string;
  loginDisplay: string;
  githubId: string;
  avatarUrl: string;
  htmlUrl: string;
  accountType: string;
  source: string;
  chunkX: number;
  chunkZ: number;
  cell: number;
  worldSeed: number;
  slotKey: string;
  planted: boolean;
  isActive: boolean;
  importRevision?: string | null;
  addedAt: string;
  plantedAt?: string | null;
  lastSelectedAt?: string | null;
  statsStatusHint?: UserStats["status"] | null;
  statsCommitsHint?: number | null;
}

interface WorldChunkRow {
  chunkKey: string;
  chunkX: number;
  chunkZ: number;
  activeUserCount: number;
  plantedUserCount: number;
  distanceScore: number;
  isActive: boolean;
}

interface GithubUserCacheRow {
  $id?: string;
  loginLower: string;
  loginDisplay: string;
  githubId: string;
  avatarUrl: string;
  htmlUrl: string;
  accountType: string;
  lastLiveSeenAt?: string | null;
  lastLiveSeen?: string | null;
  inWorld?: boolean;
  worldChunkX?: number | null;
  worldChunkZ?: number | null;
  worldCell?: number | null;
}

interface GithubStatsCacheRow {
  $id?: string;
  loginLower: string;
  githubId?: string | null;
  dataSource: "live" | "cached" | "estimated";
  cachedAt: string;
  fetchedAt: string;
  lastLiveError?: string | null;
  payload?: string | null;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function toIsoString(value: unknown, fallback = new Date().toISOString()) {
  if (typeof value !== "string" || !value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeWorldUserSource(value: string): WorldUserSource {
  if (value === "snapshot" || value === "snapsh") return "snapshot";
  return "live";
}

function toStoredWorldUserSource(value: WorldUserSource) {
  return value === "snapshot" ? "snapsh" : "github";
}

function worldRowToTrackedUser(row: WorldUserRow): TrackedWorldUser {
  return {
    id: String(row.githubId),
    githubId: Number(row.githubId),
    username: row.loginLower,
    addedAt: row.addedAt,
    chunkX: row.chunkX,
    chunkZ: row.chunkZ,
    cell: row.cell,
    worldSeed: row.worldSeed,
    planted: Boolean(row.planted),
    source: normalizeWorldUserSource(row.source),
    totalCommitsHint: row.statsCommitsHint ?? undefined,
    statusHint: row.statsStatusHint ?? undefined,
  };
}

function worldRowToSearchResult(row: WorldUserRow): WorldSearchResult {
  return {
    login: row.loginDisplay,
    avatar_url: row.avatarUrl,
    html_url: row.htmlUrl,
    type: row.accountType,
    source: normalizeWorldUserSource(row.source),
    inWorld: true,
    planted: Boolean(row.planted),
    chunkX: row.chunkX,
    chunkZ: row.chunkZ,
    cell: row.cell,
  };
}

function worldRowToCatalogProfile(row: WorldUserRow): CatalogUserProfile {
  return {
    githubId: Number(row.githubId),
    login: row.loginDisplay,
    avatarUrl: row.avatarUrl,
    htmlUrl: row.htmlUrl,
    type: row.accountType,
  };
}

function cachedRowToCatalogProfile(row: GithubUserCacheRow): CatalogUserProfile {
  return {
    githubId: Number(row.githubId),
    login: row.loginDisplay,
    avatarUrl: row.avatarUrl,
    htmlUrl: row.htmlUrl,
    type: row.accountType,
  };
}

function rowMatchesQuery(row: { loginLower: string; planted?: boolean }, normalized: string) {
  return row.loginLower === normalized ? 0 : row.loginLower.startsWith(normalized) ? 1 : 2;
}

export class AppwriteStorage implements IStorage {
  constructor(
    private readonly appwrite: AppwriteClient,
    readonly env: AppwriteEnv,
  ) {}

  static createFromBindings(bindings?: Record<string, string | undefined> | null) {
    const env = readAppwriteEnv(bindings);
    return new AppwriteStorage(new AppwriteClient(env), env);
  }

  async getTrackedUsers(): Promise<TrackedWorldUser[]> {
    const rows = await this.appwrite.listAllRows<WorldUserRow>(
      this.env.worldUsersTableId,
      [
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.equal("planted", [true]),
        AppwriteQuery.orderDesc("lastSelectedAt"),
        AppwriteQuery.orderAsc("loginLower"),
      ],
    );
    return rows.map(worldRowToTrackedUser);
  }

  async getTrackedCount(): Promise<number> {
    const result = await this.appwrite.listRows<WorldUserRow>(
      this.env.worldUsersTableId,
      [
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.equal("planted", [true]),
        AppwriteQuery.limit(1),
      ],
      { total: true },
    );
    return result.total;
  }

  async getCatalogCount(): Promise<number> {
    const result = await this.appwrite.listRows<WorldUserRow>(
      this.env.worldUsersTableId,
      [
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.limit(1),
      ],
      { total: true },
    );
    return result.total;
  }

  async getSuggestedInitialChunk(): Promise<{ cx: number; cz: number }> {
    const planted = await this.appwrite.listRows<WorldUserRow>(
      this.env.worldUsersTableId,
      [
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.equal("planted", [true]),
        AppwriteQuery.orderDesc("lastSelectedAt"),
        AppwriteQuery.limit(1),
      ],
    );
    if (planted.rows[0]) {
      return { cx: planted.rows[0].chunkX, cz: planted.rows[0].chunkZ };
    }

    const chunks = await this.appwrite.listRows<WorldChunkRow>(
      this.env.worldChunksTableId,
      [
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.orderDesc("activeUserCount"),
        AppwriteQuery.orderAsc("distanceScore"),
        AppwriteQuery.limit(1),
      ],
    );
    if (!chunks.rows[0]) return { cx: 0, cz: 0 };
    return { cx: chunks.rows[0].chunkX, cz: chunks.rows[0].chunkZ };
  }

  async getSuggestedInitialFocus(chunk: { cx: number; cz: number }): Promise<{ chunkX: number; chunkZ: number; cell: number } | null> {
    const rows = await this.findWorldUsersInChunk(chunk.cx, chunk.cz);
    if (rows.length === 0) return null;

    const center = (WORLD_CHUNK_SIZE - 1) / 2;
    const best = rows.slice().sort((left, right) => {
      const leftX = left.cell % WORLD_CHUNK_SIZE;
      const leftZ = Math.floor(left.cell / WORLD_CHUNK_SIZE);
      const rightX = right.cell % WORLD_CHUNK_SIZE;
      const rightZ = Math.floor(right.cell / WORLD_CHUNK_SIZE);
      const leftDistance = Math.hypot(leftX - center, leftZ - center);
      const rightDistance = Math.hypot(rightX - center, rightZ - center);
      return Number(right.planted) - Number(left.planted)
        || leftDistance - rightDistance
        || left.loginLower.localeCompare(right.loginLower);
    })[0];

    return {
      chunkX: best.chunkX,
      chunkZ: best.chunkZ,
      cell: best.cell,
    };
  }

  async addTrackedUser(username: string, profile?: CatalogUserProfile): Promise<TrackedWorldUser> {
    const normalized = normalizeUsername(username);
    const existing = await this.findWorldUser(normalized);
    if (existing) {
      const now = new Date().toISOString();
      const plantedAt = existing.plantedAt || now;
      await this.upsertWorldUser(existing.githubId, {
        ...existing,
        planted: true,
        plantedAt,
        lastSelectedAt: now,
      });
      await this.refreshChunkSummary(existing.chunkX, existing.chunkZ);
      await this.upsertGithubUserCache({
        githubId: Number(existing.githubId),
        login: existing.loginDisplay,
        avatarUrl: existing.avatarUrl,
        htmlUrl: existing.htmlUrl,
        type: existing.accountType,
      }, {
        inWorld: true,
        chunkX: existing.chunkX,
        chunkZ: existing.chunkZ,
        cell: existing.cell,
      });
      return worldRowToTrackedUser({
        ...existing,
        planted: true,
        plantedAt,
        lastSelectedAt: now,
      });
    }

    if (!profile) {
      throw new Error(`GitHub profile required to plant ${normalized}`);
    }

    const slot = await this.findAvailableLiveSlot(normalized);
    const now = new Date().toISOString();
    const row: WorldUserRow = {
      loginLower: normalized,
      loginDisplay: profile.login,
      githubId: String(profile.githubId),
      avatarUrl: profile.avatarUrl,
      htmlUrl: profile.htmlUrl,
      accountType: profile.type,
      source: toStoredWorldUserSource("live"),
      chunkX: slot.chunkX,
      chunkZ: slot.chunkZ,
      cell: slot.cell,
      worldSeed: slot.worldSeed,
      slotKey: slotKey(slot.chunkX, slot.chunkZ, slot.cell),
      planted: true,
      isActive: true,
      importRevision: null,
      addedAt: now,
      plantedAt: now,
      lastSelectedAt: now,
      statsStatusHint: null,
      statsCommitsHint: null,
    };

    await this.upsertWorldUser(row.githubId, row);
    await this.refreshChunkSummary(row.chunkX, row.chunkZ);
    await this.upsertGithubUserCache(profile, {
      inWorld: true,
      chunkX: row.chunkX,
      chunkZ: row.chunkZ,
      cell: row.cell,
    });
    return worldRowToTrackedUser(row);
  }

  async removeTrackedUser(username: string): Promise<void> {
    const existing = await this.findWorldUser(normalizeUsername(username));
    if (!existing) return;

    await this.upsertWorldUser(existing.githubId, {
      ...existing,
      planted: false,
    });
    await this.refreshChunkSummary(existing.chunkX, existing.chunkZ);
    await this.upsertGithubUserCache(worldRowToCatalogProfile(existing), {
      inWorld: true,
      chunkX: existing.chunkX,
      chunkZ: existing.chunkZ,
      cell: existing.cell,
    });
  }

  async isTracked(username: string): Promise<boolean> {
    const existing = await this.findWorldUser(normalizeUsername(username));
    return Boolean(existing?.planted);
  }

  async getTrackedUserLocation(username: string): Promise<TrackedWorldUser | null> {
    const row = await this.findWorldUser(normalizeUsername(username));
    return row ? worldRowToTrackedUser(row) : null;
  }

  async getChunkWindow(cx: number, cz: number, radius: number): Promise<WorldChunkWindow> {
    const rows = await this.appwrite.listAllRows<WorldUserRow>(
      this.env.worldUsersTableId,
      [
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.greaterThanEqual("chunkX", cx - radius),
        AppwriteQuery.lessThanEqual("chunkX", cx + radius),
        AppwriteQuery.greaterThanEqual("chunkZ", cz - radius),
        AppwriteQuery.lessThanEqual("chunkZ", cz + radius),
        AppwriteQuery.orderAsc("chunkZ"),
        AppwriteQuery.orderAsc("chunkX"),
        AppwriteQuery.orderAsc("cell"),
      ],
      500,
    );

    const chunkMap = new Map<string, TrackedWorldUser[]>();
    rows.forEach((row) => {
      const key = `${row.chunkX}:${row.chunkZ}`;
      const users = chunkMap.get(key) ?? [];
      users.push(worldRowToTrackedUser(row));
      chunkMap.set(key, users);
    });

    const chunks = [];
    for (let chunkZ = cz - radius; chunkZ <= cz + radius; chunkZ += 1) {
      for (let chunkX = cx - radius; chunkX <= cx + radius; chunkX += 1) {
        chunks.push({
          cx: chunkX,
          cz: chunkZ,
          users: chunkMap.get(`${chunkX}:${chunkZ}`) ?? [],
        });
      }
    }

    return {
      center: { cx, cz },
      radius,
      chunks,
    };
  }

  async searchWorldUsers(query: string, limit: number): Promise<WorldSearchResult[]> {
    const normalized = normalizeUsername(query);
    if (!normalized) return [];

    const rows = await this.searchWorldRows(normalized, limit);
    return rows.map(worldRowToSearchResult);
  }

  async searchDirectoryUsers(query: string, limit: number): Promise<WorldSearchResult[]> {
    const normalized = normalizeUsername(query);
    if (!normalized) return [];

    const rows = await this.searchDirectoryRows(normalized, limit);
    const results = await Promise.all(rows.map(async (row) => {
      const world = row.inWorld ? await this.findWorldUser(row.loginLower) : null;
      return {
        login: row.loginDisplay,
        avatar_url: row.avatarUrl,
        html_url: row.htmlUrl,
        type: row.accountType,
        source: world ? normalizeWorldUserSource(world.source) : "live",
        inWorld: Boolean(world ?? row.inWorld),
        planted: Boolean(world?.planted),
        chunkX: world?.chunkX ?? row.worldChunkX ?? undefined,
        chunkZ: world?.chunkZ ?? row.worldChunkZ ?? undefined,
        cell: world?.cell ?? row.worldCell ?? undefined,
      } satisfies WorldSearchResult;
    }));
    return results;
  }

  async getCachedGithubProfile(username: string): Promise<CachedGithubProfile | null> {
    const normalized = normalizeUsername(username);
    const row = await this.findGithubUserCache(normalized);
    if (row) {
      return {
        loginLower: row.loginLower,
        profile: cachedRowToCatalogProfile(row),
        inWorld: Boolean(row.inWorld),
        chunkX: row.worldChunkX ?? undefined,
        chunkZ: row.worldChunkZ ?? undefined,
        cell: row.worldCell ?? undefined,
      };
    }

    const world = await this.findWorldUser(normalized);
    if (!world) return null;

    return {
      loginLower: world.loginLower,
      profile: worldRowToCatalogProfile(world),
      inWorld: true,
      chunkX: world.chunkX,
      chunkZ: world.chunkZ,
      cell: world.cell,
    };
  }

  async upsertCachedGithubProfile(
    profile: CatalogUserProfile,
    options?: {
      inWorld?: boolean;
      chunkX?: number;
      chunkZ?: number;
      cell?: number;
      lastLiveSeenAt?: string;
    },
  ): Promise<void> {
    await this.upsertGithubUserCache(profile, {
      inWorld: options?.inWorld ?? false,
      chunkX: options?.chunkX,
      chunkZ: options?.chunkZ,
      cell: options?.cell,
      lastLiveSeenAt: options?.lastLiveSeenAt,
    });
  }

  async getCachedUserStats(username: string): Promise<CachedGithubStatsRecord | null> {
    const normalized = normalizeUsername(username);
    const row = await this.appwrite.getRow<GithubStatsCacheRow>(
      this.env.githubStatsCacheTableId,
      stableRowId("stats", normalized),
    );
    if (!row) return null;

    if (!row.payload) return null;

    let payload: UserStats;
    try {
      payload = JSON.parse(row.payload) as UserStats;
    } catch {
      return null;
    }

    const dataSource = row.dataSource === "estimated" ? "estimated" : "cached";
    return {
      username: normalized,
      stats: {
        ...payload,
        login: payload.login || normalized,
        dataSource,
        cachedAt: row.cachedAt,
      },
      fetchedAt: row.fetchedAt,
      lastLiveError: row.lastLiveError ?? null,
    };
  }

  async upsertCachedUserStats(
    username: string,
    stats: UserStats,
    options?: {
      githubId?: number | null;
      lastLiveError?: string | null;
    },
  ): Promise<void> {
    const normalized = normalizeUsername(username);
    const cachedAt = new Date().toISOString();
    const dataSource = stats.dataSource === "estimated"
      ? "estimated"
      : stats.dataSource === "cached"
        ? "cached"
        : "live";
    await this.appwrite.upsertRow<GithubStatsCacheRow>(
      this.env.githubStatsCacheTableId,
      stableRowId("stats", normalized),
      {
        loginLower: normalized,
        githubId: options?.githubId ? String(options.githubId) : null,
        dataSource,
        cachedAt,
        fetchedAt: cachedAt,
        lastLiveError: options?.lastLiveError ?? null,
        payload: JSON.stringify({
          ...stats,
          cachedAt,
        }),
      },
    );

    const world = await this.findWorldUser(normalized);
    if (world) {
      await this.upsertWorldUser(world.githubId, {
        ...world,
        statsStatusHint: stats.status,
        statsCommitsHint: stats.totalCommits,
        lastSelectedAt: cachedAt,
      });
    }
  }

  async touchTrackedUserSelection(username: string): Promise<void> {
    const world = await this.findWorldUser(normalizeUsername(username));
    if (!world) return;
    await this.upsertWorldUser(world.githubId, {
      ...world,
      lastSelectedAt: new Date().toISOString(),
    });
  }

  private async searchWorldRows(normalized: string, limit: number) {
    const prefixRows = await this.appwrite.listRows<WorldUserRow>(
      this.env.worldUsersTableId,
      [
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.startsWith("loginLower", normalized),
        AppwriteQuery.limit(limit),
      ],
    );

    const seen = new Set(prefixRows.rows.map((row) => row.loginLower));
    const rows = [...prefixRows.rows];

    if (rows.length < limit && normalized.length >= 2) {
      const fallbackRows = await this.appwrite.listRows<WorldUserRow>(
        this.env.worldUsersTableId,
        [
          AppwriteQuery.equal("isActive", [true]),
          AppwriteQuery.contains("loginLower", normalized),
          AppwriteQuery.limit(limit * 3),
        ],
      );

      fallbackRows.rows.forEach((row) => {
        if (seen.has(row.loginLower) || rows.length >= limit) return;
        seen.add(row.loginLower);
        rows.push(row);
      });
    }

    return rows
      .sort((left, right) =>
        rowMatchesQuery(left, normalized) - rowMatchesQuery(right, normalized)
        || Number(right.planted) - Number(left.planted)
        || left.loginLower.localeCompare(right.loginLower))
      .slice(0, limit);
  }

  private async searchDirectoryRows(normalized: string, limit: number) {
    const prefixRows = await this.appwrite.listRows<GithubUserCacheRow>(
      this.env.githubUserCacheTableId,
      [
        AppwriteQuery.startsWith("loginLower", normalized),
        AppwriteQuery.limit(limit),
      ],
    );

    const seen = new Set(prefixRows.rows.map((row) => row.loginLower));
    const rows = [...prefixRows.rows];

    if (rows.length < limit && normalized.length >= 2) {
      const fallbackRows = await this.appwrite.listRows<GithubUserCacheRow>(
        this.env.githubUserCacheTableId,
        [
          AppwriteQuery.contains("loginLower", normalized),
          AppwriteQuery.limit(limit * 3),
        ],
      );

      fallbackRows.rows.forEach((row) => {
        if (seen.has(row.loginLower) || rows.length >= limit) return;
        seen.add(row.loginLower);
        rows.push(row);
      });
    }

    return rows
      .sort((left, right) =>
        rowMatchesQuery(left, normalized) - rowMatchesQuery(right, normalized)
        || left.loginLower.localeCompare(right.loginLower))
      .slice(0, limit);
  }

  private async findWorldUser(normalized: string) {
    const result = await this.appwrite.listRows<WorldUserRow>(
      this.env.worldUsersTableId,
      [
        AppwriteQuery.equal("loginLower", [normalized]),
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.limit(1),
      ],
    );
    return result.rows[0] ?? null;
  }

  private async findWorldUsersInChunk(chunkX: number, chunkZ: number) {
    const result = await this.appwrite.listRows<WorldUserRow>(
      this.env.worldUsersTableId,
      [
        AppwriteQuery.equal("chunkX", [chunkX]),
        AppwriteQuery.equal("chunkZ", [chunkZ]),
        AppwriteQuery.equal("isActive", [true]),
        AppwriteQuery.orderAsc("cell"),
        AppwriteQuery.limit(500),
      ],
    );
    return result.rows;
  }

  private async findGithubUserCache(normalized: string) {
    const result = await this.appwrite.listRows<GithubUserCacheRow>(
      this.env.githubUserCacheTableId,
      [
        AppwriteQuery.equal("loginLower", [normalized]),
        AppwriteQuery.limit(1),
      ],
    );
    return result.rows[0] ?? null;
  }

  private async findAvailableLiveSlot(username: string) {
    const slots = candidateWorldSlots(username);
    while (true) {
      const next = slots.next();
      if (next.done) break;
      const slot = next.value;
      const result = await this.appwrite.listRows<WorldUserRow>(
        this.env.worldUsersTableId,
        [
          AppwriteQuery.equal("slotKey", [slotKey(slot.chunkX, slot.chunkZ, slot.cell)]),
          AppwriteQuery.equal("isActive", [true]),
          AppwriteQuery.limit(1),
        ],
      );
      if (result.rows.length === 0) {
        return slot;
      }
    }
    throw new Error(`Unable to assign world slot for ${normalizeUsername(username)}`);
  }

  private async upsertWorldUser(githubId: string, row: WorldUserRow) {
    await this.appwrite.upsertRow(
      this.env.worldUsersTableId,
      githubId,
      row as unknown as Record<string, unknown>,
    );
  }

  private async upsertGithubUserCache(
    profile: CatalogUserProfile,
    options?: {
      inWorld?: boolean;
      chunkX?: number;
      chunkZ?: number;
      cell?: number;
      lastLiveSeenAt?: string;
    },
  ) {
    await this.appwrite.upsertRow(
      this.env.githubUserCacheTableId,
      String(profile.githubId),
      {
        loginLower: normalizeUsername(profile.login),
        loginDisplay: profile.login,
        githubId: String(profile.githubId),
        avatarUrl: profile.avatarUrl,
        htmlUrl: profile.htmlUrl,
        accountType: profile.type,
        lastLiveSeenAt: options?.lastLiveSeenAt ?? new Date().toISOString(),
        lastLiveSeen: options?.lastLiveSeenAt ?? new Date().toISOString(),
        inWorld: options?.inWorld ?? false,
        worldChunkX: options?.chunkX ?? null,
        worldChunkZ: options?.chunkZ ?? null,
        worldCell: options?.cell ?? null,
      },
    );
  }

  async refreshChunkSummary(chunkX: number, chunkZ: number) {
    const users = await this.findWorldUsersInChunk(chunkX, chunkZ);
    const activeUserCount = users.length;
    const plantedUserCount = users.filter((user) => user.planted).length;
    const chunkKeyValue = `${chunkX}:${chunkZ}`;
    await this.appwrite.upsertRow(
      this.env.worldChunksTableId,
      stableRowId("chunk", chunkKeyValue),
      {
        chunkKey: chunkKeyValue,
        chunkX,
        chunkZ,
        activeUserCount,
        plantedUserCount,
        distanceScore: (chunkX * chunkX) + (chunkZ * chunkZ),
        isActive: activeUserCount > 0,
      } satisfies WorldChunkRow,
    );
  }
}
