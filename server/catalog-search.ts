import type { WorldSearchResponse, WorldSearchResult } from "@shared/schema";
import { normalizeUsername } from "./world-grid";

export function mergeHybridSearchResults(
  world: WorldSearchResult[],
  live: WorldSearchResult[],
  options?: { liveError?: string | null },
): WorldSearchResponse {
  const worldKeys = new Set(world.map((result) => normalizeUsername(result.login)));
  const liveDeduped: WorldSearchResult[] = [];

  live.forEach((result) => {
    const key = normalizeUsername(result.login);
    if (worldKeys.has(key)) return;
    if (liveDeduped.some((candidate) => normalizeUsername(candidate.login) === key)) return;
    liveDeduped.push(result);
  });

  return {
    world,
    live: liveDeduped,
    liveError: options?.liveError ?? null,
  };
}
