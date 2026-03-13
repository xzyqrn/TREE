import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2, Search, Sprout, Trees, X } from "lucide-react";

import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useIsMobile } from "@/hooks/use-mobile";
import type { WorldSearchResponse, WorldSearchResult } from "@shared/schema";

interface ForestSearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingUsername: string | null;
  pendingJumpUsername: string | null;
  onAddUser: (username: string) => void;
  onJumpToUser: (username: string) => void;
}

async function fetchSearchResults(query: string, mode: "suggest" | "submit"): Promise<WorldSearchResponse> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&mode=${mode}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Search failed (${response.status})`);
  }
  return response.json();
}

function renderResultItem(
  result: WorldSearchResult,
  pendingUsername: string | null,
  pendingJumpUsername: string | null,
  onAddUser: (username: string) => void,
  onJumpToUser: (username: string) => void,
) {
  const normalized = result.login.toLowerCase();
  const alreadyTracked = result.planted;
  const isPending = pendingUsername === normalized;
  const isJumping = pendingJumpUsername === normalized;
  const shouldJump = result.inWorld && alreadyTracked;

  return (
    <CommandItem
      key={`${result.source}:${result.login}`}
      value={result.login}
      disabled={isPending || isJumping}
      onSelect={() => {
        if (isPending || isJumping) return;
        if (shouldJump) {
          onJumpToUser(result.login);
          return;
        }
        onAddUser(result.login);
      }}
      className="mb-2 rounded-[16px] border-2 border-[#c7b576] bg-[#f6edc1] px-3 py-3 font-['DM_Sans'] data-[selected=true]:bg-[#e0e6b6] data-[selected=true]:text-[#2d3f26]"
    >
      <img
        src={result.avatar_url}
        alt={result.login}
        className="h-10 w-10 rounded-[10px] border-2 border-[#705e35] object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">@{result.login}</span>
          {result.type === "Organization" && <span className="pixel-chip px-2 py-1 text-[10px]">ORG</span>}
          {result.inWorld && <span className="pixel-chip px-2 py-1 text-[10px]">WORLD</span>}
          {result.planted && <span className="pixel-chip pixel-chip-gold px-2 py-1 text-[10px]">PLANTED</span>}
        </div>
        <a
          href={result.html_url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="mt-1 inline-flex items-center gap-1 text-xs text-[#5f7047] underline-offset-4 hover:underline"
        >
          <ExternalLink size={11} />
          Open profile
        </a>
      </div>
      <div className={`pixel-chip ${alreadyTracked ? "pixel-chip-blue" : ""} ${isPending || isJumping ? "pixel-chip-gold" : ""}`}>
        {shouldJump
          ? isJumping
            ? <Loader2 size={12} className="animate-spin" />
            : <Trees size={12} />
          : isPending
            ? <Loader2 size={12} className="animate-spin" />
            : <Sprout size={12} />}
        {shouldJump ? (isJumping ? "Jumping" : "Jump") : isPending ? "Planting" : "Plant"}
      </div>
    </CommandItem>
  );
}

export function ForestSearchPanel({
  open,
  onOpenChange,
  pendingUsername,
  pendingJumpUsername,
  onAddUser,
  onJumpToUser,
}: ForestSearchPanelProps) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"suggest" | "submit">("suggest");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setActiveQuery("");
      setSearchMode("suggest");
      return;
    }
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setSearchMode("suggest");
    setActiveQuery(debouncedQuery);
  }, [debouncedQuery, open]);

  const triggerLiveSearch = () => {
    const nextQuery = query.trim();
    if (!nextQuery) return;
    setSearchMode("submit");
    setActiveQuery(nextQuery);
  };

  const searchQuery = useQuery({
    queryKey: ["/api/search", searchMode, activeQuery],
    queryFn: () => fetchSearchResults(activeQuery, searchMode),
    enabled: open && activeQuery.length >= 1,
    staleTime: 30 * 1000,
    retry: false,
  });

  const state = useMemo(() => {
    if (!open) return "closed";
    if (activeQuery.length === 0) return "idle";
    if (searchQuery.isFetching) return "searching";
    if (searchQuery.error) return "error";
    if ((searchQuery.data?.directory.length ?? 0) + (searchQuery.data?.world.length ?? 0) === 0) return "not-found";
    return "results";
  }, [activeQuery.length, open, searchQuery.data, searchQuery.error, searchQuery.isFetching]);

  if (!open) return null;

  return (
    <div className={isMobile ? "absolute inset-x-3 bottom-4 top-24 z-30" : "absolute right-4 top-20 z-30 w-[min(430px,calc(100vw-32px))] md:right-6 md:top-24"}>
      <div className={`pixel-panel pixel-panel-strong ${isMobile ? "flex h-full flex-col px-4 py-4" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="pixel-kicker">GitHub search</div>
            <h3 className="pixel-title mt-2 text-[20px] leading-[1.05] md:text-[22px]">Search live profiles and planted developers</h3>
            <p className="mt-2 text-sm leading-6 text-[#405538]">
              Live GitHub matches appear first. Developers already in the world are grouped separately and can be jumped to or planted.
            </p>
          </div>
          <button className="pixel-icon-button" onClick={() => onOpenChange(false)} data-testid="button-close-search">
            <X size={15} />
          </button>
        </div>

        <Command className={`mt-4 rounded-none bg-transparent text-[#304529] ${isMobile ? "flex min-h-0 flex-1 flex-col" : ""}`}>
          <div className="flex items-center gap-2">
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  triggerLiveSearch();
                }
              }}
              placeholder="Search GitHub username"
              data-testid="input-search-user"
              className="font-['DM_Sans'] text-[14px]"
            />
            <button
              type="button"
              onClick={triggerLiveSearch}
              className="pixel-button min-w-[126px] justify-center px-3 py-3 text-[11px]"
              data-testid="button-submit-search"
            >
              <Search size={13} />
              Search GitHub
            </button>
          </div>
          <CommandList className={`mt-2 overflow-y-auto px-0 ${isMobile ? "min-h-0 flex-1" : "max-h-[340px]"}`}>
            {state === "idle" && (
              <div className="rounded-[14px] border-2 border-[#c4b16f] bg-[#f6ecbe] px-4 py-5 text-sm leading-6 text-[#405538]">
                Start typing for Appwrite suggestions. Press Enter or use the button to refresh against live GitHub.
              </div>
            )}

            {state === "searching" && (
              <div className="pixel-inline-status">
                <Loader2 size={15} className="animate-spin" />
                {searchMode === "submit" ? "Searching GitHub and Appwrite" : "Searching Appwrite cache"}
              </div>
            )}

            {searchQuery.data?.directoryError && (
              <div className="pixel-alert pixel-alert-warn">
                <AlertTriangle size={16} />
                <div>
                  <div className="font-semibold">Using cached directory results.</div>
                  <div className="mt-1 text-sm">{searchQuery.data.directoryError} Local world matches are still available.</div>
                </div>
              </div>
            )}

            {state === "error" && (
              <div className="pixel-alert pixel-alert-danger">
                <AlertTriangle size={16} />
                <div>
                  <div className="font-semibold">Search failed</div>
                  <div className="mt-1 text-sm">
                    {searchQuery.error instanceof Error ? searchQuery.error.message : "Unknown search error"}
                  </div>
                </div>
              </div>
            )}

            {state === "not-found" && (
              <div className="rounded-[14px] border-2 border-[#c4b16f] bg-[#f6ecbe] px-4 py-5 text-sm leading-6 text-[#405538]">
                No matching users found. Try a broader partial username.
              </div>
            )}

            {state === "results" && (
              <>
                {(searchQuery.data?.directory.length ?? 0) > 0 && (
                  <CommandGroup heading={`GitHub directory · ${searchQuery.data?.directorySource === "live" ? "LIVE" : "CACHED"}`} className="[&_[cmdk-group-heading]]:px-0 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:font-['Silkscreen'] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em]">
                    {(searchQuery.data?.directory ?? []).map((result: WorldSearchResult) =>
                      renderResultItem(result, pendingUsername, pendingJumpUsername, onAddUser, onJumpToUser),
                    )}
                  </CommandGroup>
                )}
                {(searchQuery.data?.world.length ?? 0) > 0 && (
                  <CommandGroup heading="Already in the world" className="[&_[cmdk-group-heading]]:px-0 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:font-['Silkscreen'] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em]">
                    {(searchQuery.data?.world ?? []).map((result) =>
                      renderResultItem(result, pendingUsername, pendingJumpUsername, onAddUser, onJumpToUser),
                    )}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
