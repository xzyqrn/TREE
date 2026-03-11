import { createReadStream } from "fs";
import readline from "readline";
import { randomUUID } from "crypto";
import { createGunzip } from "zlib";

import type { PoolClient } from "pg";
import { createCatalogPool, ensureCatalogTables } from "../server/catalog-storage";
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

const INSERT_BATCH_SIZE = 1000;
const READ_BATCH_SIZE = 5000;

function usage() {
  console.log("Usage: npm run import:github-world -- <snapshot.ndjson.gz>");
}

function normalizeRow(raw: SnapshotRow) {
  if (!raw?.id || !raw?.login) {
    throw new Error("Snapshot row must include numeric id and login");
  }

  return {
    githubId: Number(raw.id),
    login: raw.login,
    loginLower: raw.login.toLowerCase(),
    avatarUrl: raw.avatar_url || `https://github.com/${raw.login}.png`,
    htmlUrl: raw.html_url || `https://github.com/${raw.login}`,
    type: raw.type || "User",
  };
}

async function insertStageBatch(client: PoolClient, batch: ReturnType<typeof normalizeRow>[]) {
  if (batch.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];

  batch.forEach((row, index) => {
    const offset = index * 6;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
    params.push(row.githubId, row.login, row.loginLower, row.avatarUrl, row.htmlUrl, row.type);
  });

  await client.query(
    `
      INSERT INTO github_world_import_stage (
        github_id,
        login,
        login_lower,
        avatar_url,
        html_url,
        type
      ) VALUES ${values.join(", ")}
    `,
    params,
  );
}

async function readSnapshotIntoStage(client: PoolClient, sourcePath: string) {
  const stageBatch: ReturnType<typeof normalizeRow>[] = [];
  const input = createReadStream(sourcePath);
  const stream = sourcePath.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let count = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    stageBatch.push(normalizeRow(JSON.parse(line) as SnapshotRow));
    if (stageBatch.length >= INSERT_BATCH_SIZE) {
      await insertStageBatch(client, stageBatch);
      count += stageBatch.length;
      stageBatch.length = 0;
    }
  }

  if (stageBatch.length > 0) {
    await insertStageBatch(client, stageBatch);
    count += stageBatch.length;
  }

  return count;
}

async function insertCatalogBatch(
  client: PoolClient,
  revisionId: string,
  cursor: ReturnType<typeof createSpiralChunkCursor>,
  rows: Array<{
    github_id: string;
    login: string;
    login_lower: string;
    avatar_url: string;
    html_url: string;
    type: string;
  }>,
  rankStart: number,
) {
  const params: unknown[] = [];
  const values: string[] = [];

  rows.forEach((row, index) => {
    const rank = rankStart + index;
    const chunkIndex = Math.floor(rank / USERS_PER_SNAPSHOT_CHUNK);
    const chunk = cursor.advanceTo(chunkIndex);
    const cell = snapshotCellForIndex(rank);
    const worldSeed = hash32(`${row.github_id}:snapshot`);
    const offset = index * 11;
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, 'snapshot', $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, NOW(), NOW())`,
    );
    params.push(
      Number(row.github_id),
      row.login,
      row.login_lower,
      row.avatar_url,
      row.html_url,
      row.type,
      chunk.chunkX,
      chunk.chunkZ,
      cell,
      worldSeed,
      revisionId,
    );
  });

  await client.query(
    `
      INSERT INTO github_world_catalog (
        github_id,
        login,
        login_lower,
        avatar_url,
        html_url,
        type,
        source,
        chunk_x,
        chunk_z,
        cell,
        world_seed,
        import_revision,
        created_at,
        updated_at
      ) VALUES ${values.join(", ")}
    `,
    params,
  );
}

async function buildCatalogRevision(client: PoolClient, revisionId: string) {
  let lastGithubId = 0;
  let inserted = 0;
  const cursor = createSpiralChunkCursor();

  while (true) {
    const batch = await client.query<{
      github_id: string;
      login: string;
      login_lower: string;
      avatar_url: string;
      html_url: string;
      type: string;
    }>(
      `
        SELECT github_id::text, login, login_lower, avatar_url, html_url, type
        FROM github_world_import_stage
        WHERE github_id > $1
        ORDER BY github_id ASC
        LIMIT $2
      `,
      [lastGithubId, READ_BATCH_SIZE],
    );

    if (batch.rows.length === 0) break;

    await insertCatalogBatch(client, revisionId, cursor, batch.rows, inserted);
    inserted += batch.rows.length;
    lastGithubId = Number(batch.rows[batch.rows.length - 1].github_id);
  }

  return inserted;
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const pool = createCatalogPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required to import the GitHub world catalog");
  }

  const revisionId = process.env.GITHUB_WORLD_REVISION || randomUUID();
  const client = await pool.connect();

  try {
    await ensureCatalogTables(pool);
    await client.query(`CREATE TEMP TABLE github_world_import_stage (github_id BIGINT PRIMARY KEY, login TEXT NOT NULL, login_lower TEXT NOT NULL, avatar_url TEXT NOT NULL, html_url TEXT NOT NULL, type TEXT NOT NULL) ON COMMIT DROP`);
    await client.query(
      `
        INSERT INTO catalog_revisions (revision_id, source_path, record_count, is_active, created_at, activated_at)
        VALUES ($1, $2, 0, FALSE, NOW(), NULL)
        ON CONFLICT (revision_id)
        DO UPDATE SET source_path = EXCLUDED.source_path
      `,
      [revisionId, sourcePath],
    );

    const stagedCount = await readSnapshotIntoStage(client, sourcePath);
    await client.query(
      `
        DELETE FROM github_world_catalog AS live
        USING github_world_import_stage AS stage
        WHERE live.source = 'live'
          AND live.github_id = stage.github_id
      `,
    );
    await client.query(`DELETE FROM github_world_catalog WHERE import_revision = $1`, [revisionId]);
    const insertedCount = await buildCatalogRevision(client, revisionId);

    await client.query(`UPDATE catalog_revisions SET is_active = FALSE, activated_at = NULL WHERE is_active = TRUE AND revision_id <> $1`, [revisionId]);
    await client.query(
      `
        UPDATE catalog_revisions
        SET is_active = TRUE,
            activated_at = NOW(),
            record_count = $2
        WHERE revision_id = $1
      `,
      [revisionId, insertedCount],
    );
    await client.query(`DELETE FROM github_world_catalog WHERE source = 'snapshot' AND import_revision <> $1`, [revisionId]);
    await client.query(`DELETE FROM catalog_revisions WHERE revision_id <> $1 AND is_active = FALSE`, [revisionId]);

    console.log(JSON.stringify({
      revisionId,
      stagedCount,
      insertedCount,
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
