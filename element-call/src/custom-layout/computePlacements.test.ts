/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, test } from "vitest";

import {
  computeLayout,
  completeFreeRects,
  GAP,
  gridCells,
  type Placement,
  type Rect,
} from "./computePlacements";
import {
  type CustomLayoutConfig,
  defaultConfig,
  type FreeRect,
  type StreamDescriptor,
} from "./layoutConfig";

const cam = (name: string): StreamDescriptor => ({
  key: `@${name}:example.org:DEV:0`,
  kind: "camera",
  userId: `@${name}:example.org`,
});
const screen = (name: string): StreamDescriptor => ({
  key: `@${name}:example.org:DEV:0:screen-share`,
  kind: "screen",
  userId: `@${name}:example.org`,
});

const config = (c: Partial<CustomLayoutConfig>): CustomLayoutConfig => ({
  ...defaultConfig(),
  ...c,
});

const size = { width: 1600, height: 900 };

function byKey(tiles: Placement[], key: string): Placement {
  const t = tiles.find((p) => p.key === key);
  if (!t) throw new Error(`no tile for ${key}`);
  return t;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - 0.01 &&
    b.x < a.x + a.w - 0.01 &&
    a.y < b.y + b.h - 0.01 &&
    b.y < a.y + a.h - 0.01
  );
}

function expectInside(tiles: Rect[], area: { width: number; height: number }) {
  for (const t of tiles) {
    expect(t.x).toBeGreaterThanOrEqual(-0.01);
    expect(t.y).toBeGreaterThanOrEqual(-0.01);
    expect(t.x + t.w).toBeLessThanOrEqual(area.width + 0.01);
    expect(t.y + t.h).toBeLessThanOrEqual(area.height + 0.01);
    expect(t.w).toBeGreaterThan(0);
    expect(t.h).toBeGreaterThan(0);
  }
}

function expectNoOverlap(tiles: Rect[]) {
  for (let i = 0; i < tiles.length; i++)
    for (let j = i + 1; j < tiles.length; j++)
      expect(overlaps(tiles[i], tiles[j])).toBe(false);
}

describe("two screen shares at the same time", () => {
  const streams = [
    cam("alice"),
    cam("bob"),
    cam("carol"),
    screen("alice"),
    screen("bob"),
  ];

  test.each(["auto", "two-streams"] as const)(
    "%s shows both screen shares large side by side, cameras small below",
    (preset) => {
      const { tiles } = computeLayout(config({ preset }), streams, size);
      expect(tiles).toHaveLength(5);
      const a = byKey(tiles, screen("alice").key);
      const b = byKey(tiles, screen("bob").key);
      expect(a.role).toBe("primary");
      expect(b.role).toBe("primary");
      // Side by side, same row, equally large
      expect(a.y).toBe(b.y);
      expect(a.w).toBeCloseTo(b.w);
      expect(a.x + a.w).toBeLessThanOrEqual(b.x);
      // Cameras are small and below
      for (const c of ["alice", "bob", "carol"]) {
        const t = byKey(tiles, cam(c).key);
        expect(t.role).toBe("secondary");
        expect(t.y).toBeGreaterThanOrEqual(a.y + a.h);
        expect(t.w * t.h).toBeLessThan((a.w * a.h) / 4);
      }
      expectInside(tiles, size);
      expectNoOverlap(tiles);
    },
  );

  test("split ratio gives a 70/30 arrangement, cameras hidden", () => {
    const { tiles, hidden } = computeLayout(
      config({ preset: "two-streams", splitRatio: 0.7, hideCameras: true }),
      streams,
      size,
    );
    expect(tiles.map((t) => t.key).sort()).toEqual(
      [screen("alice").key, screen("bob").key].sort(),
    );
    expect(hidden).toHaveLength(3);
    const a = byKey(tiles, screen("alice").key);
    const b = byKey(tiles, screen("bob").key);
    expect(a.w / (a.w + b.w)).toBeCloseTo(0.7, 1);
    expect(a.h).toBe(size.height);
  });

  test("auto shows any number of screen shares without displacing each other", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(screen);
    const { tiles } = computeLayout(config({}), [cam("x"), ...many], size);
    for (const s of many) expect(byKey(tiles, s.key).role).toBe("primary");
    expectInside(tiles, size);
    expectNoOverlap(tiles);
  });
});

