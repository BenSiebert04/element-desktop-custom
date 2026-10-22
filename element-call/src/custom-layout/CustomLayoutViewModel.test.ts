/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { BehaviorSubject } from "rxjs";
import { describe, expect, test } from "vitest";

import { ObservableScope } from "../state/ObservableScope";
import { testScope } from "../utils/test";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";
import { type ScreenShareViewModel } from "../state/media/ScreenShareViewModel";
import {
  createCustomLayoutViewModel,
  type CustomLayoutViewModel,
  layoutSwitchUnlessCustom$,
} from "./CustomLayoutViewModel";
import { type KeyValueStore, LayoutStorage } from "./layoutStorage";
import { computeLayout } from "./computePlacements";
import { defaultConfig, sanitizeConfig } from "./layoutConfig";

class MemoryStore implements KeyValueStore {
  public readonly data = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  public removeItem(key: string): void {
    this.data.delete(key);
  }
}

const userMedia = (name: string, local = false): UserMediaViewModel =>
  ({
    id: `@${name}:example.org:DEV:0`,
    userId: `@${name}:example.org`,
    local,
    type: "user",
  }) as unknown as UserMediaViewModel;

const screenShare = (name: string): ScreenShareViewModel =>
  ({
    id: `@${name}:example.org:DEV:0:screen-share`,
    userId: `@${name}:example.org`,
    local: false,
    type: "screen share",
  }) as unknown as ScreenShareViewModel;

interface Harness {
  vm: CustomLayoutViewModel;
  userMedia$: BehaviorSubject<UserMediaViewModel[]>;
  screenShares$: BehaviorSubject<ScreenShareViewModel[]>;
  scope: ObservableScope;
}

function setup(
  storage: LayoutStorage,
  roomId = "!room:example.org",
  scope: ObservableScope = testScope(),
): Harness {
  const userMedia$ = new BehaviorSubject([
    userMedia("me", true),
    userMedia("alice"),
    userMedia("bob"),
  ]);
  const screenShares$ = new BehaviorSubject<ScreenShareViewModel[]>([]);
  const vm = createCustomLayoutViewModel(scope, {
    roomId,
    storage,
    userMedia$,
    screenShares$,
  });
  return { vm, userMedia$, screenShares$, scope };
}

const size = { width: 1280, height: 720 };
const visibleKeys = (vm: CustomLayoutViewModel): string[] =>
  computeLayout(vm.config$.value, vm.streams$.value, size, vm.maximised$.value)
    .tiles.map((t) => t.key)
    .sort();

