import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkCellToTile,
  hitTestFootprints,
  projectToScreen,
  sortByDepth,
  type IsometricFootprint,
} from "./isometric-math";

test("projectToScreen projects isometric axes around the camera anchor", () => {
  const viewport = { width: 320, height: 180 };
  const tile = { width: 20, height: 10 };
  const camera = { x: 0, z: 0, zoom: 1 };

  const east = projectToScreen({ worldX: 1, worldZ: 0 }, camera, viewport, tile);
  const south = projectToScreen({ worldX: 0, worldZ: 1 }, camera, viewport, tile);

  assert.equal(east.x, 170);
  assert.equal(east.y, 95);
  assert.equal(south.x, 150);
  assert.equal(south.y, 95);
});

test("hitTestFootprints returns the top-most overlapping footprint", () => {
  const footprints: IsometricFootprint[] = [
    { id: "nearby", centerX: 120, baseY: 100, width: 30, height: 34, depth: 2 },
    { id: "selected", centerX: 120, baseY: 100, width: 30, height: 44, depth: 8 },
  ];

  assert.equal(hitTestFootprints(footprints, 120, 82), "selected");
  assert.equal(hitTestFootprints(footprints, 70, 30), null);
});

test("sortByDepth orders back-to-front for isometric rendering", () => {
  const sorted = sortByDepth([
    { worldX: 4, worldZ: 1 },
    { worldX: 1, worldZ: 1 },
    { worldX: 1, worldZ: 4, elevation: 5 },
  ]);

  assert.deepEqual(
    sorted.map((item) => [item.worldX, item.worldZ]),
    [
      [1, 1],
      [4, 1],
      [1, 4],
    ],
  );
});

test("chunkCellToTile keeps chunk/cell mapping aligned with world cells", () => {
  const tile = chunkCellToTile(2, -1, 65, 8);

  assert.equal(tile.x, 33.5);
  assert.equal(tile.z, -11.5);
});
