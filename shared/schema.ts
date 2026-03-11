import { z } from "zod";

export const githubUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string(),
  bio: z.string().nullable(),
  followers: z.number(),
  following: z.number(),
  public_repos: z.number(),
  html_url: z.string(),
  location: z.string().nullable(),
  company: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const trackedUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  addedAt: z.string(),
});

export const userStatsSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string(),
  bio: z.string().nullable(),
  followers: z.number(),
  following: z.number(),
  public_repos: z.number(),
  html_url: z.string(),
  location: z.string().nullable(),
  company: z.string().nullable(),
  totalCommits: z.number(),
  activeDays: z.number(),
  totalStars: z.number(),
  totalForks: z.number(),
  topLanguages: z.array(z.string()),
  status: z.enum(["active", "moderate", "occasional", "inactive"]),
  lastActive: z.string().nullable(),
  created_at: z.string(),
  dataSource: z.enum(["live", "estimated"]),
  notice: z.string().optional(),
});

export const worldUserSourceSchema = z.enum(["snapshot", "live"]);

export const WORLD_CHUNK_SIZE = 16;
export const WORLD_CELL_SIZE = 8;
export const WORLD_RENDER_RADIUS_CHUNKS = 1;
export const WORLD_PRELOAD_RADIUS_CHUNKS = 1;
export const WORLD_BOOTSTRAP_RADIUS_CHUNKS = 1;
export const WORLD_CHUNK_CELL_COUNT = WORLD_CHUNK_SIZE * WORLD_CHUNK_SIZE;
export const WORLD_CHUNK_SPAN = WORLD_CHUNK_SIZE * WORLD_CELL_SIZE;

export const trackedWorldUserSchema = trackedUserSchema.extend({
  githubId: z.number().int().nonnegative(),
  chunkX: z.number().int(),
  chunkZ: z.number().int(),
  cell: z.number().int().min(0).max(WORLD_CHUNK_CELL_COUNT - 1),
  worldSeed: z.number().int().nonnegative(),
  planted: z.boolean(),
  source: worldUserSourceSchema,
});

export const worldChunkUserSummarySchema = z.object({
  githubId: z.number().int().nonnegative(),
  username: z.string(),
  chunkX: z.number().int(),
  chunkZ: z.number().int(),
  cell: z.number().int().min(0).max(WORLD_CHUNK_CELL_COUNT - 1),
  worldSeed: z.number().int().nonnegative(),
  planted: z.boolean(),
  source: worldUserSourceSchema,
  hasStats: z.boolean(),
  totalCommitsHint: z.number().optional(),
  statusHint: userStatsSchema.shape.status.optional(),
});

export const worldChunkSchema = z.object({
  cx: z.number().int(),
  cz: z.number().int(),
  users: z.array(worldChunkUserSummarySchema),
});

export const worldChunkResponseSchema = z.object({
  center: z.object({
    cx: z.number().int(),
    cz: z.number().int(),
  }),
  radius: z.number().int().nonnegative(),
  chunks: z.array(worldChunkSchema),
});

export const worldBootstrapSchema = z.object({
  trackedCount: z.number().int().nonnegative(),
  catalogCount: z.number().int().nonnegative(),
  plantedCount: z.number().int().nonnegative(),
  chunkSize: z.number().int().positive(),
  cellSize: z.number().int().positive(),
  renderRadiusChunks: z.number().int().nonnegative(),
  preloadRadiusChunks: z.number().int().nonnegative(),
  initialChunk: z.object({
    cx: z.number().int(),
    cz: z.number().int(),
  }),
  initialFocus: z.object({
    chunkX: z.number().int(),
    chunkZ: z.number().int(),
    cell: z.number().int().min(0).max(WORLD_CHUNK_CELL_COUNT - 1),
  }).nullable(),
  chunks: z.array(worldChunkSchema),
});

export const worldUserLocationSchema = z.object({
  githubId: z.number().int().nonnegative(),
  username: z.string(),
  chunkX: z.number().int(),
  chunkZ: z.number().int(),
  cell: z.number().int().min(0).max(WORLD_CHUNK_CELL_COUNT - 1),
  planted: z.boolean(),
  source: worldUserSourceSchema,
});

export const worldSearchResultSchema = z.object({
  login: z.string(),
  avatar_url: z.string(),
  html_url: z.string(),
  type: z.string(),
  source: worldUserSourceSchema,
  inWorld: z.boolean(),
  planted: z.boolean(),
  chunkX: z.number().int().optional(),
  chunkZ: z.number().int().optional(),
  cell: z.number().int().min(0).max(WORLD_CHUNK_CELL_COUNT - 1).optional(),
});

export const worldSearchResponseSchema = z.object({
  live: z.array(worldSearchResultSchema),
  world: z.array(worldSearchResultSchema),
  liveError: z.string().nullable().optional(),
});

export const plantDeveloperResponseSchema = z.object({
  username: z.string(),
  githubId: z.number().int().nonnegative(),
  chunkX: z.number().int(),
  chunkZ: z.number().int(),
  cell: z.number().int().min(0).max(WORLD_CHUNK_CELL_COUNT - 1),
  planted: z.boolean(),
  source: worldUserSourceSchema,
  action: z.enum(["planted", "already-planted", "added-live"]),
});

export type GithubUser = z.infer<typeof githubUserSchema>;
export type TrackedUser = z.infer<typeof trackedUserSchema>;
export type TrackedWorldUser = z.infer<typeof trackedWorldUserSchema>;
export type UserStats = z.infer<typeof userStatsSchema>;
export type WorldUserSource = z.infer<typeof worldUserSourceSchema>;
export type WorldChunkUserSummary = z.infer<typeof worldChunkUserSummarySchema>;
export type WorldChunk = z.infer<typeof worldChunkSchema>;
export type WorldChunkResponse = z.infer<typeof worldChunkResponseSchema>;
export type WorldBootstrap = z.infer<typeof worldBootstrapSchema>;
export type WorldUserLocation = z.infer<typeof worldUserLocationSchema>;
export type WorldSearchResult = z.infer<typeof worldSearchResultSchema>;
export type WorldSearchResponse = z.infer<typeof worldSearchResponseSchema>;
export type PlantDeveloperResponse = z.infer<typeof plantDeveloperResponseSchema>;

export const addUserSchema = z.object({
  username: z.string().min(1).max(39),
});
export type AddUser = z.infer<typeof addUserSchema>;

export function chunkKey(cx: number, cz: number) {
  return `${cx}:${cz}`;
}

export function cellToGrid(cell: number) {
  return {
    x: cell % WORLD_CHUNK_SIZE,
    z: Math.floor(cell / WORLD_CHUNK_SIZE),
  };
}

export function worldPositionForCell(chunkX: number, chunkZ: number, cell: number) {
  const local = cellToGrid(cell);
  return {
    x: ((chunkX * WORLD_CHUNK_SIZE) + local.x + 0.5) * WORLD_CELL_SIZE,
    z: ((chunkZ * WORLD_CHUNK_SIZE) + local.z + 0.5) * WORLD_CELL_SIZE,
  };
}

export function worldChunkForPoint(x: number, z: number) {
  return {
    cx: Math.floor(x / WORLD_CHUNK_SPAN),
    cz: Math.floor(z / WORLD_CHUNK_SPAN),
  };
}
