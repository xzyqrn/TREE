import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TrackedUser, UserStats } from "@shared/schema";
import ForestWorld from "@/components/ForestWorld";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import {
  Plus, Github, TreePine, X, ExternalLink, GitCommit,
  Star, Users, Activity, Code2, MapPin, Calendar,
  GitFork, Sun, Moon, Trash2, MousePointer2, Search, Check, Loader2,
} from "lucide-react";

const langColors: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f7df1e", Python: "#3776ab",
  Go: "#00add8", Rust: "#ce422b", Java: "#007396", "C++": "#f34b7d",
  C: "#555555", Ruby: "#cc342d", PHP: "#4f5d95", Swift: "#fa7343",
  Kotlin: "#a97bff", Shell: "#89e051", HTML: "#e34c26", CSS: "#563d7c",
  Vue: "#41b883", Svelte: "#ff3e00",
};

const STATUS_META = {
  active:     { label: "Active",     color: "#22c55e", bg: "rgba(34,197,94,0.15)",   border: "rgba(34,197,94,0.4)" },
  moderate:   { label: "Moderate",   color: "#eab308", bg: "rgba(234,179,8,0.15)",   border: "rgba(234,179,8,0.4)" },
  occasional: { label: "Occasional", color: "#f97316", bg: "rgba(249,115,22,0.15)",  border: "rgba(249,115,22,0.4)" },
  inactive:   { label: "Inactive",   color: "#9ca3af", bg: "rgba(156,163,175,0.15)", border: "rgba(156,163,175,0.35)" },
};

const STAGE_META = [
  { max: 99,        icon: "🌱", label: "Seedling",   range: "< 100" },
  { max: 999,       icon: "🌿", label: "Sapling",    range: "< 1K" },
  { max: 9999,      icon: "🌲", label: "Young Tree", range: "< 10K" },
  { max: 99999,     icon: "🌳", label: "Mature",     range: "< 100K" },
  { max: Infinity,  icon: "🏔️", label: "Ancient",    range: "100K+" },
];

function stageFor(commits: number) {
  return STAGE_META.find(s => commits <= s.max) ?? STAGE_META[STAGE_META.length - 1];
}