describe("four streams", () => {
  test("in a 2x2 grid of equal size", () => {
    const streams = [screen("a"), screen("b"), cam("c"), cam("d")];
    const { tiles } = computeLayout(
      config({ preset: "four-streams" }),
      streams,
      size,
    );
    expect(tiles).toHaveLength(4);
    const ws = new Set(tiles.map((t) => Math.round(t.w)));
    const hs = new Set(tiles.map((t) => Math.round(t.h)));
    expect(ws.size).toBe(1);
    expect(hs.size).toBe(1);
    expect(new Set(tiles.map((t) => Math.round(t.x))).size).toBe(2);
    expect(new Set(tiles.map((t) => Math.round(t.y))).size).toBe(2);
    expectInside(tiles, size);
    expectNoOverlap(tiles);
  });

  test("additional streams go to the strip", () => {
    const streams = [
      cam("a"),
      cam("b"),
      cam("c"),
      cam("d"),
      cam("e"),
      cam("f"),
    ];
    const { tiles } = computeLayout(
      config({ preset: "four-streams" }),
      streams,
      size,
    );
    expect(tiles.filter((t) => t.role === "primary")).toHaveLength(4);
    expect(tiles.filter((t) => t.role === "secondary")).toHaveLength(2);
    expectNoOverlap(tiles);
  });
});

describe("main stream with sidebar", () => {
  test("one main stream, others stacked on the right", () => {
    const streams = [cam("a"), cam("b"), screen("c"), cam("d")];
    const { tiles, dividers } = computeLayout(
      config({ preset: "main-sidebar" }),
      streams,
      size,
    );
    const main = byKey(tiles, screen("c").key);
    expect(main.role).toBe("primary");
    expect(main.x).toBe(0);
    expect(main.h).toBe(size.height);
    for (const t of tiles.filter((t) => t.role === "secondary"))
      expect(t.x).toBeGreaterThanOrEqual(main.x + main.w + GAP - 0.01);
    expect(dividers.map((d) => d.id)).toEqual(["sidebar"]);
    expectInside(tiles, size);
    expectNoOverlap(tiles);
  });
});

describe("hiding", () => {
  const streams = [cam("alice"), screen("alice"), cam("bob")];

  test("a single participant's tile can be hidden", () => {
    const { tiles, hidden } = computeLayout(
      config({ hidden: [cam("bob").key] }),
      streams,
      size,
    );
    expect(tiles.map((t) => t.key)).not.toContain(cam("bob").key);
    expect(hidden).toEqual([cam("bob").key]);
  });

  test("camera and screen share of the same user are independent", () => {
    const hideCam = computeLayout(
      config({ hidden: [cam("alice").key] }),
      streams,
      size,
    );
    expect(hideCam.tiles.map((t) => t.key)).toContain(screen("alice").key);
    expect(hideCam.tiles.map((t) => t.key)).not.toContain(cam("alice").key);

    const hideScreen = computeLayout(
      config({ hidden: [screen("alice").key] }),
      streams,
      size,
    );
    expect(hideScreen.tiles.map((t) => t.key)).toContain(cam("alice").key);
    expect(hideScreen.tiles.map((t) => t.key)).not.toContain(
      screen("alice").key,
    );
  });

  test("pinned cameras stay visible when all cameras are hidden", () => {
    const { tiles } = computeLayout(
      config({ hideCameras: true, pinned: [cam("bob").key] }),
      streams,
      size,
    );
    expect(tiles.map((t) => t.key).sort()).toEqual(
      [cam("bob").key, screen("alice").key].sort(),
    );
  });

  test("everything hidden yields no tiles", () => {
    const { tiles } = computeLayout(
      config({ hidden: streams.map((s) => s.key) }),
      streams,
      size,
    );
    expect(tiles).toEqual([]);
  });
});

describe("no screen share", () => {
  test.each([
    "auto",
    "two-streams",
    "four-streams",
    "main-sidebar",
    "grid",
    "free",
  ] as const)("%s lays out cameras only", (preset) => {
    const streams = [cam("a"), cam("b"), cam("c")];
    const { tiles } = computeLayout(config({ preset }), streams, size);
    expect(tiles).toHaveLength(3);
    expectInside(tiles, size);
    if (preset !== "free") expectNoOverlap(tiles);
  });

  test("auto puts all cameras in a grid of equal tiles", () => {
    const streams = [cam("a"), cam("b"), cam("c"), cam("d")];
    const { tiles } = computeLayout(config({}), streams, size);
    expect(tiles.every((t) => t.role === "primary")).toBe(true);
    expect(new Set(tiles.map((t) => Math.round(t.w))).size).toBe(1);
  });

  test("an empty call yields no tiles", () => {
    expect(computeLayout(config({}), [], size).tiles).toEqual([]);
  });
});

describe("pinning and maximising", () => {
  test("a pinned camera becomes a large tile ahead of screen shares", () => {
    const streams = [screen("a"), cam("b"), cam("c")];
    const { tiles } = computeLayout(
      config({ preset: "main-sidebar", pinned: [cam("c").key] }),
      streams,
      size,
    );
    expect(byKey(tiles, cam("c").key).role).toBe("primary");
    expect(byKey(tiles, screen("a").key).role).toBe("secondary");
  });

  test("a maximised stream fills the whole canvas", () => {
    const streams = [screen("a"), cam("b")];
    const { tiles } = computeLayout(config({}), streams, size, cam("b").key);
    expect(tiles).toEqual([
      {
        key: cam("b").key,
        role: "maximised",
        x: 0,
        y: 0,
        w: 1600,
        h: 900,
        z: 0,
      },
    ]);
  });

  test("maximising a hidden stream is ignored", () => {
    const streams = [screen("a"), cam("b")];
    const { tiles } = computeLayout(
      config({ hidden: [cam("b").key] }),
      streams,
      size,
      cam("b").key,
    );
    expect(tiles.map((t) => t.key)).toEqual([screen("a").key]);
  });
});

