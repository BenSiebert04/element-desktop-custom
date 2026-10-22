/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { BehaviorSubject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@vector-im/compound-web";
import { type FC } from "react";

import { testScope } from "../utils/test";
import { constant } from "../state/Behavior";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";
import { type ScreenShareViewModel } from "../state/media/ScreenShareViewModel";
import { createCustomLayoutViewModel } from "./CustomLayoutViewModel";
import { type KeyValueStore, LayoutStorage } from "./layoutStorage";
import { type CustomLayoutConfig, defaultConfig } from "./layoutConfig";
import { CustomLayoutView, moveRect, resizeRect } from "./CustomLayoutView";
import { LayoutPanel } from "./LayoutPanel";

// The media tiles themselves are covered by Element Call's own tests
vi.mock("../tile/GridTile", () => ({
  GridTile: (({ vm }: { vm: { media$: { value: { id: string } } } }) => (
    <div data-testid="grid-tile">{vm.media$.value.id}</div>
  )) as FC,
}));
vi.mock("./ScreenShareTile", () => ({
  ScreenShareTile: (({ vm }: { vm: { id: string } }) => (
    <div data-testid="screen-share-tile">{vm.id}</div>
  )) as FC,
}));

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const camera = (name: string, local = false): UserMediaViewModel =>
  ({
    id: `@${name}:example.org:DEV:0`,
    userId: `@${name}:example.org`,
    local,
    type: "user",
    displayName$: constant(name),
  }) as unknown as UserMediaViewModel;

const screenShare = (name: string): ScreenShareViewModel =>
  ({
    id: `@${name}:example.org:DEV:0:screen-share`,
    userId: `@${name}:example.org`,
    local: false,
    type: "screen share",
    displayName$: constant(name),
  }) as unknown as ScreenShareViewModel;

function setup({
  cameras = [camera("me", true), camera("alice"), camera("bob")],
  screenShares = [] as ScreenShareViewModel[],
  config = {} as Partial<CustomLayoutConfig>,
  width = 1216,
  height = 700,
} = {}) {
  const storage = new LayoutStorage(memoryStore());
  storage.saveRoom("!room", { ...defaultConfig(), ...config });
  const userMedia$ = new BehaviorSubject(cameras);
  const screenShares$ = new BehaviorSubject(screenShares);
  const vm = createCustomLayoutViewModel(testScope(), {
    roomId: "!room",
    storage,
    userMedia$,
    screenShares$,
  });
  const view = (w: number, h: number) => (
    <TooltipProvider>
      <CustomLayoutView
        vm={vm}
        width={w}
        height={h}
        showSpeakingIndicators
        showNameTags
        focusable
        onOpenProfile={null}
      />
    </TooltipProvider>
  );
  const result = render(view(width, height));
  return {
    ...result,
    vm,
    storage,
    userMedia$,
    screenShares$,
    resize: (w: number, h: number) => result.rerender(view(w, h)),
  };
}

function tiles(): HTMLElement[] {
  return screen.queryAllByTestId("custom-layout-tile");
}

function tile(key: string): HTMLElement {
  const t = tiles().find((el) => el.dataset.streamKey === key);
  if (!t) throw new Error(`No tile for ${key}`);
  return t;
}

/** Position and size of a tile as rendered. */
function geometry(el: HTMLElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
  return {
    x: Number(m?.[1]),
    y: Number(m?.[2]),
    w: parseFloat(el.style.width),
    h: parseFloat(el.style.height),
  };
}

// jsdom lacks PointerEvent, which would drop the coordinates of our events
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    public readonly pointerId: number;
    public readonly pointerType: string;
    public constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

afterEach(() => vi.restoreAllMocks());

describe("CustomLayoutView", () => {
  it("shows two screen shares side by side in large tiles", () => {
    setup({ screenShares: [screenShare("alice"), screenShare("bob")] });
    expect(screen.getAllByTestId("screen-share-tile")).toHaveLength(2);
    expect(screen.getAllByTestId("grid-tile")).toHaveLength(3);
    const a = geometry(tile(screenShare("alice").id));
    const b = geometry(tile(screenShare("bob").id));
    expect(a.y).toBe(b.y);
    expect(a.w).toBeCloseTo(b.w);
    expect(b.x).toBeGreaterThan(a.x + a.w);
    expect(tile(screenShare("alice").id).dataset.role).toBe("primary");
    const cam = geometry(tile(camera("bob").id));
    expect(tile(camera("bob").id).dataset.role).toBe("secondary");
    expect(cam.y).toBeGreaterThan(a.y + a.h);
  });

  it("shows four streams in a 2x2 grid", () => {
    setup({
      cameras: [camera("a"), camera("b")],
      screenShares: [screenShare("c"), screenShare("d")],
      config: { preset: "four-streams" },
    });
    const g = tiles().map(geometry);
    expect(g).toHaveLength(4);
    expect(new Set(g.map((t) => t.x)).size).toBe(2);
    expect(new Set(g.map((t) => t.y)).size).toBe(2);
    expect(new Set(g.map((t) => Math.round(t.w))).size).toBe(1);
  });

  it("works without any screen share", () => {
    setup();
    expect(screen.queryAllByTestId("screen-share-tile")).toHaveLength(0);
    expect(screen.getAllByTestId("grid-tile")).toHaveLength(3);
  });

  it("hides a participant from the tile's toolbar", () => {
    const { vm } = setup();
    const t = tile(camera("alice").id);
    fireEvent.click(t.querySelector('[data-testid="custom-layout-hide"]')!);
    expect(tiles().map((el) => el.dataset.streamKey)).not.toContain(
      camera("alice").id,
    );
    // Still part of the call; reachable through the hidden chip
    expect(vm.streams$.value).toHaveLength(3);
    expect(screen.getByTestId("custom-layout-hidden-chip")).toHaveTextContent(
      "1 hidden",
    );
    fireEvent.click(screen.getByTestId("custom-layout-hidden-chip"));
    expect(vm.panelOpen$.value).toBe(true);
  });

  it("offers to show everything again when all streams are hidden", () => {
    setup({ config: { hideCameras: true } });
    expect(tiles()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(tiles()).toHaveLength(3);
  });

  it("swaps tiles by drag and drop", () => {
    const { vm } = setup({ config: { preset: "main-sidebar" } });
    const main = tiles().find((el) => el.dataset.role === "primary")!;
    expect(main.dataset.streamKey).toBe(camera("me").id);
    const target = geometry(tile(camera("bob").id));
    const from = geometry(main);
    // jsdom has no layout, so the canvas sits at the origin
    fireEvent.pointerDown(main, {
      button: 0,
      pointerId: 1,
      clientX: from.x + 20,
      clientY: from.y + 20,
    });
    fireEvent.pointerMove(main, {
      pointerId: 1,
      clientX: target.x + 20,
      clientY: target.y + 20,
    });
    fireEvent.pointerUp(main, {
      pointerId: 1,
      clientX: target.x + 20,
      clientY: target.y + 20,
    });
    const newMain = tiles().find((el) => el.dataset.role === "primary")!;
    expect(newMain.dataset.streamKey).toBe(camera("bob").id);
    expect(vm.config$.value.order[0]).toBe(camera("bob").id);
  });

  it("moves and resizes free tiles with the mouse", () => {
    const { vm } = setup({
      config: {
        preset: "free",
        rects: {
          [camera("me").id]: { x: 0, y: 0, w: 0.25, h: 0.25, z: 1 },
          [camera("alice").id]: { x: 0.5, y: 0, w: 0.25, h: 0.25, z: 2 },
          [camera("bob").id]: { x: 0, y: 0.5, w: 0.25, h: 0.25, z: 3 },
        },
      },
      width: 1016, // 1000 + padding
      height: 816,
    });
    const me = tile(camera("me").id);
    expect(geometry(me)).toMatchObject({ x: 0, y: 0, w: 250, h: 200 });

    // Drag the tile 100px right and 50px down
    fireEvent.pointerDown(me, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(me, { pointerId: 1, clientX: 110, clientY: 60 });
    expect(geometry(tile(camera("me").id))).toMatchObject({ x: 100, y: 50 });
    fireEvent.pointerUp(me, { pointerId: 1, clientX: 110, clientY: 60 });
    expect(vm.config$.value.rects[camera("me").id]).toMatchObject({
      x: 0.1,
      y: 0.0625,
    });
    // ...and it came to the front
    expect(vm.config$.value.rects[camera("me").id].z).toBe(4);

    // Resize from the bottom right corner
    const handle = tile(camera("me").id).querySelector('[data-edge="se"]')!;
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 2,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(tile(camera("me").id), {
      pointerId: 2,
      clientX: 250,
      clientY: 200,
    });
    fireEvent.pointerUp(tile(camera("me").id), {
      pointerId: 2,
      clientX: 250,
      clientY: 200,
    });
    expect(vm.config$.value.rects[camera("me").id]).toMatchObject({
      w: 0.5,
      h: 0.5,
    });
  });

  it("changes the split between two streams by dragging the divider", () => {
    const { vm } = setup({
      screenShares: [screenShare("a"), screenShare("b")],
      config: { preset: "two-streams", hideCameras: true },
      width: 1016,
      height: 616,
    });
    const divider = screen.getByTestId("custom-layout-divider-split");
    fireEvent.pointerDown(divider, {
      button: 0,
      pointerId: 1,
      clientX: 500,
      clientY: 100,
    });
    fireEvent.pointerMove(divider, {
      pointerId: 1,
      clientX: 708,
      clientY: 100,
    });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 708, clientY: 100 });
    // The pointer is reported relative to the canvas padding (8px)
    expect(vm.config$.value.splitRatio).toBeCloseTo(0.7, 2);
    const a = geometry(tile(screenShare("a").id));
    const b = geometry(tile(screenShare("b").id));
    expect(a.w / (a.w + b.w)).toBeCloseTo(0.7, 1);
  });

  it("maximises a tile on double click and restores it again", () => {
    setup();
    fireEvent.doubleClick(tile(camera("alice").id));
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0].dataset.role).toBe("maximised");
    fireEvent.doubleClick(tile(camera("alice").id));
    expect(tiles()).toHaveLength(3);
  });

  it("adapts to window size changes", () => {
    const { resize } = setup({
      screenShares: [screenShare("alice"), screenShare("bob")],
    });
    const wideA = geometry(tile(screenShare("alice").id));
    const wideB = geometry(tile(screenShare("bob").id));
    expect(wideA.y).toBe(wideB.y); // side by side
    resize(616, 1016); // a narrow, tall window
    const narrowA = geometry(tile(screenShare("alice").id));
    const narrowB = geometry(tile(screenShare("bob").id));
    expect(narrowA.x).toBe(narrowB.x); // stacked
    expect(narrowB.y).toBeGreaterThan(narrowA.y);
    for (const el of tiles()) {
      const g = geometry(el);
      expect(g.x + g.w).toBeLessThanOrEqual(600.01);
      expect(g.y + g.h).toBeLessThanOrEqual(1000.01);
    }
  });

  it("follows participants joining and leaving", () => {
    const { userMedia$, screenShares$ } = setup();
    act(() =>
      userMedia$.next([
        camera("me", true),
        camera("alice"),
        camera("bob"),
        camera("carol"),
      ]),
    );
    expect(tiles()).toHaveLength(4);
    act(() => screenShares$.next([screenShare("carol")]));
    expect(tile(screenShare("carol").id).dataset.role).toBe("primary");
    act(() => {
      userMedia$.next([camera("me", true), camera("alice")]);
      screenShares$.next([]);
    });
    expect(new Set(tiles().map((el) => el.dataset.streamKey))).toEqual(
      new Set([camera("alice").id, camera("me").id]),
    );
  });
});

