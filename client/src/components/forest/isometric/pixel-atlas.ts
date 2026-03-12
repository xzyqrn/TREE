export type PixelStatus = "active" | "moderate" | "occasional" | "inactive";

export interface PixelSprite {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  anchorX: number;
  anchorY: number;
}

export interface PixelAtlas {
  canvas: HTMLCanvasElement;
  sprites: Record<string, PixelSprite>;
}

type AvatarFrame = "idle" | "walk-a" | "walk-b" | "walk-c" | "walk-d";
type GroundVariant = "grass" | "grass-clover" | "grass-sunlit" | "shore" | "water" | "water-deep";

const avatarPalette = {
  outline: "#1d231c",
  hair: "#293c2f",
  hairLight: "#4e6b55",
  skin: "#f1ceb0",
  skinShade: "#d1a07d",
  scarf: "#d8b35e",
  scarfShade: "#9f7d35",
  coat: "#35593d",
  coatLight: "#5f8d67",
  coatShade: "#243a2b",
  strap: "#ab8754",
  satchel: "#8a5c37",
  belt: "#6b4b2c",
  pants: "#495463",
  pantsShade: "#313b45",
  boots: "#171c1f",
} as const;

interface TreePalette {
  canopy: string;
  canopyLight: string;
  canopyShade: string;
  trunk: string;
  trunkShade: string;
  accent: string;
}

interface TreeProfile {
  trunkHeight: number;
  trunkWidth: number;
  shadowWidth: number;
  shadowHeight: number;
  canopyWidths: number[];
  canopyOffsets: number[];
}

const CELL_WIDTH = 40;
const CELL_HEIGHT = 44;
const PIXEL = 2;

const statusPalette: Record<PixelStatus, TreePalette> = {
  active: {
    canopy: "#4cae5a",
    canopyLight: "#97e286",
    canopyShade: "#25552f",
    trunk: "#78522f",
    trunkShade: "#55381f",
    accent: "#d4f4b0",
  },
  moderate: {
    canopy: "#71a84c",
    canopyLight: "#b2da7d",
    canopyShade: "#44632d",
    trunk: "#7d5a30",
    trunkShade: "#5a401f",
    accent: "#edf19a",
  },
  occasional: {
    canopy: "#b68d47",
    canopyLight: "#e1b96e",
    canopyShade: "#7a5d31",
    trunk: "#835633",
    trunkShade: "#633f24",
    accent: "#f6dd98",
  },
  inactive: {
    canopy: "#8f816b",
    canopyLight: "#c7bcaa",
    canopyShade: "#5d5649",
    trunk: "#7f6148",
    trunkShade: "#5d4634",
    accent: "#ece4d3",
  },
};

const treeProfiles: Record<number, TreeProfile> = {
  1: {
    trunkHeight: 6,
    trunkWidth: 1,
    shadowWidth: 8,
    shadowHeight: 3,
    canopyWidths: [2, 4, 6, 5, 3],
    canopyOffsets: [0, 0, 0, 0, 1],
  },
  2: {
    trunkHeight: 7,
    trunkWidth: 2,
    shadowWidth: 9,
    shadowHeight: 3,
    canopyWidths: [3, 5, 7, 9, 8, 6],
    canopyOffsets: [0, 0, 0, -1, 0, 1],
  },
  3: {
    trunkHeight: 8,
    trunkWidth: 2,
    shadowWidth: 11,
    shadowHeight: 4,
    canopyWidths: [4, 6, 8, 10, 12, 11, 9, 7],
    canopyOffsets: [0, 0, 0, -1, -1, 0, 1, 1],
  },
  4: {
    trunkHeight: 9,
    trunkWidth: 2,
    shadowWidth: 13,
    shadowHeight: 4,
    canopyWidths: [4, 6, 8, 10, 12, 14, 14, 12, 10, 8],
    canopyOffsets: [0, 0, 0, -1, -1, -1, 0, 0, 1, 1],
  },
  5: {
    trunkHeight: 10,
    trunkWidth: 2,
    shadowWidth: 15,
    shadowHeight: 5,
    canopyWidths: [4, 6, 8, 10, 12, 14, 16, 16, 14, 12, 10, 8],
    canopyOffsets: [0, 0, 0, -1, -1, -1, 0, 0, 1, 1, 1, 0],
  },
};

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas not available");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x * PIXEL, y * PIXEL, w * PIXEL, h * PIXEL);
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
  shade: string,
  outline: string,
) {
  const center = left + Math.floor(width / 2);
  const halfHeight = Math.floor(height / 2);

  for (let row = 0; row < height; row += 1) {
    const distance = row <= halfHeight ? row : height - row - 1;
    const rowWidth = Math.max(2, 2 + distance * 4);
    const startX = center - Math.floor(rowWidth / 2);
    px(ctx, startX, top + row, rowWidth, 1, row < halfHeight ? fill : shade);
  }

  px(ctx, center, top, 1, 1, outline);
  px(ctx, left + 1, top + halfHeight, 1, 1, outline);
  px(ctx, left + width - 2, top + halfHeight, 1, 1, outline);
  px(ctx, center, top + height - 1, 1, 1, outline);
}

