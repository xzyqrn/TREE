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

const CELL_WIDTH = 40;
const CELL_HEIGHT = 44;
const PIXEL = 2;

const statusPalette: Record<PixelStatus, { canopy: string; canopyShade: string; trunk: string; accent: string }> = {
  active: {
    canopy: "#4cae5a",
    canopyShade: "#2f6f3b",
    trunk: "#6a4a2e",
    accent: "#a7e184",
  },
  moderate: {
    canopy: "#71a84c",
    canopyShade: "#466b2f",
    trunk: "#74542d",
    accent: "#c7df72",
  },
  occasional: {
    canopy: "#b18f46",
    canopyShade: "#7c6132",
    trunk: "#7d5630",
    accent: "#ead087",
  },
  inactive: {
    canopy: "#8f7f65",
    canopyShade: "#625846",
    trunk: "#7a5f43",
    accent: "#d8c8ad",
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

function drawGroundTile(ctx: CanvasRenderingContext2D, cellX: number, cellY: number, water = false) {
  if (water) {
    drawDiamond(ctx, cellX + 4, cellY + 10, 12, 6, "#6cb5d8", "#3e7593", "#d6f4ff");
    px(ctx, cellX + 6, cellY + 11, 4, 1, "#dff9ff");
    px(ctx, cellX + 10, cellY + 12, 3, 1, "#dff9ff");
    return;
  }

  drawDiamond(ctx, cellX + 4, cellY + 10, 12, 6, "#8cc86d", "#5d8f4b", "#f3e7b1");
  px(ctx, cellX + 7, cellY + 12, 1, 2, "#e3f1a5");
  px(ctx, cellX + 11, cellY + 13, 1, 1, "#729f5a");
}

function drawShadow(ctx: CanvasRenderingContext2D, cellX: number, cellY: number) {
  drawDiamond(ctx, cellX + 6, cellY + 16, 10, 4, "rgba(56,49,34,0.6)", "rgba(56,49,34,0.75)", "#000000");
}

function drawAvatar(ctx: CanvasRenderingContext2D, cellX: number, cellY: number) {
  drawShadow(ctx, cellX, cellY + 2);
  px(ctx, cellX + 10, cellY + 6, 2, 2, "#2d4632");
  px(ctx, cellX + 9, cellY + 8, 4, 5, "#49744d");
  px(ctx, cellX + 8, cellY + 9, 1, 3, "#315336");
  px(ctx, cellX + 13, cellY + 9, 1, 3, "#315336");
  px(ctx, cellX + 9, cellY + 13, 1, 4, "#33404b");
  px(ctx, cellX + 12, cellY + 13, 1, 4, "#33404b");
  px(ctx, cellX + 10, cellY + 4, 2, 2, "#f4d1ae");
}

function drawMarker(ctx: CanvasRenderingContext2D, cellX: number, cellY: number) {
  drawShadow(ctx, cellX, cellY + 8);
  px(ctx, cellX + 10, cellY + 11, 2, 4, "#668443");
  px(ctx, cellX + 9, cellY + 10, 4, 2, "#a8d06f");
}

function drawTree(ctx: CanvasRenderingContext2D, cellX: number, cellY: number, stage: number, status: PixelStatus) {
  const palette = statusPalette[status];
  drawShadow(ctx, cellX, cellY + 4);

  const trunkHeight = 2 + stage * 2;
  const trunkTop = cellY + 18 - trunkHeight;
  px(ctx, cellX + 10, trunkTop, 2, trunkHeight, palette.trunk);

  const canopyBaseY = trunkTop - 1;
  const canopyWidth = 5 + stage * 2;
  const canopyHeight = 3 + stage * 2;
  const canopyLeft = cellX + Math.max(5, 11 - Math.floor(canopyWidth / 2));

  for (let layer = 0; layer < canopyHeight; layer += 1) {
    const layerWidth = canopyWidth - Math.abs(Math.floor(canopyHeight / 2) - layer);
    const rowX = canopyLeft + Math.floor((canopyWidth - layerWidth) / 2);
    px(ctx, rowX, canopyBaseY - canopyHeight + layer, layerWidth, 1, layer < canopyHeight / 2 ? palette.accent : palette.canopy);
  }

  px(ctx, cellX + 9, trunkTop - canopyHeight + 1, 1, 2, palette.canopyShade);
  px(ctx, cellX + 12, trunkTop - canopyHeight + 3, 1, 2, palette.canopyShade);

  if (stage >= 4) {
    px(ctx, cellX + 7, trunkTop - canopyHeight + 4, 2, 1, palette.canopyShade);
    px(ctx, cellX + 13, trunkTop - canopyHeight + 5, 2, 1, palette.canopyShade);
  }

  if (stage === 5) {
    px(ctx, cellX + 6, trunkTop - canopyHeight + 6, 1, 2, palette.accent);
    px(ctx, cellX + 15, trunkTop - canopyHeight + 6, 1, 2, palette.accent);
  }
}

export function treeSpriteKey(stage: number, status: PixelStatus) {
  return `tree-${stage}-${status}`;
}

export function createPixelAtlas() {
  const spriteNames = [
    "ground-grass",
    "ground-water",
    "shadow",
    "avatar",
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

    if (name === "ground-grass") {
      drawGroundTile(ctx, cellX, cellY, false);
      sprites[name] = { sx: cellX * PIXEL, sy: cellY * PIXEL, sw: 24 * PIXEL, sh: 22 * PIXEL, anchorX: 12 * PIXEL, anchorY: 13 * PIXEL };
      return;
    }

    if (name === "ground-water") {
      drawGroundTile(ctx, cellX, cellY, true);
      sprites[name] = { sx: cellX * PIXEL, sy: cellY * PIXEL, sw: 24 * PIXEL, sh: 22 * PIXEL, anchorX: 12 * PIXEL, anchorY: 13 * PIXEL };
      return;
    }

    if (name === "shadow") {
      drawShadow(ctx, cellX, cellY);
      sprites[name] = { sx: cellX * PIXEL, sy: cellY * PIXEL, sw: 24 * PIXEL, sh: 24 * PIXEL, anchorX: 12 * PIXEL, anchorY: 18 * PIXEL };
      return;
    }

    if (name === "avatar") {
      drawAvatar(ctx, cellX, cellY);
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
