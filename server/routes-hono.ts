import { Hono } from "hono";

import { mergeHybridSearchResults } from "./catalog-search";
import { getStorage } from "./storage";
import {
  WORLD_BOOTSTRAP_RADIUS_CHUNKS,
  WORLD_CELL_SIZE,
  WORLD_CHUNK_SIZE,
  WORLD_PRELOAD_RADIUS_CHUNKS,
  WORLD_RENDER_RADIUS_CHUNKS,
  addUserSchema,
  type TrackedWorldUser,
  type UserStats,
  type WorldSearchResult,
  type WorldChunkResponse,
  type WorldChunkUserSummary,
} from "@shared/schema";
import { normalizeUsername } from "./world-grid";
import { readGitHubToken } from "./runtime-env";

const GITHUB_API = "https://api.github.com";
const GITHUB_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;
const GITHUB_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_LIMIT = 8;

const githubResponseCache = new Map<string, { data: unknown; ts: number }>();
let githubRateLimitedUntil = 0;

function hashUsername(username: string): number {
  let hash = 0;
  for (const ch of username.toLowerCase()) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  }
  return hash;
}

function buildRateLimitedStats(username: string, notice?: string): UserStats {
  const hash = hashUsername(username);
  const estimatedRepos = 6 + (hash % 18);
  const estimatedCommits = 140 + (hash % 260);
  const now = new Date().toISOString();
  return {
    login: username,
    name: username,
    avatar_url: `https://github.com/${username}.png`,
    bio: "GitHub API rate limit reached. Add GITHUB_TOKEN for live stats.",
    followers: 0,
    following: 0,
    public_repos: estimatedRepos,
    html_url: `https://github.com/${username}`,
    location: null,
    company: null,
    totalCommits: estimatedCommits,
    activeDays: Math.max(estimatedRepos * 8, Math.floor(estimatedCommits * 0.55)),
    totalStars: 0,
    totalForks: 0,
    topLanguages: [],
    status: "inactive",
    lastActive: null,
    created_at: now,
    dataSource: "estimated",
    cachedAt: now,
    notice: notice ?? "GitHub is unavailable right now, so these stats are estimated.",
  };
}

function decorateCachedStats(
  cached: UserStats,
  options?: { reason?: string },
): UserStats {
  const cachedAt = cached.cachedAt ?? new Date().toISOString();
  if (cached.dataSource === "estimated") {
    return {
      ...cached,
      cachedAt,
      notice: cached.notice ?? options?.reason,
    };
  }

  return {
    ...cached,
    dataSource: "cached",
    cachedAt,
    notice: options?.reason
      ? `${options.reason} Showing cached Appwrite data from ${new Date(cachedAt).toLocaleString()}.`
      : cached.notice,
  };
}

