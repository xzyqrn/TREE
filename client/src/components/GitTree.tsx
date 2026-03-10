interface GitTreeProps {
  commits: number;
  status: "active" | "moderate" | "occasional" | "inactive";
  animated?: boolean;
  size?: number;
}

function getTreeStage(commits: number): number {
  if (commits < 20) return 1;
  if (commits < 80) return 2;
  if (commits < 200) return 3;
  if (commits < 500) return 4;
  return 5;
}

function getTreeColors(status: string, stage: number) {
  const trunkColors = {
    active: ["#5d4037", "#6d4c41", "#795548"],
    moderate: ["#5d4037", "#6d4c41", "#795548"],
    occasional: ["#6d4c41", "#795548", "#8d6e63"],
    inactive: ["#8d6e63", "#a1887f", "#bcaaa4"],
  };

  const leafSets = {
    active: [
      ["#1b5e20", "#2e7d32", "#388e3c", "#43a047", "#66bb6a"],
      ["#1b5e20", "#2e7d32", "#388e3c", "#43a047", "#66bb6a", "#81c784", "#a5d6a7"],
    ],
    moderate: [
      ["#2e7d32", "#388e3c", "#43a047", "#66bb6a", "#81c784"],
      ["#2e7d32", "#388e3c", "#43a047", "#66bb6a", "#81c784", "#a5d6a7"],
    ],
    occasional: [
      ["#558b2f", "#689f38", "#7cb342", "#8bc34a", "#aed581"],
      ["#558b2f", "#689f38", "#7cb342", "#8bc34a", "#aed581"],
    ],
    inactive: [
      ["#827717", "#9e9d24", "#afb42b", "#c0ca33", "#d4e157"],
      ["#827717", "#9e9d24", "#afb42b", "#c0ca33", "#d4e157"],
    ],
  };

  const trunks = trunkColors[status as keyof typeof trunkColors] || trunkColors.inactive;
  const leaves = leafSets[status as keyof typeof leafSets] || leafSets.inactive;
  const leafSet = stage >= 4 ? leaves[1] : leaves[0];
  return { trunks, leafSet };
}

