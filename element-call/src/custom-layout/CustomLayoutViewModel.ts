/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  skip,
} from "rxjs";

import { type Behavior } from "../state/Behavior";
import { type ObservableScope } from "../state/ObservableScope";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";
import { type ScreenShareViewModel } from "../state/media/ScreenShareViewModel";
import { shallowEquals } from "../utils/array";
import {
  clamp,
  type CustomLayoutConfig,
  defaultConfig,
  type FreeRect,
  isStreamVisible,
  orderStreams,
  type PresetId,
  RATIO_LIMITS,
  type RatioId,
  sanitizeLayer,
  sanitizeOpacity,
  standardViewConfig,
  type StreamDescriptor,
} from "./layoutConfig";
import { type LayoutStorage, type SavedLayout } from "./layoutStorage";
import {
  completeFreeRects,
  computeLayout,
  type Size,
} from "./computePlacements";

/**
 * A stream (camera or screen share) as shown by the custom layout.
 */
export interface CustomStream extends StreamDescriptor {
  local: boolean;
  media: UserMediaViewModel | ScreenShareViewModel;
}

export interface CustomLayoutViewModel {
  /** The current layout configuration of this room. */
  config$: Behavior<CustomLayoutConfig>;
  /**
   * Whether the custom layout replaces Element Call's standard view.
   */
  active$: Behavior<boolean>;
  /** All streams currently in the call, whether shown or not. */
  streams$: Behavior<CustomStream[]>;
  /** The stream currently maximised to the whole call area, if any. */
  maximised$: Behavior<string | null>;
  /** Whether the "customise layout" panel is open. */
  panelOpen$: Behavior<boolean>;
  savedLayouts$: Behavior<SavedLayout[]>;
  hasGlobalDefault$: Behavior<boolean>;

  setPanelOpen: (open: boolean) => void;
  /**
   * Switches to a preset. When switching to the free layout, `seed` (the
   * current canvas size) is used to keep tiles where they currently are.
   */
  setPreset: (preset: PresetId, canvas?: Size) => void;
  setHidden: (key: string, hidden: boolean) => void;
  /** Hides or shows camera and screen share of the given user. */
  setUserHidden: (userId: string, hidden: boolean) => void;
  setHideCameras: (hide: boolean) => void;
  showAll: () => void;
  togglePinned: (key: string) => void;
  /** Swaps the positions of two streams (drag and drop in presets). */
  swap: (a: string, b: string) => void;
  setRatio: (id: RatioId, value: number) => void;
  /** Moves/resizes a tile of the free layout. */
  setFreeRect: (key: string, rect: Omit<FreeRect, "z">) => void;
  /** Brings a free tile in front of the other tiles of its layer. */
  bringToFront: (key: string) => void;
  /** Sends a free tile behind the other tiles of its layer. */
  sendToBack: (key: string) => void;
  /** Sets how opaque a stream's tile is (OPACITY_MIN..1). */
  setOpacity: (key: string, opacity: number) => void;
  /** Moves a stream's tile to a layer (0..LAYER_MAX) of the free layout. */
  setLayer: (key: string, layer: number) => void;
  /** Makes sure every visible stream has a position in the free layout. */
  ensureFreeRects: (canvas: Size) => void;
  setMaximised: (key: string | null) => void;
  /** Restores Element Call's standard view and drops all customisations. */
  resetToStandard: () => void;
  saveNamed: (name: string) => void;
  loadNamed: (name: string) => void;
  deleteNamed: (name: string) => void;
  setAsGlobalDefault: () => void;
  clearGlobalDefault: () => void;
}

export interface CustomLayoutInputs {
  roomId: string;
  storage: LayoutStorage;
  userMedia$: Behavior<UserMediaViewModel[]>;
  screenShares$: Behavior<ScreenShareViewModel[]>;
}

function streamsEqual(a: CustomStream[], b: CustomStream[]): boolean {
  return shallowEquals(
    a.map((s) => s.media),
    b.map((s) => s.media),
  );
}

function withoutKey<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

