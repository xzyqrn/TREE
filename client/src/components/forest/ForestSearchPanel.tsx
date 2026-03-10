import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2, Plus, Search, Sprout, Trees, X } from "lucide-react";

import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface SearchResult {
  login: string;
  avatar_url: string;
  html_url: string;
  type: string;
  tracked: boolean;
}

interface ForestSearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingUsername: string | null;
  pendingJumpUsername: string | null;
  onAddUser: (username: string) => void;
  onJumpToUser: (username: string) => void;
}

async function fetchSearchResults(query: string): Promise<SearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Search failed (${response.status})`);
  }
  return response.json();
}

export function ForestSearchPanel({
  open,
  onOpenChange,
  pendingUsername,
  pendingJumpUsername,
  onAddUser,
  onJumpToUser,
}: ForestSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      return;
    }
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ["/api/search", debouncedQuery],
    queryFn: () => fetchSearchResults(debouncedQuery),
    enabled: open && debouncedQuery.length >= 1,
    staleTime: 30 * 1000,
    retry: false,
  });

  const state = useMemo(() => {
    if (!open) return "closed";
    if (debouncedQuery.length === 0) return "idle";
    if (searchQuery.isFetching) return "searching";
    if (searchQuery.error instanceof Error && /rate limit/i.test(searchQuery.error.message)) return "rate-limited";
    if (searchQuery.error) return "error";
    if ((searchQuery.data ?? []).length === 0) return "not-found";
    return "results";
  }, [debouncedQuery.length, open, searchQuery.data, searchQuery.error, searchQuery.isFetching]);

  if (!open) return null;

  return (
    <div className="absolute right-4 top-20 z-30 w-[min(390px,calc(100vw-32px))] md:right-6 md:top-24">
      <div className="pixel-panel pixel-panel-strong">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="pixel-kicker">Plant a developer</div>
            <h3 className="pixel-title mt-2 text-[22px]">Search GitHub and grow the grove</h3>
            <p className="mt-2 text-sm leading-6 text-[#405538]">
              Add a new tree or jump to one that is already planted.
            </p>
          </div>
          <button className="pixel-icon-button" onClick={() => onOpenChange(false)} data-testid="button-close-search">
            <X size={15} />
          </button>
        </div>

        <Command className="mt-4 rounded-none bg-transparent text-[#304529]">
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder="Search GitHub username"
            data-testid="input-search-user"
            className="font-['DM_Sans'] text-[14px]"
          />
          <CommandList className="mt-2 max-h-[340px] overflow-y-auto px-0">
            {state === "idle" && (
              <div className="rounded-[14px] border-2 border-[#c4b16f] bg-[#f6ecbe] px-4 py-5 text-sm leading-6 text-[#405538]">
                Start typing to search GitHub users. Tracked developers can be jumped to instantly.
              </div>
            )}

            {state === "searching" && (
              <div className="pixel-inline-status">
                <Loader2 size={15} className="animate-spin" />
                Searching GitHub
              </div>
            )}

            {state === "rate-limited" && (
              <div className="pixel-alert pixel-alert-warn">
                <AlertTriangle size={16} />
                <div>
                  <div className="font-semibold">GitHub search is rate-limited.</div>
                  <div className="mt-1 text-sm">Try again shortly or add `GITHUB_TOKEN` for steadier live results.</div>
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
              <CommandGroup heading="GitHub results" className="[&_[cmdk-group-heading]]:px-0 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:font-['Silkscreen'] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em]">
                {(searchQuery.data ?? []).map((result) => {
                  const alreadyTracked = result.tracked;
                  const isPending = pendingUsername === result.login;
                  const isJumping = pendingJumpUsername === result.login;
                  return (
                    <CommandItem
                      key={result.login}
                      value={result.login}
                      disabled={isPending || isJumping}
                      onSelect={() => {
                        if (isPending || isJumping) return;
                        if (alreadyTracked) {
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
                        {alreadyTracked
                          ? isJumping
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Trees size={12} />
                          : isPending
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Sprout size={12} />}
                        {alreadyTracked ? (isJumping ? "Jumping" : "Jump") : isPending ? "Planting" : "Plant"}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
