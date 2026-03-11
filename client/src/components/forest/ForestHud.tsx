import { Compass, Search, Sparkles, Trees, UserRound } from "lucide-react";

import { STAGE_META } from "@/components/forest/meta";

interface ForestHudProps {
  catalogCount: number;
  plantedCount: number;
  visibleTrackedCount: number;
  loadedChunkCount: number;
  activeChunk: string;
  statsLoadedCount: number;
  statsPendingCount: number;
  sceneReady: boolean;
  searchOpen: boolean;
  isMobile: boolean;
  selectedUser: string | null;
  onToggleSearch: () => void;
}

export function ForestHud({
  catalogCount,
  plantedCount,
  visibleTrackedCount,
  loadedChunkCount,
  activeChunk,
  statsLoadedCount,
  statsPendingCount,
  sceneReady,
  searchOpen,
  isMobile,
  selectedUser,
  onToggleSearch,
}: ForestHudProps) {
  const statusCopy = !sceneReady
    ? "Painting the first clearing."
    : statsPendingCount > 0
      ? `Fetching ${statsPendingCount} highlighted profile${statsPendingCount === 1 ? "" : "s"}.`
      : `Showing ${visibleTrackedCount} detailed trees across ${loadedChunkCount} streamed chunk${loadedChunkCount === 1 ? "" : "s"}.`;

  return (
    <>
      <div className="absolute left-4 top-4 z-20 max-w-[280px] md:left-6 md:top-6 md:max-w-[320px]">
        <div className="pixel-panel">
          <div className="pixel-kicker">World stream</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div>
              <div className="pixel-title text-[20px]">GitForest</div>
              <div className="mt-1 text-xs uppercase tracking-[0.22em] text-[#6a7242]">Open GitHub world</div>
            </div>
            <div className="pixel-chip">
              <Trees size={14} />
              {catalogCount.toLocaleString()}
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-[#405538]">{statusCopy}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#495c41]">
            <span className="pixel-chip">
              <Sparkles size={12} />
              {statsLoadedCount}/{Math.max(statsLoadedCount + statsPendingCount, 1)} hydrated
            </span>
            <span className="pixel-chip">
              <Trees size={12} />
              {plantedCount.toLocaleString()} planted
            </span>
            <span className="pixel-chip">
              <Compass size={12} />
              {activeChunk}
            </span>
            {selectedUser && (
              <span className="pixel-chip">
                <UserRound size={12} />@{selectedUser}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="absolute right-4 top-4 z-20 md:right-6 md:top-6">
        <button
          data-testid="button-toggle-search"
          className={`pixel-button ${searchOpen ? "pixel-button-active" : ""}`}
          onClick={onToggleSearch}
        >
          <Search size={15} />
          {searchOpen ? "Close search" : "Search GitHub"}
        </button>
      </div>

      {!isMobile && (
        <>
          <div className="absolute left-6 bottom-6 z-20 max-w-[320px]">
            <div className="pixel-panel">
              <div className="pixel-kicker">Controls</div>
              <p className="mt-3 text-sm leading-6 text-[#405538]">
                Move with WASD or arrow keys, roll the mouse wheel to zoom, and click a tree to open its stat card.
              </p>
            </div>
          </div>

          <div className="absolute right-6 bottom-6 z-20 w-[252px]">
            <div className="pixel-panel">
              <div className="pixel-kicker">Growth stages</div>
              <div className="mt-3 space-y-2">
                {STAGE_META.map((stage, index) => (
                  <div key={stage.shortLabel} className="flex items-center justify-between gap-3 text-sm text-[#405538]">
                    <div className="flex items-center gap-3">
                      <span className="pixel-bullet">{index + 1}</span>
                      <span>{stage.shortLabel}</span>
                    </div>
                    <span className="font-mono text-xs text-[#68744c]">{stage.range}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {isMobile && (
        <div className="absolute right-4 bottom-24 z-20 max-w-[220px]">
          <div className="pixel-panel">
            <div className="pixel-kicker">Controls</div>
            <p className="mt-2 text-sm leading-6 text-[#405538]">
              Use the D-pad to move, pinch-free zoom with the wheel if available, and tap trees to inspect them.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