export function createCustomLayoutViewModel(
  scope: ObservableScope,
  { roomId, storage, userMedia$, screenShares$ }: CustomLayoutInputs,
): CustomLayoutViewModel {
  const config$ = new BehaviorSubject<CustomLayoutConfig>(
    storage.loadInitial(roomId) ?? defaultConfig(),
  );
  const update = (
    fn: (config: CustomLayoutConfig) => CustomLayoutConfig,
  ): void => config$.next(fn(config$.value));

  // Every change is a local preference of this room; remember it.
  config$
    .pipe(skip(1), scope.bind())
    .subscribe((config) => storage.saveRoom(roomId, config));

  const streams$ = scope.behavior<CustomStream[]>(
    combineLatest([userMedia$, screenShares$]).pipe(
      map(([userMedia, screenShares]) => [
        ...userMedia.map((media): CustomStream => ({
          key: media.id,
          kind: "camera",
          userId: media.userId,
          local: media.local,
          media,
        })),
        ...screenShares.map((media): CustomStream => ({
          key: media.id,
          kind: "screen",
          userId: media.userId,
          local: media.local,
          media,
        })),
      ]),
      distinctUntilChanged(streamsEqual),
    ),
  );

  const maximisedSubject$ = new BehaviorSubject<string | null>(null);
  // Drop the maximised stream once it disappears or gets hidden
  const maximised$ = scope.behavior<string | null>(
    combineLatest([maximisedSubject$, streams$, config$]).pipe(
      map(([key, streams, config]) =>
        key !== null &&
        streams.some((s) => s.key === key && isStreamVisible(config, s))
          ? key
          : null,
      ),
    ),
  );

  const panelOpen$ = new BehaviorSubject(false);
  const savedLayouts$ = new BehaviorSubject(storage.loadSaved());
  const hasGlobalDefault$ = new BehaviorSubject(storage.loadGlobal() !== null);

  const setHidden = (key: string, hidden: boolean): void =>
    update((c) => {
      const stream = streams$.value.find((s) => s.key === key);
      let next = c;
      if (!hidden && stream?.kind === "camera" && c.hideCameras) {
        // Showing a single camera while all cameras are hidden: switch to
        // hiding the other cameras individually.
        const otherCameras = streams$.value
          .filter((s) => s.kind === "camera" && s.key !== key)
          .map((s) => s.key);
        next = {
          ...c,
          hideCameras: false,
          hidden: [...new Set([...c.hidden, ...otherCameras])],
        };
      }
      const without = next.hidden.filter((k) => k !== key);
      return { ...next, hidden: hidden ? [...without, key] : without };
    });

  const setPreset = (preset: PresetId, canvas?: Size): void =>
    update((c) => {
      if (preset === "free" && canvas && c.preset !== "free") {
        // Start the free layout from what is on screen right now
        const current = computeLayout(c, streams$.value, canvas, null);
        const visible = streams$.value.filter((s) => isStreamVisible(c, s));
        return {
          ...c,
          preset,
          rects: completeFreeRects({}, visible, canvas, current.tiles),
        };
      }
      return { ...c, preset };
    });

  const vm: CustomLayoutViewModel = {
    config$,
    active$: scope.behavior(config$.pipe(map((c) => c.preset !== "default"))),
    streams$,
    maximised$,
    panelOpen$,
    savedLayouts$,
    hasGlobalDefault$,

    setPanelOpen: (open) => panelOpen$.next(open),
    setPreset,
    setHidden,
    setUserHidden: (userId, hidden) => {
      for (const s of streams$.value)
        if (s.userId === userId) setHidden(s.key, hidden);
    },
    setHideCameras: (hide) => update((c) => ({ ...c, hideCameras: hide })),
    showAll: () => update((c) => ({ ...c, hidden: [], hideCameras: false })),
    togglePinned: (key) =>
      update((c) => ({
        ...c,
        pinned: c.pinned.includes(key)
          ? c.pinned.filter((k) => k !== key)
          : [...c.pinned, key],
      })),
    swap: (a, b) =>
      update((c) => {
        if (a === b) return c;
        // Materialise the current order, then swap the two entries
        const order = orderStreams(c, streams$.value).map((s) => s.key);
        for (const k of c.order) if (!order.includes(k)) order.push(k);
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia === -1 || ib === -1) return c;
        [order[ia], order[ib]] = [order[ib], order[ia]];
        // Swapping also swaps pin slots, so that pinned streams can be
        // rearranged too
        const pinned = c.pinned.map((k) => (k === a ? b : k === b ? a : k));
        const pinA = c.pinned.includes(a);
        const pinB = c.pinned.includes(b);
        return {
          ...c,
          order,
          pinned: pinA !== pinB ? pinned : c.pinned,
          // In the free layout, swap places instead
          rects:
            c.rects[a] && c.rects[b]
              ? {
                  ...c.rects,
                  [a]: { ...c.rects[b], z: c.rects[a].z },
                  [b]: { ...c.rects[a], z: c.rects[b].z },
                }
              : c.rects,
        };
      }),
    setRatio: (id, value) =>
      update((c) => {
        const v = clamp(value, ...RATIO_LIMITS[id]);
        switch (id) {
          case "split":
            return { ...c, splitRatio: v };
          case "strip":
            return { ...c, stripRatio: v };
          case "sidebar":
            return { ...c, sidebarRatio: v };
        }
      }),
    setFreeRect: (key, rect) =>
      update((c) => {
        const w = clamp(rect.w, 0.02, 1);
        const h = clamp(rect.h, 0.02, 1);
        return {
          ...c,
          rects: {
            ...c.rects,
            [key]: {
              w,
              h,
              x: clamp(rect.x, 0, 1 - w),
              y: clamp(rect.y, 0, 1 - h),
              z: c.rects[key]?.z ?? 0,
            },
          },
        };
      }),
    bringToFront: (key) =>
      update((c) => {
        const rect = c.rects[key];
        if (!rect) return c;
        const top = Math.max(...Object.values(c.rects).map((r) => r.z));
        if (rect.z === top) return c;
        return { ...c, rects: { ...c.rects, [key]: { ...rect, z: top + 1 } } };
      }),
    sendToBack: (key) =>
      update((c) => {
        const rect = c.rects[key];
        if (!rect) return c;
        const bottom = Math.min(...Object.values(c.rects).map((r) => r.z));
        if (rect.z === bottom) return c;
        return {
          ...c,
          rects: { ...c.rects, [key]: { ...rect, z: bottom - 1 } },
        };
      }),
    setOpacity: (key, opacity) =>
      update((c) => {
        const rest = withoutKey(c.opacity, key);
        const value = sanitizeOpacity(opacity);
        // Fully opaque is the default and needs no entry
        return {
          ...c,
          opacity: value === 1 ? rest : { ...rest, [key]: value },
        };
      }),
    setLayer: (key, layer) =>
      update((c) => {
        const rest = withoutKey(c.layers, key);
        const value = sanitizeLayer(layer);
        return { ...c, layers: value === 0 ? rest : { ...rest, [key]: value } };
      }),
    ensureFreeRects: (canvas) => {
      const c = config$.value;
      if (c.preset !== "free" || canvas.width <= 0 || canvas.height <= 0)
        return;
      const visible = streams$.value.filter((s) => isStreamVisible(c, s));
      if (visible.every((s) => c.rects[s.key])) return;
      config$.next({
        ...c,
        rects: completeFreeRects(c.rects, visible, canvas),
      });
    },
    setMaximised: (key) => maximisedSubject$.next(key),
    resetToStandard: () => {
      maximisedSubject$.next(null);
      config$.next(standardViewConfig());
    },
    saveNamed: (name) =>
      savedLayouts$.next(storage.saveNamed(name, config$.value)),
    loadNamed: (name) => {
      const saved = savedLayouts$.value.find((s) => s.name === name);
      if (saved) config$.next(saved.config);
    },
    deleteNamed: (name) => savedLayouts$.next(storage.deleteNamed(name)),
    setAsGlobalDefault: () => {
      storage.saveGlobal(config$.value);
      hasGlobalDefault$.next(true);
    },
    clearGlobalDefault: () => {
      storage.clearGlobal();
      hasGlobalDefault$.next(false);
    },
  };
  return vm;
}

/**
 * Element Call's own grid/spotlight switch only applies to its standard view.
 * Returns the switch to show in the footer: none while the custom layout is
 * active.
 */
export function layoutSwitchUnlessCustom$<T>(
  scope: ObservableScope,
  layoutSwitchVm$: Behavior<T | null>,
  customLayoutActive$: Behavior<boolean>,
): Behavior<T | null> {
  return scope.behavior(
    combineLatest(
      [layoutSwitchVm$, customLayoutActive$],
      (layoutSwitchVm, customActive) => (customActive ? null : layoutSwitchVm),
    ),
  );
}
