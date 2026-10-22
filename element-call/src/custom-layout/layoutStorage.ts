/*
Copyright 2026 Element Custom contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { logger as rootLogger } from "matrix-js-sdk/lib/logger";

import { type CustomLayoutConfig, sanitizeConfig } from "./layoutConfig";

const logger = rootLogger.getChild("[CustomLayoutStorage]");

/**
 * Minimal key/value interface so that the storage can be swapped out in tests.
 * `window.localStorage` satisfies it.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedLayout {
  name: string;
  config: CustomLayoutConfig;
}

const PREFIX = "element-custom.call-layout.v1";
const GLOBAL_KEY = `${PREFIX}.global`;
const SAVED_KEY = `${PREFIX}.saved`;
const roomKey = (roomId: string): string => `${PREFIX}.room.${roomId}`;

export const MAX_SAVED_LAYOUTS = 50;

/**
 * Persists layout preferences locally (in the browser profile of the desktop
 * app). There are three levels:
 *
 *  - a configuration per room, saved automatically,
 *  - an optional global default, used for rooms without their own config,
 *  - any number of named layouts the user saved explicitly.
 */
export class LayoutStorage {
  public constructor(private readonly store: KeyValueStore | null) {}

  private read(key: string): unknown {
    if (!this.store) return null;
    try {
      const raw = this.store.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) {
      logger.warn(`Ignoring unreadable layout data in ${key}`, e);
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    if (!this.store) return;
    try {
      this.store.setItem(key, JSON.stringify(value));
    } catch (e) {
      logger.warn(`Failed to store layout data in ${key}`, e);
    }
  }

  private remove(key: string): void {
    try {
      this.store?.removeItem(key);
    } catch (e) {
      logger.warn(`Failed to remove layout data in ${key}`, e);
    }
  }

  public loadRoom(roomId: string): CustomLayoutConfig | null {
    const data = this.read(roomKey(roomId));
    return data === null ? null : sanitizeConfig(data);
  }

  public saveRoom(roomId: string, config: CustomLayoutConfig): void {
    this.write(roomKey(roomId), config);
  }

  public clearRoom(roomId: string): void {
    this.remove(roomKey(roomId));
  }

  public loadGlobal(): CustomLayoutConfig | null {
    const data = this.read(GLOBAL_KEY);
    return data === null ? null : sanitizeConfig(data);
  }

  public saveGlobal(config: CustomLayoutConfig): void {
    this.write(GLOBAL_KEY, config);
  }

  public clearGlobal(): void {
    this.remove(GLOBAL_KEY);
  }

  /**
   * The configuration to start a call in the given room with.
   */
  public loadInitial(roomId: string): CustomLayoutConfig | null {
    return this.loadRoom(roomId) ?? this.loadGlobal();
  }

  public loadSaved(): SavedLayout[] {
    const data = this.read(SAVED_KEY);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (e): e is { name: string; config: unknown } =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as { name?: unknown }).name === "string",
      )
      .map((e) => ({ name: e.name, config: sanitizeConfig(e.config) }));
  }

  public saveNamed(name: string, config: CustomLayoutConfig): SavedLayout[] {
    const trimmed = name.trim();
    if (trimmed === "") return this.loadSaved();
    const saved = this.loadSaved().filter((s) => s.name !== trimmed);
    saved.push({ name: trimmed, config });
    const result = saved.slice(-MAX_SAVED_LAYOUTS);
    this.write(SAVED_KEY, result);
    return result;
  }

  public deleteNamed(name: string): SavedLayout[] {
    const result = this.loadSaved().filter((s) => s.name !== name);
    this.write(SAVED_KEY, result);
    return result;
  }
}

/**
 * The storage used by the app: the profile's localStorage, if available.
 */
export function defaultLayoutStorage(): LayoutStorage {
  let store: KeyValueStore | null = null;
  try {
    store = globalThis.localStorage ?? null;
  } catch {
    // Access to localStorage can throw (e.g. when blocked)
  }
  return new LayoutStorage(store);
}
