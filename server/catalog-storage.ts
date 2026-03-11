import { Pool } from "pg";

import type {
  TrackedWorldUser,
  WorldSearchResult,
  WorldUserSource,
} from "@shared/schema";
import { WORLD_CHUNK_SIZE } from "@shared/schema";
import { candidateWorldSlots, hash32, normalizeUsername } from "./world-grid";
import type { CatalogUserProfile, IStorage, WorldChunkWindow } from "./storage-types";

const REQUIRED_TABLES = [
  "github_world_catalog",
  "planted_developers",
  "catalog_revisions",
] as const;

const ACTIVE_CATALOG_CTE = `
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
    catalog.created_at,
    catalog.updated_at,
    planted.planted_at,
    planted.last_selected_at,
    COALESCE(planted.pinned, FALSE) AS pinned,
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
`;

interface CatalogRow {
  github_id: number | string;
  login: string;
  login_lower: string;
  avatar_url: string;
  html_url: string;
  type: string;
  source: WorldUserSource;
  chunk_x: number | string;
  chunk_z: number | string;
  cell: number | string;
  world_seed: number | string;
  planted: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
  planted_at?: string | Date | null;
  last_selected_at?: string | Date | null;
}

function toNumber(value: number | string | null | undefined) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function toIsoDate(value: string | Date | null | undefined) {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToTrackedUser(row: CatalogRow): TrackedWorldUser {
  return {
    id: String(row.github_id),
    githubId: toNumber(row.github_id),
    username: row.login_lower ?? normalizeUsername(row.login),
    addedAt: toIsoDate(row.planted_at ?? row.updated_at ?? row.created_at),
    chunkX: toNumber(row.chunk_x),
    chunkZ: toNumber(row.chunk_z),
    cell: toNumber(row.cell),
    worldSeed: toNumber(row.world_seed),
    planted: Boolean(row.planted),
    source: row.source,
  };
}

function rowToSearchResult(row: CatalogRow): WorldSearchResult {
  return {
    login: row.login,
    avatar_url: row.avatar_url,
    html_url: row.html_url,
    type: row.type,
    source: row.source,
    inWorld: true,
    planted: Boolean(row.planted),
    chunkX: toNumber(row.chunk_x),
    chunkZ: toNumber(row.chunk_z),
    cell: toNumber(row.cell),
  };
}

export function createCatalogPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) return null;
  return new Pool({
    connectionString,
    max: 8,
  });
}

