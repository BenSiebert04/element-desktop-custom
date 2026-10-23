/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { BehaviorSubject } from "rxjs";
import { describe, expect, it } from "vitest";

import { testScope } from "../utils/test";
import { type StreamDescriptor } from "./layoutConfig";
import { type KeyValueStore } from "./layoutStorage";
import {
  createPopoutStorage,
  createPopoutViewModel,
  DEFAULT_POPOUT_SIZE,
  POPOUT_NAME_PREFIX,
  popoutFeatures,
  popoutWindowName,
  sanitizeBounds,
} from "./popout";

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

const alice: StreamDescriptor = {
  key: "@alice:example.org:DEV:0",
  kind: "camera",
  userId: "@alice:example.org",
};
const aliceScreen: StreamDescriptor = {
  key: "@alice:example.org:DEV:0:screen-share",
  kind: "screen",
  userId: "@alice:example.org",
};
const bob: StreamDescriptor = {
  key: "@bob:example.org:DEV:0",
  kind: "camera",
  userId: "@bob:example.org",
};

describe("popoutWindowName", () => {
  it("is safe, prefixed and different for every stream", () => {
    const names = [alice, aliceScreen, bob].map((s) => popoutWindowName(s.key));
    for (const name of names) {
      expect(name.startsWith(POPOUT_NAME_PREFIX)).toBe(true);
      expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(name.length).toBeLessThanOrEqual(80);
    }
    expect(new Set(names).size).toBe(3);
    // Keys that only differ in unsafe characters still get their own window
    expect(popoutWindowName("a:b")).not.toBe(popoutWindowName("a/b"));
    expect(popoutWindowName("x".repeat(500)).length).toBeLessThanOrEqual(80);
  });
});

describe("bounds", () => {
  it("drops broken and limits absurd bounds", () => {
    expect(sanitizeBounds(null)).toBeNull();
    expect(
      sanitizeBounds({ left: 1, top: 2, width: "3", height: 4 }),
    ).toBeNull();
    expect(
      sanitizeBounds({ left: 0, top: 0, width: NaN, height: 100 }),
    ).toBeNull();
    expect(
      sanitizeBounds({ left: -1e9, top: 10.4, width: 5, height: 1e9 }),
    ).toEqual({ left: -100000, top: 10, width: 160, height: 8000 });
  });

  it("opens at the remembered place, else where the system wants", () => {
    expect(
      popoutFeatures({ left: 1920, top: -5, width: 400, height: 225 }),
    ).toBe("popup=yes,width=400,height=225,left=1920,top=-5");
    expect(popoutFeatures(DEFAULT_POPOUT_SIZE.camera)).toBe(
      "popup=yes,width=480,height=270",
    );
  });
});

describe("pop-out storage", () => {
  it("remembers places per person and kind, and always on top", () => {
    const store = new MemoryStore();
    const storage = createPopoutStorage(store);
    expect(storage.loadBounds("@alice:example.org|camera")).toBeNull();
    expect(storage.loadAlwaysOnTop()).toBe(false);
    storage.saveBounds("@alice:example.org|camera", {
      left: 2000,
      top: 10,
      width: 320,
      height: 180,
    });
    storage.saveAlwaysOnTop(true);
    const again = createPopoutStorage(store);
    expect(again.loadBounds("@alice:example.org|camera")).toEqual({
      left: 2000,
      top: 10,
      width: 320,
      height: 180,
    });
    expect(again.loadBounds("@alice:example.org|screen")).toBeNull();
    expect(again.loadBounds("__proto__")).toBeNull();
    expect(again.loadAlwaysOnTop()).toBe(true);
  });

  it("survives malformed or missing storage", () => {
    const store = new MemoryStore();
    store.setItem("element-custom.popouts.v1", "{not json");
    expect(createPopoutStorage(store).loadAlwaysOnTop()).toBe(false);
    store.setItem(
      "element-custom.popouts.v1",
      JSON.stringify({ alwaysOnTop: "yes", places: { x: { left: 1 } } }),
    );
    expect(createPopoutStorage(store).loadAlwaysOnTop()).toBe(false);
    expect(createPopoutStorage(store).loadBounds("x")).toBeNull();
    const none = createPopoutStorage(null);
    none.saveAlwaysOnTop(true);
    expect(none.loadBounds("x")).toBeNull();
  });
});

describe("pop-out view model", () => {
  const setup = (): {
    vm: ReturnType<typeof createPopoutViewModel>;
    streams$: BehaviorSubject<StreamDescriptor[]>;
    store: MemoryStore;
  } => {
    const store = new MemoryStore();
    const streams$ = new BehaviorSubject<StreamDescriptor[]>([
      alice,
      aliceScreen,
      bob,
    ]);
    const vm = createPopoutViewModel(
      testScope(),
      streams$,
      createPopoutStorage(store),
    );
    return { vm, streams$, store };
  };

  it("opens and closes pop-outs, each stream once", () => {
    const { vm } = setup();
    vm.open(bob.key);
    vm.open(aliceScreen.key);
    vm.open(bob.key);
    vm.open("@unknown:example.org:DEV:0");
    expect(vm.open$.value).toEqual([bob.key, aliceScreen.key]);
    vm.close(bob.key);
    expect(vm.open$.value).toEqual([aliceScreen.key]);
  });

  it("closes a pop-out when its stream ends", () => {
    const { vm, streams$ } = setup();
    vm.open(aliceScreen.key);
    vm.open(bob.key);
    streams$.next([alice, bob]);
    expect(vm.open$.value).toEqual([bob.key]);
  });

  it("opens where the person's pop-out was last time", () => {
    const { vm, store } = setup();
    expect(vm.boundsFor(aliceScreen)).toEqual(DEFAULT_POPOUT_SIZE.screen);
    vm.rememberBounds(alice, { left: -1500, top: 40, width: 300, height: 200 });
    expect(vm.boundsFor(alice)).toEqual({
      left: -1500,
      top: 40,
      width: 300,
      height: 200,
    });
    // The screen share of the same person has its own place
    expect(vm.boundsFor(aliceScreen)).toEqual(DEFAULT_POPOUT_SIZE.screen);
    expect(store.data.get("element-custom.popouts.v1")).toContain(
      "@alice:example.org|camera",
    );
  });

  it("keeps the always-on-top choice", () => {
    const { vm, store } = setup();
    expect(vm.alwaysOnTop$.value).toBe(false);
    vm.setAlwaysOnTop(true);
    expect(vm.alwaysOnTop$.value).toBe(true);
    expect(createPopoutStorage(store).loadAlwaysOnTop()).toBe(true);
  });
});