export default function GitTree({ commits, status, animated = true, size = 120 }: GitTreeProps) {
  const stage = getTreeStage(commits);
  const { trunks, leafSet } = getTreeColors(status, stage);

  const s = size;
  const cx = s / 2;

  const animClass = animated ? "tree-sway" : "";

  if (stage === 1) {
    // Seedling
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className={animClass} style={{ transformOrigin: `${cx}px ${s}px` }}>
        <rect x={cx - 2} y={s * 0.7} width={4} height={s * 0.28} fill={trunks[0]} rx={2} />
        <ellipse cx={cx} cy={s * 0.62} rx={s * 0.08} ry={s * 0.12} fill={leafSet[1]} />
        <ellipse cx={cx - s * 0.06} cy={s * 0.68} rx={s * 0.06} ry={s * 0.08} fill={leafSet[0]} />
        <ellipse cx={cx + s * 0.06} cy={s * 0.68} rx={s * 0.06} ry={s * 0.08} fill={leafSet[2]} />
        <circle cx={cx} cy={s * 0.56} r={s * 0.07} fill={leafSet[3]} />
      </svg>
    );
  }

  if (stage === 2) {
    // Sapling
    const trunkH = s * 0.38;
    const trunkY = s - trunkH;
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className={animClass} style={{ transformOrigin: `${cx}px ${s}px` }}>
        <rect x={cx - 3} y={trunkY} width={6} height={trunkH} fill={trunks[0]} rx={3} />
        <line x1={cx} y1={trunkY + trunkH * 0.3} x2={cx - s * 0.12} y2={trunkY + trunkH * 0.1} stroke={trunks[1]} strokeWidth={2} />
        <line x1={cx} y1={trunkY + trunkH * 0.3} x2={cx + s * 0.12} y2={trunkY + trunkH * 0.1} stroke={trunks[1]} strokeWidth={2} />
        <ellipse cx={cx - s * 0.12} cy={trunkY + trunkH * 0.05} rx={s * 0.1} ry={s * 0.07} fill={leafSet[0]} />
        <ellipse cx={cx + s * 0.12} cy={trunkY + trunkH * 0.05} rx={s * 0.1} ry={s * 0.07} fill={leafSet[1]} />
        <ellipse cx={cx} cy={trunkY - s * 0.04} rx={s * 0.18} ry={s * 0.22} fill={leafSet[2]} />
        <ellipse cx={cx - s * 0.08} cy={trunkY + s * 0.02} rx={s * 0.14} ry={s * 0.16} fill={leafSet[3]} />
        <ellipse cx={cx + s * 0.08} cy={trunkY + s * 0.02} rx={s * 0.14} ry={s * 0.16} fill={leafSet[1]} />
      </svg>
    );
  }

  if (stage === 3) {
    // Young tree
    const trunkH = s * 0.45;
    const trunkY = s - trunkH;
    const trunkW = 7;
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className={animClass} style={{ transformOrigin: `${cx}px ${s}px` }}>
        <path d={`M${cx - 2} ${s} Q${cx - 3} ${trunkY + trunkH * 0.5} ${cx - 1} ${trunkY}`} fill="none" stroke={trunks[0]} strokeWidth={trunkW} strokeLinecap="round" />
        <path d={`M${cx + 2} ${s} Q${cx + 3} ${trunkY + trunkH * 0.5} ${cx + 1} ${trunkY}`} fill="none" stroke={trunks[1]} strokeWidth={trunkW - 1} strokeLinecap="round" />
        <line x1={cx} y1={trunkY + trunkH * 0.35} x2={cx - s * 0.18} y2={trunkY + trunkH * 0.15} stroke={trunks[1]} strokeWidth={3} strokeLinecap="round" />
        <line x1={cx} y1={trunkY + trunkH * 0.35} x2={cx + s * 0.2} y2={trunkY + trunkH * 0.12} stroke={trunks[1]} strokeWidth={3} strokeLinecap="round" />
        <line x1={cx} y1={trunkY + trunkH * 0.55} x2={cx - s * 0.22} y2={trunkY + trunkH * 0.4} stroke={trunks[2]} strokeWidth={2} strokeLinecap="round" />
        <line x1={cx} y1={trunkY + trunkH * 0.55} x2={cx + s * 0.22} y2={trunkY + trunkH * 0.38} stroke={trunks[2]} strokeWidth={2} strokeLinecap="round" />
        <ellipse cx={cx - s * 0.18} cy={trunkY + trunkH * 0.1} rx={s * 0.12} ry={s * 0.1} fill={leafSet[0]} />
        <ellipse cx={cx + s * 0.2} cy={trunkY + trunkH * 0.07} rx={s * 0.13} ry={s * 0.1} fill={leafSet[1]} />
        <ellipse cx={cx - s * 0.2} cy={trunkY + trunkH * 0.36} rx={s * 0.13} ry={s * 0.09} fill={leafSet[2]} />
        <ellipse cx={cx + s * 0.22} cy={trunkY + trunkH * 0.34} rx={s * 0.12} ry={s * 0.09} fill={leafSet[3]} />
        <ellipse cx={cx} cy={trunkY - s * 0.06} rx={s * 0.24} ry={s * 0.26} fill={leafSet[1]} />
        <ellipse cx={cx - s * 0.09} cy={trunkY + s * 0.03} rx={s * 0.18} ry={s * 0.19} fill={leafSet[2]} />
        <ellipse cx={cx + s * 0.09} cy={trunkY + s * 0.04} rx={s * 0.18} ry={s * 0.18} fill={leafSet[0]} />
        <ellipse cx={cx} cy={trunkY - s * 0.14} rx={s * 0.18} ry={s * 0.14} fill={leafSet[4]} />
      </svg>
    );
  }

  if (stage === 4) {
    // Mature tree
    const trunkH = s * 0.52;
    const trunkY = s - trunkH;
    const trunkW = 10;
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className={animClass} style={{ transformOrigin: `${cx}px ${s}px` }}>
        <path d={`M${cx - 4} ${s} C${cx - 6} ${s * 0.7} ${cx - 2} ${trunkY + trunkH * 0.4} ${cx} ${trunkY}`} fill="none" stroke={trunks[0]} strokeWidth={trunkW} strokeLinecap="round" />
        <path d={`M${cx + 4} ${s} C${cx + 6} ${s * 0.7} ${cx + 2} ${trunkY + trunkH * 0.4} ${cx} ${trunkY}`} fill="none" stroke={trunks[1]} strokeWidth={trunkW - 2} strokeLinecap="round" />
        {[0.25, 0.45, 0.65].map((ratio, i) => (
          <g key={i}>
            <line x1={cx} y1={trunkY + trunkH * ratio} x2={cx - s * (0.22 + i * 0.02)} y2={trunkY + trunkH * (ratio - 0.15)} stroke={trunks[i % 3]} strokeWidth={4 - i} strokeLinecap="round" />
            <line x1={cx} y1={trunkY + trunkH * ratio} x2={cx + s * (0.24 + i * 0.02)} y2={trunkY + trunkH * (ratio - 0.14)} stroke={trunks[(i + 1) % 3]} strokeWidth={4 - i} strokeLinecap="round" />
          </g>
        ))}
        <ellipse cx={cx - s * 0.25} cy={trunkY + trunkH * 0.08} rx={s * 0.14} ry={s * 0.12} fill={leafSet[0]} />
        <ellipse cx={cx + s * 0.26} cy={trunkY + trunkH * 0.07} rx={s * 0.15} ry={s * 0.12} fill={leafSet[1]} />
        <ellipse cx={cx - s * 0.27} cy={trunkY + trunkH * 0.28} rx={s * 0.14} ry={s * 0.11} fill={leafSet[2]} />
        <ellipse cx={cx + s * 0.28} cy={trunkY + trunkH * 0.27} rx={s * 0.14} ry={s * 0.11} fill={leafSet[3]} />
        <ellipse cx={cx - s * 0.3} cy={trunkY + trunkH * 0.5} rx={s * 0.15} ry={s * 0.1} fill={leafSet[4]} />
        <ellipse cx={cx + s * 0.3} cy={trunkY + trunkH * 0.49} rx={s * 0.15} ry={s * 0.1} fill={leafSet[0]} />
        <ellipse cx={cx} cy={trunkY - s * 0.05} rx={s * 0.3} ry={s * 0.3} fill={leafSet[1]} />
        <ellipse cx={cx - s * 0.14} cy={trunkY + s * 0.05} rx={s * 0.22} ry={s * 0.22} fill={leafSet[2]} />
        <ellipse cx={cx + s * 0.14} cy={trunkY + s * 0.06} rx={s * 0.22} ry={s * 0.21} fill={leafSet[3]} />
        <ellipse cx={cx} cy={trunkY - s * 0.16} rx={s * 0.24} ry={s * 0.18} fill={leafSet[4]} />
        <ellipse cx={cx} cy={trunkY - s * 0.26} rx={s * 0.16} ry={s * 0.12} fill={leafSet[0]} />
      </svg>
    );
  }

  // Stage 5 - Ancient massive tree
  const trunkH = s * 0.6;
  const trunkY = s - trunkH;
  const trunkW = 14;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className={animClass} style={{ transformOrigin: `${cx}px ${s}px` }}>
      <path d={`M${cx - 6} ${s} C${cx - 9} ${s * 0.75} ${cx - 4} ${trunkY + trunkH * 0.5} ${cx - 1} ${trunkY}`} fill="none" stroke={trunks[0]} strokeWidth={trunkW} strokeLinecap="round" />
      <path d={`M${cx + 6} ${s} C${cx + 9} ${s * 0.75} ${cx + 4} ${trunkY + trunkH * 0.5} ${cx + 1} ${trunkY}`} fill="none" stroke={trunks[1]} strokeWidth={trunkW - 3} strokeLinecap="round" />
      <ellipse cx={cx} cy={s - 3} rx={s * 0.18} ry={s * 0.04} fill={trunks[0]} opacity={0.4} />
      {[0.2, 0.38, 0.55, 0.72].map((ratio, i) => (
        <g key={i}>
          <path d={`M${cx} ${trunkY + trunkH * ratio} Q${cx - s * (0.15 + i * 0.05)} ${trunkY + trunkH * (ratio - 0.1)} ${cx - s * (0.28 + i * 0.04)} ${trunkY + trunkH * (ratio - 0.18)}`} fill="none" stroke={trunks[i % 3]} strokeWidth={5 - i} strokeLinecap="round" />
          <path d={`M${cx} ${trunkY + trunkH * ratio} Q${cx + s * (0.16 + i * 0.05)} ${trunkY + trunkH * (ratio - 0.09)} ${cx + s * (0.3 + i * 0.04)} ${trunkY + trunkH * (ratio - 0.17)}`} fill="none" stroke={trunks[(i + 1) % 3]} strokeWidth={5 - i} strokeLinecap="round" />
        </g>
      ))}
      {[
        [cx - s * 0.3, trunkY + trunkH * 0.0, s * 0.16, s * 0.14, 0],
        [cx + s * 0.32, trunkY + trunkH * 0.0, s * 0.17, s * 0.14, 1],
        [cx - s * 0.34, trunkY + trunkH * 0.17, s * 0.16, s * 0.13, 2],
        [cx + s * 0.35, trunkY + trunkH * 0.16, s * 0.17, s * 0.13, 3],
        [cx - s * 0.36, trunkY + trunkH * 0.34, s * 0.17, s * 0.12, 4],
        [cx + s * 0.37, trunkY + trunkH * 0.33, s * 0.17, s * 0.12, 0],
        [cx - s * 0.38, trunkY + trunkH * 0.52, s * 0.16, s * 0.12, 1],
        [cx + s * 0.38, trunkY + trunkH * 0.51, s * 0.16, s * 0.12, 2],
      ].map(([x, y, rx, ry, ci], idx) => (
        <ellipse key={idx} cx={x as number} cy={y as number} rx={rx as number} ry={ry as number} fill={leafSet[(ci as number) % leafSet.length]} />
      ))}
      <ellipse cx={cx} cy={trunkY - s * 0.04} rx={s * 0.36} ry={s * 0.33} fill={leafSet[1]} />
      <ellipse cx={cx - s * 0.16} cy={trunkY + s * 0.08} rx={s * 0.26} ry={s * 0.26} fill={leafSet[2]} />
      <ellipse cx={cx + s * 0.16} cy={trunkY + s * 0.09} rx={s * 0.26} ry={s * 0.25} fill={leafSet[3]} />
      <ellipse cx={cx} cy={trunkY - s * 0.18} rx={s * 0.3} ry={s * 0.22} fill={leafSet[4]} />
      <ellipse cx={cx - s * 0.08} cy={trunkY - s * 0.3} rx={s * 0.22} ry={s * 0.18} fill={leafSet[0]} />
      <ellipse cx={cx + s * 0.08} cy={trunkY - s * 0.31} rx={s * 0.22} ry={s * 0.17} fill={leafSet[2]} />
      <ellipse cx={cx} cy={trunkY - s * 0.42} rx={s * 0.18} ry={s * 0.14} fill={leafSet[1]} />
      <ellipse cx={cx} cy={trunkY - s * 0.52} rx={s * 0.12} ry={s * 0.1} fill={leafSet[3]} />
    </svg>
  );
}
