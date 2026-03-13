import { Activity, Calendar, Code2, ExternalLink, GitCommit, GitFork, Loader2, MapPin, Sprout, Star, Trash2, UserRound, X } from "lucide-react";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { langColors, stageFor, STATUS_META } from "@/components/forest/meta";
import type { UserStats, WorldChunk } from "@shared/schema";

interface ForestInspectorProps {
  isMobile: boolean;
  selectedUser: string | null;
  selectedWorldUser: WorldChunk["users"][number] | null;
  selectedStats: UserStats | null;
  onClose: () => void;
  onPlant: (username: string) => void;
  onRemove: (username: string) => void;
  plantPendingUsername: string | null;
  removePendingUsername: string | null;
}

function statCard(icon: React.ReactNode, label: string, value: string) {
  return (
    <div className="rounded-[16px] border-2 border-[#c7b576] bg-[#f6edc1] p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[#6b7245]">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-[#2f4328]">{value}</div>
    </div>
  );
}

function InspectorContent({
  selectedUser,
  selectedWorldUser,
  selectedStats,
  onClose,
  onPlant,
  onRemove,
  plantPendingUsername,
  removePendingUsername,
}: Omit<ForestInspectorProps, "isMobile">) {
  if (!selectedUser) return null;

  const loading = !selectedStats;
  const stage = selectedStats ? stageFor(selectedStats.totalCommits) : null;
  const statusMeta = selectedStats ? STATUS_META[selectedStats.status] : STATUS_META.inactive;
  const isRemoving = removePendingUsername === selectedUser;
  const isPlanting = plantPendingUsername === selectedUser;
  const isPlanted = selectedWorldUser?.planted ?? false;

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="pixel-kicker">Forest inspector</div>
          <h3 className="pixel-title mt-2 text-[24px]">{loading ? `@${selectedUser}` : selectedStats.name || `@${selectedUser}`}</h3>
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-[#56663e]">
            <UserRound size={14} />
            @{selectedStats?.login ?? selectedUser}
          </div>
        </div>
        <div className="flex gap-2">
          {!isPlanted && (
            <button
              className="pixel-icon-button"
              onClick={() => onPlant(selectedUser)}
            >
              {isPlanting ? <Loader2 size={15} className="animate-spin" /> : <Sprout size={15} />}
            </button>
          )}
          <button className="pixel-icon-button" onClick={onClose}>
            <X size={15} />
          </button>
          {isPlanted && (
            <button
              className="pixel-icon-button pixel-icon-button-danger"
              data-testid={`remove-user-${selectedUser}`}
              onClick={() => onRemove(selectedUser)}
            >
              {isRemoving ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="pixel-alert mt-5">
          <Loader2 size={16} className="animate-spin" />
          <div>
            <div className="font-semibold">Refreshing developer profile</div>
            <div className="mt-1 text-sm">Trying live GitHub first, then falling back to cached Appwrite data if needed.</div>
          </div>
        </div>
      )}

      {selectedStats && (
        <>
          <div className="mt-5 flex items-center gap-4">
            <img
              src={selectedStats.avatar_url}
              alt={selectedStats.login}
              className="h-[72px] w-[72px] rounded-[18px] border-2 border-[#705e35] object-cover"
            />
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {isPlanted && <span className="pixel-chip pixel-chip-gold">Planted</span>}
                <span className="pixel-chip" style={{ color: statusMeta.color, background: statusMeta.bg, borderColor: statusMeta.border }}>
                  {statusMeta.label}
                </span>
                {stage && <span className="pixel-chip">{stage.shortLabel}</span>}
                <span className={`pixel-chip ${selectedStats.dataSource === "estimated" ? "pixel-chip-gold" : selectedStats.dataSource === "cached" ? "pixel-chip-blue" : "pixel-chip-green"}`}>
                  {selectedStats.dataSource === "estimated"
                    ? "Estimated stats"
                    : selectedStats.dataSource === "cached"
                      ? "Cached Appwrite data"
                      : "Live GitHub data"}
                </span>
              </div>
              {selectedStats.bio && <p className="max-w-[340px] text-sm leading-6 text-[#405538]">{selectedStats.bio}</p>}
              <a
                href={selectedStats.html_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-[#49633d] underline-offset-4 hover:underline"
              >
                <ExternalLink size={13} />
                Open GitHub profile
              </a>
            </div>
          </div>

          {selectedStats.notice && (
            <div className={`pixel-alert mt-4 ${selectedStats.dataSource === "estimated" ? "pixel-alert-warn" : ""}`}>
              <Activity size={16} />
              <div>{selectedStats.notice}</div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            {statCard(<GitCommit size={14} />, "Commits", selectedStats.totalCommits.toLocaleString())}
            {statCard(<Activity size={14} />, "Active days", selectedStats.activeDays.toLocaleString())}
            {statCard(<Star size={14} />, "Stars", selectedStats.totalStars.toLocaleString())}
            {statCard(<UserRound size={14} />, "Followers", selectedStats.followers.toLocaleString())}
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-sm text-[#405538]">
            {selectedStats.location && (
              <span className="pixel-chip">
                <MapPin size={12} />
                {selectedStats.location}
              </span>
            )}
            <span className="pixel-chip">
              <Code2 size={12} />
              {selectedStats.public_repos} public repos
            </span>
            {selectedStats.lastActive && (
              <span className="pixel-chip">
                <Calendar size={12} />
                {new Date(selectedStats.lastActive).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
              </span>
            )}
            {selectedStats.totalForks > 0 && (
              <span className="pixel-chip">
                <GitFork size={12} />
                {selectedStats.totalForks.toLocaleString()} forks
              </span>
            )}
          </div>

          {selectedStats.topLanguages.length > 0 && (
            <div className="mt-5">
              <div className="pixel-kicker">Top languages</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedStats.topLanguages.slice(0, 5).map((language) => (
                  <span key={language} className="pixel-chip">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-[2px]"
                      style={{ background: langColors[language] || "#9ca3af" }}
                    />
                    {language}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ForestInspector(props: ForestInspectorProps) {
  const { isMobile, selectedUser, onClose } = props;
  if (!selectedUser) return null;

  if (isMobile) {
    return (
      <Drawer open={!!selectedUser} onOpenChange={(open) => !open && onClose()}>
        <DrawerContent className="border-0 bg-transparent p-0 shadow-none">
          <div className="mx-2 mb-2 max-h-[78vh] overflow-y-auto rounded-t-[28px] border-4 border-[#6f5d35] bg-[#efe2a8] shadow-[0_-10px_0_rgba(111,93,53,0.18)]">
            <InspectorContent {...props} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <aside className="absolute bottom-6 right-6 top-28 z-20 w-[380px] overflow-y-auto rounded-[28px] border-4 border-[#6f5d35] bg-[#efe2a8] shadow-[0_16px_0_rgba(111,93,53,0.18)]">
      <InspectorContent {...props} />
    </aside>
  );
}
