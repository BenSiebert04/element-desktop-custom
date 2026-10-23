/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * Typed parser for the "Private Voice" client configuration, which a homeserver
 * publishes to the user as global account data (schema version 1).
 *
 * The configuration is a display preference only: it never grants access,
 * never changes encryption and never causes joins or invites. Everything that
 * does not match the expected types is dropped; nothing in it is ever
 * interpreted as HTML, script or URL.
 */

/** The account data event type the configuration is published under. */
export const DEFAULT_ACCOUNT_DATA_TYPE = "io.github.bensiebert04.mosaix.private_voice";

/** The only schema version this client understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Section tags of managed categories must use Element's custom section prefix. */
export const MANAGED_SECTION_TAG_PREFIX = "element.io.section.pvb.";

const MAX_NAME_LENGTH = 255;
const MAX_ID_LENGTH = 512;

/** "jam": a channel where members share their running Spotify Jams. */
export type RoomKind = "text" | "voice" | "jam";
export type BridgedMedium = "audio" | "text";

export interface PrivateVoiceCategory {
    categoryId: string;
    name: string;
    order: number;
    sectionTag: string;
}

export interface PrivateVoiceRoom {
    roomId: string;
    spaceId: string;
    name: string;
    kind: RoomKind;
    /** The category (sub-space) of the room, or null if it is not grouped. */
    categoryId: string | null;
    matrixOnly: boolean;
    bridgedMedia: BridgedMedium[];
    /** What the operator expects. The actual room state is what counts. */
    expectedEncryption: "e2ee" | "none";
}

export interface PrivateVoiceSpace {
    spaceId: string;
    name: string;
    /** Sorted by order, then by category id. */
    categories: PrivateVoiceCategory[];
    rooms: PrivateVoiceRoom[];
}

export interface PrivateVoiceUi {
    preserveUserOverrides: boolean;
    showCallControlsInTextRooms: boolean;
    allowCompanionChat: boolean;
}

export interface PrivateVoiceConfig {
    userId: string;
    revision: string;
    ui: PrivateVoiceUi;
    spaces: PrivateVoiceSpace[];
}

export type ParseResult =
    /** No configuration for this account (missing or emptied account data). */
    | { kind: "absent" }
    | { kind: "ok"; config: PrivateVoiceConfig; droppedEntries: number }
    /** A schema version this client does not know. Ignored on purpose. */
    | { kind: "unsupported"; schemaVersion: unknown }
    | { kind: "invalid"; reason: string };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Room and space ids: opaque strings starting with "!". No ":" is assumed. */
function isRoomId(value: unknown): value is string {
    return typeof value === "string" && value.length >= 2 && value.length <= MAX_ID_LENGTH && value.startsWith("!");
}

function isName(value: unknown): value is string {
    return typeof value === "string";
}

/** Names are only ever rendered as text; they are just trimmed in length. */
function cleanName(value: string): string {
    return value.length > MAX_NAME_LENGTH ? value.slice(0, MAX_NAME_LENGTH) : value;
}

function compareCategories(a: PrivateVoiceCategory, b: PrivateVoiceCategory): number {
    if (a.order !== b.order) return a.order - b.order;
    return a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0;
}

/**
 * Parses and validates the account data content.
 *
 * @param content - The content of the account data event, or undefined if there is none.
 * @param ownUserId - The Matrix ID of the logged-in account. The configuration must be for exactly this account.
 */
