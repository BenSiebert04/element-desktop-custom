/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * Pop-outs: a camera or screen share in a window of its own, which the user
 * can move anywhere (another monitor, a corner) and optionally keep on top of
 * all other windows.
 *
 * Purely local: where a person's pop-out was is remembered per Matrix ID and
 * kind of stream in the app's profile, never sent anywhere.
 */

import { BehaviorSubject, combineLatest } from "rxjs";
import { logger } from "matrix-js-sdk/lib/logger";

import { type Behavior } from "../state/Behavior";
import { type ObservableScope } from "../state/ObservableScope";
import { clamp, type StreamDescriptor, type StreamKind } from "./layoutConfig";
import { type KeyValueStore } from "./layoutStorage";

/** Window names of pop-outs start with this (the desktop app relies on it). */
export const POPOUT_NAME_PREFIX = "mosaix-popout-";

const KEY = "element-custom.popouts.v1";

export const POPOUT_MIN_WIDTH = 160;
export const POPOUT_MIN_HEIGHT = 90;
const POPOUT_MAX_SIZE = 8000;
const SCREEN_LIMIT = 100000;

/** Position and size of a pop-out window, in screen pixels. */
export interface PopoutBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DEFAULT_POPOUT_SIZE: Record<StreamKind, PopoutBounds> = {
  camera: { left: NaN, top: NaN, width: 480, height: 270 },
  screen: { left: NaN, top: NaN, width: 960, height: 540 },
};

/**
 * The window name of a stream's pop-out: the prefix, then only characters
 * that are safe everywhere, plus a hash so that different keys never share a
 * window.
 */
export function popoutWindowName(key: string): string {
  // FNV-1a, 32 bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const readable = key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
  return `${POPOUT_NAME_PREFIX}${readable}-${hash.toString(16)}`;
}

/** Where a pop-out is remembered: the person and the kind of stream. */
export function popoutPlaceKey(stream: StreamDescriptor): string {
  return `${stream.userId}|${stream.kind}`;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Sane bounds, or null if they cannot be used. */
export function sanitizeBounds(raw: unknown): PopoutBounds | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { left, top, width, height } = raw as Record<string, unknown>;
  if (![left, top, width, height].every(isFiniteNumber)) return null;
  return {
    left: Math.round(clamp(left as number, -SCREEN_LIMIT, SCREEN_LIMIT)),
    top: Math.round(clamp(top as number, -SCREEN_LIMIT, SCREEN_LIMIT)),
    width: Math.round(
      clamp(width as number, POPOUT_MIN_WIDTH, POPOUT_MAX_SIZE),
    ),
    height: Math.round(
      clamp(height as number, POPOUT_MIN_HEIGHT, POPOUT_MAX_SIZE),
    ),
  };
}

/** The window features for `window.open`. */
export function popoutFeatures(bounds: PopoutBounds): string {
  const features = [
    "popup=yes",
    `width=${Math.round(bounds.width)}`,
    `height=${Math.round(bounds.height)}`,
  ];
  // Without a remembered place the system decides where the window goes
  if (Number.isFinite(bounds.left) && Number.isFinite(bounds.top))
    features.push(
      `left=${Math.round(bounds.left)}`,
      `top=${Math.round(bounds.top)}`,
    );
  return features.join(",");
}

interface Stored {
  alwaysOnTop?: unknown;
  places?: unknown;
}

export interface PopoutStorage {
  loadBounds(placeKey: string): PopoutBounds | null;
  saveBounds(placeKey: string, bounds: PopoutBounds): void;
  loadAlwaysOnTop(): boolean;
  saveAlwaysOnTop(onTop: boolean): void;
}

export function createPopoutStorage(
  store: KeyValueStore | null,
): PopoutStorage {
  const read = (): {
    alwaysOnTop: boolean;
    places: Record<string, unknown>;
  } => {
    let parsed: Stored = {};
    try {
      const raw: unknown = JSON.parse(store?.getItem(KEY) ?? "{}");
      if (typeof raw === "object" && raw !== null) parsed = raw as Stored;
    } catch (e) {
      logger.warn("[custom-layout] Ignoring malformed stored pop-outs", e);
    }
    const places =
      typeof parsed.places === "object" &&
      parsed.places !== null &&
      !Array.isArray(parsed.places)
        ? (parsed.places as Record<string, unknown>)
        : {};
    return { alwaysOnTop: parsed.alwaysOnTop === true, places };
  };
  const write = (data: ReturnType<typeof read>): void => {
    try {
      store?.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      logger.warn("[custom-layout] Could not store pop-outs", e);
    }
  };

  return {
    loadBounds: (placeKey) =>
      Object.hasOwn(read().places, placeKey)
        ? sanitizeBounds(read().places[placeKey])
        : null,
    saveBounds: (placeKey, bounds) => {
      const clean = sanitizeBounds(bounds);
      if (!clean) return;
      const data = read();
      write({ ...data, places: { ...data.places, [placeKey]: clean } });
    },
    loadAlwaysOnTop: () => read().alwaysOnTop,
    saveAlwaysOnTop: (onTop) => write({ ...read(), alwaysOnTop: onTop }),
  };
}

export function defaultPopoutStorage(): PopoutStorage {
  let store: KeyValueStore | null = null;
  try {
    store = globalThis.localStorage ?? null;
  } catch {
    // Access to localStorage can throw (e.g. when blocked)
  }
  return createPopoutStorage(store);
}

export interface PopoutViewModel {
  /** The keys of the streams that are popped out, in the order opened. */
  open$: Behavior<string[]>;
  /** Whether pop-outs stay on top of all other windows. */
  alwaysOnTop$: Behavior<boolean>;
  /** Pops a stream out; does nothing if it is already popped out. */
  open: (key: string) => void;
  close: (key: string) => void;
  setAlwaysOnTop: (onTop: boolean) => void;
  /** Where the stream's pop-out opens. */
  boundsFor: (stream: StreamDescriptor) => PopoutBounds;
  /** Remembers where the stream's pop-out is now. */
  rememberBounds: (stream: StreamDescriptor, bounds: PopoutBounds) => void;
}

export function createPopoutViewModel(
  scope: ObservableScope,
  streams$: Behavior<StreamDescriptor[]>,
  storage: PopoutStorage,
): PopoutViewModel {
  const requested$ = new BehaviorSubject<string[]>([]);
  const alwaysOnTop$ = new BehaviorSubject(storage.loadAlwaysOnTop());

  // A pop-out ends with its stream (someone leaves, stops sharing)
  combineLatest([requested$, streams$])
    .pipe(scope.bind())
    .subscribe(([keys, streams]) => {
      const present = keys.filter((k) => streams.some((s) => s.key === k));
      if (present.length !== keys.length) requested$.next(present);
    });

  return {
    open$: requested$,
    alwaysOnTop$,
    open: (key) => {
      if (requested$.value.includes(key)) return;
      if (!streams$.value.some((s) => s.key === key)) return;
      requested$.next([...requested$.value, key]);
    },
    close: (key) => {
      if (requested$.value.includes(key))
        requested$.next(requested$.value.filter((k) => k !== key));
    },
    setAlwaysOnTop: (onTop) => {
      storage.saveAlwaysOnTop(onTop);
      alwaysOnTop$.next(onTop);
    },
    boundsFor: (stream) =>
      storage.loadBounds(popoutPlaceKey(stream)) ??
      DEFAULT_POPOUT_SIZE[stream.kind],
    rememberBounds: (stream, bounds) =>
      storage.saveBounds(popoutPlaceKey(stream), bounds),
  };
}