export function groundSpriteKey(variant: GroundVariant) {
  return `ground-${variant}`;
}

function drawGroundTile(ctx: CanvasRenderingContext2D, cellX: number, cellY: number, variant: GroundVariant) {
  if (variant === "water") {
    drawDiamond(ctx, cellX + 4, cellY + 10, 12, 6, "#6cbad7", "#3e7794", "#ddf6ff");
    px(ctx, cellX + 6, cellY + 11, 4, 1, "#effdff");
    px(ctx, cellX + 10, cellY + 12, 3, 1, "#d7f5ff");
    px(ctx, cellX + 9, cellY + 14, 4, 1, "#5c9ab4");
    return;
  }

  if (variant === "water-deep") {
    drawDiamond(ctx, cellX + 4, cellY + 10, 12, 6, "#519fc2", "#28556f", "#b9eeff");
    px(ctx, cellX + 7, cellY + 11, 3, 1, "#dbf9ff");
    px(ctx, cellX + 11, cellY + 12, 2, 1, "#dbf9ff");
    px(ctx, cellX + 9, cellY + 13, 4, 2, "#347491");
    return;
  }

  if (variant === "shore") {
    drawDiamond(ctx, cellX + 4, cellY + 10, 12, 6, "#b3c473", "#7b8d55", "#efe6b7");
    px(ctx, cellX + 6, cellY + 12, 2, 1, "#d4e8c5");
    px(ctx, cellX + 10, cellY + 11, 4, 1, "#d9c28b");
    px(ctx, cellX + 11, cellY + 13, 3, 1, "#ccb078");
    px(ctx, cellX + 8, cellY + 14, 1, 1, "#68906e");
    return;
  }

  if (variant === "grass-clover") {
    drawDiamond(ctx, cellX + 4, cellY + 10, 12, 6, "#82c568", "#547f46", "#edf3b9");
    px(ctx, cellX + 6, cellY + 12, 2, 1, "#b4eba0");
    px(ctx, cellX + 9, cellY + 11, 2, 1, "#6b9d52");
    px(ctx, cellX + 11, cellY + 12, 2, 1, "#b4eba0");
    px(ctx, cellX + 10, cellY + 14, 1, 1, "#4f6c35");
    return;
  }

  if (variant === "grass-sunlit") {
    drawDiamond(ctx, cellX + 4, cellY + 10, 12, 6, "#b9d56f", "#7f9754", "#fff0bf");
    px(ctx, cellX + 6, cellY + 11, 4, 1, "#fff1b2");
    px(ctx, cellX + 11, cellY + 12, 2, 1, "#d8e987");
    px(ctx, cellX + 9, cellY + 14, 1, 1, "#7b8f4f");
    px(ctx, cellX + 12, cellY + 13, 1, 1, "#f5c97c");
    return;
  }

  drawDiamond(ctx, cellX + 4, cellY + 10, 12, 6, "#8ac86d", "#5a8c4a", "#f2e7b2");
  px(ctx, cellX + 7, cellY + 12, 1, 2, "#d9ef9e");
  px(ctx, cellX + 10, cellY + 11, 2, 1, "#b3dd86");
  px(ctx, cellX + 11, cellY + 13, 1, 1, "#6f9a55");
}

function drawShadow(ctx: CanvasRenderingContext2D, cellX: number, cellY: number) {
  drawDiamond(ctx, cellX + 6, cellY + 16, 10, 4, "rgba(56,49,34,0.6)", "rgba(56,49,34,0.75)", "#000000");
}

function drawAvatarShadow(ctx: CanvasRenderingContext2D, cellX: number, cellY: number, shiftX: number, width: number) {
  drawDiamond(
    ctx,
    cellX + 6 + shiftX,
    cellY + 18,
    width,
    4,
    "rgba(40,31,22,0.56)",
    "rgba(19,14,10,0.76)",
    "rgba(0,0,0,0.2)",
  );
}

