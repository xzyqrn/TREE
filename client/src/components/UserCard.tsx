import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserStats } from "@shared/schema";
import GitTree3D from "./GitTree3D";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  GitCommit, Star, Users, MapPin, Trash2,
  ExternalLink, Calendar, Activity, Code2, GitFork
} from "lucide-react";

interface UserCardProps {
  username: string;
  onRemove: (username: string) => void;
}

const statusConfig = {
  active: {
    label: "Active",
    stripe: "bg-green-500",
    dotClass: "animate-pulse bg-green-500",
    textColor: "text-green-600 dark:text-green-400",
    badgeBg: "bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800",
    borderClass: "border-green-200 dark:border-green-900",
  },
  moderate: {
    label: "Moderate",
    stripe: "bg-yellow-400",
    dotClass: "bg-yellow-400",
    textColor: "text-yellow-600 dark:text-yellow-400",
    badgeBg: "bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200 dark:border-yellow-800",
    borderClass: "border-yellow-200 dark:border-yellow-900",
  },
  occasional: {
    label: "Occasional",
    stripe: "bg-orange-400",
    dotClass: "bg-orange-400",
    textColor: "text-orange-600 dark:text-orange-400",
    badgeBg: "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800",
    borderClass: "border-orange-200 dark:border-orange-900",
  },
  inactive: {
    label: "Inactive",
    stripe: "bg-gray-400",
    dotClass: "bg-gray-400",
    textColor: "text-gray-500 dark:text-gray-400",
    badgeBg: "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700",
    borderClass: "border-gray-200 dark:border-gray-700",
  },
};

const langColors: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f7df1e", Python: "#3776ab",
  Go: "#00add8", Rust: "#ce422b", Java: "#007396", "C++": "#f34b7d",
  C: "#555555", Ruby: "#cc342d", PHP: "#4f5d95", Swift: "#fa7343",
  Kotlin: "#a97bff", Shell: "#89e051", HTML: "#e34c26", CSS: "#563d7c",
  Vue: "#41b883", Svelte: "#ff3e00", Dart: "#00b4ab",
};

function StageLabel({ commits }: { commits: number }) {
  const stages = [
    { max: 19, icon: "🌱", label: "Seedling", bg: "bg-lime-100 dark:bg-lime-950/50 text-lime-700 dark:text-lime-300 border-lime-300 dark:border-lime-700" },
    { max: 79, icon: "🌿", label: "Sapling", bg: "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700" },
    { max: 199, icon: "🌲", label: "Young Tree", bg: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700" },
    { max: 499, icon: "🌳", label: "Mature", bg: "bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700" },
    { max: Infinity, icon: "🏔️", label: "Ancient", bg: "bg-cyan-100 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700" },
  ];
  const s = stages.find(x => commits <= x.max) || stages[stages.length - 1];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full border ${s.bg}`}>
      {s.icon} {s.label}
    </span>
  );
}

function StatBox({ icon, value, label, tip }: { icon: React.ReactNode; value: string | number; label: string; tip?: string }) {
  const inner = (
    <div className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl bg-background/70 border border-border/50">
      <div className="text-muted-foreground/80">{icon}</div>
      <div className="text-[13px] font-bold text-foreground tabular-nums leading-none">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-[10px] text-muted-foreground leading-none">{label}</div>
    </div>
  );
  if (tip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">{tip}</TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}

export default function UserCard({ username, onRemove }: UserCardProps) {
  const { data: stats, isLoading, isError, error } = useQuery<UserStats>({
    queryKey: ["/api/users", username, "stats"],
    queryFn: () =>
      fetch(`/api/users/${username}/stats`).then(r => {
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
      <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
        <div className="h-1.5 w-full bg-muted animate-pulse" />
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-[200px] w-full rounded-xl" />
          <div className="grid grid-cols-4 gap-1.5">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
          <Skeleton className="h-3.5 w-full rounded-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    const msg = (error as any)?.error || "Failed to load";
    const isRate = msg.toLowerCase().includes("rate limit");
    return (
      <div className={`rounded-2xl border bg-card overflow-hidden flex flex-col ${isRate ? "border-yellow-300/50 dark:border-yellow-800/40" : "border-destructive/30"}`}>
        <div className={`h-1.5 w-full ${isRate ? "bg-yellow-400" : "bg-destructive"}`} />
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-medium">@{username}</span>
            <button
              data-testid={`remove-user-${username}`}
              onClick={() => onRemove(username)}
              className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <div className="text-4xl">{isRate ? "⏳" : "🌵"}</div>
            <div className={`text-sm font-semibold ${isRate ? "text-yellow-600 dark:text-yellow-400" : "text-destructive"}`}>
              {isRate ? "Rate limit reached" : "Failed to load"}
            </div>
            <div className="text-xs text-muted-foreground max-w-[180px] leading-relaxed">
              {isRate ? "Add a GITHUB_TOKEN secret to increase API limits." : msg}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div
      data-testid={`user-card-${username}`}
      className={`group rounded-2xl border bg-card overflow-hidden flex flex-col transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${sc.borderClass}`}
    >
      {/* Status stripe */}
      <div className={`h-1.5 w-full ${sc.stripe}`} />

      <div className="p-4 flex flex-col gap-3">
        {/* User header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-shrink-0">
              <img
                data-testid={`avatar-${username}`}
                src={stats.avatar_url}
                alt={username}
                className="w-10 h-10 rounded-full object-cover border-2 border-border"
              />
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${sc.dotClass}`} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-foreground truncate leading-tight">
                {stats.name || stats.login}
              </div>
              <a
                href={stats.html_url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`link-github-${username}`}
                className="font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-0.5"
              >
                @{stats.login} <ExternalLink size={9} className="opacity-50" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${sc.badgeBg} ${sc.textColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dotClass}`} />
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
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{stats.bio}</p>
        )}

        {/* 3D Tree */}
        <div className="relative rounded-xl overflow-hidden border border-border/40">
          <GitTree3D
            commits={stats.totalCommits}
            status={stats.status}
            width={270}
            height={240}
          />
          <div className="absolute top-2 left-2 pointer-events-none">
            <StageLabel commits={stats.totalCommits} />
          </div>
          <div className="absolute bottom-2 right-2 pointer-events-none">
            <span className="text-[9px] text-white/50 bg-black/20 px-1.5 py-0.5 rounded-full backdrop-blur-sm">
              drag to rotate
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-1.5">
          <StatBox icon={<GitCommit size={12} />} label="Commits" value={stats.totalCommits} tip="Estimated total commits" />
          <StatBox icon={<Activity size={12} />} label="Days" value={stats.activeDays} tip="Active contribution days (estimated)" />
          <StatBox icon={<Star size={12} />} label="Stars" value={stats.totalStars} />
          <StatBox icon={<Users size={12} />} label="Followers" value={stats.followers} />
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Code2 size={10} />
            <span>{stats.public_repos} repos</span>
          </div>
          {stats.location && (
            <div className="flex items-center gap-1">
              <MapPin size={10} />
              <span className="truncate max-w-[90px]">{stats.location}</span>
            </div>
          )}
          {stats.lastActive && (
            <div className="flex items-center gap-1">
              <Calendar size={10} />
              <span>
                {new Date(stats.lastActive).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
              </span>
            </div>
          )}
          {stats.totalForks > 0 && (
            <div className="flex items-center gap-1">
              <GitFork size={10} />
              <span>{stats.totalForks.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Language pills */}
        {stats.topLanguages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.topLanguages.slice(0, 5).map(lang => (
              <span
                key={lang}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border border-border/50 bg-background/60 text-muted-foreground font-mono"
              >
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
