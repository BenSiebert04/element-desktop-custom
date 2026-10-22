/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import {
  clamp,
  type CustomLayoutConfig,
  type FreeRect,
  isStreamVisible,
  orderStreams,
  type RatioId,
  type StreamDescriptor,
  streamLayer,
} from "./layoutConfig";

/**
 * Pure geometry for the custom call layout. Given the configuration, the
 * streams present in the call and the size of the canvas, works out where
 * every tile goes. No DOM, no React, so it is cheap to test exhaustively.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TileRole = "primary" | "secondary" | "free" | "maximised";

export interface Placement extends Rect {
  key: string;
  role: TileRole;
  z: number;
}

/**
 * A draggable boundary between two areas of a preset layout. Dragging it
 * changes the ratio with the given id.
 */
export interface Divider extends Rect {
  id: RatioId;
  orientation: "vertical" | "horizontal";
  /** The pixel range along the drag axis that maps to the ratio 0..1. */
  start: number;
  length: number;
}

export interface LayoutResult {
  tiles: Placement[];
  dividers: Divider[];
  /** Keys of streams present in the call but hidden by the user. */
  hidden: string[];
}

export const GAP = 8;
export const DEFAULT_ASPECT = 16 / 9;
const MIN_STRIP_PX = 72;

/**
 * Chooses the number of columns which gives the biggest tiles when placing
 * `n` tiles of the given aspect ratio into the area.
 */
export function bestColumns(
  n: number,
  area: Size,
  aspect = DEFAULT_ASPECT,
): number {
  let best = 1;
  let bestScore = -1;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (area.width - (cols - 1) * GAP) / cols;
    const cellH = (area.height - (rows - 1) * GAP) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    // Area of the largest rectangle with the target aspect ratio in the cell
    const w = Math.min(cellW, cellH * aspect);
    const score = w * (w / aspect);
    if (score > bestScore + 0.5) {
      bestScore = score;
      best = cols;
    }
  }
  return best;
}

/**
 * Lays out `n` cells in a grid inside the area. The last row is centred.
 */
export function gridCells(
  n: number,
  area: Rect,
  aspect = DEFAULT_ASPECT,
): Rect[] {
  if (n <= 0) return [];
  const cols = bestColumns(n, { width: area.w, height: area.h }, aspect);
  const rows = Math.ceil(n / cols);
  const cellW = Math.max(0, (area.w - (cols - 1) * GAP) / cols);
  const cellH = Math.max(0, (area.h - (rows - 1) * GAP) / rows);
  const cells: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i % cols;
    const offset = ((cols - inRow) * (cellW + GAP)) / 2;
    cells.push({
      x: area.x + offset + col * (cellW + GAP),
      y: area.y + row * (cellH + GAP),
      w: cellW,
      h: cellH,
    });
  }
  return cells;
}

/**
 * Lays out small tiles in a single row if they fit, otherwise in a grid.
 */
function stripCells(n: number, area: Rect): Rect[] {
  if (n <= 0) return [];
  const tileW = Math.min(area.h * DEFAULT_ASPECT, (area.w - (n - 1) * GAP) / n);
  if (tileW >= area.h * 0.9) {
    // One row, centred
    const total = n * tileW + (n - 1) * GAP;
    const start = area.x + (area.w - total) / 2;
    return Array.from({ length: n }, (_, i) => ({
      x: start + i * (tileW + GAP),
      y: area.y,
      w: tileW,
      h: area.h,
    }));
  }
  return gridCells(n, area);
}

function primaryCountFor(
  config: CustomLayoutConfig,
  ordered: StreamDescriptor[],
): number {
  switch (config.preset) {
    case "grid":
    case "default":
      return ordered.length;
    case "two-streams":
      return Math.min(2, ordered.length);
    case "four-streams":
      return Math.min(4, ordered.length);
    case "main-sidebar":
      return Math.min(1, ordered.length);
    case "auto":
    case "free": {
      // Every pinned stream and every screen share is large. If there are
      // none, everything is large (i.e. a plain grid of cameras).
      const big = ordered.filter(
        (s) => s.kind === "screen" || config.pinned.includes(s.key),
      ).length;
      return big === 0 ? ordered.length : big;
    }
  }
}