export async function ensureCatalogTables(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_revisions (
      revision_id TEXT PRIMARY KEY,
      source_path TEXT,
      record_count BIGINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      activated_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS github_world_catalog (
      catalog_id BIGSERIAL PRIMARY KEY,
      github_id BIGINT NOT NULL,
      login TEXT NOT NULL,
      login_lower TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      html_url TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('snapshot', 'live')),
      chunk_x INTEGER NOT NULL,
      chunk_z INTEGER NOT NULL,
      cell SMALLINT NOT NULL,
      world_seed INTEGER NOT NULL,
      import_revision TEXT REFERENCES catalog_revisions(revision_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS planted_developers (
      github_id BIGINT PRIMARY KEY,
      planted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_selected_at TIMESTAMPTZ,
      pinned BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS github_world_catalog_github_id_idx ON github_world_catalog (github_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS github_world_catalog_login_lower_idx ON github_world_catalog (login_lower);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS github_world_catalog_revision_idx ON github_world_catalog (import_revision, chunk_x, chunk_z, cell);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS github_world_catalog_live_idx ON github_world_catalog (source, chunk_x, chunk_z, cell);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS planted_developers_last_selected_idx ON planted_developers (last_selected_at DESC, planted_at DESC);`);
}

async function catalogTablesReady(pool: Pool) {
  const result = await pool.query<{ table_name: string | null }>(
    `
      SELECT to_regclass($1) AS table_name
      UNION ALL SELECT to_regclass($2)
      UNION ALL SELECT to_regclass($3)
    `,
    REQUIRED_TABLES.map((name) => `public.${name}`),
  );
  return result.rows.every((row) => row.table_name !== null);
}

export class PostgresCatalogStorage implements IStorage {
  constructor(private readonly pool: Pool) {}

  static async createFromEnv() {
    const pool = createCatalogPool();
    if (!pool) return null;
    try {
      const ready = await catalogTablesReady(pool);
      if (!ready) {
        await pool.end();
        return null;
      }
      return new PostgresCatalogStorage(pool);
    } catch {
      await pool.end().catch(() => undefined);
      return null;
    }
  }

  async getTrackedUsers(): Promise<TrackedWorldUser[]> {
    const result = await this.pool.query<CatalogRow>(`
      ${ACTIVE_CATALOG_CTE}
      SELECT *
      FROM active_catalog
      WHERE planted = TRUE
      ORDER BY COALESCE(last_selected_at, planted_at) DESC NULLS LAST, login_lower ASC
    `);
    return result.rows.map(rowToTrackedUser);
  }

  async getTrackedCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(`
      ${ACTIVE_CATALOG_CTE}
      SELECT COUNT(*)::text AS count
      FROM active_catalog
      WHERE planted = TRUE
    `);
    return Number(result.rows[0]?.count ?? 0);
  }

  async getCatalogCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(`
      ${ACTIVE_CATALOG_CTE}
      SELECT COUNT(*)::text AS count
      FROM active_catalog
    `);
    return Number(result.rows[0]?.count ?? 0);
  }

  async getSuggestedInitialChunk(): Promise<{ cx: number; cz: number }> {
    const planted = await this.pool.query<CatalogRow>(`
      ${ACTIVE_CATALOG_CTE}
      SELECT *
      FROM active_catalog
      WHERE planted = TRUE
      ORDER BY COALESCE(last_selected_at, planted_at) DESC NULLS LAST, login_lower ASC
      LIMIT 1
    `);
    if (planted.rows[0]) {
      return {
        cx: toNumber(planted.rows[0].chunk_x),
        cz: toNumber(planted.rows[0].chunk_z),
      };
    }

    const densest = await this.pool.query<{ chunk_x: string; chunk_z: string }>(`
      ${ACTIVE_CATALOG_CTE}
      SELECT chunk_x::text, chunk_z::text
      FROM active_catalog
      GROUP BY chunk_x, chunk_z
      ORDER BY COUNT(*) DESC, ((chunk_x * chunk_x) + (chunk_z * chunk_z)) ASC
      LIMIT 1
    `);
    if (!densest.rows[0]) {
      return { cx: 0, cz: 0 };
    }
    return {
      cx: Number(densest.rows[0].chunk_x),
      cz: Number(densest.rows[0].chunk_z),
    };
  }

  async getSuggestedInitialFocus(chunk: { cx: number; cz: number }): Promise<{ chunkX: number; chunkZ: number; cell: number } | null> {
    const center = (WORLD_CHUNK_SIZE - 1) / 2;
    const result = await this.pool.query<CatalogRow>(
      `
        ${ACTIVE_CATALOG_CTE}
        SELECT *
        FROM active_catalog
        WHERE chunk_x = $1 AND chunk_z = $2
        ORDER BY
          planted DESC,
          POWER(MOD(cell, $3) - $4, 2) + POWER(FLOOR(cell::numeric / $3) - $4, 2),
          login_lower ASC
        LIMIT 1
      `,
      [chunk.cx, chunk.cz, WORLD_CHUNK_SIZE, center],
    );

    if (!result.rows[0]) return null;
    return {
      chunkX: toNumber(result.rows[0].chunk_x),
      chunkZ: toNumber(result.rows[0].chunk_z),
      cell: toNumber(result.rows[0].cell),
    };
  }

  async addTrackedUser(username: string, profile?: CatalogUserProfile): Promise<TrackedWorldUser> {
    const normalized = normalizeUsername(username);
    const existing = await this.findWorldRecord(normalized);
    if (existing) {
      await this.upsertPlant(toNumber(existing.github_id));
      const refreshed = await this.findWorldRecord(normalized);
      if (!refreshed) throw new Error(`Unable to plant ${normalized}`);
      return rowToTrackedUser(refreshed);
    }

    if (!profile) {
      throw new Error(`GitHub profile required to plant ${normalized}`);
    }

    const slot = await this.findAvailableLiveSlot(normalized);
    await this.pool.query(
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
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 'live', $7, $8, $9, $10, NULL, NOW(), NOW()
        )
      `,
      [
        profile.githubId,
        profile.login,
        normalized,
        profile.avatarUrl,
        profile.htmlUrl,
        profile.type,
        slot.chunkX,
        slot.chunkZ,
        slot.cell,
        slot.worldSeed,
      ],
    );
    await this.upsertPlant(profile.githubId);

    const inserted = await this.findWorldRecord(normalized);
    if (!inserted) {
      throw new Error(`Unable to locate ${normalized} after planting`);
    }
    return rowToTrackedUser(inserted);
  }

  async removeTrackedUser(username: string): Promise<void> {
    const existing = await this.findWorldRecord(normalizeUsername(username));
    if (!existing) return;
    await this.pool.query(`DELETE FROM planted_developers WHERE github_id = $1`, [existing.github_id]);
  }

  async isTracked(username: string): Promise<boolean> {
    const existing = await this.findWorldRecord(normalizeUsername(username));
    return Boolean(existing?.planted);
  }

  async getTrackedUserLocation(username: string): Promise<TrackedWorldUser | null> {
    const existing = await this.findWorldRecord(normalizeUsername(username));
    return existing ? rowToTrackedUser(existing) : null;
  }

  async getChunkWindow(cx: number, cz: number, radius: number): Promise<WorldChunkWindow> {
    const result = await this.pool.query<CatalogRow>(
      `
        ${ACTIVE_CATALOG_CTE}
        SELECT *
        FROM active_catalog
        WHERE chunk_x BETWEEN $1 AND $2
          AND chunk_z BETWEEN $3 AND $4
        ORDER BY chunk_x ASC, chunk_z ASC, cell ASC
      `,
      [cx - radius, cx + radius, cz - radius, cz + radius],
    );

    const chunkMap = new Map<string, TrackedWorldUser[]>();
    result.rows.forEach((row) => {
      const key = `${row.chunk_x}:${row.chunk_z}`;
      const users = chunkMap.get(key) ?? [];
      users.push(rowToTrackedUser(row));
      chunkMap.set(key, users);
    });

    const chunks = [];
    for (let chunkZ = cz - radius; chunkZ <= cz + radius; chunkZ += 1) {
      for (let chunkX = cx - radius; chunkX <= cx + radius; chunkX += 1) {
        const key = `${chunkX}:${chunkZ}`;
        chunks.push({
          cx: chunkX,
          cz: chunkZ,
          users: chunkMap.get(key) ?? [],
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

    const prefix = `${normalized}%`;
    const prefixRows = await this.pool.query<CatalogRow>(
      `
        ${ACTIVE_CATALOG_CTE}
        SELECT *
        FROM active_catalog
        WHERE login_lower LIKE $1
        ORDER BY
          CASE WHEN login_lower = $2 THEN 0 ELSE 1 END,
          planted DESC,
          login_lower ASC
        LIMIT $3
      `,
      [prefix, normalized, limit],
    );

    const seen = new Set(prefixRows.rows.map((row) => normalizeUsername(row.login)));
    const rows = [...prefixRows.rows];

    if (rows.length < limit && normalized.length >= 2) {
      const substringRows = await this.pool.query<CatalogRow>(
        `
          ${ACTIVE_CATALOG_CTE}
          SELECT *
          FROM active_catalog
          WHERE login_lower LIKE $1
          ORDER BY planted DESC, login_lower ASC
          LIMIT $2
        `,
        [`%${normalized}%`, Math.max(limit * 2, limit)],
      );

      substringRows.rows.forEach((row) => {
        const key = normalizeUsername(row.login);
        if (seen.has(key) || rows.length >= limit) return;
        seen.add(key);
        rows.push(row);
      });
    }

    return rows.slice(0, limit).map(rowToSearchResult);
  }

  async dispose() {
    await this.pool.end();
  }

  private async upsertPlant(githubId: number) {
    await this.pool.query(
      `
        INSERT INTO planted_developers (github_id, planted_at, last_selected_at, pinned)
        VALUES ($1, NOW(), NOW(), FALSE)
        ON CONFLICT (github_id)
        DO UPDATE SET last_selected_at = EXCLUDED.last_selected_at
      `,
      [githubId],
    );
  }

  private async findWorldRecord(normalized: string) {
    const result = await this.pool.query<CatalogRow>(
      `
        ${ACTIVE_CATALOG_CTE}
        SELECT *
        FROM active_catalog
        WHERE login_lower = $1
        ORDER BY planted DESC, login_lower ASC
        LIMIT 1
      `,
      [normalized],
    );
    return result.rows[0] ?? null;
  }

  private async findAvailableLiveSlot(username: string) {
    const slots = candidateWorldSlots(username, { minRadiusChunks: 1, maxRadiusChunks: 4096 });
    while (true) {
      const next = slots.next();
      if (next.done) break;
      const slot = next.value;
      const occupied = await this.pool.query(
        `
          WITH active_revision AS (
            SELECT revision_id
            FROM catalog_revisions
            WHERE is_active = TRUE
            ORDER BY COALESCE(activated_at, created_at) DESC
            LIMIT 1
          )
          SELECT 1
          FROM github_world_catalog AS catalog
          LEFT JOIN active_revision AS active ON TRUE
          WHERE (catalog.source = 'live' OR catalog.import_revision = active.revision_id)
            AND catalog.chunk_x = $1
            AND catalog.chunk_z = $2
            AND catalog.cell = $3
          LIMIT 1
        `,
        [slot.chunkX, slot.chunkZ, slot.cell],
      );
      if (occupied.rowCount === 0) {
        return slot;
      }
    }
    throw new Error(`Unable to assign live slot for ${username}`);
  }
}