function drawAvatarBase(ctx: CanvasRenderingContext2D, cellX: number, cellY: number) {
  const p = avatarPalette;

  px(ctx, cellX + 10, cellY + 2, 4, 1, p.hair);
  px(ctx, cellX + 9, cellY + 3, 6, 1, p.hair);
  px(ctx, cellX + 8, cellY + 4, 1, 1, p.hair);
  px(ctx, cellX + 9, cellY + 4, 6, 1, p.hairLight);
  px(ctx, cellX + 15, cellY + 4, 1, 1, p.hair);

  px(ctx, cellX + 10, cellY + 5, 4, 3, p.skin);
  px(ctx, cellX + 10, cellY + 8, 4, 1, p.skinShade);
  px(ctx, cellX + 11, cellY + 6, 1, 1, p.outline);
  px(ctx, cellX + 13, cellY + 6, 1, 1, p.outline);
  px(ctx, cellX + 12, cellY + 7, 1, 1, "#ca8f7c");

  px(ctx, cellX + 9, cellY + 9, 6, 1, p.scarf);
  px(ctx, cellX + 11, cellY + 10, 3, 1, p.scarfShade);
  px(ctx, cellX + 14, cellY + 10, 1, 2, p.scarf);

  px(ctx, cellX + 8, cellY + 10, 8, 1, p.outline);
  px(ctx, cellX + 8, cellY + 11, 1, 6, p.outline);
  px(ctx, cellX + 15, cellY + 11, 1, 6, p.outline);
  px(ctx, cellX + 9, cellY + 16, 6, 1, p.outline);

  px(ctx, cellX + 9, cellY + 11, 6, 5, p.coat);
  px(ctx, cellX + 10, cellY + 11, 4, 2, p.coatLight);
  px(ctx, cellX + 9, cellY + 12, 1, 3, p.coatShade);
  px(ctx, cellX + 14, cellY + 12, 1, 3, p.coatShade);
  px(ctx, cellX + 12, cellY + 11, 1, 5, p.strap);
  px(ctx, cellX + 9, cellY + 14, 6, 1, p.belt);
  px(ctx, cellX + 10, cellY + 15, 4, 1, p.coatShade);

  px(ctx, cellX + 7, cellY + 12, 1, 3, p.satchel);
  px(ctx, cellX + 7, cellY + 15, 2, 1, p.satchel);
}

function drawAvatarFrame(ctx: CanvasRenderingContext2D, cellX: number, cellY: number, frame: AvatarFrame) {
  const p = avatarPalette;
  const bodyLift = frame === "walk-b" || frame === "walk-d" ? -1 : 0;
  const shadowShift = frame === "walk-a" ? -1 : frame === "walk-c" ? 1 : 0;
  drawAvatarShadow(ctx, cellX, cellY, shadowShift, frame === "idle" ? 10 : 12);

  const y = cellY + bodyLift;
  drawAvatarBase(ctx, cellX, y);

  if (frame === "walk-a") {
    px(ctx, cellX + 7, y + 10, 1, 4, p.coatShade);
    px(ctx, cellX + 7, y + 14, 1, 1, p.skinShade);
    px(ctx, cellX + 16, y + 12, 1, 4, p.coatShade);
    px(ctx, cellX + 16, y + 16, 1, 1, p.skinShade);
    px(ctx, cellX + 9, y + 17, 2, 4, p.pants);
    px(ctx, cellX + 8, y + 21, 3, 1, p.boots);
    px(ctx, cellX + 13, y + 16, 2, 3, p.pantsShade);
    px(ctx, cellX + 13, y + 19, 2, 1, p.boots);
    return;
  }

  if (frame === "walk-b") {
    px(ctx, cellX + 7, y + 12, 1, 3, p.coatShade);
    px(ctx, cellX + 7, y + 15, 1, 1, p.skinShade);
    px(ctx, cellX + 16, y + 10, 1, 4, p.coatShade);
    px(ctx, cellX + 16, y + 14, 1, 1, p.skinShade);
    px(ctx, cellX + 10, y + 17, 2, 4, p.pants);
    px(ctx, cellX + 10, y + 21, 2, 1, p.boots);
    px(ctx, cellX + 13, y + 16, 2, 3, p.pantsShade);
    px(ctx, cellX + 12, y + 19, 3, 1, p.boots);
    return;
  }

  if (frame === "walk-c") {
    px(ctx, cellX + 7, y + 12, 1, 4, p.coatShade);
    px(ctx, cellX + 7, y + 16, 1, 1, p.skinShade);
    px(ctx, cellX + 16, y + 10, 1, 4, p.coatShade);
    px(ctx, cellX + 16, y + 14, 1, 1, p.skinShade);
    px(ctx, cellX + 10, y + 16, 2, 3, p.pants);
    px(ctx, cellX + 10, y + 19, 2, 1, p.boots);
    px(ctx, cellX + 13, y + 17, 2, 4, p.pantsShade);
    px(ctx, cellX + 13, y + 21, 3, 1, p.boots);
    return;
  }

  if (frame === "walk-d") {
    px(ctx, cellX + 7, y + 10, 1, 4, p.coatShade);
    px(ctx, cellX + 7, y + 14, 1, 1, p.skinShade);
    px(ctx, cellX + 16, y + 12, 1, 3, p.coatShade);
    px(ctx, cellX + 16, y + 15, 1, 1, p.skinShade);
    px(ctx, cellX + 10, y + 16, 2, 3, p.pants);
    px(ctx, cellX + 9, y + 19, 3, 1, p.boots);
    px(ctx, cellX + 13, y + 17, 2, 4, p.pantsShade);
    px(ctx, cellX + 13, y + 21, 2, 1, p.boots);
    return;
  }

  px(ctx, cellX + 7, y + 11, 1, 4, p.coatShade);
  px(ctx, cellX + 7, y + 15, 1, 1, p.skinShade);
  px(ctx, cellX + 16, y + 11, 1, 4, p.coatShade);
  px(ctx, cellX + 16, y + 15, 1, 1, p.skinShade);
  px(ctx, cellX + 10, y + 17, 2, 4, p.pants);
  px(ctx, cellX + 13, y + 17, 2, 4, p.pantsShade);
  px(ctx, cellX + 10, y + 21, 2, 1, p.boots);
  px(ctx, cellX + 13, y + 21, 2, 1, p.boots);
}

