import { WORLD_CHUNK_CELL_COUNT, WORLD_CHUNK_SIZE, cellToGrid } from "@shared/schema";

export interface WorldSlot {
  chunkX: number;
  chunkZ: number;
  cell: number;
  worldSeed: number;
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function hash32(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashFloat(input: string) {
  return hash32(input) / 0xffffffff;
}

function signedStep(input: string) {
  const raw = (hash32(input) % 9) - 4;
  return raw === 0 ? 3 : raw;
}

function floorDiv(value: number, divisor: number) {
  return Math.floor(value / divisor);
}

export function slotKey(chunkX: number, chunkZ: number, cell: number) {
  return `${chunkX}:${chunkZ}:${cell}`;
}

export function worldCellFromSlot(chunkX: number, chunkZ: number, cell: number) {
  const local = cellToGrid(cell);
  return {
    x: chunkX * WORLD_CHUNK_SIZE + local.x,
    z: chunkZ * WORLD_CHUNK_SIZE + local.z,
  };
}

export function slotFromWorldCell(x: number, z: number, worldSeed: number): WorldSlot {
  const chunkX = floorDiv(x, WORLD_CHUNK_SIZE);
  const chunkZ = floorDiv(z, WORLD_CHUNK_SIZE);
  const localX = x - chunkX * WORLD_CHUNK_SIZE;
  const localZ = z - chunkZ * WORLD_CHUNK_SIZE;
  return {
    chunkX,
    chunkZ,
    cell: localZ * WORLD_CHUNK_SIZE + localX,
    worldSeed,
  };
}

export function assignWorldSlot(
  username: string,
  isOccupied: (chunkX: number, chunkZ: number, cell: number) => boolean,
  options?: {
    minRadiusChunks?: number;
    maxRadiusChunks?: number;
  },
): WorldSlot {
  const normalized = normalizeUsername(username);
  const worldSeed = hash32(`${normalized}:world`);
  const minRadiusChunks = options?.minRadiusChunks ?? 2;
  const maxRadiusChunks = Math.max(minRadiusChunks, options?.maxRadiusChunks ?? 64);
  const radiusT = Math.sqrt(hashFloat(`${normalized}:radius`));
  const radius = minRadiusChunks + Math.floor(radiusT * (maxRadiusChunks - minRadiusChunks));
  const angle = hashFloat(`${normalized}:angle`) * Math.PI * 2;
  const baseChunkX = Math.round(Math.cos(angle) * radius);
  const baseChunkZ = Math.round(Math.sin(angle) * radius);
  const baseCell = hash32(`${normalized}:cell`) % WORLD_CHUNK_CELL_COUNT;
  const baseWorldCell = worldCellFromSlot(baseChunkX, baseChunkZ, baseCell);
  const stepX = signedStep(`${normalized}:step-x`);
  const stepZ = signedStep(`${normalized}:step-z`);

  for (let attempt = 0; attempt < 100000; attempt++) {
    const quadratic = attempt === 0 ? 0 : attempt * attempt;
    const worldCellX = baseWorldCell.x + stepX * quadratic + stepZ * attempt;
    const worldCellZ = baseWorldCell.z + stepZ * quadratic - stepX * attempt;
    const slot = slotFromWorldCell(worldCellX, worldCellZ, worldSeed);
    if (!isOccupied(slot.chunkX, slot.chunkZ, slot.cell)) {
      return slot;
    }
  }

  throw new Error(`Unable to assign world slot for ${normalized}`);
}

export function forEachChunkInRadius(
  cx: number,
  cz: number,
  radius: number,
  visit: (chunkX: number, chunkZ: number) => void,
) {
  for (let chunkZ = cz - radius; chunkZ <= cz + radius; chunkZ++) {
    for (let chunkX = cx - radius; chunkX <= cx + radius; chunkX++) {
      visit(chunkX, chunkZ);
    }
  }
}
