/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixEvent, SyncState, type MatrixClient } from "matrix-js-sdk/src/matrix";

import { MatrixDispatcher } from "../../dispatcher/dispatcher";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import SdkConfig from "../../SdkConfig";
import { cacheKey, type CacheStorage, PrivateVoiceStore } from "./PrivateVoiceStore";
import { DEFAULT_ACCOUNT_DATA_TYPE } from "./parser";
import { exampleConfig, OWN_USER, REVISION_1, REVISION_2, SPACE_ID } from "./testData";

const HS = "https://matrix.example.org";

class MemoryStorage implements CacheStorage {
    public data = new Map<string, string>();
    public getItem = (k: string): string | null => this.data.get(k) ?? null;
    public setItem = (k: string, v: string): void => void this.data.set(k, v);
    public removeItem = (k: string): void => void this.data.delete(k);
}

interface FakeClient {
    client: MatrixClient;
    accountData: Map<string, MatrixEvent>;
    setSyncState(state: SyncState): void;
}

function fakeClient(userId = OWN_USER, homeserver = HS): FakeClient {
    const accountData = new Map<string, MatrixEvent>();
    let syncState = SyncState.Syncing;
    const client = {
        getUserId: () => userId,
        getSafeUserId: () => userId,
        getHomeserverUrl: () => homeserver,
        getSyncState: () => syncState,
        getAccountData: (type: string) => accountData.get(type),
    } as unknown as MatrixClient;
    return { client, accountData, setSyncState: (s) => (syncState = s) };
}

function setAccountData(fake: FakeClient, content: unknown, type = DEFAULT_ACCOUNT_DATA_TYPE): void {
    fake.accountData.set(type, new MatrixEvent({ type, content: content as Record<string, unknown> }));
}

async function readyStore(fake: FakeClient, storage = new MemoryStorage()) {
    const dispatcher = new MatrixDispatcher();
    const store = new PrivateVoiceStore(dispatcher, storage);
    const updates = vi.fn();
    store.on(UPDATE_EVENT, updates);
    (store as any).readyStore.useUnitTestClient(fake.client);
    await (store as any).onReady();
    return { store, dispatcher, storage, updates };
}

async function dispatch(store: PrivateVoiceStore, payload: Record<string, unknown>): Promise<void> {
    await (store as any).onAction(payload);
}

