/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * Data model of the "Mosaix" call layout.
 *
 * Everything in here is a purely local display preference. Nothing in this
 * module ever talks to the homeserver, LiveKit or other participants.
 */

/**
 * The layout presets the user can pick from.
 *
 *  - `default`: Element Call's own, unmodified layout (grid / spotlight).
 *  - `auto`: All screen shares (and pinned streams) large, cameras in a strip.
 *  - `grid`: Every visible stream in an equally sized grid.
 *  - `two-streams`: Two large streams side by side, the rest in a strip.
 *  - `four-streams`: Up to four large streams in a 2x2 grid, rest in a strip.
 *  - `main-sidebar`: One main stream, everything else in a sidebar.
 *  - `free`: Freely positioned and sized tiles.
 */
export type PresetId =
  | "default"
  | "auto"
  | "grid"
  | "two-streams"
  | "four-streams"
  | "main-sidebar"
  | "free";

export const PRESET_IDS: readonly PresetId[] = [
  "default",
  "auto",
  "grid",
  "two-streams",
  "four-streams",
  "main-sidebar",
  "free",
];

export type StreamKind = "camera" | "screen";

/**
 * A rectangle in the free layout, expressed as fractions (0..1) of the canvas
 * so that it scales with the window.
 */
export interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order; higher is in front. */
  z: number;
}

export type RatioId = "split" | "strip" | "sidebar";

export interface CustomLayoutConfig {
  version: 1;
  preset: PresetId;
  /** Keys of streams which the user has hidden locally. */
  hidden: string[];
  /** Hide all camera streams (unless they are pinned). */
  hideCameras: boolean;
  /** Keys of pinned streams, in pin order. Pinned streams are always large. */
  pinned: string[];
  /** User-defined ordering of streams (via drag and drop). */
  order: string[];
  /** Share of the width taken by the first stream in `two-streams`. */
  splitRatio: number;
  /** Share of the height taken by the small-tile strip. */
  stripRatio: number;
  /** Share of the width taken by the sidebar in `main-sidebar`. */
  sidebarRatio: number;
  /** Positions in the free layout, by stream key. */
  rects: Record<string, FreeRect>;
  /**
   * Opacity of a stream's tile (OPACITY_MIN..1), by stream key. Missing means
   * fully opaque.
   */
  opacity: Record<string, number>;
  /**
   * Layer of a stream's tile in the free layout (0..LAYER_MAX), by stream key.
   * A tile on a higher layer is always in front of tiles on lower layers.
   * Missing means layer 0.
   */
  layers: Record<string, number>;
}

/** The most transparent a tile can be made (it must stay visible). */
export const OPACITY_MIN = 0.1;
export const LAYER_MAX = 9;

export const RATIO_LIMITS: Record<RatioId, [number, number]> = {
  split: [0.15, 0.85],
  strip: [0.1, 0.45],
  sidebar: [0.12, 0.5],
};

export function defaultConfig(): CustomLayoutConfig {
  return {
    version: 1,
    preset: "auto",
    hidden: [],
    hideCameras: false,
    pinned: [],
    order: [],
    splitRatio: 0.5,
    stripRatio: 0.2,
    sidebarRatio: 0.24,
    rects: {},
    opacity: {},
    layers: {},
  };
}

/**
 * The configuration that restores Element Call's standard view.
 */
export function standardViewConfig(): CustomLayoutConfig {
  return { ...defaultConfig(), preset: "default" };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string"))]
    : [];
}

function sanitizeRect(v: unknown): FreeRect | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (
    !isFiniteNumber(r.x) ||
    !isFiniteNumber(r.y) ||
    !isFiniteNumber(r.w) ||
    !isFiniteNumber(r.h)
  )
    return null;
  const w = clamp(r.w, 0.02, 1);
  const h = clamp(r.h, 0.02, 1);
  return {
    w,
    h,
    x: clamp(r.x, 0, 1 - w),
    y: clamp(r.y, 0, 1 - h),
    z: isFiniteNumber(r.z) ? r.z : 0,
  };
}

