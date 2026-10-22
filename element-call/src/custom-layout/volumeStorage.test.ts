/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, test, vi } from "vitest";

import { testScope } from "../utils/test";
import { constant } from "../state/Behavior";
import { createVolumeControls } from "../state/VolumeControls";
import { type KeyValueStore } from "./layoutStorage";
import { createVolumeStorage, MAX_PLAYBACK_VOLUME } from "./volumeStorage";

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

const ALICE = "@alice:example.org";
const BOB = "@bob:example.org";

describe("volume storage", () => {
  test("remembers a volume per person and source", () => {
    const store = new MemoryStore();
    const volumes = createVolumeStorage(store);
    expect(volumes.load(ALICE, "microphone")).toBe(1);
    volumes.save(ALICE, "microphone", 1.8);
    volumes.save(ALICE, "screenShare", 0.3);
    volumes.save(BOB, "microphone", 0.02);
    // A new call (new storage object, same profile) gets the same values
    const later = createVolumeStorage(store);
    expect(later.load(ALICE, "microphone")).toBe(1.8);
    expect(later.load(ALICE, "screenShare")).toBe(0.3);
    expect(later.load(BOB, "microphone")).toBe(0.02);
    expect(later.load(BOB, "screenShare")).toBe(1);
  });

  test("keeps values between 0 and 200 % and drops the default", () => {
    const store = new MemoryStore();
    const volumes = createVolumeStorage(store);
    volumes.save(ALICE, "microphone", 7);
    expect(volumes.load(ALICE, "microphone")).toBe(MAX_PLAYBACK_VOLUME);
    volumes.save(ALICE, "microphone", -1);
    expect(volumes.load(ALICE, "microphone")).toBe(0);
    volumes.save(ALICE, "microphone", 1);
    expect(store.data.get("element-custom.volume.v1")).toBe("{}");
  });

  test("ignores broken stored data and works without storage", () => {
    const store = new MemoryStore();
    store.setItem("element-custom.volume.v1", "{not json");
    expect(createVolumeStorage(store).load(ALICE, "microphone")).toBe(1);
    store.setItem(
      "element-custom.volume.v1",
      JSON.stringify({ [ALICE]: { microphone: "loud" } }),
    );
    expect(createVolumeStorage(store).load(ALICE, "microphone")).toBe(1);
    const none = createVolumeStorage(null);
    none.save(ALICE, "microphone", 2);
    expect(none.load(ALICE, "microphone")).toBe(1);
  });
});

describe("volume controls with a remembered volume", () => {
  test("start at the remembered volume and report committed changes", () => {
    const sink = vi.fn();
    const committed = vi.fn();
    const controls = createVolumeControls(testScope(), {
      pretendToBeDisconnected$: constant(false),
      sink$: constant(sink),
      initialVolume: 1.5,
      onVolumeCommitted: committed,
    });
    expect(controls.playbackVolume$.value).toBe(1.5);
    // The playback module gets the boosted volume
    expect(sink).toHaveBeenLastCalledWith(1.5);

    // Dragging is not remembered until the slider is released
    controls.adjustPlaybackVolume(2);
    expect(sink).toHaveBeenLastCalledWith(2);
    expect(committed).not.toHaveBeenCalled();
    controls.commitPlaybackVolume();
    expect(committed).toHaveBeenLastCalledWith(2);

    // Muting and unmuting are remembered too
    controls.togglePlaybackMuted();
    expect(committed).toHaveBeenLastCalledWith(0);
    controls.togglePlaybackMuted();
    expect(committed).toHaveBeenLastCalledWith(2);
  });

  test("a person remembered as muted can be unmuted to 100 %", () => {
    const controls = createVolumeControls(testScope(), {
      pretendToBeDisconnected$: constant(false),
      sink$: constant(() => {}),
      initialVolume: 0,
    });
    expect(controls.playbackMuted$.value).toBe(true);
    controls.togglePlaybackMuted();
    expect(controls.playbackVolume$.value).toBe(1);
  });
});
