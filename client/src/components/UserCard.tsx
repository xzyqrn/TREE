import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserStats } from "@shared/schema";
import GitTree from "./GitTree";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  GitCommit, Star, GitFork, Users, MapPin, Trash2,
  ExternalLink, Calendar, Activity, Code2, Zap
} from "lucide-react";

interface UserCardProps {
  username: string;
  onRemove: (username: string) => void;
}

const statusConfig = {
  active: {
    label: "Active",
    color: "bg-green-500",
    textColor: "text-green-600 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-200 dark:border-green-800",
    dot: "animate-pulse bg-green-500",
  },
  moderate: {
    label: "Moderate",
    color: "bg-yellow-500",
    textColor: "text-yellow-600 dark:text-yellow-400",
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    border: "border-yellow-200 dark:border-yellow-800",
    dot: "bg-yellow-500",
  },
  occasional: {
    label: "Occasional",
    color: "bg-orange-400",
    textColor: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    border: "border-orange-200 dark:border-orange-800",
    dot: "bg-orange-400",
  },
  inactive: {
    label: "Inactive",
    color: "bg-gray-400",
    textColor: "text-gray-500 dark:text-gray-400",
    bg: "bg-gray-50 dark:bg-gray-900/30",
    border: "border-gray-200 dark:border-gray-700",
    dot: "bg-gray-400",
  },
};

const langColors: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f7df1e",
  Python: "#3776ab",
  Go: "#00add8",
  Rust: "#ce422b",
  Java: "#007396",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#cc342d",
  PHP: "#4f5d95",
  Swift: "#fa7343",
  Kotlin: "#a97bff",
  Scala: "#dc322f",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Dart: "#00b4ab",
  Elixir: "#6e4a7e",
};

