/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import { type EmptyObject, type MatrixClient, SyncState } from "matrix-js-sdk/src/matrix";
import { type AccountDataEvents } from "matrix-js-sdk/src/types";

import { AsyncStoreWithClient } from "../../stores/AsyncStoreWithClient";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { type MatrixDispatcher } from "../../dispatcher/dispatcher";
import { type ActionPayload } from "../../dispatcher/payloads";
import SdkConfig from "../../SdkConfig";
import {
    DEFAULT_ACCOUNT_DATA_TYPE,
    parsePrivateVoiceConfig,
    type PrivateVoiceCategory,
    type PrivateVoiceConfig,
    type PrivateVoiceRoom,
    type PrivateVoiceSpace,
} from "./parser";

const logger = rootLogger.getChild("PrivateVoiceStore");

/**
 * Optional settings in config.json:
 *
 * ```json
 * "mosaix_private_voice": {
 *     "enabled": true,
 *     "account_data_type": "io.github.bensiebert04.mosaix.private_voice",
 *     "homeservers": ["https://matrix.example.org"]
 * }
 * ```
 *
 * `homeservers` restricts the feature to these homeserver base URLs. Without it,
 * any homeserver that publishes the account data is supported.
 */
export interface PrivateVoiceSettings {
    enabled: boolean;
    accountDataType: string;
    homeservers: string[] | null;
}

export function getPrivateVoiceSettings(): PrivateVoiceSettings {
    const raw = (SdkConfig.get() as unknown as Record<string, unknown>)["mosaix_private_voice"];
    const cfg = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const homeservers = Array.isArray(cfg.homeservers)
        ? cfg.homeservers.filter((h): h is string => typeof h === "string").map(normaliseUrl)
        : null;
    return {
        enabled: cfg.enabled !== false,
        accountDataType:
            typeof cfg.account_data_type === "string" && cfg.account_data_type.length > 0
                ? cfg.account_data_type
                : DEFAULT_ACCOUNT_DATA_TYPE,
        homeservers: homeservers && homeservers.length > 0 ? homeservers : null,
    };
}