async function fetchGitHub(path: string, env?: Record<string, string | undefined>) {
  if (Date.now() < githubRateLimitedUntil) {
    throw new Error("rate_limit");
  }

  const cached = githubResponseCache.get(path);
  if (cached && Date.now() - cached.ts < GITHUB_CACHE_TTL_MS) {
    return cached.data as any;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitForest-App",
  };

  const githubToken = readGitHubToken(env ?? null);
  if (githubToken) {
    headers.Authorization = `token ${githubToken}`;
  }

  const response = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!response.ok) {
    if (response.status === 404) throw new Error("User not found");
    if (response.status === 403 || response.status === 429) {
      githubRateLimitedUntil = Date.now() + GITHUB_RATE_LIMIT_COOLDOWN_MS;
      throw new Error("rate_limit");
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json();
  githubResponseCache.set(path, { data, ts: Date.now() });
  return data;
}

async function getLiveUserStats(username: string, env?: Record<string, string | undefined>): Promise<UserStats> {
  if (normalizeUsername(username).startsWith("synthetic-dev-")) {
    return buildRateLimitedStats(username);
  }

  const user = await fetchGitHub(`/users/${username}`, env);
  let totalCommits = 0;
  let totalStars = 0;
  let totalForks = 0;
  let activeDays = 0;
  let lastActive: string | null = null;
  let notice: string | undefined;
  let computedSource: UserStats["dataSource"] = "live";
  const languageCounts: Record<string, number> = {};

  try {
    const repos = await fetchGitHub(`/users/${username}/repos?per_page=100&sort=updated`, env);
    if (Array.isArray(repos)) {
      totalStars = repos.reduce((acc: number, repo: any) => acc + (repo.stargazers_count || 0), 0);
      totalForks = repos.reduce((acc: number, repo: any) => acc + (repo.forks_count || 0), 0);
      if (repos.length > 0 && repos[0].updated_at) {
        lastActive = repos[0].updated_at;
      }
      repos.forEach((repo: any) => {
        if (repo.language) {
          languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
        }
      });
      const ownRepos = repos.filter((repo: any) => !repo.fork);
      totalCommits = ownRepos.reduce(
        (acc: number, repo: any) => acc + Math.min(Math.max(Math.floor((repo.size || 0) / 10), 1), 300),
        0,
      );
      totalCommits = Math.max(totalCommits, ownRepos.length * 8);
    }
  } catch (error: any) {
    if (error.message === "rate_limit") {
      computedSource = "estimated";
      notice = "Repository activity is currently estimated because GitHub rate limits are active.";
      totalCommits = user.public_repos * 10;
    } else {
      throw error;
    }
  }

  const createdAt = new Date(user.created_at);
  const accountAgeDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  activeDays = Math.min(accountAgeDays, Math.floor(totalCommits * 0.65) + user.public_repos * 2);
  const topLanguages = Object.entries(languageCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([language]) => language);

  let status: UserStats["status"] = "inactive";
  if (lastActive) {
    const daysSince = Math.floor((Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24));
    status = daysSince < 7 ? "active" : daysSince < 30 ? "moderate" : daysSince < 90 ? "occasional" : "inactive";
  }

  const cachedAt = new Date().toISOString();
  return {
    login: user.login,
    name: user.name,
    avatar_url: user.avatar_url,
    bio: user.bio,
    followers: user.followers,
    following: user.following,
    public_repos: user.public_repos,
    html_url: user.html_url,
    location: user.location,
    company: user.company,
    totalCommits,
    activeDays,
    totalStars,
    totalForks,
    topLanguages,
    status,
    lastActive,
    created_at: user.created_at,
    dataSource: computedSource,
    cachedAt,
    notice,
  };
}

function clampRadius(value: number, fallback = WORLD_PRELOAD_RADIUS_CHUNKS) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(4, Math.trunc(value)));
}

function buildPlaceholderHints(user: Pick<TrackedWorldUser, "githubId" | "username">) {
  const hash = Number(user.githubId) || hashUsername(user.username);
  const commits = 120 + (hash % 7200);
  const statuses: UserStats["status"][] = ["active", "moderate", "occasional", "inactive"];
  return {
    totalCommitsHint: commits,
    statusHint: statuses[hash % statuses.length],
  };
}

function toChunkSummary(user: TrackedWorldUser): Pick<WorldChunkUserSummary, "hasStats" | "totalCommitsHint" | "statusHint"> {
  if (typeof user.totalCommitsHint === "number" && user.statusHint) {
    return {
      hasStats: true,
      totalCommitsHint: user.totalCommitsHint,
      statusHint: user.statusHint,
    };
  }
  return {
    hasStats: false,
    ...buildPlaceholderHints(user),
  };
}

async function buildChunkResponse(
  centerX: number,
  centerZ: number,
  radius: number,
  env?: Record<string, string | undefined>,
): Promise<WorldChunkResponse> {
  const storage = await getStorage(env);
  const window = await storage.getChunkWindow(centerX, centerZ, radius);
  return {
    center: window.center,
    radius: window.radius,
    chunks: window.chunks.map((chunk) => ({
      cx: chunk.cx,
      cz: chunk.cz,
      users: chunk.users.map((user) => ({
        githubId: user.githubId,
        username: user.username,
        chunkX: user.chunkX,
        chunkZ: user.chunkZ,
        cell: user.cell,
        worldSeed: user.worldSeed,
        planted: user.planted,
        source: user.source,
        ...toChunkSummary(user),
      })),
    })),
  };
}