function numberRecord(
  v: unknown,
  sanitize: (n: number) => number,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (typeof v !== "object" || v === null) return result;
  for (const [key, value] of Object.entries(v))
    if (isFiniteNumber(value)) result[key] = sanitize(value);
  return result;
}

export function sanitizeOpacity(value: number): number {
  return clamp(value, OPACITY_MIN, 1);
}

export function sanitizeLayer(value: number): number {
  return clamp(Math.round(value), 0, LAYER_MAX);
}

/** The opacity of a stream's tile (1 = opaque). */
export function streamOpacity(config: CustomLayoutConfig, key: string): number {
  return config.opacity[key] ?? 1;
}

/** The layer of a stream's tile in the free layout. */
export function streamLayer(config: CustomLayoutConfig, key: string): number {
  return config.layers[key] ?? 0;
}

/**
 * Turns untrusted (e.g. stored) data into a valid configuration, falling back
 * to defaults for anything missing or malformed.
 */
export function sanitizeConfig(input: unknown): CustomLayoutConfig {
  const base = defaultConfig();
  if (typeof input !== "object" || input === null) return base;
  const c = input as Record<string, unknown>;
  const rects: Record<string, FreeRect> = {};
  if (typeof c.rects === "object" && c.rects !== null) {
    for (const [key, value] of Object.entries(c.rects)) {
      const rect = sanitizeRect(value);
      if (rect) rects[key] = rect;
    }
  }
  const ratio = (v: unknown, id: RatioId, fallback: number): number =>
    isFiniteNumber(v) ? clamp(v, ...RATIO_LIMITS[id]) : fallback;
  return {
    version: 1,
    preset: PRESET_IDS.includes(c.preset as PresetId)
      ? (c.preset as PresetId)
      : base.preset,
    hidden: stringArray(c.hidden),
    hideCameras: c.hideCameras === true,
    pinned: stringArray(c.pinned),
    order: stringArray(c.order),
    splitRatio: ratio(c.splitRatio, "split", base.splitRatio),
    stripRatio: ratio(c.stripRatio, "strip", base.stripRatio),
    sidebarRatio: ratio(c.sidebarRatio, "sidebar", base.sidebarRatio),
    rects,
    opacity: numberRecord(c.opacity, sanitizeOpacity),
    layers: numberRecord(c.layers, sanitizeLayer),
  };
}

/**
 * The minimal description of a stream that the layout logic needs.
 */
export interface StreamDescriptor {
  key: string;
  kind: StreamKind;
  userId: string;
}

/**
 * Whether the given stream should currently be shown according to the config.
 */
export function isStreamVisible(
  config: CustomLayoutConfig,
  stream: StreamDescriptor,
): boolean {
  if (config.hidden.includes(stream.key)) return false;
  if (
    stream.kind === "camera" &&
    config.hideCameras &&
    !config.pinned.includes(stream.key)
  )
    return false;
  return true;
}

/**
 * Orders the visible streams by importance: pinned streams first (in pin
 * order), then the user's manual ordering, then screen shares before cameras,
 * then order of appearance.
 */
export function orderStreams<T extends StreamDescriptor>(
  config: CustomLayoutConfig,
  streams: readonly T[],
): T[] {
  const rank = (s: T, index: number): number[] => {
    const pin = config.pinned.indexOf(s.key);
    const order = config.order.indexOf(s.key);
    return [
      pin === -1 ? Infinity : pin,
      // Streams the user has not ordered yet: new screen shares are promoted
      // to the front so that they are seen, new cameras go to the back.
      order !== -1 ? order : s.kind === "screen" ? -1 : Infinity,
      s.kind === "screen" ? 0 : 1,
      index,
    ];
  };
  return streams
    .map((s, i) => [s, rank(s, i)] as const)
    .sort(([, a], [, b]) => {
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
      }
      return 0;
    })
    .map(([s]) => s);
}
