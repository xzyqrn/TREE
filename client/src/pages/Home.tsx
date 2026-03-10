import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TrackedUser } from "@shared/schema";
import UserCard from "@/components/UserCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, TreePine, Search, Github, Leaf, Wind,
  Users, GitCommit, Star, Sparkles, Moon, Sun
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

function ForestBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-gradient-to-b from-sky-50/60 via-background to-background dark:from-sky-950/20 dark:via-background dark:to-background" />
      <div className="absolute bottom-0 left-0 right-0 h-32 opacity-10">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute bottom-0 inline-block"
            style={{
              left: `${(i / 20) * 100 + Math.sin(i * 1.7) * 2}%`,
              opacity: 0.4 + Math.random() * 0.6,
            }}
          >
            <svg width={20 + (i % 5) * 6} height={40 + (i % 7) * 12} viewBox="0 0 30 60">
              <polygon points="15,0 0,60 30,60" fill="hsl(var(--primary))" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroStats({ totalUsers, totalCommits, totalStars }: { totalUsers: number; totalCommits: number; totalStars: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-6 mb-8">
      {[
        { icon: <Users size={16} />, value: totalUsers, label: "Developers" },
        { icon: <GitCommit size={16} />, value: totalCommits, label: "Total Commits" },
        { icon: <Star size={16} />, value: totalStars, label: "Total Stars" },
      ].map(({ icon, value, label }) => (
        <div key={label} className="flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border/60 shadow-sm">
          <span className="text-primary">{icon}</span>
          <span className="text-sm font-bold text-foreground">{value.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
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
      className="fixed top-4 right-4 p-2.5 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors z-50"
      aria-label="Toggle theme"
    >
      {dark ? <Sun size={16} className="text-yellow-500" /> : <Moon size={16} className="text-slate-600" />}
    </button>
  );
}

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: trackedUsers = [], isLoading: loadingUsers } = useQuery<TrackedUser[]>({
    queryKey: ["/api/users"],
  });

  const addMutation = useMutation({
    mutationFn: (username: string) => apiRequest("POST", "/api/users", { username }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setInputValue("");
      toast({ title: "User added to your forest! 🌱", description: `@${inputValue} is now growing.` });
    },
    onError: (err: any) => {
      const msg = err?.error || err?.message || "Failed to add user";
      toast({ title: "Could not add user", description: msg, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (username: string) => apiRequest("DELETE", `/api/users/${username}`),
    onSuccess: (_, username) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Removed from forest", description: `@${username} was removed.` });
    },
    onError: () => {
      toast({ title: "Failed to remove user", variant: "destructive" });
    },
  });

  const handleAdd = () => {
    const val = inputValue.trim().replace(/^@/, "");
    if (!val) return;
    addMutation.mutate(val);
  };

  const filteredUsers = trackedUsers.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background relative">
      <ForestBackground />
      <ThemeToggle />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-4">
            <Sparkles size={12} />
            GitHub Developer Forest
            <Leaf size={12} />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-3 tracking-tight">
            Your Dev{" "}
            <span className="text-primary relative inline-block">
              Forest
              <span className="absolute -top-1 -right-6">🌲</span>
            </span>
          </h1>
          <p className="text-muted-foreground max-w-md mx-auto text-sm leading-relaxed">
            Watch developers grow into mighty trees. More commits = taller, denser trees.
            Track your team's contribution ecosystem.
          </p>
        </div>

        {/* Hero stats */}
        {trackedUsers.length > 0 && (
          <HeroStats
            totalUsers={trackedUsers.length}
            totalCommits={0}
            totalStars={0}
          />
        )}

        {/* Add user panel */}
        <div className="max-w-lg mx-auto mb-10">
          <div className="flex gap-2 p-3 rounded-2xl border border-border bg-card shadow-sm">
            <div className="relative flex-1">
              <Github size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                data-testid="input-add-user"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="GitHub username (e.g. torvalds)"
                className="pl-8 bg-background border-border/50 text-sm h-9"
              />
            </div>
            <Button
              data-testid="button-add-user"
              onClick={handleAdd}
              disabled={!inputValue.trim() || addMutation.isPending}
              size="sm"
              className="gap-1.5 px-4"
            >
              {addMutation.isPending ? (
                <span className="animate-spin text-sm">⟳</span>
              ) : (
                <Plus size={14} />
              )}
              Add
            </Button>
          </div>
          <p className="text-center text-[11px] text-muted-foreground mt-2 flex items-center justify-center gap-1">
            <Wind size={10} /> Plant a developer in your forest and watch them grow
          </p>
        </div>

        {/* Search + label row */}
        {trackedUsers.length > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-2">
              <TreePine size={16} className="text-primary" />
              <span className="text-sm font-medium text-foreground">
                {filteredUsers.length} developer{filteredUsers.length !== 1 ? "s" : ""} in your forest
              </span>
            </div>
            <div className="relative w-full sm:w-52">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                data-testid="input-search-users"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search developers..."
                className="pl-8 h-8 text-sm bg-card border-border/50"
              />
            </div>
          </div>
        )}

        {/* Legend */}
        {trackedUsers.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-6 p-3 rounded-xl bg-card/60 border border-border/40">
            <span className="text-[11px] font-medium text-muted-foreground">Tree stages:</span>
            {[
              { icon: "🌱", label: "Seedling", range: "< 20" },
              { icon: "🌿", label: "Sapling", range: "20–79" },
              { icon: "🌲", label: "Young", range: "80–199" },
              { icon: "🌳", label: "Mature", range: "200–499" },
              { icon: "🏔️", label: "Ancient", range: "500+" },
            ].map(({ icon, label, range }) => (
              <div key={label} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span>{icon}</span>
                <span className="font-medium text-foreground/70">{label}</span>
                <span className="text-muted-foreground/60">({range} commits)</span>
              </div>
            ))}
          </div>
        )}

        {/* Grid */}
        {loadingUsers ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="text-4xl animate-bounce">🌱</div>
              <p className="text-sm">Loading your forest...</p>
            </div>
          </div>
        ) : filteredUsers.length === 0 && searchQuery ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🔍</div>
            <p className="text-muted-foreground">No developers match "{searchQuery}"</p>
          </div>
        ) : trackedUsers.length === 0 ? (
          <div className="text-center py-20 flex flex-col items-center gap-4">
            <div className="text-6xl">🌵</div>
            <div>
              <p className="text-lg font-semibold text-foreground mb-1">Your forest is empty</p>
              <p className="text-sm text-muted-foreground">Add a GitHub username above to plant your first tree</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredUsers.map(user => (
              <UserCard
                key={user.username}
                username={user.username}
                onRemove={(u) => removeMutation.mutate(u)}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-16 pb-4">
          <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
            <TreePine size={11} className="text-primary" />
            GitForest — commit counts are estimated from public repository data
            <TreePine size={11} className="text-primary" />
          </p>
        </div>
      </div>
    </div>
  );
}