function presetLayout(
  config: CustomLayoutConfig,
  ordered: StreamDescriptor[],
  size: Size,
): { tiles: Placement[]; dividers: Divider[] } {
  const canvas: Rect = { x: 0, y: 0, w: size.width, h: size.height };
  const primaryCount = primaryCountFor(config, ordered);
  const primary = ordered.slice(0, primaryCount);
  const secondary = ordered.slice(primaryCount);
  const tiles: Placement[] = [];
  const dividers: Divider[] = [];

  const place = (
    streams: StreamDescriptor[],
    cells: Rect[],
    role: "primary" | "secondary",
  ): void =>
    streams.forEach((s, i) =>
      tiles.push({ key: s.key, role, z: 0, ...cells[i] }),
    );

  if (config.preset === "main-sidebar" && secondary.length > 0) {
    const sidebarW = clamp(
      size.width * config.sidebarRatio,
      Math.min(120, size.width / 2),
      size.width / 2,
    );
    const mainW = size.width - sidebarW - GAP;
    place(primary, [{ x: 0, y: 0, w: mainW, h: size.height }], "primary");
    const sidebar: Rect = {
      x: mainW + GAP,
      y: 0,
      w: sidebarW,
      h: size.height,
    };
    // Prefer a single column in the sidebar, stacking downwards
    const n = secondary.length;
    const colH = (sidebar.h - (n - 1) * GAP) / n;
    const cells =
      colH >= sidebar.w / DEFAULT_ASPECT / 2
        ? Array.from({ length: n }, (_, i) => {
            const h = Math.min(colH, sidebar.w / DEFAULT_ASPECT);
            const total = n * h + (n - 1) * GAP;
            const top = (sidebar.h - total) / 2;
            return { x: sidebar.x, y: top + i * (h + GAP), w: sidebar.w, h };
          })
        : gridCells(n, sidebar);
    place(secondary, cells, "secondary");
    dividers.push({
      id: "sidebar",
      orientation: "vertical",
      x: mainW,
      y: 0,
      w: GAP,
      h: size.height,
      // Dragging left grows the sidebar, so the ratio runs right to left
      start: size.width,
      length: -size.width,
    });
    return { tiles, dividers };
  }

  // All other presets: a main area on top, a strip of small tiles below
  let main = canvas;
  if (secondary.length > 0 && primary.length > 0) {
    const stripH = clamp(
      size.height * config.stripRatio,
      Math.min(MIN_STRIP_PX, size.height / 3),
      size.height * 0.45,
    );
    main = { ...canvas, h: size.height - stripH - GAP };
    const strip: Rect = {
      x: 0,
      y: main.h + GAP,
      w: size.width,
      h: stripH,
    };
    place(secondary, stripCells(secondary.length, strip), "secondary");
    dividers.push({
      id: "strip",
      orientation: "horizontal",
      x: 0,
      y: main.h,
      w: size.width,
      h: GAP,
      start: size.height,
      length: -size.height,
    });
  }

  if (config.preset === "two-streams" && primary.length === 2) {
    // Side by side, unless the area is clearly portrait
    const vertical = main.w >= main.h * 0.9;
    if (vertical) {
      const firstW = (main.w - GAP) * config.splitRatio;
      place(
        primary,
        [
          { x: main.x, y: main.y, w: firstW, h: main.h },
          {
            x: main.x + firstW + GAP,
            y: main.y,
            w: main.w - firstW - GAP,
            h: main.h,
          },
        ],
        "primary",
      );
      dividers.push({
        id: "split",
        orientation: "vertical",
        x: main.x + firstW,
        y: main.y,
        w: GAP,
        h: main.h,
        start: main.x,
        length: main.w,
      });
    } else {
      const firstH = (main.h - GAP) * config.splitRatio;
      place(
        primary,
        [
          { x: main.x, y: main.y, w: main.w, h: firstH },
          {
            x: main.x,
            y: main.y + firstH + GAP,
            w: main.w,
            h: main.h - firstH - GAP,
          },
        ],
        "primary",
      );
      dividers.push({
        id: "split",
        orientation: "horizontal",
        x: main.x,
        y: main.y + firstH,
        w: main.w,
        h: GAP,
        start: main.y,
        length: main.h,
      });
    }
  } else if (config.preset === "four-streams" && primary.length > 1) {
    // A fixed 2x2 arrangement so that the tiles don't jump around
    const cellW = (main.w - GAP) / 2;
    const cellH = (main.h - GAP) / (primary.length > 2 ? 2 : 1);
    const cells = primary.map((_, i) => ({
      x: main.x + (i % 2) * (cellW + GAP),
      y: main.y + Math.floor(i / 2) * (cellH + GAP),
      w: cellW,
      h: cellH,
    }));
    place(primary, cells, "primary");
  } else {
    place(primary, gridCells(primary.length, main), "primary");
  }

  return { tiles, dividers };
}