describe("CustomLayoutViewModel", () => {
  test("starts in the custom (auto) layout by default", () => {
    const { vm } = setup(new LayoutStorage(new MemoryStore()));
    expect(vm.config$.value.preset).toBe("auto");
    expect(vm.active$.value).toBe(true);
    expect(vm.streams$.value.map((s) => s.kind)).toEqual([
      "camera",
      "camera",
      "camera",
    ]);
  });

  test("two screen shares are both shown, neither displaces the other", () => {
    const { vm, screenShares$ } = setup(new LayoutStorage(new MemoryStore()));
    screenShares$.next([screenShare("alice")]);
    screenShares$.next([screenShare("alice"), screenShare("bob")]);
    const layout = computeLayout(vm.config$.value, vm.streams$.value, size);
    const primaries = layout.tiles.filter((t) => t.role === "primary");
    expect(primaries.map((t) => t.key).sort()).toEqual(
      [screenShare("alice").id, screenShare("bob").id].sort(),
    );
  });

  test("hiding camera and screen share separately", () => {
    const { vm, screenShares$ } = setup(new LayoutStorage(new MemoryStore()));
    screenShares$.next([screenShare("alice")]);
    vm.setHidden(userMedia("alice").id, true);
    expect(visibleKeys(vm)).toContain(screenShare("alice").id);
    expect(visibleKeys(vm)).not.toContain(userMedia("alice").id);

    vm.setHidden(userMedia("alice").id, false);
    vm.setHidden(screenShare("alice").id, true);
    expect(visibleKeys(vm)).toContain(userMedia("alice").id);
    expect(visibleKeys(vm)).not.toContain(screenShare("alice").id);
  });

  test("hiding a whole participant and showing everyone again", () => {
    const { vm, screenShares$ } = setup(new LayoutStorage(new MemoryStore()));
    screenShares$.next([screenShare("alice")]);
    vm.setUserHidden("@alice:example.org", true);
    expect(visibleKeys(vm)).toEqual(
      [userMedia("bob").id, userMedia("me").id].sort(),
    );
    // The participant is still part of the call, just not shown
    expect(vm.streams$.value.map((s) => s.key)).toContain(
      userMedia("alice").id,
    );
    vm.showAll();
    expect(visibleKeys(vm)).toHaveLength(4);
  });

  test("showing one camera while all cameras are hidden", () => {
    const { vm } = setup(new LayoutStorage(new MemoryStore()));
    vm.setHideCameras(true);
    expect(visibleKeys(vm)).toEqual([]);
    vm.setHidden(userMedia("bob").id, false);
    expect(visibleKeys(vm)).toEqual([userMedia("bob").id]);
    expect(vm.config$.value.hideCameras).toBe(false);
  });

  test("a participant leaving and a new one joining", () => {
    const { vm, userMedia$ } = setup(new LayoutStorage(new MemoryStore()));
    vm.setHidden(userMedia("bob").id, true);
    vm.togglePinned(userMedia("alice").id);
    vm.setMaximised(userMedia("alice").id);
    // Alice leaves: her maximised tile goes away, nothing breaks
    userMedia$.next([userMedia("me", true), userMedia("bob")]);
    expect(vm.maximised$.value).toBeNull();
    expect(visibleKeys(vm)).toEqual([userMedia("me").id]);
    // Carol joins and is shown right away
    userMedia$.next([
      userMedia("me", true),
      userMedia("bob"),
      userMedia("carol"),
    ]);
    expect(visibleKeys(vm)).toEqual(
      [userMedia("carol").id, userMedia("me").id].sort(),
    );
    // Bob is still hidden, Alice's pin is remembered for when she comes back
    expect(vm.config$.value.hidden).toEqual([userMedia("bob").id]);
    expect(vm.config$.value.pinned).toEqual([userMedia("alice").id]);
  });

  test("dragging a tile onto another swaps them", () => {
    const { vm } = setup(new LayoutStorage(new MemoryStore()));
    vm.setPreset("main-sidebar");
    const main = (): string =>
      computeLayout(vm.config$.value, vm.streams$.value, size).tiles.find(
        (t) => t.role === "primary",
      )!.key;
    expect(main()).toBe(userMedia("me").id);
    vm.swap(userMedia("me").id, userMedia("bob").id);
    expect(main()).toBe(userMedia("bob").id);
  });

  test("resizing with the mouse: dividers and free tiles", () => {
    const { vm } = setup(new LayoutStorage(new MemoryStore()));
    vm.setPreset("two-streams");
    vm.setRatio("split", 0.7);
    expect(vm.config$.value.splitRatio).toBe(0.7);
    vm.setRatio("split", 5);
    expect(vm.config$.value.splitRatio).toBe(0.85);

    vm.setPreset("free", size);
    // Switching to the free layout keeps the tiles where they were
    const keys = vm.streams$.value.map((s) => s.key);
    expect(Object.keys(vm.config$.value.rects).sort()).toEqual(keys.sort());
    vm.setFreeRect(userMedia("bob").id, { x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
    vm.bringToFront(userMedia("bob").id);
    const rect = vm.config$.value.rects[userMedia("bob").id];
    expect(rect).toMatchObject({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
    expect(rect.z).toBe(
      Math.max(...Object.values(vm.config$.value.rects).map((r) => r.z)),
    );
    // Tiles cannot be dragged out of the canvas
    vm.setFreeRect(userMedia("bob").id, { x: 0.9, y: -1, w: 0.25, h: 0.25 });
    expect(vm.config$.value.rects[userMedia("bob").id]).toMatchObject({
      x: 0.75,
      y: 0,
    });
  });

  test("a stream joining the free layout gets a position", () => {
    const { vm, screenShares$ } = setup(new LayoutStorage(new MemoryStore()));
    vm.setPreset("free", size);
    screenShares$.next([screenShare("alice")]);
    vm.ensureFreeRects(size);
    expect(vm.config$.value.rects[screenShare("alice").id]).toBeDefined();
  });

  test("restoring the standard view drops every customisation", () => {
    const { vm } = setup(new LayoutStorage(new MemoryStore()));
    vm.setPreset("free", size);
    vm.setHidden(userMedia("bob").id, true);
    vm.togglePinned(userMedia("alice").id);
    vm.setHideCameras(true);
    vm.resetToStandard();
    expect(vm.active$.value).toBe(false);
    expect(vm.config$.value).toEqual({
      ...defaultConfig(),
      preset: "default",
    });
  });
});

describe("persistence", () => {
  test("layout is saved per room and restored when switching rooms", () => {
    const store = new MemoryStore();
    const storage = new LayoutStorage(store);

    const scopeA = new ObservableScope();
    const a = setup(storage, "!a:example.org", scopeA);
    a.vm.setPreset("four-streams");
    a.vm.setHidden(userMedia("bob").id, true);
    scopeA.end();

    // Another room starts with the defaults
    const scopeB = new ObservableScope();
    const b = setup(storage, "!b:example.org", scopeB);
    expect(b.vm.config$.value).toEqual(defaultConfig());
    b.vm.setPreset("main-sidebar");
    scopeB.end();

    // Back in the first room, everything is as it was
    const again = setup(storage, "!a:example.org");
    expect(again.vm.config$.value.preset).toBe("four-streams");
    expect(again.vm.config$.value.hidden).toEqual([userMedia("bob").id]);
  });

  test("named layouts can be saved, loaded and deleted", () => {
    const storage = new LayoutStorage(new MemoryStore());
    const { vm } = setup(storage);
    vm.setPreset("two-streams");
    vm.setRatio("split", 0.7);
    vm.setHideCameras(true);
    vm.saveNamed("  Gaming + Code  ");
    expect(vm.savedLayouts$.value.map((s) => s.name)).toEqual([
      "Gaming + Code",
    ]);

    vm.resetToStandard();
    vm.loadNamed("Gaming + Code");
    expect(vm.config$.value).toMatchObject({
      preset: "two-streams",
      splitRatio: 0.7,
      hideCameras: true,
    });

    // Saved layouts are available in other rooms too
    const other = setup(storage, "!other:example.org");
    expect(other.vm.savedLayouts$.value).toHaveLength(1);

    vm.deleteNamed("Gaming + Code");
    expect(vm.savedLayouts$.value).toEqual([]);
  });

  test("the global default applies to rooms without their own layout", () => {
    const storage = new LayoutStorage(new MemoryStore());
    const { vm } = setup(storage, "!a:example.org");
    vm.setPreset("main-sidebar");
    vm.setAsGlobalDefault();
    expect(vm.hasGlobalDefault$.value).toBe(true);

    expect(setup(storage, "!new:example.org").vm.config$.value.preset).toBe(
      "main-sidebar",
    );

    vm.clearGlobalDefault();
    expect(setup(storage, "!new2:example.org").vm.config$.value.preset).toBe(
      "auto",
    );
  });

  test("corrupt stored data falls back to defaults", () => {
    const store = new MemoryStore();
    store.setItem("element-custom.call-layout.v1.room.!a:example.org", "{nope");
    store.setItem(
      "element-custom.call-layout.v1.room.!b:example.org",
      JSON.stringify({ preset: "bogus", hidden: [1, "x"], splitRatio: 99 }),
    );
    const storage = new LayoutStorage(store);
    expect(setup(storage, "!a:example.org").vm.config$.value).toEqual(
      defaultConfig(),
    );
    expect(setup(storage, "!b:example.org").vm.config$.value).toMatchObject({
      preset: "auto",
      hidden: ["x"],
      splitRatio: 0.85,
    });
  });

  test("works without any storage", () => {
    const { vm } = setup(new LayoutStorage(null));
    vm.setPreset("grid");
    vm.saveNamed("x");
    expect(vm.config$.value.preset).toBe("grid");
  });

  test("sanitizeConfig keeps free rects inside the canvas", () => {
    expect(
      sanitizeConfig({ rects: { a: { x: 2, y: -1, w: 0.5, h: 3, z: 4 } } })
        .rects.a,
    ).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1, z: 4 });
  });
});

test("Element Call's layout switch is hidden while the custom layout is active", () => {
  const { vm } = setup(new LayoutStorage(new MemoryStore()));
  const layoutSwitch = { name: "switch" };
  const switch$ = layoutSwitchUnlessCustom$(
    testScope(),
    new BehaviorSubject<typeof layoutSwitch | null>(layoutSwitch),
    vm.active$,
  );
  expect(switch$.value).toBeNull();
  vm.resetToStandard();
  expect(switch$.value).toBe(layoutSwitch);
  vm.setPreset("grid");
  expect(switch$.value).toBeNull();
});
