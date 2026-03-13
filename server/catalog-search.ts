import type { WorldSearchResponse, WorldSearchResult } from "@shared/schema";
import { normalizeUsername } from "./world-grid";

export function mergeHybridSearchResults(
  world: WorldSearchResult[],
  directory: WorldSearchResult[],
  options?: { directorySource?: "live" | "cached"; directoryError?: string | null },
): WorldSearchResponse {
  const worldKeys = new Set(world.map((result) => normalizeUsername(result.login)));
  const directoryDeduped: WorldSearchResult[] = [];

  directory.forEach((result) => {
    const key = normalizeUsername(result.login);
    if (worldKeys.has(key)) return;
    if (directoryDeduped.some((candidate) => normalizeUsername(candidate.login) === key)) return;
    directoryDeduped.push(result);
  });

  return {
    world,
    directory: directoryDeduped,
    directorySource: options?.directorySource ?? "cached",
    directoryError: options?.directoryError ?? null,
  };
}
