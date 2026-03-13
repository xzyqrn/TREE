import { AppwriteClient } from "../server/appwrite-client";
import { ensureLocalEnvLoaded, readAppwriteEnv, stableRowId, type AppwriteEnv } from "../server/runtime-env";
import { STARTER_WORLD_USERS } from "../server/starter-users";
import { assignWorldSlot, hash32, normalizeUsername, slotKey } from "../server/world-grid";

type IndexType = "key" | "unique" | "fulltext";

interface AppwriteTableMetadata {
  $id: string;
  columns: Array<{
    key: string;
    type: string;
    status: string;
    elements?: string[];
  }>;
  indexes: Array<{
    key: string;
    status: string;
    type: string;
    columns: string[];
  }>;
}

interface WorldUserSeedRow {
  rowId: string;
  data: Record<string, unknown>;
}

interface LiveWorldUserRow {
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
  planted?: boolean;
  isActive?: boolean;
  addedAt?: string;
}

const UPSERT_BATCH_SIZE = 250;
const COLUMN_WAIT_TIMEOUT_MS = 90_000;
const COLUMN_WAIT_INTERVAL_MS = 1_000;
const TARGET_USERS_PER_CHUNK = 6;
const MIN_RADIUS_CHUNKS = 1;
const MAX_RADIUS_CHUNKS = 72;

function toStoredWorldSource(source: "snapshot" | "live") {
  return source === "snapshot" ? "snapsh" : "github";
}

class AppwriteAdmin {
  constructor(private readonly env: AppwriteEnv) {}

  private async request<ResponseShape>(
    method: string,
    pathname: string,
    body?: Record<string, unknown>,
  ): Promise<ResponseShape> {
    const base = this.env.endpoint.endsWith("/")
      ? this.env.endpoint.slice(0, -1)
      : this.env.endpoint;
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": this.env.projectId,
        "X-Appwrite-Key": this.env.apiKey,
        "X-Appwrite-Response-Format": "1.8.0",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(data?.message || `Appwrite request failed (${response.status})`);
    }
    return data as ResponseShape;
  }

  getTable(tableId: string) {
    return this.request<AppwriteTableMetadata>("GET", `/tablesdb/${this.env.databaseId}/tables/${tableId}`);
  }

  createBooleanColumn(tableId: string, key: string, required: boolean, xdefault?: boolean) {
    return this.request("POST", `/tablesdb/${this.env.databaseId}/tables/${tableId}/columns/boolean`, {
      key,
      required,
      default: xdefault,
    });
  }

  createDatetimeColumn(tableId: string, key: string, required: boolean, xdefault?: string) {
    return this.request("POST", `/tablesdb/${this.env.databaseId}/tables/${tableId}/columns/datetime`, {
      key,
      required,
      default: xdefault,
    });
  }

  createEnumColumn(tableId: string, key: string, elements: string[], required: boolean, xdefault?: string) {
    return this.request("POST", `/tablesdb/${this.env.databaseId}/tables/${tableId}/columns/enum`, {
      key,
      elements,
      required,
      default: xdefault,
    });
  }

  updateEnumColumn(tableId: string, key: string, elements: string[], required: boolean, xdefault: string) {
    return this.request("PATCH", `/tablesdb/${this.env.databaseId}/tables/${tableId}/columns/enum/${key}`, {
      elements,
      required,
      default: xdefault,
    });
  }

  createIntegerColumn(tableId: string, key: string, required: boolean, xdefault?: number) {
    return this.request("POST", `/tablesdb/${this.env.databaseId}/tables/${tableId}/columns/integer`, {
      key,
      required,
      default: xdefault,
    });
  }

  createLongtextColumn(tableId: string, key: string, required: boolean, xdefault?: string) {
    return this.request("POST", `/tablesdb/${this.env.databaseId}/tables/${tableId}/columns/longtext`, {
      key,
      required,
      default: xdefault,
    });
  }

  createVarcharColumn(tableId: string, key: string, size: number, required: boolean, xdefault?: string) {
    return this.request("POST", `/tablesdb/${this.env.databaseId}/tables/${tableId}/columns/varchar`, {
      key,
      size,
      required,
      default: xdefault,
    });
  }

  createIndex(
    tableId: string,
    key: string,
    type: IndexType,
    columns: string[],
    orders?: Array<"asc" | "desc">,
  ) {
    return this.request("POST", `/tablesdb/${this.env.databaseId}/tables/${tableId}/indexes`, {
      key,
      type,
      columns,
      orders,
    });
  }
}