describe("window size changes", () => {
  const streams = [screen("a"), screen("b"), cam("c"), cam("d")];
  const sizes = [
    { width: 1920, height: 1080 },
    { width: 960, height: 1040 }, // window on one half of a 1080p screen
    { width: 640, height: 700 },
    { width: 400, height: 300 },
  ];

  test.each([
    "auto",
    "grid",
    "two-streams",
    "four-streams",
    "main-sidebar",
  ] as const)(
    "%s stays inside the canvas without overlaps at every size",
    (preset) => {
      for (const s of sizes) {
        const { tiles } = computeLayout(config({ preset }), streams, s);
        expect(tiles).toHaveLength(4);
        expectInside(tiles, s);
        expectNoOverlap(tiles);
      }
    },
  );

  test("two streams stack vertically in a portrait window", () => {
    const { tiles } = computeLayout(
      config({ preset: "two-streams" }),
      [screen("a"), screen("b")],
      { width: 700, height: 1000 },
    );
    const a = byKey(tiles, screen("a").key);
    const b = byKey(tiles, screen("b").key);
    expect(a.x).toBe(b.x);
    expect(b.y).toBeGreaterThan(a.y);
  });

  test("free layout scales with the window", () => {
    const c = config({
      preset: "free",
      rects: { [screen("a").key]: { x: 0.1, y: 0.2, w: 0.5, h: 0.4, z: 1 } },
    });
    const small = computeLayout(c, [screen("a")], { width: 800, height: 600 });
    const big = computeLayout(c, [screen("a")], { width: 1600, height: 1200 });
    expect(small.tiles[0]).toMatchObject({ x: 80, y: 120, w: 400, h: 240 });
    expect(big.tiles[0]).toMatchObject({ x: 160, y: 240, w: 800, h: 480 });
  });
});

describe("free layout", () => {
  test("new streams get a spot that does not cover existing tiles", () => {
    const rects = completeFreeRects(
      { [screen("a").key]: { x: 0, y: 0, w: 0.5, h: 0.5, z: 1 } },
      [screen("a"), cam("b")],
      size,
    );
    const a = rects[screen("a").key];
    const b = rects[cam("b").key];
    expect(b.z).toBeGreaterThan(a.z);
    expect(
      overlaps(
        { x: a.x, y: a.y, w: a.w, h: a.h },
        { x: b.x, y: b.y, w: b.w, h: b.h },
      ),
    ).toBe(false);
  });

  test("seeded rects keep tiles where they were", () => {
    const seed: Placement[] = [
      {
        key: cam("a").key,
        role: "primary",
        x: 160,
        y: 90,
        w: 800,
        h: 450,
        z: 0,
      },
    ];
    const rects = completeFreeRects({}, [cam("a")], size, seed);
    expect(rects[cam("a").key]).toMatchObject({
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.5,
    });
  });
});

describe("gridCells", () => {
  test("centres the last row", () => {
    const cells = gridCells(3, { x: 0, y: 0, w: 1000, h: 1000 });
    // 2 columns, 2 rows; the third cell sits in the middle
    expect(cells[2].x + cells[2].w / 2).toBeCloseTo(500);
  });
});

describe("layers in the free layout", () => {
  const a = cam("alice");
  const b = cam("bob");
  const c = screen("carol");
  const rect = (z: number): FreeRect => ({ x: 0.1, y: 0.1, w: 0.5, h: 0.5, z });

  test("a higher layer is always in front, whatever was brought forward", () => {
    const tiles = computeLayout(
      config({
        preset: "free",
        // Bob was brought to the front last, but Alice is on layer 1
        rects: { [a.key]: rect(1), [b.key]: rect(9), [c.key]: rect(5) },
        layers: { [a.key]: 1 },
      }),
      [a, b, c],
      size,
    ).tiles;
    expect(byKey(tiles, a.key).z).toBeGreaterThan(byKey(tiles, b.key).z);
    expect(byKey(tiles, a.key).z).toBeGreaterThan(byKey(tiles, c.key).z);
    // Within layer 0 the order of bringing to front still applies
    expect(byKey(tiles, b.key).z).toBeGreaterThan(byKey(tiles, c.key).z);
    // Compact stacking order, usable as a z-index
    expect(tiles.map((t) => t.z).sort((x, y) => x - y)).toEqual([1, 2, 3]);
  });
});
