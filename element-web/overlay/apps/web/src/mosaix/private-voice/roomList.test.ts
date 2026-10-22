/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import { PrivateVoiceStore } from "./PrivateVoiceStore";
import { parsePrivateVoiceConfig } from "./parser";
import {
    getManagedRoomName,
    getManagedSectionTagsByRoom,
    getManagedSectionTitle,
    isVirtualManagedSection,
    pickSectionTag,
    withManagedSectionTags,
} from "./roomList";
import { SectionFilter } from "../../stores/room-list-v3/skip-list/filters/SectionFilter";
import DMRoomMap from "../../utils/DMRoomMap";
import { exampleConfig, OWN_USER, SPACE_ID } from "./testData";

const GENERAL = "element.io.section.pvb.general";
const GAMING = "element.io.section.pvb.gaming";
const PROJECTS = "element.io.section.pvb.projects";
const ARCHIVE = "element.io.section.pvb.archive";
const BASE_TAGS = ["im.vector.fake.invite", "m.favourite", "im.vector.fake.direct", "chats", "m.lowpriority"];

function useConfig(content: unknown): void {
    const result = parsePrivateVoiceConfig(content, OWN_USER);
    const store = PrivateVoiceStore.instance;
    (store as any).apply(
        result.kind === "ok" ? result.config : null,
        result.kind === "ok" ? "active" : "absent",
        false,
    );
}

function mkRoom(roomId: string, tags: Record<string, object> = {}, name = "Matrix name"): Room {
    return {
        roomId,
        name,
        tags,
        getMyMembership: () => "join",
    } as unknown as Room;
}

describe("Private Voice in the room list", () => {
    beforeEach(() => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({ getUserIdForRoomId: () => undefined } as any);
        useConfig(exampleConfig());
    });
    afterEach(() => {
        useConfig(undefined);
        vi.restoreAllMocks();
    });

    it("adds the four categories of the active space in order, before Chats", () => {
        expect(withManagedSectionTags(BASE_TAGS, SPACE_ID)).toEqual([
            "im.vector.fake.invite",
            "m.favourite",
            "im.vector.fake.direct",
            GENERAL,
            GAMING,
            PROJECTS,
            ARCHIVE,
            "chats",
            "m.lowpriority",
        ]);
    });

    it("does not add categories in other spaces or without configuration", () => {
        expect(withManagedSectionTags(BASE_TAGS, "!other-space")).toEqual(BASE_TAGS);
        expect(withManagedSectionTags(BASE_TAGS, undefined)).toEqual(BASE_TAGS);
        useConfig(undefined);
        expect(withManagedSectionTags(BASE_TAGS, SPACE_ID)).toEqual(BASE_TAGS);
    });

    it("does not duplicate an existing Element section with the same tag", () => {
        const withUserSection = ["m.favourite", GAMING, "chats"];
        const result = withManagedSectionTags(withUserSection, SPACE_ID);
        expect(result.filter((t) => t === GAMING)).toHaveLength(1);
        // The user's own position of the existing section is kept
        expect(result.indexOf(GAMING)).toBe(1);
        expect(isVirtualManagedSection(GAMING, { [GAMING]: {} })).toBe(false);
        expect(isVirtualManagedSection(GENERAL, { [GAMING]: {} })).toBe(true);
        expect(isVirtualManagedSection("element.io.section.mine", {})).toBe(false);
    });

    it("maps rooms with a category to its section and leaves the rest alone", () => {
        const map = getManagedSectionTagsByRoom(SPACE_ID);
        expect(map.get("!general-text")).toBe(GENERAL);
        expect(map.get("!gaming-voice")).toBe(GAMING);
        expect(map.has("!lobby")).toBe(false); // null category: ungrouped
        expect(map.has("!dm")).toBe(false);
        expect(getManagedSectionTagsByRoom("!other-space").size).toBe(0);
    });

    it("keeps personal favourites and personal sections", () => {
        const tags = withManagedSectionTags(["m.favourite", "element.io.section.mine", "chats"], SPACE_ID);
        expect(pickSectionTag(mkRoom("!general-text", { "m.favourite": {} }), tags, GENERAL)).toBe("m.favourite");
        expect(pickSectionTag(mkRoom("!general-text", { "element.io.section.mine": {} }), tags, GENERAL)).toBe(
            "element.io.section.mine",
        );
        expect(pickSectionTag(mkRoom("!general-text"), tags, GENERAL)).toBe(GENERAL);
    });

    it("follows the configuration when a room still carries an old managed tag", () => {
        const tags = withManagedSectionTags(["chats"], SPACE_ID);
        expect(pickSectionTag(mkRoom("!general-text", { [ARCHIVE]: {} }), tags, GENERAL)).toBe(GENERAL);
        // An unmanaged room keeps its tag
        expect(pickSectionTag(mkRoom("!dm", { [ARCHIVE]: {} }), tags, undefined)).toBe(ARCHIVE);
    });

    it("puts every room into exactly one section with the section filter", () => {
        const tags = withManagedSectionTags(BASE_TAGS, SPACE_ID);
        const filter = new SectionFilter(tags, getManagedSectionTagsByRoom(SPACE_ID));
        expect(filter.keyFor(mkRoom("!general-text"))).toBe(GENERAL);
        expect(filter.keyFor(mkRoom("!gaming-voice"))).toBe(GAMING);
        expect(filter.keyFor(mkRoom("!lobby"))).toBe("chats");
        expect(filter.keyFor(mkRoom("!unmanaged"))).toBe("chats");
        expect(filter.keyFor(mkRoom("!projects-text", { "m.favourite": {} }))).toBe("m.favourite");
        // Without managed data the filter behaves exactly as before
        expect(new SectionFilter(BASE_TAGS).keyFor(mkRoom("!general-text"))).toBe("chats");
    });

    it("takes category names from the configuration, unless the user renamed the section", () => {
        expect(getManagedSectionTitle(GAMING, undefined)).toBe("Gaming");
        expect(getManagedSectionTitle(GAMING, "Meine Spiele")).toBe("Meine Spiele");
        // Different content always comes with a different revision
        const content = exampleConfig("d".repeat(64));
        content.ui.categories.preserve_user_overrides = false;
        useConfig(content);
        expect(getManagedSectionTitle(GAMING, "Meine Spiele")).toBe("Gaming");
        expect(getManagedSectionTitle("element.io.section.mine", "Mine")).toBe("Mine");
    });

    it("takes room names from the configuration as plain text", () => {
        expect(getManagedRoomName(mkRoom("!gaming-voice"))).toBe("🔊 Zocken");
        expect(getManagedRoomName(mkRoom("!dm", {}, "Bob"))).toBe("Bob");
    });

    it("drops the managed presentation when a room is removed from the configuration", () => {
        const content = exampleConfig("c".repeat(64));
        content.spaces[0].rooms = content.spaces[0].rooms.filter((r: any) => r.room_id !== "!gaming-voice");
        useConfig(content);
        const filter = new SectionFilter(
            withManagedSectionTags(BASE_TAGS, SPACE_ID),
            getManagedSectionTagsByRoom(SPACE_ID),
        );
        expect(filter.keyFor(mkRoom("!gaming-voice"))).toBe("chats");
        expect(getManagedRoomName(mkRoom("!gaming-voice"))).toBe("Matrix name");
    });
});
