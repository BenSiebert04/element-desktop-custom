/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * Remembers the playback volume the user has set for other people, by Matrix
 * user ID, so that it applies again in every later call with that person.
 *
 * Purely local: stored in the app's profile, never sent anywhere.
 */

import { logger } from "matrix-js-sdk/lib/logger";

import { clamp } from "./layoutConfig";
import { type KeyValueStore } from "./layoutStorage";

/** Highest playback volume (200 %). */
export const MAX_PLAYBACK_VOLUME = 2;

/** Which of a person's audio streams the volume is for. */
export type VolumeSource = "microphone" | "screenShare";

const KEY = "element-custom.volume.v1";

type Volumes = Record<string, Partial<Record<VolumeSource, number>>>;

export interface VolumeStorage {
  /** The stored volume, or 1 (100 %) if none is stored. */
  load(userId: string, source: VolumeSource): number;
  save(userId: string, source: VolumeSource, volume: number): void;
}

function isVolume(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function createVolumeStorage(
  store: KeyValueStore | null,
): VolumeStorage {
  const read = (): Volumes => {
    if (!store) return {};
    try {
      const parsed: unknown = JSON.parse(store.getItem(KEY) ?? "{}");
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Volumes)
        : {};
    } catch (e) {
      logger.warn("[custom-layout] Ignoring malformed stored volumes", e);
      return {};
    }
  };

  return {
    load: (userId, source) => {
      const v = read()[userId]?.[source];
      return isVolume(v) ? clamp(v, 0, MAX_PLAYBACK_VOLUME) : 1;
    },
    save: (userId, source, volume) => {
      if (!store) return;
      const volumes = read();
      const entry = { ...volumes[userId] };
      const value = clamp(volume, 0, MAX_PLAYBACK_VOLUME);
      // 100 % is the default and needs no entry
      if (value === 1) delete entry[source];
      else entry[source] = value;
      if (Object.keys(entry).length > 0) volumes[userId] = entry;
      else delete volumes[userId];
      try {
        store.setItem(KEY, JSON.stringify(volumes));
      } catch (e) {
        logger.warn("[custom-layout] Could not store volume", e);
      }
    },
  };
}

let appVolumeStorage: VolumeStorage | null = null;

/**
 * The volume storage used by the app: the profile's localStorage, if
 * available.
 */
export function getVolumeStorage(): VolumeStorage {
  if (!appVolumeStorage) {
    let store: KeyValueStore | null = null;
    try {
      store = globalThis.localStorage ?? null;
    } catch {
      // Access to localStorage can throw (e.g. when blocked)
    }
    appVolumeStorage = createVolumeStorage(store);
  }
  return appVolumeStorage;
}