export function parsePrivateVoiceConfig(content: unknown, ownUserId: string): ParseResult {
    // Missing or emptied ({}) account data: this account has no managed configuration
    if (content === undefined || content === null) return { kind: "absent" };
    if (!isObject(content)) return { kind: "invalid", reason: "content is not an object" };
    if (Object.keys(content).length === 0) return { kind: "absent" };

    if (content.schema_version !== SUPPORTED_SCHEMA_VERSION) {
        return typeof content.schema_version === "number"
            ? { kind: "unsupported", schemaVersion: content.schema_version }
            : { kind: "invalid", reason: "schema_version missing or not a number" };
    }
    if (typeof content.user_id !== "string") return { kind: "invalid", reason: "user_id missing" };
    if (content.user_id !== ownUserId) return { kind: "invalid", reason: "user_id does not match the account" };
    if (typeof content.revision !== "string" || !/^[a-f0-9]{64}$/.test(content.revision)) {
        return { kind: "invalid", reason: "revision missing or malformed" };
    }
    if (!Array.isArray(content.spaces)) return { kind: "invalid", reason: "spaces is not an array" };

    const ui = isObject(content.ui) ? content.ui : {};
    const categoriesUi = isObject(ui.categories) ? ui.categories : {};
    const textUi = isObject(ui.managed_text_rooms) ? ui.managed_text_rooms : {};
    const voiceUi = isObject(ui.managed_voice_rooms) ? ui.managed_voice_rooms : {};

    let dropped = 0;
    const seenSpaces = new Set<string>();
    const seenRooms = new Set<string>();
    const spaces: PrivateVoiceSpace[] = [];

    for (const rawSpace of content.spaces) {
        if (!isObject(rawSpace) || !isRoomId(rawSpace.space_id) || !isName(rawSpace.name)) {
            dropped++;
            continue;
        }
        if (seenSpaces.has(rawSpace.space_id)) {
            dropped++;
            continue;
        }
        seenSpaces.add(rawSpace.space_id);
        const spaceId = rawSpace.space_id;

        const categories: PrivateVoiceCategory[] = [];
        const categoryIds = new Set<string>();
        const sectionTags = new Set<string>();
        for (const raw of Array.isArray(rawSpace.categories) ? rawSpace.categories : []) {
            if (
                !isObject(raw) ||
                !isRoomId(raw.category_id) ||
                !isName(raw.name) ||
                typeof raw.order !== "number" ||
                !Number.isInteger(raw.order) ||
                typeof raw.section_tag !== "string" ||
                !raw.section_tag.startsWith(MANAGED_SECTION_TAG_PREFIX) ||
                raw.section_tag.length > MAX_ID_LENGTH ||
                categoryIds.has(raw.category_id) ||
                sectionTags.has(raw.section_tag)
            ) {
                dropped++;
                continue;
            }
            categoryIds.add(raw.category_id);
            sectionTags.add(raw.section_tag);
            categories.push({
                categoryId: raw.category_id,
                name: cleanName(raw.name),
                order: raw.order,
                sectionTag: raw.section_tag,
            });
        }
        categories.sort(compareCategories);

        const rooms: PrivateVoiceRoom[] = [];
        for (const raw of Array.isArray(rawSpace.rooms) ? rawSpace.rooms : []) {
            const media: unknown[] | null =
                isObject(raw) && Array.isArray(raw.bridged_media) ? (raw.bridged_media as unknown[]) : null;
            if (
                !isObject(raw) ||
                !isRoomId(raw.room_id) ||
                !isName(raw.name) ||
                (raw.kind !== "text" && raw.kind !== "voice" && raw.kind !== "jam") ||
                !(raw.category_id === null || isRoomId(raw.category_id)) ||
                typeof raw.matrix_only !== "boolean" ||
                media === null ||
                !media.every((m: unknown) => m === "audio" || m === "text") ||
                (raw.expected_matrix_encryption !== "e2ee" && raw.expected_matrix_encryption !== "none")
            ) {
                dropped++;
                continue;
            }
            // Exactly one entry per room, even across spaces
            if (seenRooms.has(raw.room_id)) {
                dropped++;
                continue;
            }
            seenRooms.add(raw.room_id);
            const categoryId = raw.category_id as string | null;
            rooms.push({
                roomId: raw.room_id,
                spaceId,
                name: cleanName(raw.name),
                kind: raw.kind,
                // A room pointing at an unknown category is shown ungrouped
                categoryId: categoryId !== null && categoryIds.has(categoryId) ? categoryId : null,
                matrixOnly: raw.matrix_only,
                // A Matrix-only room is never shown as bridged
                bridgedMedia: raw.matrix_only ? [] : [...new Set(media as BridgedMedium[])],
                expectedEncryption: raw.expected_matrix_encryption,
            });
        }

        spaces.push({ spaceId, name: cleanName(rawSpace.name), categories, rooms });
    }

    return {
        kind: "ok",
        droppedEntries: dropped,
        config: {
            userId: content.user_id,
            revision: content.revision,
            ui: {
                preserveUserOverrides: categoriesUi.preserve_user_overrides !== false,
                showCallControlsInTextRooms: textUi.show_call_controls === true,
                allowCompanionChat: voiceUi.allow_companion_chat !== false,
            },
            spaces,
        },
    };
}