function TreeStageBadge({ commits }: { commits: number }) {
  const stages = [
    { min: 0, max: 19, label: "Seedling", icon: "🌱", color: "bg-lime-100 text-lime-700 border-lime-200 dark:bg-lime-950/50 dark:text-lime-300 dark:border-lime-800" },
    { min: 20, max: 79, label: "Sapling", icon: "🌿", color: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800" },
    { min: 80, max: 199, label: "Young Tree", icon: "🌲", color: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800" },
    { min: 200, max: 499, label: "Mature Tree", icon: "🌳", color: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800" },
    { min: 500, max: Infinity, label: "Ancient Tree", icon: "🏔️", color: "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800" },
  ];
  const stage = stages.find(s => commits >= s.min && commits <= s.max) || stages[0];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${stage.color}`}>
      {stage.icon} {stage.label}
    </span>
  );
}

function StatItem({ icon, label, value, tooltip }: { icon: React.ReactNode; label: string; value: string | number; tooltip?: string }) {
  const content = (
    <div className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-background/60 border border-border/50 min-w-0">
      <div className="text-muted-foreground">{icon}</div>
      <div className="text-sm font-bold text-foreground leading-none">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-[10px] text-muted-foreground leading-none">{label}</div>
    </div>
  );
  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    );
  }
  return content;
}

export default function UserCard({ username, onRemove }: UserCardProps) {
  const [hovered, setHovered] = useState(false);

  const { data: stats, isLoading, isError, error } = useQuery<UserStats>({
    queryKey: ["/api/users", username, "stats"],
    queryFn: () => fetch(`/api/users/${username}/stats`).then(r => {
      if (!r.ok) return r.json().then(e => Promise.reject(e));
      return r.json();
    }),
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: (failureCount, err: any) => {
      if (err?.error?.includes("rate limit")) return false;
      if (err?.error === "GitHub user not found") return false;
      return failureCount < 2;
    },
    retryDelay: 3000,
  });

  const status = stats?.status ?? "inactive";
  const sc = statusConfig[status];

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4 min-h-[420px]">
        <div className="flex items-center gap-3">
          <Skeleton className="w-12 h-12 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  if (isError) {
    const msg = (error as any)?.error || "Failed to load user";
    const isRateLimit = msg.toLowerCase().includes("rate limit");
    return (
      <div className={`rounded-2xl border bg-card p-5 flex flex-col gap-4 min-h-[340px] ${isRateLimit ? "border-yellow-300/50 dark:border-yellow-800/50" : "border-destructive/30"}`}>
        <div className="flex items-center justify-between">
          <div className="font-mono text-sm font-medium text-foreground">@{username}</div>
          <button
            data-testid={`remove-user-${username}`}
            onClick={() => onRemove(username)}
            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <div className="text-4xl">{isRateLimit ? "⏳" : "🌵"}</div>
          <div className={`text-sm font-medium ${isRateLimit ? "text-yellow-600 dark:text-yellow-400" : "text-destructive"}`}>
            {isRateLimit ? "Rate limit reached" : "Failed to load"}
          </div>
          <div className="text-xs text-muted-foreground max-w-[200px] leading-relaxed">
            {isRateLimit ? "GitHub API limit hit. Add a GITHUB_TOKEN secret to unlock higher limits." : msg}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const treeSize = hovered ? 148 : 140;

  return (
    <div
      data-testid={`user-card-${username}`}
      className={`group rounded-2xl border bg-card overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${sc.border}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header stripe */}
      <div className={`h-1.5 w-full ${sc.color}`} />

      <div className="p-5 flex flex-col gap-4">
        {/* User info row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <img
                data-testid={`avatar-${username}`}
                src={stats.avatar_url}
                alt={username}
                className="w-11 h-11 rounded-full object-cover border-2 border-border"
              />
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${sc.dot}`} />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-foreground truncate leading-tight">
                {stats.name || username}
              </div>
              <a
                href={stats.html_url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`link-github-${username}`}
                className="font-mono text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-0.5"
              >
                @{stats.login} <ExternalLink size={9} className="opacity-60" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.bg} ${sc.textColor} border ${sc.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              {sc.label}
            </span>
            <button
              data-testid={`remove-user-${username}`}
              onClick={() => onRemove(username)}
              className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Bio */}
        {stats.bio && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{stats.bio}</p>
        )}

        {/* Tree visualization */}
        <div className={`flex flex-col items-center justify-end rounded-xl py-3 px-2 ${sc.bg} border ${sc.border} relative overflow-hidden`} style={{ minHeight: 160 }}>
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background/20 to-transparent" />
          <div className="absolute top-2 right-2">
            <TreeStageBadge commits={stats.totalCommits} />
          </div>
          <div className="relative z-10 transition-all duration-300" style={{ transform: hovered ? 'scale(1.04)' : 'scale(1)' }}>
            <GitTree
              commits={stats.totalCommits}
              status={status}
              animated={hovered}
              size={treeSize}
            />
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-5 rounded-b-xl" style={{
            background: "linear-gradient(to top, rgba(139,90,43,0.15), transparent)"
          }} />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-1.5">
          <StatItem icon={<GitCommit size={13} />} label="Commits" value={stats.totalCommits} tooltip="Estimated total commits" />
          <StatItem icon={<Activity size={13} />} label="Active Days" value={stats.activeDays} tooltip="Estimated active contribution days" />
          <StatItem icon={<Star size={13} />} label="Stars" value={stats.totalStars} tooltip="Total stars received" />
          <StatItem icon={<Users size={13} />} label="Followers" value={stats.followers} />
        </div>

        {/* Bottom meta */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 border-t border-border/50">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Code2 size={10} />
            <span>{stats.public_repos} repos</span>
          </div>
          {stats.location && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MapPin size={10} />
              <span className="truncate max-w-[100px]">{stats.location}</span>
            </div>
          )}
          {stats.lastActive && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Calendar size={10} />
              <span>{new Date(stats.lastActive).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
            </div>
          )}
          {stats.totalForks > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <GitFork size={10} />
              <span>{stats.totalForks.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Languages */}
        {stats.topLanguages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.topLanguages.slice(0, 4).map(lang => (
              <span key={lang} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border border-border/60 bg-background/60 text-muted-foreground font-mono">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: langColors[lang] || "#888" }}
                />
                {lang}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
