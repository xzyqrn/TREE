import { worldPositionForCell } from "@shared/schema";

export interface TileMetrics {
  width: number;
  height: number;
}

export interface IsometricCamera {
  x: number;
  z: number;
  zoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ProjectablePoint {
  worldX: number;
  worldZ: number;
  elevation?: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

export interface IsometricFootprint {
  id: string;
  centerX: number;
  baseY: number;
  width: number;
  height: number;
  depth: number;
}

export function worldToTile(worldX: number, worldZ: number, cellSize: number) {
  return {
    x: worldX / cellSize,
    z: worldZ / cellSize,
  };
}

export function chunkCellToTile(chunkX: number, chunkZ: number, cell: number, cellSize: number) {
  const world = worldPositionForCell(chunkX, chunkZ, cell);
  return worldToTile(world.x, world.z, cellSize);
}

export function depthKey(point: ProjectablePoint) {
  return point.worldX + point.worldZ + (point.elevation ?? 0) * 0.01;
}

export function projectToScreen(
  point: ProjectablePoint,
  camera: IsometricCamera,
  viewport: ViewportSize,
  tile: TileMetrics,
): ProjectedPoint {
  const isoX = (point.worldX - point.worldZ) * (tile.width / 2);
  const isoY = (point.worldX + point.worldZ) * (tile.height / 2) - (point.elevation ?? 0);
  const camIsoX = (camera.x - camera.z) * (tile.width / 2);
  const camIsoY = (camera.x + camera.z) * (tile.height / 2);

  return {
    x: viewport.width / 2 + (isoX - camIsoX) * camera.zoom,
    y: viewport.height / 2 + (isoY - camIsoY) * camera.zoom,
    depth: depthKey(point),
  };
}

export function sortByDepth<T extends ProjectablePoint>(items: T[]) {
  return [...items].sort((left, right) => depthKey(left) - depthKey(right));
}

export function pointInDiamond(x: number, y: number, centerX: number, centerY: number, width: number, height: number) {
  const dx = Math.abs(x - centerX) / (width / 2);
  const dy = Math.abs(y - centerY) / (height / 2);
  return dx + dy <= 1;
}

export function footprintContainsPoint(footprint: IsometricFootprint, x: number, y: number) {
  const bodyTop = footprint.baseY - footprint.height;
  const bodyBottom = footprint.baseY;
  const bodyLeft = footprint.centerX - footprint.width / 2;
  const bodyRight = footprint.centerX + footprint.width / 2;

  if (x >= bodyLeft && x <= bodyRight && y >= bodyTop && y <= bodyBottom) {
    return true;
  }

  return pointInDiamond(x, y, footprint.centerX, footprint.baseY, footprint.width, Math.max(footprint.width * 0.55, 6));
}

export function hitTestFootprints(footprints: IsometricFootprint[], x: number, y: number) {
  const ordered = [...footprints].sort((left, right) => left.depth - right.depth);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const footprint = ordered[index];
    if (footprintContainsPoint(footprint, x, y)) {
      return footprint.id;
    }
  }
  return null;
}
