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

const GITHUB_API = "https://api.github.com";
const GITHUB_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;

const cache = new Map<string, { data: any; ts: number }>();
const statsCache = new Map<string, UserStats>();
const CACHE_TTL = 10 * 60 * 1000;
let githubRateLimitedUntil = 0;

function hashUsername(username: string): number {
  let hash = 0;
  for (const ch of username.toLowerCase()) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  }
  return hash;
}

function buildRateLimitedStats(username: string) {
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
    status: "inactive" as const,
    lastActive: null,
    created_at: now,
    dataSource: "estimated" as const,
    notice: "GitHub rate limits are active, so these stats are estimated until live data is available again.",
  };
}

async function fetchGitHub(path: string, env?: Record<string, string | undefined>) {
  if (Date.now() < githubRateLimitedUntil) {
    throw new Error("rate_limit");
  }
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "GitForest-App",
  };
  const ghToken = (env?.GITHUB_TOKEN) || (env?.GITHUB_PERSONAL_ACCESS_TOKEN)
    || (typeof process !== "undefined" ? (process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN) : undefined);
  if (ghToken) headers["Authorization"] = `token ${ghToken}`;

  const res = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!res.ok) {
    if (res.status === 404) throw new Error("User not found");
    if (res.status === 403 || res.status === 429) {
      githubRateLimitedUntil = Date.now() + GITHUB_RATE_LIMIT_COOLDOWN_MS;
      throw new Error("rate_limit");
    }
    throw new Error(`GitHub API error: ${res.status}`);
  }
  const data = await res.json();
  cache.set(path, { data, ts: Date.now() });
  return data;
}

async function getUserStats(username: string, env?: Record<string, string | undefined>) {
  if (normalizeUsername(username).startsWith("synthetic-dev-")) {
    return buildRateLimitedStats(username);
  }
  const user = await fetchGitHub(`/users/${username}`, env);
  let totalCommits = 0, totalStars = 0, totalForks = 0, activeDays = 0;
  let lastActive: string | null = null;
  let dataSource: "live" | "estimated" = "live";
  let notice: string | undefined;
  const languageCounts: Record<string, number> = {};

  try {
    const repos = await fetchGitHub(`/users/${username}/repos?per_page=100&sort=updated`, env);
    if (Array.isArray(repos)) {
      totalStars = repos.reduce((acc: number, r: any) => acc + (r.stargazers_count || 0), 0);
      totalForks = repos.reduce((acc: number, r: any) => acc + (r.forks_count || 0), 0);
      if (repos.length > 0 && repos[0].updated_at) lastActive = repos[0].updated_at;
      repos.forEach((r: any) => { if (r.language) languageCounts[r.language] = (languageCounts[r.language] || 0) + 1; });
      const ownRepos = repos.filter((r: any) => !r.fork);
      totalCommits = ownRepos.reduce((acc: number, r: any) => acc + Math.min(Math.max(Math.floor((r.size || 0) / 10), 1), 300), 0);
      totalCommits = Math.max(totalCommits, ownRepos.length * 8);
    }
  } catch (e: any) {
    if (e.message === "rate_limit") {
      dataSource = "estimated";
      notice = "Repository activity is currently estimated because GitHub rate limits are active.";
      totalCommits = user.public_repos * 10;
    }
  }

  const createdAt = new Date(user.created_at);
  const accountAgeDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  activeDays = Math.min(accountAgeDays, Math.floor(totalCommits * 0.65) + user.public_repos * 2);
  const topLanguages = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([lang]) => lang);

  let status: "active" | "moderate" | "occasional" | "inactive" = "inactive";
  if (lastActive) {
    const daysSince = Math.floor((Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24));
    status = daysSince < 7 ? "active" : daysSince < 30 ? "moderate" : daysSince < 90 ? "occasional" : "inactive";
  }

  return { login: user.login, name: user.name, avatar_url: user.avatar_url, bio: user.bio, followers: user.followers, following: user.following, public_repos: user.public_repos, html_url: user.html_url, location: user.location, company: user.company, totalCommits, activeDays, totalStars, totalForks, topLanguages, status, lastActive, created_at: user.created_at, dataSource, notice };
}

function clampRadius(value: number, fallback = WORLD_PRELOAD_RADIUS_CHUNKS) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(4, Math.trunc(value)));
}

function buildPlaceholderHints(user: Pick<TrackedWorldUser, "githubId" | "username">) {
  const hash = Number(user.githubId) || hashUsername(user.username);
  const commits = 120 + (hash % 7200);
  const statuses: UserStats["status"][] = ["active", "moderate", "occasional", "inactive"];
  return { totalCommitsHint: commits, statusHint: statuses[hash % statuses.length] };
}

function toChunkSummary(user: TrackedWorldUser): Pick<WorldChunkUserSummary, "hasStats" | "totalCommitsHint" | "statusHint"> {
  const cached = statsCache.get(normalizeUsername(user.username));
  if (!cached) return { hasStats: false, ...buildPlaceholderHints(user) };
  return { hasStats: true, totalCommitsHint: cached.totalCommits, statusHint: cached.status };
}

async function buildChunkResponse(cx: number, cz: number, radius: number): Promise<WorldChunkResponse> {
  const storage = await getStorage();
  const window = await storage.getChunkWindow(cx, cz, radius);
  return {
    center: window.center,
    radius: window.radius,
    chunks: window.chunks.map((chunk) => ({
      cx: chunk.cx, cz: chunk.cz,
      users: chunk.users.map((user) => ({
        githubId: user.githubId, username: user.username, chunkX: user.chunkX, chunkZ: user.chunkZ,
        cell: user.cell, worldSeed: user.worldSeed, planted: user.planted, source: user.source,
        ...toChunkSummary(user),
      })),
    })),
  };
}

