import { WORLD_CHUNK_CELL_COUNT, WORLD_CHUNK_SIZE, cellToGrid } from "@shared/schema";

export interface WorldSlot {
  chunkX: number;
  chunkZ: number;
  cell: number;
  worldSeed: number;
}

const SNAPSHOT_LOCAL_COORDS = [
  { x: 7, z: 7 },
  { x: 8, z: 7 },
  { x: 7, z: 8 },
  { x: 8, z: 8 },
  { x: 6, z: 7 },
  { x: 9, z: 7 },
  { x: 6, z: 8 },
  { x: 9, z: 8 },
] as const;

export const USERS_PER_SNAPSHOT_CHUNK = SNAPSHOT_LOCAL_COORDS.length;
export const SNAPSHOT_LOCAL_CELL_ORDER = SNAPSHOT_LOCAL_COORDS.map(({ x, z }) => z * WORLD_CHUNK_SIZE + x);

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

export function snapshotCellForIndex(index: number) {
  return SNAPSHOT_LOCAL_CELL_ORDER[index % SNAPSHOT_LOCAL_CELL_ORDER.length];
}

export function createSpiralChunkCursor() {
  let chunkIndex = 0;
  let x = 0;
  let z = 0;
  let dx = 1;
  let dz = 0;
  let segmentLength = 1;
  let segmentProgress = 0;
  let segmentRepeats = 0;

  return {
    current() {
      return { chunkX: x, chunkZ: z };
    },
    advanceTo(targetIndex: number) {
      while (chunkIndex < targetIndex) {
        x += dx;
        z += dz;
        chunkIndex += 1;
        segmentProgress += 1;
        if (segmentProgress === segmentLength) {
          segmentProgress = 0;
          const nextDx = -dz;
          const nextDz = dx;
          dx = nextDx;
          dz = nextDz;
          segmentRepeats += 1;
          if (segmentRepeats === 2) {
            segmentRepeats = 0;
            segmentLength += 1;
          }
        }
      }
      return { chunkX: x, chunkZ: z };
    },
  };
}

export function spiralChunkForIndex(index: number) {
  if (index < 0) {
    throw new Error(`Chunk index must be non-negative, got ${index}`);
  }
  return createSpiralChunkCursor().advanceTo(index);
}

export function snapshotSlotForRank(rank: number, worldSeed: number) {
  if (rank < 0) {
    throw new Error(`Rank must be non-negative, got ${rank}`);
  }
  const chunkIndex = Math.floor(rank / USERS_PER_SNAPSHOT_CHUNK);
  const { chunkX, chunkZ } = spiralChunkForIndex(chunkIndex);
  return {
    chunkX,
    chunkZ,
    cell: snapshotCellForIndex(rank),
    worldSeed,
  } satisfies WorldSlot;
}

export function* candidateWorldSlots(
  username: string,
  options?: {
    minRadiusChunks?: number;
    maxRadiusChunks?: number;
  },
) {
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
    yield slotFromWorldCell(worldCellX, worldCellZ, worldSeed);
  }
}

export function assignWorldSlot(
  username: string,
  isOccupied: (chunkX: number, chunkZ: number, cell: number) => boolean,
  options?: {
    minRadiusChunks?: number;
    maxRadiusChunks?: number;
  },
): WorldSlot {
  const slots = candidateWorldSlots(username, options);
  while (true) {
    const next = slots.next();
    if (next.done) break;
    const slot = next.value;
    if (!isOccupied(slot.chunkX, slot.chunkZ, slot.cell)) {
      return slot;
    }
  }

  throw new Error(`Unable to assign world slot for ${normalizeUsername(username)}`);
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