describe("moveRect / resizeRect", () => {
  const bounds = { width: 1000, height: 500 };
  it("keeps tiles inside the canvas", () => {
    expect(
      moveRect({ x: 900, y: 0, w: 200, h: 100 }, 500, -50, bounds),
    ).toEqual({
      x: 800,
      y: 0,
      w: 200,
      h: 100,
    });
  });
  it("enforces a minimum size", () => {
    expect(
      resizeRect({ x: 100, y: 100, w: 200, h: 100 }, "nw", 500, 500, bounds),
    ).toEqual({ x: 204, y: 146, w: 96, h: 54 });
  });
});

describe("LayoutPanel", () => {
  function setupPanel() {
    const storage = new LayoutStorage(memoryStore());
    const userMedia$ = new BehaviorSubject([
      camera("me", true),
      camera("alice"),
    ]);
    const screenShares$ = new BehaviorSubject([screenShare("alice")]);
    const vm = createCustomLayoutViewModel(testScope(), {
      roomId: "!room",
      storage,
      userMedia$,
      screenShares$,
    });
    render(
      <TooltipProvider>
        <LayoutPanel vm={vm} canvasSize={{ width: 1000, height: 600 }} />
      </TooltipProvider>,
    );
    return { vm, storage };
  }

  const row = (key: string): HTMLElement =>
    screen
      .getAllByTestId("custom-layout-stream-row")
      .find((el) => el.dataset.streamKey === key)!;

  it("lists all streams and hides camera and screen share separately", () => {
    const { vm } = setupPanel();
    expect(screen.getAllByTestId("custom-layout-stream-row")).toHaveLength(3);
    fireEvent.click(
      row(screenShare("alice").id).querySelector(
        '[data-testid="custom-layout-toggle-visibility"]',
      )!,
    );
    expect(vm.config$.value.hidden).toEqual([screenShare("alice").id]);
    expect(row(screenShare("alice").id).dataset.visible).toBe("false");
    expect(row(camera("alice").id).dataset.visible).toBe("true");
    fireEvent.click(screen.getByTestId("custom-layout-show-all"));
    expect(vm.config$.value.hidden).toEqual([]);
  });

  it("switches presets", () => {
    const { vm } = setupPanel();
    fireEvent.click(screen.getByTestId("custom-layout-preset-four-streams"));
    expect(vm.config$.value.preset).toBe("four-streams");
    fireEvent.click(screen.getByTestId("custom-layout-preset-free"));
    expect(vm.config$.value.preset).toBe("free");
    expect(Object.keys(vm.config$.value.rects)).toHaveLength(3);
  });

  it("saves and loads named layouts", () => {
    const { vm } = setupPanel();
    fireEvent.click(screen.getByTestId("custom-layout-preset-main-sidebar"));
    fireEvent.change(screen.getByTestId("custom-layout-save-name"), {
      target: { value: "Coding" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getAllByTestId("custom-layout-saved")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("custom-layout-preset-grid"));
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(vm.config$.value.preset).toBe("main-sidebar");
  });

  it("restores the standard view", () => {
    const { vm, storage } = setupPanel();
    fireEvent.click(screen.getByTestId("custom-layout-preset-free"));
    fireEvent.click(screen.getByTestId("custom-layout-hide-cameras"));
    fireEvent.click(screen.getByTestId("custom-layout-reset"));
    expect(vm.active$.value).toBe(false);
    expect(vm.config$.value).toEqual({ ...defaultConfig(), preset: "default" });
    expect(storage.loadRoom("!room")?.preset).toBe("default");
  });
});