function getRadiusCapForCount(count: number) {
  const requiredChunks = Math.max(1, Math.ceil(count / TARGET_USERS_PER_CHUNK));
  const radius = Math.ceil(Math.sqrt(requiredChunks / Math.PI));
  return Math.max(MIN_RADIUS_CHUNKS, Math.min(MAX_RADIUS_CHUNKS, radius));
}

function buildStarterWorldRows(now: string) {
  const occupiedSlots = new Set<string>();

  return STARTER_WORLD_USERS.map((displayLogin, index) => {
    const loginLower = normalizeUsername(displayLogin);
    const slot = assignWorldSlot(
      loginLower,
      (chunkX, chunkZ, cell) => occupiedSlots.has(slotKey(chunkX, chunkZ, cell)),
      {
        minRadiusChunks: MIN_RADIUS_CHUNKS,
        maxRadiusChunks: getRadiusCapForCount(index + 1),
      },
    );
    occupiedSlots.add(slotKey(slot.chunkX, slot.chunkZ, slot.cell));

    const githubId = String(hash32(`github:${loginLower}`));
    return {
      rowId: githubId,
      data: {
        loginLower,
        loginDisplay: displayLogin,
        githubId,
        avatarUrl: `https://github.com/${displayLogin}.png`,
        htmlUrl: `https://github.com/${displayLogin}`,
        accountType: "User",
        source: toStoredWorldSource("snapshot"),
        chunkX: slot.chunkX,
        chunkZ: slot.chunkZ,
        cell: slot.cell,
        worldSeed: slot.worldSeed,
        slotKey: slotKey(slot.chunkX, slot.chunkZ, slot.cell),
        planted: false,
        isActive: true,
        importRevision: "starter-seed",
        addedAt: now,
        plantedAt: null,
        lastSelectedAt: null,
        statsStatusHint: null,
        statsCommitsHint: null,
      },
    } satisfies WorldUserSeedRow;
  });
}