/**
 * Finds a spot for a new tile in the free layout which overlaps the existing
 * tiles as little as possible.
 */
export function findFreeSpot(
  existing: FreeRect[],
  w: number,
  h: number,
): { x: number; y: number } {
  const steps = 8;
  let best = { x: 0, y: 0 };
  let bestOverlap = Infinity;
  for (let j = 0; j <= steps; j++) {
    for (let i = 0; i <= steps; i++) {
      const x = ((1 - w) * i) / steps;
      const y = ((1 - h) * j) / steps;
      let overlap = 0;
      for (const r of existing) {
        const ox = Math.max(0, Math.min(x + w, r.x + r.w) - Math.max(x, r.x));
        const oy = Math.max(0, Math.min(y + h, r.y + r.h) - Math.max(y, r.y));
        overlap += ox * oy;
      }
      if (overlap < bestOverlap - 1e-9) {
        bestOverlap = overlap;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Converts a pixel rect to a fractional free-layout rect.
 */
export function toFreeRect(rect: Rect, size: Size, z: number): FreeRect {
  const w = clamp(rect.w / Math.max(1, size.width), 0.02, 1);
  const h = clamp(rect.h / Math.max(1, size.height), 0.02, 1);
  return {
    w,
    h,
    x: clamp(rect.x / Math.max(1, size.width), 0, 1 - w),
    y: clamp(rect.y / Math.max(1, size.height), 0, 1 - h),
    z,
  };
}

/**
 * Completes the free-layout rects so that every visible stream has one. Rects
 * of streams that do not have one yet are taken from `seed` (typically the
 * previous preset layout) or else placed in a free spot.
 */
export function completeFreeRects(
  rects: Record<string, FreeRect>,
  visible: StreamDescriptor[],
  size: Size,
  seed?: Placement[],
): Record<string, FreeRect> {
  const result = { ...rects };
  let z = Math.max(0, ...Object.values(result).map((r) => r.z));
  for (const s of visible) {
    if (result[s.key]) continue;
    const seeded = seed?.find((p) => p.key === s.key);
    if (seeded) {
      result[s.key] = toFreeRect(seeded, size, ++z);
      continue;
    }
    const w = s.kind === "screen" ? 0.45 : 0.22;
    const pxW = w * size.width;
    const h = clamp(pxW / DEFAULT_ASPECT / Math.max(1, size.height), 0.05, 0.9);
    const placed = visible
      .map((v) => result[v.key])
      .filter((r): r is FreeRect => r !== undefined);
    result[s.key] = { ...findFreeSpot(placed, w, h), w, h, z: ++z };
  }
  return result;
}

function freeLayout(
  config: CustomLayoutConfig,
  ordered: StreamDescriptor[],
  size: Size,
): Placement[] {
  const rects = completeFreeRects(config.rects, ordered, size);
  // Stacking: the layer decides first, then the tile brought to the front
  // last. The result is a compact 1..n so that it is usable as a CSS z-index.
  const stacking = [...ordered]
    .sort(
      (a, b) =>
        streamLayer(config, a.key) - streamLayer(config, b.key) ||
        rects[a.key].z - rects[b.key].z,
    )
    .map((s) => s.key);
  return ordered.map((s) => {
    const r = rects[s.key];
    return {
      key: s.key,
      role: "free" as const,
      x: r.x * size.width,
      y: r.y * size.height,
      w: r.w * size.width,
      h: r.h * size.height,
      z: stacking.indexOf(s.key) + 1,
    };
  });
}

/**
 * Computes the full custom layout.
 *
 * @param maximisedKey A stream that should take up the whole canvas, if any.
 */
export function computeLayout(
  config: CustomLayoutConfig,
  streams: readonly StreamDescriptor[],
  size: Size,
  maximisedKey: string | null = null,
): LayoutResult {
  const visible = streams.filter((s) => isStreamVisible(config, s));
  const hidden = streams
    .filter((s) => !isStreamVisible(config, s))
    .map((s) => s.key);
  if (size.width <= 0 || size.height <= 0)
    return { tiles: [], dividers: [], hidden };

  if (maximisedKey !== null && visible.some((s) => s.key === maximisedKey)) {
    return {
      tiles: [
        {
          key: maximisedKey,
          role: "maximised",
          x: 0,
          y: 0,
          w: size.width,
          h: size.height,
          z: 0,
        },
      ],
      dividers: [],
      hidden,
    };
  }

  const ordered = orderStreams(config, visible);
  if (config.preset === "free")
    return { tiles: freeLayout(config, ordered, size), dividers: [], hidden };
  return { ...presetLayout(config, ordered, size), hidden };
}
