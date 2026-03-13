import { createCatalogPool } from "../server/catalog-storage";
import { AppwriteClient } from "../server/appwrite-client";
import { ensureLocalEnvLoaded, readAppwriteEnv, stableRowId } from "../server/runtime-env";

const ACTIVE_CATALOG_QUERY = `
WITH active_revision AS (
  SELECT revision_id
  FROM catalog_revisions
  WHERE is_active = TRUE
  ORDER BY COALESCE(activated_at, created_at) DESC
  LIMIT 1
),
active_catalog AS (
  SELECT DISTINCT ON (catalog.github_id)
    catalog.github_id,
    catalog.login,
    catalog.login_lower,
    catalog.avatar_url,
    catalog.html_url,
    catalog.type,
    catalog.source,
    catalog.chunk_x,
    catalog.chunk_z,
    catalog.cell,
    catalog.world_seed,
    catalog.import_revision,
    catalog.created_at,
    planted.planted_at,
    planted.last_selected_at,
    (planted.github_id IS NOT NULL) AS planted
  FROM github_world_catalog AS catalog
  LEFT JOIN planted_developers AS planted ON planted.github_id = catalog.github_id
  LEFT JOIN active_revision AS active ON TRUE
  WHERE catalog.source = 'live' OR catalog.import_revision = active.revision_id
  ORDER BY
    catalog.github_id,
    CASE WHEN catalog.source = 'snapshot' THEN 0 ELSE 1 END,
    catalog.updated_at DESC
)
SELECT *
FROM active_catalog
ORDER BY chunk_z ASC, chunk_x ASC, cell ASC
`;

interface ActiveCatalogRow {
  github_id: string | number;
  login: string;
  login_lower: string;
  avatar_url: string;
  html_url: string;
  type: string;
  source: "snapshot" | "live";
  chunk_x: string | number;
  chunk_z: string | number;
  cell: string | number;
  world_seed: string | number;
  import_revision?: string | null;
  created_at: string;
  planted_at?: string | null;
  last_selected_at?: string | null;
  planted: boolean;
}

const UPSERT_BATCH_SIZE = 250;

function toStoredWorldSource(source: "snapshot" | "live") {
  return source === "snapshot" ? "snapsh" : "github";
}

async function main() {
  await ensureLocalEnvLoaded();

  const pool = createCatalogPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required for postgres-to-appwrite migration");
  }

  const env = readAppwriteEnv();
  const client = new AppwriteClient(env);

  try {
    const result = await pool.query<ActiveCatalogRow>(ACTIVE_CATALOG_QUERY);
    const rows = result.rows;
    const chunkCounts = new Map<string, { chunkX: number; chunkZ: number; activeUserCount: number; plantedUserCount: number }>();

    for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + UPSERT_BATCH_SIZE);

      await client.upsertRows(env.worldUsersTableId, batch.map((row) => {
        const chunkX = Number(row.chunk_x);
        const chunkZ = Number(row.chunk_z);
        const cell = Number(row.cell);
        const chunkKey = `${chunkX}:${chunkZ}`;
        const counts = chunkCounts.get(chunkKey) ?? { chunkX, chunkZ, activeUserCount: 0, plantedUserCount: 0 };
        counts.activeUserCount += 1;
        if (row.planted) counts.plantedUserCount += 1;
        chunkCounts.set(chunkKey, counts);

        return {
          rowId: String(row.github_id),
          data: {
            loginLower: row.login_lower,
            loginDisplay: row.login,
            githubId: String(row.github_id),
            avatarUrl: row.avatar_url,
            htmlUrl: row.html_url,
            accountType: row.type,
            source: toStoredWorldSource(row.source),
            chunkX,
            chunkZ,
            cell,
            worldSeed: Number(row.world_seed),
            slotKey: `${chunkX}:${chunkZ}:${cell}`,
            planted: row.planted,
            isActive: true,
            importRevision: row.import_revision ?? null,
            addedAt: row.created_at,
            plantedAt: row.planted_at ?? null,
            lastSelectedAt: row.last_selected_at ?? null,
            statsStatusHint: null,
            statsCommitsHint: null,
          },
        };
      }));

      await client.upsertRows(env.githubUserCacheTableId, batch.map((row) => ({
        rowId: String(row.github_id),
        data: {
          loginLower: row.login_lower,
          loginDisplay: row.login,
          githubId: String(row.github_id),
          avatarUrl: row.avatar_url,
          htmlUrl: row.html_url,
          accountType: row.type,
          lastLiveSeenAt: new Date().toISOString(),
          inWorld: true,
          worldChunkX: Number(row.chunk_x),
          worldChunkZ: Number(row.chunk_z),
          worldCell: Number(row.cell),
        },
      })));
    }

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

    console.log(JSON.stringify({
      migratedUsers: rows.length,
      migratedChunks: chunkRows.length,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
