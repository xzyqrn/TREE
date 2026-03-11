import type { TrackedWorldUser, WorldSearchResult } from "@shared/schema";

export interface TrackedWorldChunk {
  cx: number;
  cz: number;
  users: TrackedWorldUser[];
}

export interface WorldChunkWindow {
  center: {
    cx: number;
    cz: number;
  };
  radius: number;
  chunks: TrackedWorldChunk[];
}

export interface CatalogUserProfile {
  githubId: number;
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  type: string;
}

export interface IStorage {
  getTrackedUsers(): Promise<TrackedWorldUser[]>;
  getTrackedCount(): Promise<number>;
  getCatalogCount(): Promise<number>;
  getSuggestedInitialChunk(): Promise<{ cx: number; cz: number }>;
  getSuggestedInitialFocus(chunk: { cx: number; cz: number }): Promise<{ chunkX: number; chunkZ: number; cell: number } | null>;
  addTrackedUser(username: string, profile?: CatalogUserProfile): Promise<TrackedWorldUser>;
  removeTrackedUser(username: string): Promise<void>;
  isTracked(username: string): Promise<boolean>;
  getTrackedUserLocation(username: string): Promise<TrackedWorldUser | null>;
  getChunkWindow(cx: number, cz: number, radius: number): Promise<WorldChunkWindow>;
  searchWorldUsers(query: string, limit: number): Promise<WorldSearchResult[]>;
}
