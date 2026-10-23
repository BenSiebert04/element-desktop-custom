/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { type MatrixClient, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";
import { act, fireEvent, render, screen } from "test-utils-rtl";
import { mkEvent, mkMembership, stubClient } from "test-utils";

import MatrixClientContext from "../../contexts/MatrixClientContext";
import { PrivateVoiceStore } from "../private-voice/PrivateVoiceStore";
import { parsePrivateVoiceConfig } from "../private-voice/parser";
import { getManagedRoomName } from "../private-voice/roomList";
import { exampleConfig, OWN_USER, SPACE_ID } from "../private-voice/testData";
import { activeJams, cleanTitle, isJamUrl, JAM_EVENT_TYPE, jamContent, parseJam } from "./jam";
import { JamPanel } from "./JamPanel";

const JAM_ROOM = "!jams";
const BOB = "@bob:example.org";
const CAROL = "@carol:example.org";
const JAM_URL = "https://open.spotify.com/socialsession/AbC123";

function useConfig(withJamRoom: boolean): void {
    // A different revision for each variant (the same revision is not applied twice)
    const content = exampleConfig((withJamRoom ? "f" : "e").repeat(64));
    if (withJamRoom) {
        content.spaces[0].rooms.push({
            room_id: JAM_ROOM,
            name: "🎵 Jams",
            kind: "jam",
            category_id: null,
            matrix_only: true,
            bridged_media: [],
            expected_matrix_encryption: "none",
        });
    }
    const result = parsePrivateVoiceConfig(content, OWN_USER);
    act(() => {
        (PrivateVoiceStore.instance as any).apply(result.kind === "ok" ? result.config : null, "active", false);
    });
}

function jamEvent(sender: string, content: Record<string, unknown>, stateKey = sender) {
    return mkEvent({ event: true, type: JAM_EVENT_TYPE, room: JAM_ROOM, user: sender, skey: stateKey, content });
}

function makeRoom(client: MatrixClient): Room {
    const room = new Room(JAM_ROOM, client, OWN_USER, { pendingEventOrdering: PendingEventOrdering.Detached });
    room.currentState.setStateEvents(
        [OWN_USER, BOB, CAROL].map((u) =>
            mkMembership({ event: true, room: JAM_ROOM, user: u, mship: "join", name: u.slice(1, u.indexOf(":")) }),
        ),
    );
    return room;
}

describe("Jam data", () => {
    it("only accepts Spotify Jam links", () => {
        expect(isJamUrl(JAM_URL)).toBe(true);
        expect(isJamUrl("https://spotify.link/xYz9")).toBe(true);
        expect(isJamUrl("https://open.spotify.com/socialsession/AbC123?si=abc_1")).toBe(true);
        for (const bad of [
            "http://open.spotify.com/socialsession/AbC123",
            "https://open.spotify.com/track/AbC123",
            "https://evil.example/socialsession/AbC123",
            "https://open.spotify.com.evil.example/socialsession/AbC",
            "javascript:alert(1)",
            "https://open.spotify.com/socialsession/AbC123\"><script>",
            "https://spotify.link/" + "a".repeat(600),
            42,
        ]) {
            expect(isJamUrl(bad)).toBe(false);
        }
    });

    it("keeps titles as short plain text", () => {
        expect(cleanTitle("  Chill\u0007 Abend\n ")).toBe("Chill Abend");
        expect([...cleanTitle("🎵".repeat(100))]).toHaveLength(80);
        expect(cleanTitle(null)).toBe("");
    });

    it("ignores ended, invalid and foreign entries", () => {
        expect(parseJam(jamEvent(BOB, jamContent(JAM_URL, "x", 1000)))).toMatchObject({
            userId: BOB,
            url: JAM_URL,
            startedTs: 1000,
        });
        expect(parseJam(jamEvent(BOB, { status: "ended", url: JAM_URL }))).toBeNull();
        expect(parseJam(jamEvent(BOB, { status: "active", url: "https://example.org" }))).toBeNull();
        // Someone else's state key: not their Jam
        expect(parseJam(jamEvent(BOB, jamContent(JAM_URL, ""), CAROL))).toBeNull();
    });

    it("lists the running Jams of members, newest first", () => {
        const client = stubClient();
        const room = makeRoom(client);
        room.currentState.setStateEvents([
            jamEvent(BOB, jamContent(JAM_URL, "Bob", 1000)),
            jamEvent(CAROL, jamContent("https://spotify.link/Carol1", "Carol", 2000)),
            jamEvent("@gone:example.org", jamContent(JAM_URL, "Gone", 3000)),
        ]);
        expect(activeJams(room).map((j) => j.userId)).toEqual([CAROL, BOB]);
    });
});

describe("JamPanel", () => {
    let client: MatrixClient;

    beforeEach(() => {
        client = stubClient();
        client.sendStateEvent = vi.fn().mockResolvedValue({ event_id: "$x" });
        useConfig(true);
    });
    afterEach(() => {
        act(() => (PrivateVoiceStore.instance as any).apply(null, "absent", false));
    });

    const renderPanel = (room: Room) =>
        render(
            <MatrixClientContext.Provider value={client}>
                <JamPanel room={room} />
            </MatrixClientContext.Provider>,
        );

    it("shows nothing outside jam channels", () => {
        useConfig(false);
        renderPanel(makeRoom(client));
        expect(screen.queryByTestId("jam-panel")).toBeNull();
    });

    it("shows running Jams with a join button for the Jam link", () => {
        const room = makeRoom(client);
        room.currentState.setStateEvents([jamEvent(BOB, jamContent(JAM_URL, "Chill", Date.now() - 5 * 60000))]);
        renderPanel(room);
        expect(screen.getByRole("heading")).toHaveTextContent("1 Jam running");
        const card = screen.getByTestId("jam-card");
        expect(card).toHaveTextContent("Chill");
        expect(card).toHaveTextContent("Running for 5 minutes");
        const join = screen.getByTestId("jam-join");
        expect(join).toHaveAttribute("href", JAM_URL);
        expect(join).toHaveAttribute("target", "_blank");
        expect(join).toHaveAttribute("rel", "noreferrer noopener");
    });

    it("updates live when a Jam starts or ends", () => {
        const room = makeRoom(client);
        renderPanel(room);
        expect(screen.queryAllByTestId("jam-card")).toHaveLength(0);
        act(() => room.currentState.setStateEvents([jamEvent(CAROL, jamContent(JAM_URL, ""))]));
        expect(screen.getAllByTestId("jam-card")).toHaveLength(1);
        act(() => room.currentState.setStateEvents([jamEvent(CAROL, { status: "ended" })]));
        expect(screen.queryAllByTestId("jam-card")).toHaveLength(0);
    });

    it("shares one's own Jam, accepting only Jam links", async () => {
        renderPanel(makeRoom(client));
        fireEvent.click(screen.getByTestId("jam-share"));
        const submit = screen.getByTestId("jam-share-submit");
        fireEvent.change(screen.getByTestId("jam-link"), { target: { value: "https://example.org/x" } });
        expect(submit).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByText(/isn't a Spotify Jam link/)).toBeInTheDocument();
        // Even when submitted anyway, nothing is sent
        await act(async () => fireEvent.submit(screen.getByTestId("jam-share-form")));
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        fireEvent.change(screen.getByTestId("jam-link"), { target: { value: ` ${JAM_URL} ` } });
        fireEvent.change(screen.getByTestId("jam-title"), { target: { value: "Chill" } });
        expect(submit).not.toHaveAttribute("aria-disabled", "true");
        await act(async () => fireEvent.submit(screen.getByTestId("jam-share-form")));
        expect(client.sendStateEvent).toHaveBeenCalledWith(
            JAM_ROOM,
            JAM_EVENT_TYPE,
            expect.objectContaining({ url: JAM_URL, title: "Chill", status: "active" }),
            client.getSafeUserId(),
        );
    });

    it("lets the owner end their Jam instead of joining it", async () => {
        const room = makeRoom(client);
        const me = client.getSafeUserId();
        room.currentState.setStateEvents([
            mkMembership({ event: true, room: JAM_ROOM, user: me, mship: "join" }),
            jamEvent(me, jamContent(JAM_URL, "Mine")),
        ]);
        renderPanel(room);
        expect(screen.queryByTestId("jam-join")).toBeNull();
        expect(screen.queryByTestId("jam-share")).toBeNull();
        await act(async () => fireEvent.click(screen.getByTestId("jam-end")));
        expect(client.sendStateEvent).toHaveBeenCalledWith(JAM_ROOM, JAM_EVENT_TYPE, { status: "ended" }, me);
    });

    it("shows the number of running Jams next to the channel name", () => {
        const room = makeRoom(client);
        expect(getManagedRoomName(room)).toBe("🎵 Jams");
        room.currentState.setStateEvents([
            jamEvent(BOB, jamContent(JAM_URL, "")),
            jamEvent(CAROL, jamContent(JAM_URL, "")),
        ]);
        expect(getManagedRoomName(room)).toBe("🎵 Jams · ♪ 2 live");
        expect(PrivateVoiceStore.instance.isManagedTextRoom(JAM_ROOM)).toBe(true);
        expect(PrivateVoiceStore.instance.getSpace(SPACE_ID)?.rooms.some((r) => r.kind === "jam")).toBe(true);
    });
});