function drawMarker(ctx: CanvasRenderingContext2D, cellX: number, cellY: number) {
  drawShadow(ctx, cellX, cellY + 8);
  px(ctx, cellX + 10, cellY + 11, 2, 4, "#668443");
  px(ctx, cellX + 9, cellY + 10, 4, 2, "#a8d06f");
}

function drawTree(ctx: CanvasRenderingContext2D, cellX: number, cellY: number, stage: number, status: PixelStatus) {
  const palette = statusPalette[status];
  const profile = treeProfiles[stage] ?? treeProfiles[5];
  const centerX = cellX + 11;
  const groundY = cellY + 33;
  const trunkLeft = centerX - Math.floor(profile.trunkWidth / 2);
  const trunkTop = groundY - profile.trunkHeight;
  const canopyTop = trunkTop - profile.canopyWidths.length + 1;
  const highlightRows = Math.max(1, Math.floor(profile.canopyWidths.length / 4));
  const shadedRows = Math.max(2, Math.floor(profile.canopyWidths.length / 3));

  drawDiamond(
    ctx,
    centerX - Math.floor(profile.shadowWidth / 2),
    groundY - Math.floor(profile.shadowHeight / 2) - 1,
    profile.shadowWidth,
    profile.shadowHeight,
    "rgba(47,36,26,0.48)",
    "rgba(24,18,13,0.7)",
    "rgba(16,10,7,0.22)",
  );

  px(ctx, trunkLeft, trunkTop, profile.trunkWidth, profile.trunkHeight, palette.trunk);
  px(
    ctx,
    trunkLeft + profile.trunkWidth - 1,
    trunkTop + 1,
    1,
    Math.max(1, profile.trunkHeight - 1),
    palette.trunkShade,
  );
  px(ctx, trunkLeft - 1, groundY - 2, profile.trunkWidth + 2, 1, palette.trunk);

  if (stage >= 3) {
    px(ctx, trunkLeft - 2, trunkTop + 3, 2, 1, palette.trunkShade);
    px(ctx, trunkLeft + profile.trunkWidth, trunkTop + 4, 2, 1, palette.trunkShade);
  }

  profile.canopyWidths.forEach((width, index) => {
    const rowY = canopyTop + index;
    const rowLeft = centerX - Math.floor(width / 2) + (profile.canopyOffsets[index] ?? 0);
    const fill = index < highlightRows
      ? palette.canopyLight
      : index >= profile.canopyWidths.length - shadedRows
        ? palette.canopyShade
        : palette.canopy;

    px(ctx, rowLeft, rowY, width, 1, fill);

    if (width >= 8) {
      px(ctx, rowLeft, rowY, 1, 1, palette.canopyShade);
      px(ctx, rowLeft + width - 1, rowY, 1, 1, palette.canopyShade);
    }

    if ((index === 1 || index === Math.floor(profile.canopyWidths.length / 2)) && width >= 6) {
      px(ctx, rowLeft + 1, rowY, Math.max(1, Math.floor(width / 4)), 1, palette.accent);
    }
  });

  px(ctx, centerX, canopyTop, 1, 1, palette.accent);
  px(ctx, centerX - 1, canopyTop + 1, 1, 1, palette.accent);

  if (stage >= 2) {
    const lowerBoughY = canopyTop + profile.canopyWidths.length - 3;
    px(ctx, centerX - 6, lowerBoughY, 2, 1, palette.canopyShade);
    px(ctx, centerX + 4, lowerBoughY + 1, 2, 1, palette.canopyShade);
  }

  if (stage >= 4) {
    const mossY = canopyTop + Math.floor(profile.canopyWidths.length / 2);
    px(ctx, centerX - 5, mossY, 1, 2, palette.accent);
    px(ctx, centerX + 5, mossY + 1, 1, 2, palette.accent);
  }
}