function normaliseUrl(url: string | undefined): string {
    return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

/** Minimal storage interface, so that tests can swap it out. */
export interface CacheStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const CACHE_PREFIX = "mosaix.private_voice.v1";

/** Cache key, strictly separated by homeserver and account. */
export function cacheKey(homeserverUrl: string, userId: string): string {
    return `${CACHE_PREFIX}|${normaliseUrl(homeserverUrl)}|${userId}`;
}

export type PrivateVoiceStatus = "inactive" | "absent" | "active" | "unsupported" | "invalid";

/**
 * Applies the Private Voice configuration of the logged-in account.
 *
 * Reads the account data from the SDK after the initial sync and follows
 * changes delivered by the normal `/sync` loop. No extra requests are made and
 * the access token is never touched here.
 */
export class PrivateVoiceStore extends AsyncStoreWithClient<EmptyObject> {
    private static internalInstance: PrivateVoiceStore | undefined;

    public static get instance(): PrivateVoiceStore {
        if (!PrivateVoiceStore.internalInstance) {
            PrivateVoiceStore.internalInstance = new PrivateVoiceStore(defaultDispatcher);
            void PrivateVoiceStore.internalInstance.start();
        }
        return PrivateVoiceStore.internalInstance;
    }

    private currentConfig: PrivateVoiceConfig | null = null;
    private currentStatus: PrivateVoiceStatus = "inactive";
    private currentStale = false;
    private roomsById = new Map<string, PrivateVoiceRoom>();
    private spacesById = new Map<string, PrivateVoiceSpace>();
    private synced = false;

    public constructor(
        dispatcher: MatrixDispatcher,
        private readonly storage: CacheStorage | null = PrivateVoiceStore.defaultStorage(),
    ) {
        super(dispatcher);
    }

    private static defaultStorage(): CacheStorage | null {
        try {
            return globalThis.localStorage ?? null;
        } catch {
            return null;
        }
    }

    /** The configuration in effect, or null if there is none. */
    public get config(): PrivateVoiceConfig | null {
        return this.currentConfig;
    }

    public get status(): PrivateVoiceStatus {
        return this.currentStatus;
    }

    /**
     * Whether the configuration shown is a last-known-good copy that could not
     * be confirmed by a successful sync yet (e.g. while offline).
     */
    public get isStale(): boolean {
        return this.currentStale;
    }

    /** The managed room with this id, if any. */
    public getRoom(roomId: string): PrivateVoiceRoom | null {
        return this.roomsById.get(roomId) ?? null;
    }

    /** Text channels without call buttons (jam channels never have calls). */
    public isManagedTextRoom(roomId: string): boolean {
        const room = this.getRoom(roomId);
        if (room?.kind === "jam") return true;
        return room?.kind === "text" && !this.currentConfig!.ui.showCallControlsInTextRooms;
    }

    public isManagedJamRoom(roomId: string): boolean {
        return this.getRoom(roomId)?.kind === "jam";
    }

    public isManagedVoiceRoom(roomId: string): boolean {
        return this.getRoom(roomId)?.kind === "voice";
    }

    /** The managed space with this id, if any. */
    public getSpace(spaceId: string): PrivateVoiceSpace | null {
        return this.spacesById.get(spaceId) ?? null;
    }

    /** The categories of a managed space, in display order. */
    public getCategories(spaceId: string): PrivateVoiceCategory[] {
        return this.getSpace(spaceId)?.categories ?? [];
    }

    /**
     * The section tag a room belongs to when the given space is active, or
     * undefined if the room is not grouped there.
     */
    public getSectionTagForRoom(roomId: string, spaceId: string): string | undefined {
        const room = this.getRoom(roomId);
        if (!room || room.spaceId !== spaceId || room.categoryId === null) return undefined;
        return this.getSpace(spaceId)?.categories.find((c) => c.categoryId === room.categoryId)?.sectionTag;
    }

    /** All rooms of a space that are grouped into a category, mapped to their section tag. */
    public getSectionTagsByRoom(spaceId: string): Map<string, string> {
        const space = this.getSpace(spaceId);
        const result = new Map<string, string>();
        if (!space) return result;
        const tags = new Map(space.categories.map((c) => [c.categoryId, c.sectionTag]));
        for (const room of space.rooms) {
            const tag = room.categoryId === null ? undefined : tags.get(room.categoryId);
            if (tag) result.set(room.roomId, tag);
        }
        return result;
    }

    /** The name of a managed category, by its section tag. */
    public getCategoryName(sectionTag: string): string | undefined {
        for (const space of this.spacesById.values()) {
            const category = space.categories.find((c) => c.sectionTag === sectionTag);
            if (category) return category.name;
        }
        return undefined;
    }

    protected async onReady(): Promise<void> {
        const client = this.matrixClient;
        if (!client) return;
        // The ready store only fires once the client has prepared, i.e. after
        // the (possibly cached) initial sync.
        this.synced = client.getSyncState?.() === SyncState.Syncing;
        this.refresh();
    }

    protected async onNotReady(): Promise<void> {
        // Logout or account switch: forget everything about the previous account
        this.synced = false;
        this.apply(null, "inactive", false);
    }

    protected async onAction(payload: ActionPayload): Promise<void> {
        if (!this.matrixClient) return;
        if (payload.action === "MatrixActions.accountData") {
            if (payload.event_type === getPrivateVoiceSettings().accountDataType) this.refresh();
        } else if (payload.action === "MatrixActions.sync") {
            const wasSynced = this.synced;
            if (payload.state === SyncState.Syncing) this.synced = true;
            else if (payload.state === SyncState.Error || payload.state === SyncState.Reconnecting) this.synced = false;
            if (wasSynced !== this.synced) this.refresh();
        }
    }

    /**
     * Re-reads the configuration from the client's account data cache.
     */
    public refresh(): void {
        try {
            this.refreshUnsafe();
        } catch (e) {
            // The configuration must never get in the way of normal operation
            logger.warn("Could not read the configuration", e);
            this.apply(null, "inactive", false);
        }
    }

    private refreshUnsafe(): void {
        const client = this.matrixClient;
        if (!client) return;
        const settings = getPrivateVoiceSettings();
        // Defensive: the client may be a partial implementation (e.g. in tests)
        const userId = client.getUserId?.();
        const homeserver = client.getHomeserverUrl?.() ?? "";
        if (!settings.enabled || !userId || !this.isHomeserverAllowed(client, settings)) {
            this.apply(null, "inactive", false);
            return;
        }

        const key = cacheKey(homeserver, userId);
        // The event type is configurable, so it is not one of the SDK's known types
        const event = client.getAccountData?.(settings.accountDataType as keyof AccountDataEvents);
        const result = parsePrivateVoiceConfig(event?.getContent(), userId);

        switch (result.kind) {
            case "ok":
                if (result.droppedEntries > 0) {
                    logger.warn(`Ignored ${result.droppedEntries} malformed entries in the configuration`);
                }
                this.writeCache(key, event!.getContent());
                // Unconfirmed while the last sync failed
                this.apply(result.config, "active", !this.synced);
                return;
            case "absent":
                if (!event && !this.synced) {
                    // Nothing known yet and no successful sync: fall back to the
                    // last-known-good copy of this very account, marked as stale
                    const cached = this.readCache(key, userId);
                    if (cached) {
                        this.apply(cached, "active", true);
                        return;
                    }
                }
                if (this.synced) this.removeCache(key);
                this.apply(null, "absent", false);
                return;
            case "unsupported":
                logger.info(`Ignoring configuration with unsupported schema version ${String(result.schemaVersion)}`);
                this.apply(null, "unsupported", false);
                return;
            case "invalid":
                logger.warn(`Ignoring invalid configuration: ${result.reason}`);
                this.apply(null, "invalid", false);
                return;
        }
    }

    private isHomeserverAllowed(client: MatrixClient, settings: PrivateVoiceSettings): boolean {
        if (!settings.homeservers) return true;
        return settings.homeservers.includes(normaliseUrl(client.getHomeserverUrl()));
    }

    private apply(config: PrivateVoiceConfig | null, status: PrivateVoiceStatus, stale: boolean): void {
        const unchanged =
            this.currentStatus === status &&
            this.currentStale === stale &&
            // The revision identifies the content: re-applying it is a no-op
            (config?.revision ?? null) === (this.currentConfig?.revision ?? null) &&
            (config?.userId ?? null) === (this.currentConfig?.userId ?? null);
        if (unchanged) return;

        this.currentConfig = config;
        this.currentStatus = status;
        this.currentStale = stale;
        this.roomsById = new Map();
        this.spacesById = new Map();
        for (const space of config?.spaces ?? []) {
            this.spacesById.set(space.spaceId, space);
            for (const room of space.rooms) this.roomsById.set(room.roomId, room);
        }
        this.emit(UPDATE_EVENT);
    }

    private readCache(key: string, userId: string): PrivateVoiceConfig | null {
        try {
            const raw = this.storage?.getItem(key);
            if (!raw) return null;
            const result = parsePrivateVoiceConfig(JSON.parse(raw), userId);
            return result.kind === "ok" ? result.config : null;
        } catch {
            return null;
        }
    }

    private writeCache(key: string, content: unknown): void {
        try {
            this.storage?.setItem(key, JSON.stringify(content));
        } catch {
            // Not being able to cache is not a problem
        }
    }

    private removeCache(key: string): void {
        try {
            this.storage?.removeItem(key);
        } catch {
            // ignore
        }
    }
}