export function createHonoApp() {
  const app = new Hono<{ Bindings: Record<string, string | undefined> }>();

  app.get("/api/users", async (c) => {
    try {
      const storage = await getStorage();
      return c.json(await storage.getTrackedUsers());
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/users", async (c) => {
    try {
      const body = await c.req.json();
      const { username } = addUserSchema.parse(body);
      const normalized = normalizeUsername(username);
      const storage = await getStorage();
      const existing = await storage.getTrackedUserLocation(normalized);
      if (existing?.planted) {
        return c.json({ username: existing.username, githubId: existing.githubId, chunkX: existing.chunkX, chunkZ: existing.chunkZ, cell: existing.cell, planted: true, source: existing.source, action: "already-planted" });
      }

      let profile;
      if (!existing) {
        try {
          const githubUser = await fetchGitHub(`/users/${normalized}`, c.env);
          profile = { githubId: githubUser.id, login: githubUser.login, avatarUrl: githubUser.avatar_url, htmlUrl: githubUser.html_url, type: githubUser.type };
        } catch (e: any) {
          if (e.message === "User not found") return c.json({ error: "GitHub user not found" }, 404);
          if (e.message === "rate_limit") return c.json({ error: "GitHub API rate limit reached. Try again in a minute, or add a GITHUB_TOKEN." }, 429);
          throw e;
        }
      }

      const user = await storage.addTrackedUser(normalized, profile);
      return c.json({ username: user.username, githubId: user.githubId, chunkX: user.chunkX, chunkZ: user.chunkZ, cell: user.cell, planted: user.planted, source: user.source, action: existing ? "planted" : "added-live" });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.delete("/api/users/:username", async (c) => {
    try {
      const storage = await getStorage();
      await storage.removeTrackedUser(c.req.param("username"));
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/search", async (c) => {
    try {
      const q = (c.req.query("q") || "").trim();
      if (!q || q.length < 1) return c.json({ live: [], world: [], liveError: null });
      const storage = await getStorage();
      const world = await storage.searchWorldUsers(q, 8);
      let live: WorldSearchResult[] = [];
      let liveError: string | null = null;
      try {
        const data = await fetchGitHub(`/search/users?q=${encodeURIComponent(q)}&per_page=8`, c.env);
        live = await Promise.all((data.items || []).map(async (user: any) => {
          const existing = await storage.getTrackedUserLocation(user.login);
          return { login: user.login, avatar_url: user.avatar_url, html_url: user.html_url, type: user.type, source: "live" as const, inWorld: Boolean(existing), planted: Boolean(existing?.planted), chunkX: existing?.chunkX, chunkZ: existing?.chunkZ, cell: existing?.cell };
        }));
      } catch (err: any) {
        if (err.message === "rate_limit") liveError = "GitHub search is rate-limited right now.";
        else throw err;
      }
      return c.json(mergeHybridSearchResults(world, live, { liveError }));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/users/:username/stats", async (c) => {
    try {
      const username = c.req.param("username");
      const stats = await getUserStats(username, c.env);
      statsCache.set(normalizeUsername(username), stats);
      return c.json(stats);
    } catch (err: any) {
      if (err.message === "User not found") return c.json({ error: "GitHub user not found" }, 404);
      if (err.message === "rate_limit") {
        const fallback = buildRateLimitedStats(c.req.param("username"));
        statsCache.set(normalizeUsername(c.req.param("username")), fallback);
        return c.json(fallback);
      }
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/world/bootstrap", async (c) => {
    try {
      const storage = await getStorage();
      const trackedCount = await storage.getTrackedCount();
      const catalogCount = await storage.getCatalogCount();
      const initialChunk = await storage.getSuggestedInitialChunk();
      const initialFocus = await storage.getSuggestedInitialFocus(initialChunk);
      const chunks = await buildChunkResponse(initialChunk.cx, initialChunk.cz, WORLD_BOOTSTRAP_RADIUS_CHUNKS);
      return c.json({ trackedCount, catalogCount, plantedCount: trackedCount, chunkSize: WORLD_CHUNK_SIZE, cellSize: WORLD_CELL_SIZE, renderRadiusChunks: WORLD_RENDER_RADIUS_CHUNKS, preloadRadiusChunks: WORLD_PRELOAD_RADIUS_CHUNKS, initialChunk, initialFocus, chunks: chunks.chunks });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/world/chunks", async (c) => {
    try {
      const cx = Math.trunc(Number(c.req.query("cx") ?? 0));
      const cz = Math.trunc(Number(c.req.query("cz") ?? 0));
      const radius = clampRadius(Number(c.req.query("radius")));
      return c.json(await buildChunkResponse(cx, cz, radius));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/world/users/:username/location", async (c) => {
    try {
      const storage = await getStorage();
      const trackedUser = await storage.getTrackedUserLocation(c.req.param("username"));
      if (!trackedUser) return c.json({ error: "Tracked user not found" }, 404);
      return c.json({ githubId: trackedUser.githubId, username: trackedUser.username, chunkX: trackedUser.chunkX, chunkZ: trackedUser.chunkZ, cell: trackedUser.cell, planted: trackedUser.planted, source: trackedUser.source });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}