describe("PrivateVoiceStore", () => {
    beforeEach(() => SdkConfig.reset());
    afterEach(() => SdkConfig.reset());

    it("reads the configuration after the initial sync", async () => {
        const fake = fakeClient();
        setAccountData(fake, exampleConfig());
        const { store } = await readyStore(fake);
        expect(store.status).toBe("active");
        expect(store.isStale).toBe(false);
        expect(store.getCategories(SPACE_ID).map((c) => c.name)).toEqual(["Allgemein", "Gaming", "Projekte", "Archiv"]);
        expect(store.isManagedTextRoom("!general-text")).toBe(true);
        expect(store.isManagedVoiceRoom("!general-voice")).toBe(true);
        expect(store.getSectionTagForRoom("!gaming-voice", SPACE_ID)).toBe("element.io.section.pvb.gaming");
        expect(store.getSectionTagForRoom("!lobby", SPACE_ID)).toBeUndefined();
        expect(store.getSectionTagForRoom("!gaming-voice", "!other-space")).toBeUndefined();
    });

    it("is inactive without a configuration and never touches unmanaged rooms", async () => {
        const { store } = await readyStore(fakeClient());
        expect(store.status).toBe("absent");
        expect(store.getRoom("!dm")).toBeNull();
        expect(store.isManagedTextRoom("!dm")).toBe(false);
    });

    it("applies live changes without a restart", async () => {
        const fake = fakeClient();
        setAccountData(fake, exampleConfig());
        const { store, updates } = await readyStore(fake);
        updates.mockClear();

        const changed = exampleConfig(REVISION_2);
        changed.spaces[0].rooms = changed.spaces[0].rooms.filter((r: any) => r.room_id !== "!archive-text");
        setAccountData(fake, changed);
        await dispatch(store, { action: "MatrixActions.accountData", event_type: DEFAULT_ACCOUNT_DATA_TYPE });

        expect(updates).toHaveBeenCalledTimes(1);
        expect(store.config?.revision).toBe(REVISION_2);
        // A removed room loses only its managed presentation
        expect(store.getRoom("!archive-text")).toBeNull();
    });

    it("does nothing for an unchanged revision", async () => {
        const fake = fakeClient();
        setAccountData(fake, exampleConfig());
        const { store, updates } = await readyStore(fake);
        updates.mockClear();
        setAccountData(fake, exampleConfig(REVISION_1));
        await dispatch(store, { action: "MatrixActions.accountData", event_type: DEFAULT_ACCOUNT_DATA_TYPE });
        expect(updates).not.toHaveBeenCalled();
    });

    it("ignores other account data", async () => {
        const fake = fakeClient();
        const { store, updates } = await readyStore(fake);
        updates.mockClear();
        await dispatch(store, { action: "MatrixActions.accountData", event_type: "m.direct" });
        expect(updates).not.toHaveBeenCalled();
    });

    it("ignores newer schema versions and invalid data, keeping the UI usable", async () => {
        const fake = fakeClient();
        setAccountData(fake, { ...exampleConfig(), schema_version: 2 });
        const { store } = await readyStore(fake);
        expect(store.status).toBe("unsupported");
        expect(store.config).toBeNull();

        setAccountData(fake, { ...exampleConfig(), user_id: "@mallory:example.org" });
        await dispatch(store, { action: "MatrixActions.accountData", event_type: DEFAULT_ACCOUNT_DATA_TYPE });
        expect(store.status).toBe("invalid");
        expect(store.getRoom("!general-text")).toBeNull();
    });

    it("drops the configuration when it is emptied or has no spaces", async () => {
        const fake = fakeClient();
        setAccountData(fake, exampleConfig());
        const { store, storage } = await readyStore(fake);

        setAccountData(fake, { ...exampleConfig(REVISION_2), spaces: [] });
        await dispatch(store, { action: "MatrixActions.accountData", event_type: DEFAULT_ACCOUNT_DATA_TYPE });
        expect(store.getCategories(SPACE_ID)).toEqual([]);
        expect(store.getRoom("!general-text")).toBeNull();

        setAccountData(fake, {});
        await dispatch(store, { action: "MatrixActions.accountData", event_type: DEFAULT_ACCOUNT_DATA_TYPE });
        expect(store.status).toBe("absent");
        expect(storage.data.size).toBe(0);
    });

    it("forgets everything on logout and does not carry it over to another account", async () => {
        const storage = new MemoryStorage();
        const alice = fakeClient();
        setAccountData(alice, exampleConfig());
        const { store } = await readyStore(alice, storage);
        expect(store.config).not.toBeNull();

        await (store as any).onNotReady();
        expect(store.config).toBeNull();
        expect(store.status).toBe("inactive");

        // Bob logs in on the same device, offline: Alice's cached copy is not used
        const bob = fakeClient("@bob:example.org");
        bob.setSyncState(SyncState.Error);
        (store as any).readyStore.useUnitTestClient(bob.client);
        await (store as any).onReady();
        expect(store.config).toBeNull();

        // Alice's data would not even parse for Bob
        const wrong = exampleConfig();
        setAccountData(bob, wrong);
        store.refresh();
        expect(store.status).toBe("invalid");
    });

    it("keeps caches separate per homeserver and account", () => {
        expect(cacheKey(HS, OWN_USER)).not.toBe(cacheKey("https://other.example.org", OWN_USER));
        expect(cacheKey(HS, OWN_USER)).not.toBe(cacheKey(HS, "@bob:example.org"));
        expect(cacheKey(HS + "/", OWN_USER)).toBe(cacheKey(HS, OWN_USER));
    });

    it("uses the last-known-good copy while offline and marks it as stale", async () => {
        const storage = new MemoryStorage();
        const online = fakeClient();
        setAccountData(online, exampleConfig());
        await readyStore(online, storage);
        expect(storage.data.size).toBe(1);

        // Next start: offline, the SDK has no account data
        const offline = fakeClient();
        offline.setSyncState(SyncState.Error);
        const { store } = await readyStore(offline, storage);
        expect(store.status).toBe("active");
        expect(store.isStale).toBe(true);
        expect(store.getCategories(SPACE_ID)).toHaveLength(4);

        // The first successful sync is authoritative: no configuration any more
        offline.setSyncState(SyncState.Syncing);
        await dispatch(store, { action: "MatrixActions.sync", state: SyncState.Syncing, prevState: SyncState.Error });
        expect(store.status).toBe("absent");
        expect(store.isStale).toBe(false);
        expect(storage.data.size).toBe(0);
    });

    it("marks the configuration as stale while the sync is failing", async () => {
        const fake = fakeClient();
        setAccountData(fake, exampleConfig());
        const { store } = await readyStore(fake);
        await dispatch(store, { action: "MatrixActions.sync", state: SyncState.Error, prevState: SyncState.Syncing });
        expect(store.isStale).toBe(true);
        expect(store.config).not.toBeNull();
        await dispatch(store, { action: "MatrixActions.sync", state: SyncState.Syncing, prevState: SyncState.Error });
        expect(store.isStale).toBe(false);
    });

    it("can be restricted to certain homeservers and use another event type", async () => {
        SdkConfig.put({
            mosaix_private_voice: { homeservers: ["https://other.example.org"] },
        } as any);
        const fake = fakeClient();
        setAccountData(fake, exampleConfig());
        const { store } = await readyStore(fake);
        expect(store.status).toBe("inactive");

        SdkConfig.put({
            mosaix_private_voice: { homeservers: [HS + "/"], account_data_type: "org.example.custom" },
        } as any);
        setAccountData(fake, exampleConfig(), "org.example.custom");
        store.refresh();
        expect(store.status).toBe("active");
    });

    it("can be disabled in config.json", async () => {
        SdkConfig.put({ mosaix_private_voice: { enabled: false } } as any);
        const fake = fakeClient();
        setAccountData(fake, exampleConfig());
        const { store } = await readyStore(fake);
        expect(store.status).toBe("inactive");
    });
});