export function treeSpriteKey(stage: number, status: PixelStatus) {
  return `tree-${stage}-${status}`;
}

export function createPixelAtlas() {
  const groundSprites = [
    groundSpriteKey("grass"),
    groundSpriteKey("grass-clover"),
    groundSpriteKey("grass-sunlit"),
    groundSpriteKey("shore"),
    groundSpriteKey("water"),
    groundSpriteKey("water-deep"),
  ];
  const spriteNames = [
    ...groundSprites,
    "shadow",
    "avatar-idle",
    "avatar-walk-a",
    "avatar-walk-b",
    "avatar-walk-c",
    "avatar-walk-d",
    "marker",
    ...(["active", "moderate", "occasional", "inactive"] as const).flatMap((status) =>
      [1, 2, 3, 4, 5].map((stage) => treeSpriteKey(stage, status)),
    ),
  ];

  const columns = 5;
  const rows = Math.ceil(spriteNames.length / columns);
  const { canvas, ctx } = makeCanvas(columns * CELL_WIDTH * PIXEL, rows * CELL_HEIGHT * PIXEL);
  const sprites: Record<string, PixelSprite> = {};

  spriteNames.forEach((name, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = column * CELL_WIDTH;
    const cellY = row * CELL_HEIGHT;

    if (name.startsWith("ground-")) {
      drawGroundTile(ctx, cellX, cellY, name.replace("ground-", "") as GroundVariant);
      sprites[name] = { sx: cellX * PIXEL, sy: cellY * PIXEL, sw: 24 * PIXEL, sh: 22 * PIXEL, anchorX: 12 * PIXEL, anchorY: 13 * PIXEL };
      return;
    }

    if (name === "shadow") {
      drawShadow(ctx, cellX, cellY);
      sprites[name] = { sx: cellX * PIXEL, sy: cellY * PIXEL, sw: 24 * PIXEL, sh: 24 * PIXEL, anchorX: 12 * PIXEL, anchorY: 18 * PIXEL };
      return;
    }

    if (name.startsWith("avatar-")) {
      drawAvatarFrame(ctx, cellX, cellY, name.replace("avatar-", "") as AvatarFrame);
      sprites[name] = { sx: cellX * PIXEL, sy: cellY * PIXEL, sw: 24 * PIXEL, sh: 36 * PIXEL, anchorX: 12 * PIXEL, anchorY: 32 * PIXEL };
      return;
    }

    if (name === "marker") {
      drawMarker(ctx, cellX, cellY);
      sprites[name] = { sx: cellX * PIXEL, sy: cellY * PIXEL, sw: 24 * PIXEL, sh: 28 * PIXEL, anchorX: 12 * PIXEL, anchorY: 24 * PIXEL };
      return;
    }

    const [, stageLabel, statusLabel] = name.split("-");
    drawTree(ctx, cellX, cellY, Number(stageLabel), statusLabel as PixelStatus);
    sprites[name] = { sx: cellX * PIXEL, sy: cellY * PIXEL, sw: 24 * PIXEL, sh: 40 * PIXEL, anchorX: 12 * PIXEL, anchorY: 34 * PIXEL };
  });

  return { canvas, sprites } satisfies PixelAtlas;
}