// Individual stats loader — each user gets their own component, staggered by index
function StatsLoader({ username, index, onLoaded }: { username: string; index: number; onLoaded: (username: string, stats: UserStats) => void }) {
  const [enabled, setEnabled] = useState(index === 0);
  useEffect(() => {
    if (index === 0) return;
    const timer = setTimeout(() => setEnabled(true), index * 400);
    return () => clearTimeout(timer);
  }, [index]);

  const { data } = useQuery<UserStats>({
    queryKey: ["/api/users", username, "stats"],
    queryFn: () =>
      fetch(`/api/users/${username}/stats`).then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(e));
        return r.json();
      }),
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    enabled,
    retry: (n, err: any) => !err?.error?.includes("rate limit") && n < 2,
    retryDelay: 3000,
  });

  useEffect(() => {
    if (data) onLoaded(username, data);
  }, [data, username]);

  return null;
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    document.documentElement.classList.toggle("dark");
    setDark(d => !d);
    localStorage.setItem("theme", !dark ? "dark" : "light");
  };
  return (
    <button
      data-testid="button-theme-toggle"
      onClick={toggle}
      style={{
        background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "50%",
        width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", backdropFilter: "blur(8px)", color: dark ? "#fbbf24" : "#bae6fd",
      }}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function Glass({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(12px)",
      border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, color: "#fff", ...style,
    }}>
      {children}
    </div>
  );
}

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statsMap, setStatsMap] = useState<Record<string, UserStats>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (showAdd) setTimeout(() => searchInputRef.current?.focus(), 50);
    else { setSearchQuery(""); setDebouncedQuery(""); }
  }, [showAdd]);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") document.documentElement.classList.add("dark");
    else if (saved === "light") document.documentElement.classList.remove("dark");
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("dark");
  }, []);

  const { data: trackedUsers = [] } = useQuery<TrackedUser[]>({ queryKey: ["/api/users"] });

  const { data: searchResults = [], isFetching: searchLoading } = useQuery<
    Array<{ login: string; avatar_url: string; html_url: string; type: string }>
  >({
    queryKey: ["/api/search", debouncedQuery],
    queryFn: () =>
      fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`).then(r => r.json()),
    enabled: debouncedQuery.length >= 1,
    staleTime: 30 * 1000,
  });

  const trackedSet = new Set(trackedUsers.map(u => u.username.toLowerCase()));

  const handleStatsLoaded = useCallback((username: string, stats: UserStats) => {
    setStatsMap(prev => ({ ...prev, [username]: stats }));
  }, []);

  const forestUsers = trackedUsers.map(u => ({
    username: u.username,
    stats: statsMap[u.username] ?? null,
  }));

  const selectedStats = selectedUser ? (statsMap[selectedUser] ?? null) : null;

  const addMutation = useMutation({
    mutationFn: (username: string) => apiRequest("POST", "/api/users", { username }),
    onSuccess: (_, username) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "🌱 New tree planted!", description: `@${username} joins the forest.` });
    },
    onError: (err: any) => {
      toast({ title: "Could not add user", description: err?.error || err?.message || "Failed", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (username: string) => apiRequest("DELETE", `/api/users/${username}`),
    onSuccess: (_, u) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setStatsMap(prev => { const n = { ...prev }; delete n[u]; return n; });
      if (selectedUser === u) setSelectedUser(null);
      toast({ title: "Tree removed", description: `@${u} left the forest.` });
    },
  });

  const sm = selectedStats ? (STATUS_META[selectedStats.status] ?? STATUS_META.inactive) : null;
  const stage = selectedStats ? stageFor(selectedStats.totalCommits) : null;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      {/* Load stats for each user */}
      {trackedUsers.map((u, i) => (
        <StatsLoader key={u.username} username={u.username} index={i} onLoaded={handleStatsLoaded} />
      ))}

      {/* 3D World */}
      <ForestWorld users={forestUsers} onSelectUser={setSelectedUser} selectedUser={selectedUser} />

      {/* Top bar */}
      <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <Glass style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <TreePine size={18} color="#4ade80" />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.3 }}>GitForest</span>
          <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.2)" }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
            {trackedUsers.length} dev{trackedUsers.length !== 1 ? "s" : ""}
          </span>
        </Glass>
      </div>

      {/* Top-right controls */}
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 10, display: "flex", gap: 8 }}>
        <ThemeToggle />
        <button
          data-testid="button-open-add"
          onClick={() => setShowAdd(s => !s)}
          style={{
            background: showAdd ? "rgba(74,222,128,0.25)" : "rgba(0,0,0,0.55)",
            border: "1px solid rgba(74,222,128,0.45)", borderRadius: 20,
            padding: "6px 14px", display: "flex", alignItems: "center", gap: 6,
            cursor: "pointer", backdropFilter: "blur(8px)", color: "#4ade80", fontSize: 13, fontWeight: 600,
          }}
        >
          <Plus size={14} /> Add Dev
        </button>
      </div>

      {/* Search panel */}
      {showAdd && (
        <Glass style={{ position: "absolute", top: 64, right: 16, zIndex: 10, padding: 16, width: 300 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "rgba(255,255,255,0.8)", display: "flex", alignItems: "center", gap: 6 }}>
            <Search size={13} color="#4ade80" /> Search GitHub developers
          </div>
          <div style={{ position: "relative" }}>
            <Github size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.4)", pointerEvents: "none" }} />
            {searchLoading && (
              <Loader2 size={13} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.35)", animation: "spin 1s linear infinite" }} />
            )}
            <input
              data-testid="input-search-user"
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search username…"
              style={{
                width: "100%", paddingLeft: 28, paddingRight: 28, paddingTop: 8, paddingBottom: 8,
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8, color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Results list */}
          {debouncedQuery.length >= 1 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
              {(searchResults as Array<{ login: string; avatar_url: string; type: string }>).length === 0 && !searchLoading && (
                <div style={{ padding: "10px 0", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                  No users found
                </div>
              )}
              {(searchResults as Array<{ login: string; avatar_url: string; type: string }>).map(u => {
                const alreadyAdded = trackedSet.has(u.login.toLowerCase());
                const isPending = addMutation.isPending && addMutation.variables === u.login;
                return (
                  <div
                    key={u.login}
                    data-testid={`result-user-${u.login}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                      borderRadius: 8, background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <img src={u.avatar_url} alt={u.login} style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{u.login}
                      </div>
                      {u.type === "Organization" && (
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Organization</div>
                      )}
                    </div>
                    <button
                      data-testid={`button-add-${u.login}`}
                      onClick={() => { if (!alreadyAdded && !isPending) addMutation.mutate(u.login); }}
                      disabled={alreadyAdded || isPending}
                      style={{
                        flexShrink: 0, width: 28, height: 28,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: 7, border: alreadyAdded ? "1px solid rgba(74,222,128,0.4)" : "1px solid rgba(74,222,128,0.5)",
                        background: alreadyAdded ? "rgba(74,222,128,0.1)" : "rgba(74,222,128,0.2)",
                        cursor: alreadyAdded ? "default" : "pointer",
                        color: "#4ade80", opacity: isPending ? 0.6 : 1,
                      }}
                    >
                      {isPending ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : alreadyAdded ? <Check size={12} /> : <Plus size={12} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {debouncedQuery.length === 0 && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 8, marginBottom: 0 }}>
              Type a name to search GitHub users
            </p>
          )}
        </Glass>
      )}

      {/* Selected user panel */}
      {selectedUser && selectedStats && sm && stage && (
        <Glass style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 10, padding: "16px 20px",
          minWidth: 340, maxWidth: 520, width: "calc(100vw - 40px)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <img src={selectedStats.avatar_url} alt={selectedUser}
              style={{ width: 50, height: 50, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", flexShrink: 0, objectFit: "cover" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{selectedStats.name || selectedUser}</span>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: sm.bg, border: `1px solid ${sm.border}`, color: sm.color, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: sm.color }} />
                  {sm.label}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.75)" }}>
                  {stage.icon} {stage.label}
                </span>
              </div>
              <a href={selectedStats.html_url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", display: "inline-flex", alignItems: "center", gap: 3, marginTop: 2 }}>
                @{selectedStats.login} <ExternalLink size={9} />
              </a>
              {selectedStats.bio && (
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 4, lineHeight: 1.5, display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2, overflow: "hidden" }}>
                  {selectedStats.bio}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <a href={selectedStats.html_url} target="_blank" rel="noopener noreferrer"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "5px 8px", color: "rgba(255,255,255,0.65)", display: "flex", alignItems: "center" }}>
                <Github size={14} />
              </a>
              <button onClick={() => removeMutation.mutate(selectedUser)} data-testid={`remove-user-${selectedUser}`}
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "5px 8px", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center" }}>
                <Trash2 size={14} />
              </button>
              <button onClick={() => setSelectedUser(null)}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 8px", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 12 }}>
            {[
              { icon: <GitCommit size={12} />, val: selectedStats.totalCommits.toLocaleString(), label: "Commits" },
              { icon: <Activity size={12} />,  val: selectedStats.activeDays.toLocaleString(),   label: "Active days" },
              { icon: <Star size={12} />,       val: selectedStats.totalStars.toLocaleString(),   label: "Stars" },
              { icon: <Users size={12} />,      val: selectedStats.followers.toLocaleString(),    label: "Followers" },
            ].map(({ icon, val, label }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 4px", textAlign: "center" }}>
                <div style={{ color: "rgba(255,255,255,0.4)", display: "flex", justifyContent: "center", marginBottom: 3 }}>{icon}</div>
                <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Meta + languages */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
            {selectedStats.location && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
                <MapPin size={10} /> {selectedStats.location}
              </span>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
              <Code2 size={10} /> {selectedStats.public_repos} repos
            </span>
            {selectedStats.lastActive && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
                <Calendar size={10} /> {new Date(selectedStats.lastActive).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
              </span>
            )}
            {selectedStats.totalForks > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
                <GitFork size={10} /> {selectedStats.totalForks.toLocaleString()} forks
              </span>
            )}
            {selectedStats.topLanguages.slice(0, 5).map(lang => (
              <span key={lang} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, padding: "2px 7px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: langColors[lang] || "#888", flexShrink: 0 }} />
                {lang}
              </span>
            ))}
          </div>
        </Glass>
      )}

      {/* Controls hint */}
      {trackedUsers.length > 0 && !selectedUser && (
        <div style={{
          position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10,
          background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20,
          padding: "5px 16px", fontSize: 11, color: "rgba(255,255,255,0.38)", backdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", gap: 12, pointerEvents: "none", whiteSpace: "nowrap",
        }}>
          <span>🖱 Drag to orbit</span>
          <span>·</span>
          <span>⚙ Scroll to zoom</span>
          <span>·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <MousePointer2 size={10} /> Click tree to inspect
          </span>
        </div>
      )}

      {/* Empty state */}
      {trackedUsers.length === 0 && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", zIndex: 10, color: "#fff", pointerEvents: "none" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🌿</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Your forest is empty</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>Click "Add Dev" to plant your first tree</div>
        </div>
      )}

      {/* Legend */}
      <Glass style={{ position: "absolute", bottom: 16, right: 16, zIndex: 10, padding: "10px 14px" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.38)", marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>Tree stages</div>
        {STAGE_META.map(s => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 3 }}>
            <span>{s.icon}</span>
            <span style={{ fontWeight: 500 }}>{s.label}</span>
            <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, marginLeft: 2 }}>{s.range}</span>
          </div>
        ))}
      </Glass>
    </div>
  );
}
