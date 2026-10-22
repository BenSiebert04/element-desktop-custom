/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// Synthetic test data only. No real room, space or Discord ids.

export const OWN_USER = "@alice:example.org";
export const SPACE_ID = "!space:example.org";
export const REVISION_1 = "a".repeat(64);
export const REVISION_2 = "b".repeat(64);

export function exampleConfig(revision = REVISION_1): any {
    return {
        schema_version: 1,
        user_id: OWN_USER,
        revision,
        ui: {
            categories: { presentation: "collapsible_sections", preserve_user_overrides: true },
            managed_text_rooms: { show_call_controls: false },
            managed_voice_rooms: { default_view: "call_lobby", allow_companion_chat: true },
            unmanaged_rooms: "preserve",
        },
        spaces: [
            {
                space_id: SPACE_ID,
                name: "Beispielserver",
                // Deliberately not in display order
                categories: [
                    {
                        category_id: "!cat-archive",
                        name: "Archiv",
                        order: 3,
                        section_tag: "element.io.section.pvb.archive",
                    },
                    {
                        category_id: "!cat-general",
                        name: "Allgemein",
                        order: 0,
                        section_tag: "element.io.section.pvb.general",
                    },
                    {
                        category_id: "!cat-projects",
                        name: "Projekte",
                        order: 2,
                        section_tag: "element.io.section.pvb.projects",
                    },
                    {
                        category_id: "!cat-gaming",
                        name: "Gaming",
                        order: 1,
                        section_tag: "element.io.section.pvb.gaming",
                    },
                ],
                rooms: [
                    room("!general-text", "💬 allgemein", "text", "!cat-general", false, ["text"], "none"),
                    room("!general-voice", "🔊 Treffpunkt", "voice", "!cat-general", false, ["audio"], "none"),
                    room("!gaming-text", "🎮 gaming-chat", "text", "!cat-gaming", false, ["text"], "none"),
                    room("!gaming-voice", "🔊 Zocken", "voice", "!cat-gaming", true, [], "e2ee"),
                    room("!projects-text", "📁 projekte", "text", "!cat-projects", true, [], "e2ee"),
                    room("!archive-text", "📦 alt", "text", "!cat-archive", false, ["text"], "none"),
                    room("!lobby", "👋 lobby", "text", null, false, [], "none"),
                ],
            },
        ],
    };
}

function room(
    id: string,
    name: string,
    kind: "text" | "voice",
    category: string | null,
    matrixOnly: boolean,
    media: string[],
    encryption: "e2ee" | "none",
): any {
    return {
        room_id: id,
        name,
        kind,
        category_id: category,
        matrix_only: matrixOnly,
        bridged_media: media,
        expected_matrix_encryption: encryption,
    };
}