export function createHonoApp() {
  const app = new Hono<{
    Bindings: {
      ASSETS: { fetch: typeof fetch };
      GITHUB_TOKEN?: string;
      GITHUB_PERSONAL_ACCESS_TOKEN?: string;
      APPWRITE_ENDPOINT?: string;
      APPWRITE_PROJECT_ID?: string;
      APPWRITE_API_KEY?: string;
      APPWRITE_DATABASE_ID?: string;
      APPWRITE_TABLE_WORLD_USERS?: string;
      APPWRITE_TABLE_WORLD_CHUNKS?: string;
      APPWRITE_TABLE_GITHUB_USER_CACHE?: string;
      APPWRITE_TABLE_GITHUB_STATS_CACHE?: string;
      APPWRITE_TABLE_CATALOG_REVISIONS?: string;
      [key: string]: any;
    };
  }>();

  app.get("/api/users", async (c) => {
    try {
      const storage = await getStorage(c.env);
      return c.json(await storage.getTrackedUsers());
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  app.post("/api/users", async (c) => {
    try {
      const body = await c.req.json();
      const { username } = addUserSchema.parse(body);
      const normalized = normalizeUsername(username);
      const storage = await getStorage(c.env);
      const existing = await storage.getTrackedUserLocation(normalized);
      if (existing?.planted) {
        return c.json({
          username: existing.username,
          githubId: existing.githubId,
          chunkX: existing.chunkX,
          chunkZ: existing.chunkZ,
          cell: existing.cell,
          planted: true,
          source: existing.source,
          action: "already-planted",
        });
      }

      let profile = await storage.getCachedGithubProfile(normalized);
      if (!profile) {
        try {
          const githubUser = await fetchGitHub(`/users/${normalized}`, c.env);
          const nextProfile = {
            githubId: githubUser.id,
            login: githubUser.login,
            avatarUrl: githubUser.avatar_url,
            htmlUrl: githubUser.html_url,
            type: githubUser.type,
          };
          await storage.upsertCachedGithubProfile(nextProfile, { inWorld: false });
          profile = {
            loginLower: normalized,
            profile: nextProfile,
            inWorld: false,
          };
        } catch (error: any) {
          if (error.message === "User not found") return c.json({ error: "GitHub user not found" }, 404);
          if (error.message === "rate_limit") {
            return c.json({ error: "GitHub API rate limit reached. Try again in a minute, or search a cached user." }, 429);
          }
          throw error;
        }
      }

      const user = await storage.addTrackedUser(normalized, profile.profile);
      await storage.upsertCachedGithubProfile(profile.profile, {
        inWorld: true,
        chunkX: user.chunkX,
        chunkZ: user.chunkZ,
        cell: user.cell,
      });
      return c.json({
        username: user.username,
        githubId: user.githubId,
        chunkX: user.chunkX,
        chunkZ: user.chunkZ,
        cell: user.cell,
        planted: user.planted,
        source: user.source,
        action: existing ? "planted" : "added-live",
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  app.delete("/api/users/:username", async (c) => {
    try {
      const storage = await getStorage(c.env);
      await storage.removeTrackedUser(c.req.param("username"));
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  app.get("/api/search", async (c) => {
    try {
      const q = (c.req.query("q") || "").trim();
      const mode = c.req.query("mode") === "submit" ? "submit" : "suggest";
      if (!q) {
        return c.json({
          directory: [],
          world: [],
          directorySource: "cached",
          directoryError: null,
        });
      }

      const storage = await getStorage(c.env);
      const world = await storage.searchWorldUsers(q, SEARCH_LIMIT);

      if (mode === "suggest") {
        const directory = await storage.searchDirectoryUsers(q, SEARCH_LIMIT);
        return c.json(mergeHybridSearchResults(world, directory, {
          directorySource: "cached",
          directoryError: null,
        }));
      }

      try {
        const data = await fetchGitHub(`/search/users?q=${encodeURIComponent(q)}&per_page=${SEARCH_LIMIT}`, c.env);
        const directory: WorldSearchResult[] = [];

        for (const user of data.items || []) {
          const cachedWorld = await storage.getTrackedUserLocation(user.login);
          await storage.upsertCachedGithubProfile({
            githubId: user.id,
            login: user.login,
            avatarUrl: user.avatar_url,
            htmlUrl: user.html_url,
            type: user.type,
          }, {
            inWorld: Boolean(cachedWorld),
            chunkX: cachedWorld?.chunkX,
            chunkZ: cachedWorld?.chunkZ,
            cell: cachedWorld?.cell,
            lastLiveSeenAt: new Date().toISOString(),
          });

          directory.push({
            login: user.login,
            avatar_url: user.avatar_url,
            html_url: user.html_url,
            type: user.type,
            source: cachedWorld?.source ?? "live",
            inWorld: Boolean(cachedWorld),
            planted: Boolean(cachedWorld?.planted),
            chunkX: cachedWorld?.chunkX,
            chunkZ: cachedWorld?.chunkZ,
            cell: cachedWorld?.cell,
          });
        }

        return c.json(mergeHybridSearchResults(world, directory, {
          directorySource: "live",
          directoryError: null,
        }));
      } catch (error: any) {
        if (error.message !== "rate_limit") throw error;
        const directory = await storage.searchDirectoryUsers(q, SEARCH_LIMIT);
        return c.json(mergeHybridSearchResults(world, directory, {
          directorySource: "cached",
          directoryError: "GitHub search is rate-limited right now. Showing cached Appwrite results.",
        }));
      }
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  app.get("/api/users/:username/stats", async (c) => {
    try {
      const username = normalizeUsername(c.req.param("username"));
      const mode = c.req.query("mode") === "cache-only" ? "cache-only" : "live-first";
      const storage = await getStorage(c.env);

      if (mode === "cache-only") {
        const cached = await storage.getCachedUserStats(username);
        if (cached) {
          await storage.touchTrackedUserSelection(username);
          return c.json(decorateCachedStats(cached.stats));
        }
        const estimated = buildRateLimitedStats(username);
        await storage.upsertCachedUserStats(username, estimated, { lastLiveError: "cache_miss" });
        return c.json(estimated);
      }

      try {
        const liveStats = await getLiveUserStats(username, c.env);
        const cachedProfile = await storage.getCachedGithubProfile(username);
        await storage.upsertCachedUserStats(username, liveStats, {
          githubId: cachedProfile?.profile.githubId ?? null,
          lastLiveError: null,
        });
        await storage.touchTrackedUserSelection(username);
        return c.json(liveStats);
      } catch (error: any) {
        const cached = await storage.getCachedUserStats(username);
        if (cached) {
          await storage.touchTrackedUserSelection(username);
          return c.json(decorateCachedStats(cached.stats, {
            reason: error.message === "rate_limit"
              ? "GitHub is rate-limited."
              : "Live GitHub refresh failed.",
          }));
        }

        if (error.message === "User not found") {
          return c.json({ error: "GitHub user not found" }, 404);
        }

        const estimated = buildRateLimitedStats(
          username,
          error.message === "rate_limit"
            ? "GitHub is rate-limited right now, so these stats are estimated."
            : "GitHub is unavailable right now, so these stats are estimated.",
        );
        const cachedProfile = await storage.getCachedGithubProfile(username);
        await storage.upsertCachedUserStats(username, estimated, {
          githubId: cachedProfile?.profile.githubId ?? null,
          lastLiveError: error.message,
        });
        return c.json(estimated);
      }
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  app.get("/api/world/bootstrap", async (c) => {
    try {
      const storage = await getStorage(c.env);
      const trackedCount = await storage.getTrackedCount();
      const catalogCount = await storage.getCatalogCount();
      const initialChunk = await storage.getSuggestedInitialChunk();
      const initialFocus = await storage.getSuggestedInitialFocus(initialChunk);
      const chunks = await buildChunkResponse(initialChunk.cx, initialChunk.cz, WORLD_BOOTSTRAP_RADIUS_CHUNKS, c.env);
      return c.json({
        trackedCount,
        catalogCount,
        plantedCount: trackedCount,
        chunkSize: WORLD_CHUNK_SIZE,
        cellSize: WORLD_CELL_SIZE,
        renderRadiusChunks: WORLD_RENDER_RADIUS_CHUNKS,
        preloadRadiusChunks: WORLD_PRELOAD_RADIUS_CHUNKS,
        initialChunk,
        initialFocus,
        chunks: chunks.chunks,
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  app.get("/api/world/chunks", async (c) => {
    try {
      const cx = Math.trunc(Number(c.req.query("cx") ?? 0));
      const cz = Math.trunc(Number(c.req.query("cz") ?? 0));
      const radius = clampRadius(Number(c.req.query("radius")));
      return c.json(await buildChunkResponse(cx, cz, radius, c.env));
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  app.get("/api/world/users/:username/location", async (c) => {
    try {
      const storage = await getStorage(c.env);
      const trackedUser = await storage.getTrackedUserLocation(c.req.param("username"));
      if (!trackedUser) return c.json({ error: "Tracked user not found" }, 404);
      return c.json({
        githubId: trackedUser.githubId,
        username: trackedUser.username,
        chunkX: trackedUser.chunkX,
        chunkZ: trackedUser.chunkZ,
        cell: trackedUser.cell,
        planted: trackedUser.planted,
        source: trackedUser.source,
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  app.get("/*", (c) => {
    if (c.env?.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw);
    }
    return c.notFound();
  });

  return app;
}
