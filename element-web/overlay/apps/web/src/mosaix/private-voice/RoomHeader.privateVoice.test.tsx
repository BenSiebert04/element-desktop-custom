/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { PendingEventOrdering, Room, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { act, render, type RenderOptions, screen } from "test-utils-rtl";
import { stubClient } from "test-utils";

import RoomHeader from "../../components/views/rooms/RoomHeader/RoomHeader";
import DMRoomMap from "../../utils/DMRoomMap";
import { ScopedRoomContextProvider } from "../../contexts/ScopedRoomContext";
import RoomContext, { type RoomContextType } from "../../contexts/RoomContext";
import * as ShieldUtils from "../../utils/ShieldUtils";
import SettingsStore from "../../settings/SettingsStore";
import { CallStore } from "../../stores/CallStore";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { SDKContext } from "../../contexts/SDKContext";
import { SDKContextClass } from "../../contexts/SDKContextClass.ts";
import { PrivateVoiceStore } from "./PrivateVoiceStore";
import { parsePrivateVoiceConfig } from "./parser";
import { exampleConfig, OWN_USER } from "./testData";

vi.mock("../../utils/ShieldUtils");
vi.mock("../../hooks/right-panel/useCurrentPhase", () => ({
    useCurrentPhase: () => ({ currentPhase: "foo", isOpen: false }),
}));
vi.mock("../../Modal");

function useConfig(content: unknown): void {
    const result = parsePrivateVoiceConfig(content, OWN_USER);
    act(() => {
        (PrivateVoiceStore.instance as any).apply(
            result.kind === "ok" ? result.config : null,
            result.kind === "ok" ? "active" : "absent",
            false,
        );
    });
}

function mockRoomMembers(room: Room, count: number): void {
    const members = Array.from({ length: count }, (_, index) => ({
        userId: `@user-${index}:example.org`,
        name: `Member ${index}`,
        rawDisplayName: `Member ${index}`,
        roomId: room.roomId,
        membership: KnownMembership.Join,
        getAvatarUrl: () => "",
        getMxcAvatarUrl: () => "",
    }));
    room.currentState.setJoinedMemberCount(members.length);
    room.getJoinedMembers = vi.fn().mockReturnValue(members);
}

describe("RoomHeader with Private Voice", () => {
    let client: MatrixClient;
    let roomContext: RoomContextType;

    function renderHeader(roomId: string, isDm = false): Room {
        const room = new Room(roomId, client, OWN_USER, { pendingEventOrdering: PendingEventOrdering.Detached });
        DMRoomMap.setShared({
            getUserIdForRoomId: vi.fn().mockReturnValue(isDm ? "@bob:example.org" : undefined),
        } as unknown as DMRoomMap);
        mockRoomMembers(room, 2);
        const roomViewStore = {
            isViewingCall: vi.fn().mockReturnValue(false),
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn(),
        };
        roomContext = { ...RoomContext, roomId, roomViewStore } as unknown as RoomContextType;
        const options: RenderOptions = {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>
                    <MatrixClientContext.Provider value={client}>
                        <ScopedRoomContextProvider {...roomContext}>{children}</ScopedRoomContextProvider>
                    </MatrixClientContext.Provider>
                </SDKContext.Provider>
            ),
        };
        render(<RoomHeader room={room} />, options);
        return room;
    }

    beforeEach(() => {
        client = stubClient();
        vi.spyOn(ShieldUtils, "shieldStatusForRoom").mockResolvedValue(ShieldUtils.E2EStatus.Normal);
        vi.spyOn(CallStore.instance, "getCall").mockReturnValue(null);
        vi.spyOn(CallStore.instance, "getConfiguredRTCTransports").mockReturnValue([]);
        useConfig(exampleConfig());
    });

    afterEach(() => {
        useConfig(undefined);
        vi.resetAllMocks();
        SettingsStore.reset();
    });

    function callButtons(): HTMLElement[] {
        return [
            ...screen.queryAllByRole("button", { name: /call/i }),
            ...screen.queryAllByRole("button", { name: /join/i }),
            ...screen.queryAllByLabelText(/call/i, { selector: "button" }),
        ];
    }

    it("shows no call buttons at all in a managed text room, not even disabled ones", () => {
        renderHeader("!general-text");
        expect(callButtons()).toEqual([]);
    });

    it("keeps the call buttons of an unmanaged direct message", () => {
        renderHeader("!dm-with-bob", true);
        expect(screen.getByRole("button", { name: "Voice call" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Video call" })).toBeInTheDocument();
    });

    it("keeps the call buttons when there is no configuration", () => {
        useConfig(undefined);
        renderHeader("!general-text");
        expect(screen.getByRole("button", { name: "Video call" })).toBeInTheDocument();
    });

    it("shows the managed name and marks Discord bridging exactly as configured", () => {
        renderHeader("!general-voice");
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("🔊 Treffpunkt");
        const badges = screen.getByTestId("private-voice-badges");
        expect(badges).toHaveTextContent("Voice room");
        expect(badges).toHaveTextContent("Discord: audio");
        expect(badges).not.toHaveTextContent("Discord: text");
    });

    it("never marks a Matrix-only room as bridged, and does not claim encryption", () => {
        // Expected to be encrypted, but the room has no encryption state
        renderHeader("!gaming-voice");
        const badges = screen.getByTestId("private-voice-badges");
        expect(badges).toHaveTextContent("Matrix only");
        expect(badges).not.toHaveTextContent("Discord");
        expect(badges).toHaveTextContent("Not encrypted");
    });

    it("updates live when the configuration changes", () => {
        renderHeader("!general-text");
        expect(callButtons()).toEqual([]);
        useConfig({ ...exampleConfig("e".repeat(64)), spaces: [] });
        expect(screen.getByRole("button", { name: "Video call" })).toBeInTheDocument();
        expect(screen.queryByTestId("private-voice-badges")).toBeNull();
    });
});
