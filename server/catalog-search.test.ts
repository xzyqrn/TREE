import assert from "node:assert/strict";
import test from "node:test";

import type { WorldSearchResult } from "@shared/schema";
import { mergeHybridSearchResults } from "./catalog-search";

function searchResult(login: string, overrides: Partial<WorldSearchResult> = {}): WorldSearchResult {
  return {
    login,
    avatar_url: `https://github.com/${login}.png`,
    html_url: `https://github.com/${login}`,
    type: "User",
    source: "live",
    inWorld: false,
    planted: false,
    ...overrides,
  };
}

test("mergeHybridSearchResults keeps world matches and removes duplicate live matches", () => {
  const merged = mergeHybridSearchResults(
    [
      searchResult("torvalds", { source: "snapshot", inWorld: true, planted: true, chunkX: 0, chunkZ: 0, cell: 1 }),
      searchResult("gaearon", { source: "snapshot", inWorld: true, planted: false, chunkX: 0, chunkZ: 0, cell: 2 }),
    ],
    [
      searchResult("gaearon"),
      searchResult("torvalds"),
      searchResult("yyx990803"),
    ],
    { directorySource: "live", directoryError: null },
  );

  assert.deepEqual(merged.world.map((item) => item.login), ["torvalds", "gaearon"]);
  assert.deepEqual(merged.directory.map((item) => item.login), ["yyx990803"]);
  assert.equal(merged.directorySource, "live");
  assert.equal(merged.directoryError, null);
});
