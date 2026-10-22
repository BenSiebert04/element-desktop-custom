/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * Glue between the Private Voice configuration and Element's room list.
 *
 * Managed categories are shown as additional, collapsible room list sections
 * in their space. They are virtual: nothing is written to the account (no
 * section data, no room tags). If the user already has an Element section
 * with the same tag (e.g. created by the server's section setup for stock
 * Element clients), that section is used instead of adding a duplicate.
 */

import { type Room } from "matrix-js-sdk/src/matrix";

import { MANAGED_SECTION_TAG_PREFIX } from "./parser";
import { PrivateVoiceStore } from "./PrivateVoiceStore";

/** The tag of the "Chats"/"Rooms" section, see room-list-v3/section.ts. */
const CHATS_TAG = "chats";

/** Whether the tag is one of the server-managed category sections. */
export function isManagedSectionTag(tag: string): boolean {
    return tag.startsWith(MANAGED_SECTION_TAG_PREFIX);
}

/**
 * Adds the managed category sections of the active space to the ordered
 * section tags: in category order, right before the Chats section. Sections
 * that already exist (user's own Element sections with the same tag) keep the
 * position the user gave them.
 *
 * @param tags - The ordered section tags.
 * @param spaceId - The active space.
 */
export function withManagedSectionTags(tags: string[], spaceId: string | undefined): string[] {
    if (!spaceId) return tags;
    const missing = PrivateVoiceStore.instance
        .getCategories(spaceId)
        .map((c) => c.sectionTag)
        .filter((tag) => !tags.includes(tag));
    if (missing.length === 0) return tags;
    const result = [...tags];
    const chatsIndex = result.indexOf(CHATS_TAG);
    result.splice(chatsIndex === -1 ? result.length : chatsIndex, 0, ...missing);
    return result;
}

/**
 * The section tag of every managed room of the active space, for the section filter.
 */
export function getManagedSectionTagsByRoom(spaceId: string | undefined): Map<string, string> {
    return spaceId ? PrivateVoiceStore.instance.getSectionTagsByRoom(spaceId) : new Map();
}

/**
 * Picks the section of a room. Personal choices (favourites, low priority and
 * the user's own sections) always win. A managed room otherwise goes to the
 * section of its category, even if it still carries the tag of another
 * managed section.
 *
 * @param room - The room.
 * @param sectionTags - The section tags in display order.
 * @param managedTag - The section tag of the room's managed category, if any.
 * @returns The tag the room is tagged with that decides its section, or the managed tag, or undefined.
 */
export function pickSectionTag(room: Room, sectionTags: string[], managedTag: string | undefined): string | undefined {
    const userTag = sectionTags.find((tag) => room.tags[tag] && !(managedTag && isManagedSectionTag(tag)));
    if (userTag) return userTag;
    if (managedTag && sectionTags.includes(managedTag)) return managedTag;
    return undefined;
}

/**
 * Whether the section only exists because of the managed configuration, i.e.
 * the user has no Element section with this tag.
 */
export function isVirtualManagedSection(tag: string, customSectionData: Record<string, unknown>): boolean {
    return (
        isManagedSectionTag(tag) &&
        !(tag in customSectionData) &&
        PrivateVoiceStore.instance.getCategoryName(tag) !== undefined
    );
}

/**
 * The title of a section header: the managed category name, unless the user
 * renamed an existing Element section with this tag and the configuration
 * asks to preserve user overrides.
 */
export function getManagedSectionTitle(tag: string, customName: string | undefined): string | undefined {
    if (!isManagedSectionTag(tag)) return customName;
    const managedName = PrivateVoiceStore.instance.getCategoryName(tag);
    if (managedName === undefined) return customName;
    const preserve = PrivateVoiceStore.instance.config?.ui.preserveUserOverrides ?? true;
    return preserve && customName ? customName : managedName;
}

/** The name to show for a room in the room list. */
export function getManagedRoomName(room: Room): string {
    return PrivateVoiceStore.instance.getRoom(room.roomId)?.name || room.name;
}
