import { createHash } from "crypto";

let localEnvLoaded = false;

function parseEnvContent(content: string) {
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) return;

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  });
}

export async function ensureLocalEnvLoaded() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  if (typeof process === "undefined" || process.release?.name !== "node") {
    return;
  }

  try {
    const [{ readFile }, pathModule] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const envCandidates: string[] = [];
    let currentDir = process.cwd();

    for (let depth = 0; depth < 4; depth += 1) {
      envCandidates.push(pathModule.resolve(currentDir, ".env"));
      const parentDir = pathModule.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }

    for (const envPath of envCandidates) {
      try {
        const content = await readFile(envPath, "utf8");
        parseEnvContent(content);
      } catch {
        // Ignore missing .env files while checking parent directories.
      }
    }
  } catch {
    // Local .env is optional; Cloudflare bindings or shell env can provide values instead.
  }
}

export function readEnvValue(
  key: string,
  bindings?: Record<string, string | undefined> | null,
) {
  const bindingValue = bindings?.[key];
  if (bindingValue !== undefined && bindingValue !== null && bindingValue !== "") {
    return bindingValue;
  }
  if (typeof process !== "undefined" && process.env[key]) {
    return process.env[key];
  }
  return undefined;
}

export interface AppwriteEnv {
  endpoint: string;
  projectId: string;
  apiKey: string;
  databaseId: string;
  worldUsersTableId: string;
  worldChunksTableId: string;
  githubUserCacheTableId: string;
  githubStatsCacheTableId: string;
  catalogRevisionsTableId: string;
}

export function readAppwriteEnv(bindings?: Record<string, string | undefined> | null): AppwriteEnv {
  const endpoint = readEnvValue("APPWRITE_ENDPOINT", bindings);
  const projectId = readEnvValue("APPWRITE_PROJECT_ID", bindings);
  const apiKey = readEnvValue("APPWRITE_API_KEY", bindings);
  const databaseId = readEnvValue("APPWRITE_DATABASE_ID", bindings);
  const worldUsersTableId = readEnvValue("APPWRITE_TABLE_WORLD_USERS", bindings);
  const worldChunksTableId = readEnvValue("APPWRITE_TABLE_WORLD_CHUNKS", bindings);
  const githubUserCacheTableId = readEnvValue("APPWRITE_TABLE_GITHUB_USER_CACHE", bindings);
  const githubStatsCacheTableId = readEnvValue("APPWRITE_TABLE_GITHUB_STATS_CACHE", bindings);
  const catalogRevisionsTableId = readEnvValue("APPWRITE_TABLE_CATALOG_REVISIONS", bindings);

  const missing = [
    ["APPWRITE_ENDPOINT", endpoint],
    ["APPWRITE_PROJECT_ID", projectId],
    ["APPWRITE_API_KEY", apiKey],
    ["APPWRITE_DATABASE_ID", databaseId],
    ["APPWRITE_TABLE_WORLD_USERS", worldUsersTableId],
    ["APPWRITE_TABLE_WORLD_CHUNKS", worldChunksTableId],
    ["APPWRITE_TABLE_GITHUB_USER_CACHE", githubUserCacheTableId],
    ["APPWRITE_TABLE_GITHUB_STATS_CACHE", githubStatsCacheTableId],
    ["APPWRITE_TABLE_CATALOG_REVISIONS", catalogRevisionsTableId],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing Appwrite env: ${missing.map(([key]) => key).join(", ")}`);
  }

  return {
    endpoint: endpoint!,
    projectId: projectId!,
    apiKey: apiKey!,
    databaseId: databaseId!,
    worldUsersTableId: worldUsersTableId!,
    worldChunksTableId: worldChunksTableId!,
    githubUserCacheTableId: githubUserCacheTableId!,
    githubStatsCacheTableId: githubStatsCacheTableId!,
    catalogRevisionsTableId: catalogRevisionsTableId!,
  };
}

export function readGitHubToken(bindings?: Record<string, string | undefined> | null) {
  return readEnvValue("GITHUB_TOKEN", bindings)
    || readEnvValue("GITHUB_PERSONAL_ACCESS_TOKEN", bindings);
}

export function stableRowId(prefix: string, raw: string) {
  const suffixLength = Math.max(8, 36 - prefix.length - 1);
  return `${prefix}_${createHash("sha1").update(raw).digest("hex").slice(0, suffixLength)}`;
}
