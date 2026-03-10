import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ForestHud } from "@/components/forest/ForestHud";
import { ForestInspector } from "@/components/forest/ForestInspector";
import { ForestSceneFallback } from "@/components/forest/ForestSceneFallback";
import { ForestSearchPanel } from "@/components/forest/ForestSearchPanel";
import type { ChunkWindowChange } from "@/components/forest/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  WORLD_CELL_SIZE,
  WORLD_CHUNK_SIZE,
  WORLD_PRELOAD_RADIUS_CHUNKS,
  WORLD_RENDER_RADIUS_CHUNKS,
  chunkKey,
  type UserStats,
  type WorldBootstrap,
  type WorldChunk,
  type WorldChunkResponse,
  type WorldUserLocation,
} from "@shared/schema";

const ForestWorld = lazy(() => import("@/components/ForestWorld"));

function StatsLoader({
  username,
  onLoaded,
}: {
  username: string;
  onLoaded: (username: string, stats: UserStats) => void;
}) {
  const { data } = useQuery<UserStats>({
    queryKey: ["/api/users", username, "stats"],
    queryFn: async () => {
      const response = await fetch(`/api/users/${username}/stats`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Failed to load ${username}`);
      }
      return response.json();
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (data) onLoaded(username, data);
  }, [data, onLoaded, username]);

  return null;
}

async function fetchWorldBootstrap(): Promise<WorldBootstrap> {
  const response = await fetch("/api/world/bootstrap");
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Failed to load world bootstrap");
  }
  return response.json();
}

async function fetchWorldChunks(cx: number, cz: number, radius: number): Promise<WorldChunkResponse> {
  const response = await fetch(`/api/world/chunks?cx=${cx}&cz=${cz}&radius=${radius}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Failed to stream world chunks");
  }
  return response.json();
}

async function fetchWorldLocation(username: string): Promise<WorldUserLocation> {
  const response = await fetch(`/api/world/users/${encodeURIComponent(username)}/location`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Could not locate @${username}`);
  }
  return response.json();
}

function sameChunkUsers(left: WorldChunk["users"], right: WorldChunk["users"]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.username !== b.username
      || a.chunkX !== b.chunkX
      || a.chunkZ !== b.chunkZ
      || a.cell !== b.cell
      || a.worldSeed !== b.worldSeed
      || a.hasStats !== b.hasStats
      || a.totalCommitsHint !== b.totalCommitsHint
      || a.statusHint !== b.statusHint
    ) {
      return false;
    }
  }
  return true;
}

export default function Home() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [statsMap, setStatsMap] = useState<Record<string, UserStats>>({});
  const [chunkCache, setChunkCache] = useState<Record<string, WorldChunk>>({});
  const [chunkWindowCenter, setChunkWindowCenter] = useState<ChunkWindowChange>({ cx: 0, cz: 0 });
  const [visibleTrackedUsers, setVisibleTrackedUsers] = useState<string[]>([]);
  const [jumpTarget, setJumpTarget] = useState<WorldUserLocation | null>(null);
  const [pendingJumpUsername, setPendingJumpUsername] = useState<string | null>(null);
  const [trackedCountDelta, setTrackedCountDelta] = useState(0);

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  const bootstrapQuery = useQuery<WorldBootstrap>({
    queryKey: ["/api/world/bootstrap"],
    queryFn: fetchWorldBootstrap,
    staleTime: 5 * 60 * 1000,
  });

  const worldConfig = bootstrapQuery.data ?? {
    trackedCount: 0,
    chunkSize: WORLD_CHUNK_SIZE,
    cellSize: WORLD_CELL_SIZE,
    renderRadiusChunks: WORLD_RENDER_RADIUS_CHUNKS,
    preloadRadiusChunks: WORLD_PRELOAD_RADIUS_CHUNKS,
    initialChunk: { cx: 0, cz: 0 },
    initialFocus: null,
    chunks: [],
  };

  const mergeChunks = useCallback((chunks: WorldChunk[]) => {
    setChunkCache((prev) => {
      let changed = false;
      const next = { ...prev };
      chunks.forEach((chunk) => {
        const key = chunkKey(chunk.cx, chunk.cz);
        const previous = prev[key];
        if (!previous || !sameChunkUsers(previous.users, chunk.users)) {
          next[key] = chunk;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (!bootstrapQuery.data) return;
    mergeChunks(bootstrapQuery.data.chunks);
    setChunkWindowCenter((current) =>
      current.cx === 0 && current.cz === 0
        ? bootstrapQuery.data.initialChunk
        : current,
    );
  }, [bootstrapQuery.data, mergeChunks]);

  useEffect(() => {
    let active = true;
    if (!bootstrapQuery.data || !sceneReady) return;

    queryClient.fetchQuery({
      queryKey: ["world-chunks", chunkWindowCenter.cx, chunkWindowCenter.cz, worldConfig.preloadRadiusChunks],
      queryFn: () => fetchWorldChunks(chunkWindowCenter.cx, chunkWindowCenter.cz, worldConfig.preloadRadiusChunks),
      staleTime: 30 * 1000,
    }).then((response) => {
      if (active) mergeChunks(response.chunks);
    }).catch((error: Error) => {
      if (!active) return;
      toast({
        title: "Could not stream world chunks",
        description: error.message,
        variant: "destructive",
      });
    });

    return () => {
      active = false;
    };
  }, [bootstrapQuery.data, chunkWindowCenter, mergeChunks, queryClient, sceneReady, toast, worldConfig.preloadRadiusChunks]);

  useEffect(() => {
    const cacheRadius = worldConfig.preloadRadiusChunks + 1;
    setChunkCache((prev) => {
      let changed = false;
      const next: Record<string, WorldChunk> = {};

      Object.entries(prev).forEach(([key, chunk]) => {
        const keep = Math.abs(chunk.cx - chunkWindowCenter.cx) <= cacheRadius
          && Math.abs(chunk.cz - chunkWindowCenter.cz) <= cacheRadius;
        if (keep) {
          next[key] = chunk;
        } else {
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [chunkWindowCenter, worldConfig.preloadRadiusChunks]);

  const handleStatsLoaded = useCallback((username: string, stats: UserStats) => {
    setStatsMap((prev) => {
      if (prev[username] === stats) return prev;
      return { ...prev, [username]: stats };
    });
  }, []);

  const hydrateUsernames = useMemo(() => {
    const next = new Set(visibleTrackedUsers);
    if (selectedUser) next.add(selectedUser);
    return Array.from(next);
  }, [selectedUser, visibleTrackedUsers]);

  const selectedStats = selectedUser ? statsMap[selectedUser] ?? null : null;
  const visibleTrackedCount = visibleTrackedUsers.length;
  const statsLoadedCount = useMemo(
    () => hydrateUsernames.reduce((count, username) => count + (statsMap[username] ? 1 : 0), 0),
    [hydrateUsernames, statsMap],
  );
  const statsPendingCount = Math.max(0, hydrateUsernames.length - statsLoadedCount);
  const trackedCount = Math.max(0, worldConfig.trackedCount + trackedCountDelta);
  const loadedChunkCount = Object.keys(chunkCache).length;
  const activeChunkLabel = `Chunk ${chunkWindowCenter.cx}, ${chunkWindowCenter.cz}`;
  const chunkList = useMemo(() => Object.values(chunkCache), [chunkCache]);

  const jumpToTrackedUser = useCallback(async (username: string) => {
    const normalized = username.toLowerCase();
    setPendingJumpUsername(normalized);
    try {
      const location = await queryClient.fetchQuery({
        queryKey: ["world-location", normalized],
        queryFn: () => fetchWorldLocation(normalized),
        staleTime: 60 * 1000,
      });
      setSelectedUser(location.username);
      setChunkWindowCenter({ cx: location.chunkX, cz: location.chunkZ });
      setJumpTarget(location);
      setSearchOpen(false);
    } finally {
      setPendingJumpUsername(null);
    }
  }, [queryClient]);

  const addMutation = useMutation({
    mutationFn: (username: string) => apiRequest("POST", "/api/users", { username }),
    onSuccess: async (_response, username) => {
      setTrackedCountDelta((current) => current + 1);
      await queryClient.invalidateQueries({ queryKey: ["/api/search"] });
      await jumpToTrackedUser(username);
      toast({
        title: "Developer planted",
        description: `@${username} is now part of the forest.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not add developer",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (username: string) => apiRequest("DELETE", `/api/users/${username}`),
    onSuccess: async (_response, username) => {
      const normalized = username.toLowerCase();
      setTrackedCountDelta((current) => current - 1);
      setStatsMap((prev) => {
        const next = { ...prev };
        delete next[normalized];
        return next;
      });
      setVisibleTrackedUsers((prev) => prev.filter((candidate) => candidate !== normalized));
      setChunkCache((prev) => {
        const next: Record<string, WorldChunk> = {};
        Object.entries(prev).forEach(([key, chunk]) => {
          next[key] = {
            ...chunk,
            users: chunk.users.filter((user) => user.username !== normalized),
          };
        });
        return next;
      });
      if (selectedUser === normalized) setSelectedUser(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/search"] });
      toast({
        title: "Developer removed",
        description: `@${username} left the forest.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not remove developer",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="forest-shell fixed inset-0 overflow-hidden">
      <div className="forest-cloud forest-cloud-one" />
      <div className="forest-cloud forest-cloud-two" />

      {hydrateUsernames.map((username) => (
        <StatsLoader
          key={username}
          username={username}
          onLoaded={handleStatsLoaded}
        />
      ))}

      <Suspense fallback={<ForestSceneFallback />}>
        {bootstrapQuery.data ? (
          <ForestWorld
            worldConfig={worldConfig}
            chunks={chunkList}
            statsMap={statsMap}
            selectedUser={selectedUser}
            jumpTarget={jumpTarget}
            onJumpHandled={() => setJumpTarget(null)}
            onSelectUser={setSelectedUser}
            onChunkWindowChange={setChunkWindowCenter}
            onVisibleTrackedUsersChange={setVisibleTrackedUsers}
            onSceneReady={() => setSceneReady(true)}
          />
        ) : (
          <ForestSceneFallback />
        )}
      </Suspense>

      <ForestHud
        trackedCount={trackedCount}
        visibleTrackedCount={visibleTrackedCount}
        loadedChunkCount={loadedChunkCount}
        activeChunk={activeChunkLabel}
        statsLoadedCount={statsLoadedCount}
        statsPendingCount={statsPendingCount}
        sceneReady={sceneReady}
        searchOpen={searchOpen}
        isMobile={isMobile}
        selectedUser={selectedUser}
        onToggleSearch={() => setSearchOpen((open) => !open)}
      />

      <ForestSearchPanel
        open={searchOpen}
        onOpenChange={setSearchOpen}
        pendingUsername={addMutation.isPending ? addMutation.variables?.toLowerCase() ?? null : null}
        pendingJumpUsername={pendingJumpUsername}
        onAddUser={(username) => addMutation.mutate(username)}
        onJumpToUser={jumpToTrackedUser}
      />

      <ForestInspector
        isMobile={isMobile}
        selectedUser={selectedUser}
        selectedStats={selectedStats}
        onClose={() => setSelectedUser(null)}
        onRemove={(username) => removeMutation.mutate(username)}
        removePendingUsername={removeMutation.isPending ? removeMutation.variables?.toLowerCase() ?? null : null}
      />

      {trackedCount === 0 && bootstrapQuery.isSuccess && (
        <div className="absolute inset-0 z-[18] grid place-items-center pointer-events-none">
          <div className="pixel-panel pixel-panel-strong w-[min(430px,calc(100vw-48px))] p-7">
            <div className="pixel-kicker">Empty world</div>
            <h2 className="pixel-title mt-3 text-[28px]">Plant the first developer</h2>
            <p className="mt-3 text-sm leading-7 text-[#405538]">
              The grove is ready. Open the search panel, choose a GitHub user, and drop the first tree into the isometric world.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
