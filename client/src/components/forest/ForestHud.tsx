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
  const mobileStatusCopy = !sceneReady
    ? "Painting the first clearing."
    : statsPendingCount > 0
      ? `Fetching ${statsPendingCount} highlighted profile${statsPendingCount === 1 ? "" : "s"}.`
      : `Showing ${visibleTrackedCount} detailed tree${visibleTrackedCount === 1 ? "" : "s"}.`;

  if (isMobile) {
    return (
      <>
        <div className="absolute inset-x-3 top-3 z-20">
          <div className="relative">
            <div className="pixel-panel min-h-[156px] px-4 pb-4 pt-4 pr-[10.5rem]">
              <div className="pixel-kicker">World stream</div>
              <div className="mt-2">
                <div className="pixel-title text-[18px] leading-none">GitForest</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[#6a7242]">Open GitHub world</div>
              </div>
              <p className="mt-3 text-[13px] leading-5 text-[#405538]">{mobileStatusCopy}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#495c41]">
                <span className="pixel-chip">
                  <Trees size={11} />
                  {catalogCount.toLocaleString()} world
                </span>
                <span className="pixel-chip">
                  <Sparkles size={11} />
                  {statsLoadedCount}/{Math.max(statsLoadedCount + statsPendingCount, 1)} ready
                </span>
                <span className="pixel-chip">
                  <Compass size={11} />
                  {activeChunk}
                </span>
                {selectedUser && (
                  <span className="pixel-chip">
                    <UserRound size={11} />@{selectedUser}
                  </span>
                )}
              </div>
            </div>

            <button
              data-testid="button-toggle-search"
              className={`pixel-button absolute right-0 top-0 min-w-[152px] justify-center px-4 py-3 text-[11px] ${searchOpen ? "pixel-button-active" : ""}`}
              onClick={onToggleSearch}
            >
              <Search size={14} />
              {searchOpen ? "Close" : "Search"}
            </button>
          </div>
        </div>

        {!searchOpen && !selectedUser && (
          <div className="absolute bottom-4 right-3 z-20 max-w-[184px]">
            <div className="pixel-panel px-3 py-3">
              <div className="pixel-kicker">Controls</div>
              <p className="mt-2 text-[13px] leading-5 text-[#405538]">
                D-pad to move. Tap trees to inspect.
              </p>
            </div>
          </div>
        )}
      </>
    );
  }

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

      <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center px-4 md:bottom-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            className="pixel-chip font-mono text-[11px] tracking-[0.08em] text-[#4a5d3d] transition hover:bg-[rgba(255,250,228,0.96)]"
            href="https://github.com/xzyqrn"
            target="_blank"
            rel="noreferrer"
          >
            Created by xzyqrn
          </a>
          <a
            className="pixel-chip font-mono text-[11px] tracking-[0.08em] text-[#4a5d3d] transition hover:bg-[rgba(255,250,228,0.96)]"
            href="https://github.com/xzyqrn/TREE.git"
            target="_blank"
            rel="noreferrer"
          >
            Repository
          </a>
        </div>
      </div>
    </>
  );
}
