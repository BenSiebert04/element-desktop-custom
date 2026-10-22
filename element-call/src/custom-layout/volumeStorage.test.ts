/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, test, vi } from "vitest";
import { type RemoteParticipant, Track } from "livekit-client";

import { testScope } from "../utils/test";
import { constant } from "../state/Behavior";
import { createVolumeControls } from "../state/VolumeControls";
import { type KeyValueStore } from "./layoutStorage";
import { createVolumeStorage, MAX_PLAYBACK_VOLUME } from "./volumeStorage";
import { requestedPlaybackVolume, setPlaybackVolume } from "./playbackVolume";

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
  test("start at the remembered volume and report committed changes", async () => {
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
    await Promise.resolve();
    expect(committed).toHaveBeenLastCalledWith(2);

    // Muting and unmuting are remembered too
    controls.togglePlaybackMuted();
    await Promise.resolve();
    expect(committed).toHaveBeenLastCalledWith(0);
    controls.togglePlaybackMuted();
    await Promise.resolve();
    expect(committed).toHaveBeenLastCalledWith(2);
  });

  test("remembers the new volume when the slider commits before the change", async () => {
    // As the slider does with the keyboard (e.g. the End key)
    const committed = vi.fn();
    const controls = createVolumeControls(testScope(), {
      pretendToBeDisconnected$: constant(false),
      sink$: constant(() => {}),
      onVolumeCommitted: committed,
    });
    controls.commitPlaybackVolume();
    controls.adjustPlaybackVolume(2);
    await Promise.resolve();
    expect(committed).toHaveBeenCalledExactlyOnceWith(2);
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

describe("volumes above 100 %", () => {
  test("are limited to 100 % until the track plays through Web Audio", () => {
    const applied: number[] = [];
    let webAudio = false;
    const participant = {
      identity: "@carol:example.org:DEVICE",
      setVolume: (volume: number): void => {
        // Like an <audio> element
        if (volume > 1 && !webAudio) throw new RangeError("volume > 1");
        applied.push(volume);
      },
    } as unknown as RemoteParticipant;

    setPlaybackVolume(participant, 1.8);
    expect(applied).toEqual([1]);
    // The renderer applies the requested volume once Web Audio is used
    expect(
      requestedPlaybackVolume(participant.identity, Track.Source.Microphone),
    ).toBe(1.8);
    webAudio = true;
    setPlaybackVolume(participant, 2);
    expect(applied).toEqual([1, 2]);
    expect(
      requestedPlaybackVolume(
        participant.identity,
        Track.Source.ScreenShareAudio,
      ),
    ).toBeUndefined();
  });
});
