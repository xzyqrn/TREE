import type { WorldUserLocation } from "@shared/schema";

export interface ChunkWindowChange {
  cx: number;
  cz: number;
}

export type SceneJumpTarget = WorldUserLocation;
