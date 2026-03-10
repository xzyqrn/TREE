export const langColors: Record<string, string> = {
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
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
};

export const STATUS_META = {
  active: { label: "Active", color: "#22c55e", bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.34)" },
  moderate: { label: "Moderate", color: "#eab308", bg: "rgba(234,179,8,0.14)", border: "rgba(234,179,8,0.34)" },
  occasional: { label: "Occasional", color: "#f97316", bg: "rgba(249,115,22,0.14)", border: "rgba(249,115,22,0.34)" },
  inactive: { label: "Inactive", color: "#9ca3af", bg: "rgba(156,163,175,0.14)", border: "rgba(156,163,175,0.3)" },
} as const;

export const STAGE_META = [
  { max: 99, icon: "Seedling", shortLabel: "Seedling", range: "< 100" },
  { max: 999, icon: "Sapling", shortLabel: "Sapling", range: "< 1K" },
  { max: 9999, icon: "Young Tree", shortLabel: "Young Tree", range: "< 10K" },
  { max: 99999, icon: "Mature", shortLabel: "Mature", range: "< 100K" },
  { max: Infinity, icon: "Ancient", shortLabel: "Ancient", range: "100K+" },
] as const;

export function stageFor(commits: number) {
  return STAGE_META.find((stage) => commits <= stage.max) ?? STAGE_META[STAGE_META.length - 1];
}

