import { createReadStream } from "fs";
import { randomUUID } from "crypto";
import readline from "readline";
import { createGunzip } from "zlib";

import { AppwriteClient, AppwriteQuery } from "../server/appwrite-client";
import { ensureLocalEnvLoaded, readAppwriteEnv, stableRowId } from "../server/runtime-env";
import {
  USERS_PER_SNAPSHOT_CHUNK,
  createSpiralChunkCursor,
  hash32,
  snapshotCellForIndex,
} from "../server/world-grid";

interface SnapshotRow {
  id: number;
  login: string;
  avatar_url?: string;
  html_url?: string;
  type?: string;
}

interface WorldUserRowInput {
  rowId: string;
  data: Record<string, unknown>;
}

const UPSERT_BATCH_SIZE = 250;

function toStoredWorldSource(source: "snapshot" | "live") {
  return source === "snapshot" ? "snapsh" : "github";
}

function usage() {
  console.log("Usage: npm run import:github-world -- <snapshot.ndjson.gz>");
}

function normalizeRow(raw: SnapshotRow) {
  if (!raw?.id || !raw?.login) {
    throw new Error("Snapshot row must include numeric id and login");
  }

  return {
    githubId: String(raw.id),
    login: raw.login,
    loginLower: raw.login.toLowerCase(),
    avatarUrl: raw.avatar_url || `https://github.com/${raw.login}.png`,
    htmlUrl: raw.html_url || `https://github.com/${raw.login}`,
    type: raw.type || "User",
  };
}

async function* readSnapshotRows(sourcePath: string) {
  const input = createReadStream(sourcePath);
  const stream = sourcePath.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    yield normalizeRow(JSON.parse(line) as SnapshotRow);
  }
}

async function upsertWorldUsers(
  client: AppwriteClient,
  tableId: string,
  rows: WorldUserRowInput[],
) {
  if (rows.length === 0) return;
  await client.upsertRows(tableId, rows);
}

async function main() {
  await ensureLocalEnvLoaded();

  const sourcePath = process.argv[2];
  if (!sourcePath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const env = readAppwriteEnv();
  const client = new AppwriteClient(env);
  const revisionId = process.env.GITHUB_WORLD_REVISION || randomUUID();
  const cursor = createSpiralChunkCursor();
  const now = new Date().toISOString();
  const pendingRows: WorldUserRowInput[] = [];
  const chunkCounts = new Map<string, { chunkX: number; chunkZ: number; activeUserCount: number; plantedUserCount: number }>();

  let insertedCount = 0;

  for await (const row of readSnapshotRows(sourcePath)) {
    const chunkIndex = Math.floor(insertedCount / USERS_PER_SNAPSHOT_CHUNK);
    const chunk = cursor.advanceTo(chunkIndex);
    const cell = snapshotCellForIndex(insertedCount);
    const chunkKey = `${chunk.chunkX}:${chunk.chunkZ}`;
    const counts = chunkCounts.get(chunkKey) ?? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ, activeUserCount: 0, plantedUserCount: 0 };
    counts.activeUserCount += 1;
    chunkCounts.set(chunkKey, counts);

    pendingRows.push({
      rowId: row.githubId,
      data: {
        loginLower: row.loginLower,
        loginDisplay: row.login,
        githubId: row.githubId,
        avatarUrl: row.avatarUrl,
        htmlUrl: row.htmlUrl,
        accountType: row.type,
        source: toStoredWorldSource("snapshot"),
        chunkX: chunk.chunkX,
        chunkZ: chunk.chunkZ,
        cell,
        worldSeed: hash32(`${row.githubId}:snapshot`),
        slotKey: `${chunk.chunkX}:${chunk.chunkZ}:${cell}`,
        planted: false,
        isActive: true,
        importRevision: revisionId,
        addedAt: now,
        plantedAt: null,
        lastSelectedAt: null,
        statsStatusHint: null,
        statsCommitsHint: null,
      },
    });

    insertedCount += 1;

    if (pendingRows.length >= UPSERT_BATCH_SIZE) {
      await upsertWorldUsers(client, env.worldUsersTableId, pendingRows);
      pendingRows.length = 0;
    }
  }

  if (pendingRows.length > 0) {
    await upsertWorldUsers(client, env.worldUsersTableId, pendingRows);
  }

  const activeLiveUsers = await client.listAllRows<{
    $id: string;
    chunkX: number;
    chunkZ: number;
    planted: boolean;
  }>(
    env.worldUsersTableId,
    [
      AppwriteQuery.equal("source", [toStoredWorldSource("live")]),
      AppwriteQuery.equal("isActive", [true]),
    ],
    250,
  );

  activeLiveUsers.forEach((row) => {
    const chunkKey = `${row.chunkX}:${row.chunkZ}`;
    const counts = chunkCounts.get(chunkKey) ?? { chunkX: row.chunkX, chunkZ: row.chunkZ, activeUserCount: 0, plantedUserCount: 0 };
    counts.activeUserCount += 1;
    if (row.planted) counts.plantedUserCount += 1;
    chunkCounts.set(chunkKey, counts);
  });

  const chunkRows = Array.from(chunkCounts.entries()).map(([chunkKey, value]) => ({
    rowId: stableRowId("chunk", chunkKey),
    data: {
      chunkKey,
      chunkX: value.chunkX,
      chunkZ: value.chunkZ,
      activeUserCount: value.activeUserCount,
      plantedUserCount: value.plantedUserCount,
      distanceScore: (value.chunkX * value.chunkX) + (value.chunkZ * value.chunkZ),
      isActive: value.activeUserCount > 0,
    },
  }));

  for (let index = 0; index < chunkRows.length; index += UPSERT_BATCH_SIZE) {
    await client.upsertRows(env.worldChunksTableId, chunkRows.slice(index, index + UPSERT_BATCH_SIZE));
  }

  const existingSnapshots = await client.listAllRows<{
    $id: string;
    source: "snapshot" | "live";
    importRevision?: string | null;
  }>(
    env.worldUsersTableId,
    [AppwriteQuery.equal("source", [toStoredWorldSource("snapshot")])],
    250,
  );

  for (const row of existingSnapshots) {
    if (row.importRevision === revisionId) continue;
    await client.upsertRow(env.worldUsersTableId, row.$id, {
      isActive: false,
      importRevision: row.importRevision ?? null,
    });
  }

  const existingChunks = await client.listAllRows<{ $id: string; chunkKey: string }>(
    env.worldChunksTableId,
    [],
    250,
  );

  for (const row of existingChunks) {
    if (chunkCounts.has(row.chunkKey)) continue;
    await client.upsertRow(env.worldChunksTableId, row.$id, {
      activeUserCount: 0,
      plantedUserCount: 0,
      isActive: false,
    });
  }

  await client.upsertRow(env.catalogRevisionsTableId, revisionId, {
    revisionId,
    sourcePath,
    recordCount: insertedCount,
    isActive: true,
    createdAt: now,
    activatedAt: now,
  });

  console.log(JSON.stringify({
    revisionId,
    insertedCount,
    chunkCount: chunkRows.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
