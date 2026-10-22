/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { parsePrivateVoiceConfig } from "./parser";
import { exampleConfig, OWN_USER } from "./testData";

describe("parsePrivateVoiceConfig", () => {
    it("parses a valid configuration", () => {
        const result = parsePrivateVoiceConfig(exampleConfig(), OWN_USER);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.droppedEntries).toBe(0);
        const space = result.config.spaces[0];
        expect(space.categories.map((c) => c.name)).toEqual(["Allgemein", "Gaming", "Projekte", "Archiv"]);
        expect(space.rooms).toHaveLength(7);
        expect(result.config.ui).toEqual({
            preserveUserOverrides: true,
            showCallControlsInTextRooms: false,
            allowCompanionChat: true,
        });
    });

    it("sorts categories by order, then by id", () => {
        const content = exampleConfig();
        content.spaces[0].categories = [
            { category_id: "!b", name: "B", order: 1, section_tag: "element.io.section.pvb.b" },
            { category_id: "!a", name: "A", order: 1, section_tag: "element.io.section.pvb.a" },
            { category_id: "!z", name: "Z", order: 0, section_tag: "element.io.section.pvb.z" },
        ];
        const result = parsePrivateVoiceConfig(content, OWN_USER);
        expect(result.kind === "ok" && result.config.spaces[0].categories.map((c) => c.categoryId)).toEqual([
            "!z",
            "!a",
            "!b",
        ]);
    });

    it("treats missing or emptied account data as absent", () => {
        expect(parsePrivateVoiceConfig(undefined, OWN_USER)).toEqual({ kind: "absent" });
        expect(parsePrivateVoiceConfig({}, OWN_USER)).toEqual({ kind: "absent" });
    });

    it("ignores newer schema versions", () => {
        expect(parsePrivateVoiceConfig({ ...exampleConfig(), schema_version: 2 }, OWN_USER)).toEqual({
            kind: "unsupported",
            schemaVersion: 2,
        });
    });

    it("rejects invalid documents", () => {
        expect(parsePrivateVoiceConfig("nope", OWN_USER).kind).toBe("invalid");
        expect(parsePrivateVoiceConfig({ ...exampleConfig(), schema_version: "1" }, OWN_USER).kind).toBe("invalid");
        expect(parsePrivateVoiceConfig({ ...exampleConfig(), revision: "abc" }, OWN_USER).kind).toBe("invalid");
        expect(parsePrivateVoiceConfig({ ...exampleConfig(), spaces: {} }, OWN_USER).kind).toBe("invalid");
    });

    it("requires the configuration to be for exactly this account", () => {
        const result = parsePrivateVoiceConfig(exampleConfig(), "@someone-else:example.org");
        expect(result).toEqual({ kind: "invalid", reason: "user_id does not match the account" });
    });

    it("ignores unknown additional fields", () => {
        const content: any = exampleConfig();
        content.future_field = { anything: true };
        content.spaces[0].rooms[0].future = 42;
        content.ui.future = "x";
        const result = parsePrivateVoiceConfig(content, OWN_USER);
        expect(result.kind).toBe("ok");
        expect(result.kind === "ok" && result.droppedEntries).toBe(0);
    });

    it("drops entries with wrong types but keeps the rest", () => {
        const content: any = exampleConfig();
        content.spaces[0].rooms.push({ room_id: 5, name: "bad" });
        content.spaces[0].rooms.push({ ...content.spaces[0].rooms[0], room_id: "!x", kind: "video" });
        content.spaces[0].rooms.push({ ...content.spaces[0].rooms[0], room_id: "!y", bridged_media: ["video"] });
        content.spaces[0].categories.push({
            category_id: "!c",
            name: "X",
            order: 1.5,
            section_tag: "element.io.section.pvb.x",
        });
        content.spaces[0].categories.push({
            category_id: "!d",
            name: "Y",
            order: 1,
            section_tag: "element.io.section.other",
        });
        const result = parsePrivateVoiceConfig(content, OWN_USER);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.droppedEntries).toBe(5);
        expect(result.config.spaces[0].rooms).toHaveLength(7);
        expect(result.config.spaces[0].categories).toHaveLength(4);
    });

    it("keeps exactly one entry per room and per category", () => {
        const content: any = exampleConfig();
        content.spaces[0].rooms.push({ ...content.spaces[0].rooms[0], name: "Duplicate" });
        content.spaces[0].categories.push({ ...content.spaces[0].categories[0], name: "Duplicate" });
        const result = parsePrivateVoiceConfig(content, OWN_USER);
        expect(result.kind === "ok" && result.config.spaces[0].rooms.filter((r) => r.name === "Duplicate")).toEqual([]);
        expect(result.kind === "ok" && result.config.spaces[0].categories).toHaveLength(4);
    });

    it("shows rooms with a null or unknown category ungrouped", () => {
        const content: any = exampleConfig();
        content.spaces[0].rooms[0].category_id = "!does-not-exist";
        const result = parsePrivateVoiceConfig(content, OWN_USER);
        expect(result.kind === "ok" && result.config.spaces[0].rooms[0].categoryId).toBeNull();
        expect(
            result.kind === "ok" && result.config.spaces[0].rooms.find((r) => r.roomId === "!lobby")?.categoryId,
        ).toBeNull();
    });

    it("accepts room ids without a server part", () => {
        const content: any = exampleConfig();
        content.spaces[0].rooms[0].room_id = "!opaqueRoomIdWithoutColon";
        const result = parsePrivateVoiceConfig(content, OWN_USER);
        expect(result.kind === "ok" && result.config.spaces[0].rooms[0].roomId).toBe("!opaqueRoomIdWithoutColon");
    });

    it("keeps unicode names as plain text", () => {
        const content: any = exampleConfig();
        content.spaces[0].categories[0].name = "🎮 Spiele & <b>Spaß</b> ü";
        const result = parsePrivateVoiceConfig(content, OWN_USER);
        expect(
            result.kind === "ok" &&
                result.config.spaces[0].categories.find((c) => c.categoryId === "!cat-archive")?.name,
        ).toBe("🎮 Spiele & <b>Spaß</b> ü");
    });

    it("never marks a Matrix-only room as bridged", () => {
        const content: any = exampleConfig();
        content.spaces[0].rooms[0].matrix_only = true;
        content.spaces[0].rooms[0].bridged_media = ["text"];
        const result = parsePrivateVoiceConfig(content, OWN_USER);
        expect(result.kind === "ok" && result.config.spaces[0].rooms[0].bridgedMedia).toEqual([]);
    });

    it("accepts an explicitly empty list of spaces", () => {
        const result = parsePrivateVoiceConfig({ ...exampleConfig(), spaces: [] }, OWN_USER);
        expect(result.kind === "ok" && result.config.spaces).toEqual([]);
    });
});
