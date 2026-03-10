import test from "node:test";
import assert from "node:assert/strict";

import { chunkKey } from "@shared/schema";
import { MemStorage } from "./storage";
import { assignWorldSlot, slotKey } from "./world-grid";

test("assignWorldSlot is deterministic for the same username and occupancy", () => {
  const occupied = new Set<string>();
  const first = assignWorldSlot("torvalds", (chunkX, chunkZ, cell) => occupied.has(slotKey(chunkX, chunkZ, cell)));
  const second = assignWorldSlot("torvalds", (chunkX, chunkZ, cell) => occupied.has(slotKey(chunkX, chunkZ, cell)));
  assert.deepEqual(second, first);
});

test("assignWorldSlot resolves collisions deterministically", () => {
  const base = assignWorldSlot("collision-dev", () => false);
  const occupied = new Set([slotKey(base.chunkX, base.chunkZ, base.cell)]);
  const first = assignWorldSlot("collision-dev", (chunkX, chunkZ, cell) => occupied.has(slotKey(chunkX, chunkZ, cell)));
  const second = assignWorldSlot("collision-dev", (chunkX, chunkZ, cell) => occupied.has(slotKey(chunkX, chunkZ, cell)));

  assert.notDeepEqual(first, base);
  assert.deepEqual(second, first);
});

test("adding a user does not move existing tracked users", async () => {
  const storage = new MemStorage();
  const before = await storage.getTrackedUserLocation("torvalds");
  assert.ok(before);

  await storage.addTrackedUser("chunk-regression-user");
  const after = await storage.getTrackedUserLocation("torvalds");
  assert.deepEqual(after, before);
});

test("chunk queries return only the requested window", async () => {
  const storage = new MemStorage();
  const window = await storage.getChunkWindow(0, 0, 0);

  assert.equal(window.chunks.length, 1);
  assert.equal(chunkKey(window.chunks[0].cx, window.chunks[0].cz), "0:0");
});

test("starter world keeps multiple developers near the initial view", async () => {
  const storage = new MemStorage();
  const initial = await storage.getSuggestedInitialChunk();
  const window = await storage.getChunkWindow(initial.cx, initial.cz, 1);
  const totalUsers = window.chunks.reduce((count, chunk) => count + chunk.users.length, 0);
  const initialChunkUsers = window.chunks.find(
    (chunk) => chunk.cx === initial.cx && chunk.cz === initial.cz,
  )?.users.length ?? 0;

  assert.ok(totalUsers >= 6, `expected a visible neighborhood, got ${totalUsers} users`);
  assert.ok(initialChunkUsers >= 3, `expected a populated starting chunk, got ${initialChunkUsers} users`);
});