function arraysEqual(left: string[] | undefined, right: string[]) {
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function waitForTableReady(
  admin: AppwriteAdmin,
  tableId: string,
  expectedColumns: string[],
  expectedIndexes: string[],
) {
  const deadline = Date.now() + COLUMN_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const table = await admin.getTable(tableId);
    const columnsReady = expectedColumns.every((key) => table.columns.some((column) => column.key === key && column.status === "available"));
    const indexesReady = expectedIndexes.every((key) => table.indexes.some((index) => index.key === key && index.status === "available"));

    if (columnsReady && indexesReady) return;
    await new Promise((resolve) => setTimeout(resolve, COLUMN_WAIT_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for Appwrite table ${tableId} schema changes to finish`);
}

async function ensureWorldUsersSchema(admin: AppwriteAdmin, env: AppwriteEnv) {
  const table = await admin.getTable(env.worldUsersTableId);
  const columnKeys = new Set(table.columns.map((column) => column.key));
  const sourceColumn = table.columns.find((column) => column.key === "source");

  if (!sourceColumn) {
    await admin.createEnumColumn(env.worldUsersTableId, "source", ["snapsh", "github"], true);
  }

  if (!columnKeys.has("chunkX")) await admin.createIntegerColumn(env.worldUsersTableId, "chunkX", true);
  if (!columnKeys.has("chunkZ")) await admin.createIntegerColumn(env.worldUsersTableId, "chunkZ", true);
  if (!columnKeys.has("cell")) await admin.createIntegerColumn(env.worldUsersTableId, "cell", true);
  if (!columnKeys.has("worldSeed")) await admin.createIntegerColumn(env.worldUsersTableId, "worldSeed", true);
  if (!columnKeys.has("slotKey")) await admin.createVarcharColumn(env.worldUsersTableId, "slotKey", 255, true);
  if (!columnKeys.has("planted")) await admin.createBooleanColumn(env.worldUsersTableId, "planted", true);
  if (!columnKeys.has("isActive")) await admin.createBooleanColumn(env.worldUsersTableId, "isActive", true);
  if (!columnKeys.has("importRevision")) await admin.createVarcharColumn(env.worldUsersTableId, "importRevision", 255, false);
  if (!columnKeys.has("addedAt")) await admin.createDatetimeColumn(env.worldUsersTableId, "addedAt", true);
  if (!columnKeys.has("plantedAt")) await admin.createDatetimeColumn(env.worldUsersTableId, "plantedAt", false);
  if (!columnKeys.has("lastSelectedAt")) await admin.createDatetimeColumn(env.worldUsersTableId, "lastSelectedAt", false);
  if (!columnKeys.has("statsStatusHint")) {
    await admin.createEnumColumn(env.worldUsersTableId, "statsStatusHint", ["active", "moderate", "occasional", "inactive"], false);
  }
  if (!columnKeys.has("statsCommitsHint")) await admin.createIntegerColumn(env.worldUsersTableId, "statsCommitsHint", false);

  const indexKeys = new Set(table.indexes.map((index) => index.key));
  if (!indexKeys.has("world_users_login_lower_unique")) {
    await admin.createIndex(env.worldUsersTableId, "world_users_login_lower_unique", "unique", ["loginLower"], ["asc"]);
  }
  if (!indexKeys.has("world_users_slot_key_unique")) {
    await admin.createIndex(env.worldUsersTableId, "world_users_slot_key_unique", "unique", ["slotKey"], ["asc"]);
  }
  if (!indexKeys.has("world_users_chunk_lookup")) {
    await admin.createIndex(env.worldUsersTableId, "world_users_chunk_lookup", "key", ["chunkX", "chunkZ", "isActive", "cell"], ["asc", "asc", "asc", "asc"]);
  }
  if (!indexKeys.has("world_users_search_lookup")) {
    await admin.createIndex(env.worldUsersTableId, "world_users_search_lookup", "key", ["isActive", "loginLower"], ["asc", "asc"]);
  }
  if (!indexKeys.has("world_users_planted_selected")) {
    await admin.createIndex(env.worldUsersTableId, "world_users_planted_selected", "key", ["isActive", "planted", "lastSelectedAt"], ["asc", "asc", "desc"]);
  }
  if (!indexKeys.has("world_users_source_lookup")) {
    await admin.createIndex(env.worldUsersTableId, "world_users_source_lookup", "key", ["source", "isActive"], ["asc", "asc"]);
  }

  await waitForTableReady(
    admin,
    env.worldUsersTableId,
    [
      "source",
      "chunkX",
      "chunkZ",
      "cell",
      "worldSeed",
      "slotKey",
      "planted",
      "isActive",
      "importRevision",
      "addedAt",
      "plantedAt",
      "lastSelectedAt",
      "statsStatusHint",
      "statsCommitsHint",
    ],
    [
      "world_users_login_lower_unique",
      "world_users_slot_key_unique",
      "world_users_chunk_lookup",
      "world_users_search_lookup",
      "world_users_planted_selected",
      "world_users_source_lookup",
    ],
  );
}

async function ensureWorldChunksSchema(admin: AppwriteAdmin, env: AppwriteEnv) {
  const table = await admin.getTable(env.worldChunksTableId);
  const columnKeys = new Set(table.columns.map((column) => column.key));
  if (!columnKeys.has("isActive")) await admin.createBooleanColumn(env.worldChunksTableId, "isActive", true);

  const indexKeys = new Set(table.indexes.map((index) => index.key));
  if (!indexKeys.has("world_chunks_chunk_key_unique")) {
    await admin.createIndex(env.worldChunksTableId, "world_chunks_chunk_key_unique", "unique", ["chunkKey"], ["asc"]);
  }
  if (!indexKeys.has("world_chunks_bootstrap")) {
    await admin.createIndex(env.worldChunksTableId, "world_chunks_bootstrap", "key", ["isActive", "activeUserCount", "distanceScore"], ["asc", "desc", "asc"]);
  }
  if (!indexKeys.has("world_chunks_coords")) {
    await admin.createIndex(env.worldChunksTableId, "world_chunks_coords", "key", ["chunkX", "chunkZ"], ["asc", "asc"]);
  }

  await waitForTableReady(
    admin,
    env.worldChunksTableId,
    ["isActive"],
    ["world_chunks_chunk_key_unique", "world_chunks_bootstrap", "world_chunks_coords"],
  );
}

async function ensureGithubUserCacheSchema(admin: AppwriteAdmin, env: AppwriteEnv) {
  const table = await admin.getTable(env.githubUserCacheTableId);
  const columnKeys = new Set(table.columns.map((column) => column.key));
  if (!columnKeys.has("lastLiveSeenAt")) await admin.createDatetimeColumn(env.githubUserCacheTableId, "lastLiveSeenAt", false);
  if (!columnKeys.has("inWorld")) await admin.createBooleanColumn(env.githubUserCacheTableId, "inWorld", true);
  if (!columnKeys.has("worldChunkX")) await admin.createIntegerColumn(env.githubUserCacheTableId, "worldChunkX", false);
  if (!columnKeys.has("worldChunkZ")) await admin.createIntegerColumn(env.githubUserCacheTableId, "worldChunkZ", false);
  if (!columnKeys.has("worldCell")) await admin.createIntegerColumn(env.githubUserCacheTableId, "worldCell", false);

  const indexKeys = new Set(table.indexes.map((index) => index.key));
  if (!indexKeys.has("github_user_cache_login_lower_unique")) {
    await admin.createIndex(env.githubUserCacheTableId, "github_user_cache_login_lower_unique", "unique", ["loginLower"], ["asc"]);
  }

  await waitForTableReady(
    admin,
    env.githubUserCacheTableId,
    ["lastLiveSeenAt", "inWorld", "worldChunkX", "worldChunkZ", "worldCell"],
    ["github_user_cache_login_lower_unique"],
  );
}

async function ensureGithubStatsCacheSchema(admin: AppwriteAdmin, env: AppwriteEnv) {
  const table = await admin.getTable(env.githubStatsCacheTableId);
  const columnKeys = new Set(table.columns.map((column) => column.key));
  if (!columnKeys.has("payload")) await admin.createLongtextColumn(env.githubStatsCacheTableId, "payload", true);

  const indexKeys = new Set(table.indexes.map((index) => index.key));
  if (!indexKeys.has("gh_stats_login_lower_uq")) {
    await admin.createIndex(env.githubStatsCacheTableId, "gh_stats_login_lower_uq", "unique", ["loginLower"], ["asc"]);
  }

  await waitForTableReady(
    admin,
    env.githubStatsCacheTableId,
    ["payload"],
    ["gh_stats_login_lower_uq"],
  );
}

async function seedStarterWorldIfEmpty(client: AppwriteClient, env: AppwriteEnv) {
  const existingWorld = await client.listRows<LiveWorldUserRow>(
    env.worldUsersTableId,
    [],
    { total: true },
  );
  if (existingWorld.total > 0) {
    return { seeded: false, inserted: 0 };
  }

  const now = new Date().toISOString();
  const worldRows = buildStarterWorldRows(now);
  await client.upsertRows(env.worldUsersTableId, worldRows);

  const cacheRows = worldRows.map((row) => ({
    rowId: row.rowId,
    data: {
      loginLower: row.data.loginLower,
      loginDisplay: row.data.loginDisplay,
      githubId: row.data.githubId,
      avatarUrl: row.data.avatarUrl,
      htmlUrl: row.data.htmlUrl,
      accountType: row.data.accountType,
      lastLiveSeenAt: now,
      lastLiveSeen: now,
      inWorld: true,
      worldChunkX: row.data.chunkX,
      worldChunkZ: row.data.chunkZ,
      worldCell: row.data.cell,
    },
  }));
  await client.upsertRows(env.githubUserCacheTableId, cacheRows);

  await client.upsertRow(env.catalogRevisionsTableId, "starter-seed", {
    revisionId: "starter-seed",
    sourcePath: "starter-users",
    recordCount: worldRows.length,
    isActive: true,
    createdAt: now,
    activatedAt: now,
  });

  return { seeded: true, inserted: worldRows.length };
}

async function syncDerivedTables(client: AppwriteClient, env: AppwriteEnv) {
  const worldRows = await client.listAllRows<LiveWorldUserRow>(env.worldUsersTableId, [], UPSERT_BATCH_SIZE);
  const activeRows = worldRows.filter((row) => row.isActive !== false);
  const now = new Date().toISOString();
  const chunkCounts = new Map<string, { chunkX: number; chunkZ: number; activeUserCount: number; plantedUserCount: number }>();

  for (const row of activeRows) {
    const key = `${row.chunkX}:${row.chunkZ}`;
    const summary = chunkCounts.get(key) ?? {
      chunkX: row.chunkX,
      chunkZ: row.chunkZ,
      activeUserCount: 0,
      plantedUserCount: 0,
    };
    summary.activeUserCount += 1;
    if (row.planted) summary.plantedUserCount += 1;
    chunkCounts.set(key, summary);
  }

  const cacheRows = activeRows.map((row) => ({
    rowId: String(row.githubId),
    data: {
      loginLower: row.loginLower,
      loginDisplay: row.loginDisplay,
      githubId: row.githubId,
      avatarUrl: row.avatarUrl,
      htmlUrl: row.htmlUrl,
      accountType: row.accountType,
      lastLiveSeenAt: row.addedAt ?? now,
      lastLiveSeen: row.addedAt ?? now,
      inWorld: true,
      worldChunkX: row.chunkX,
      worldChunkZ: row.chunkZ,
      worldCell: row.cell,
    },
  }));
  for (let index = 0; index < cacheRows.length; index += UPSERT_BATCH_SIZE) {
    await client.upsertRows(env.githubUserCacheTableId, cacheRows.slice(index, index + UPSERT_BATCH_SIZE));
  }

  const chunkRows = Array.from(chunkCounts.entries()).map(([chunkKeyValue, chunk]) => ({
    rowId: stableRowId("chunk", chunkKeyValue),
    data: {
      chunkKey: chunkKeyValue,
      chunkX: chunk.chunkX,
      chunkZ: chunk.chunkZ,
      activeUserCount: chunk.activeUserCount,
      plantedUserCount: chunk.plantedUserCount,
      distanceScore: (chunk.chunkX * chunk.chunkX) + (chunk.chunkZ * chunk.chunkZ),
      isActive: chunk.activeUserCount > 0,
    },
  }));
  for (let index = 0; index < chunkRows.length; index += UPSERT_BATCH_SIZE) {
    await client.upsertRows(env.worldChunksTableId, chunkRows.slice(index, index + UPSERT_BATCH_SIZE));
  }

  const existingChunks = await client.listAllRows<{ $id: string; chunkKey: string }>(
    env.worldChunksTableId,
    [],
    UPSERT_BATCH_SIZE,
  );
  for (const row of existingChunks) {
    if (chunkCounts.has(row.chunkKey)) continue;
    await client.upsertRow(env.worldChunksTableId, row.$id, {
      chunkKey: row.chunkKey,
      activeUserCount: 0,
      plantedUserCount: 0,
      isActive: false,
    });
  }

  return {
    activeUsers: activeRows.length,
    chunks: chunkRows.length,
  };
}

async function main() {
  await ensureLocalEnvLoaded();

  const env = readAppwriteEnv();
  const admin = new AppwriteAdmin(env);
  const client = new AppwriteClient(env);

  await ensureWorldUsersSchema(admin, env);
  await ensureWorldChunksSchema(admin, env);
  await ensureGithubUserCacheSchema(admin, env);
  await ensureGithubStatsCacheSchema(admin, env);

  const seedSummary = await seedStarterWorldIfEmpty(client, env);
  const derivedSummary = await syncDerivedTables(client, env);

  console.log(JSON.stringify({
    databaseId: env.databaseId,
    seededStarterWorld: seedSummary.seeded,
    seededUsers: seedSummary.inserted,
    activeUsers: derivedSummary.activeUsers,
    chunkCount: derivedSummary.chunks,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
