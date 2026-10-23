/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// Spotify Jams shared in a jam channel (kind "jam" in the Private Voice
// configuration). Each member has at most one entry: a state event of type
// JAM_EVENT_TYPE with the state key "jam/" + their Matrix ID (not the bare ID:
// room versions only let its owner write a state key starting with "@", and
// the server's checking service has to correct entries). The checking service
// is named explicitly by the room's policy (JAM_POLICY_EVENT_TYPE, writable
// only by the room's administration); Mosaix only shows valid, running Jams.

import { type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

export const JAM_EVENT_TYPE = "io.github.bensiebert04.mosaix.jam";
export const JAM_POLICY_EVENT_TYPE = "io.github.bensiebert04.mosaix.jam.policy";
export const JAM_STATE_KEY_PREFIX = "jam/";

const MAX_USER_ID_LENGTH = 255;

const MAX_URL_LENGTH = 512;
const MAX_TITLE_LENGTH = 80;

// Only links to a Spotify Jam, nothing else is ever shown or opened
const JAM_URL =
    /^https:\/\/(?:open\.spotify\.com\/socialsession|spotify\.link)\/[A-Za-z0-9]+(?:\?[A-Za-z0-9=&_.%-]*)?$/;

export type JamStatus = "active" | "ended";

export interface Jam {
    userId: string;
    url: string;
    /** Plain text, may be empty */
    title: string;
    startedTs: number;
    /** When the server last confirmed that the Jam is running, if ever */
    checkedTs: number | null;
}

/** A full Matrix user ID: "@" and at least one more character, no whitespace. */
function isUserId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length >= 2 &&
        value.length <= MAX_USER_ID_LENGTH &&
        // eslint-disable-next-line no-control-regex
        /^@[^\s\u0000-\u001f\u007f]+$/.test(value)
    );
}

/** The state key of a member's Jam. */
export function jamStateKey(userId: string): string {
    return JAM_STATE_KEY_PREFIX + userId;
}

/** The owner of a Jam state key, or null if it is not one. */
export function jamOwner(stateKey: string | undefined): string | null {
    if (!stateKey?.startsWith(JAM_STATE_KEY_PREFIX)) return null;
    const userId = stateKey.slice(JAM_STATE_KEY_PREFIX.length);
    return isUserId(userId) ? userId : null;
}

/** The checking service of a jam channel, as named by the room's policy, or null. */
export function jamChecker(room: Room): string | null {
    const checker = room.currentState.getStateEvents(JAM_POLICY_EVENT_TYPE, "")?.getContent().checker;
    return isUserId(checker) ? checker : null;
}

/** Whether a link is a Spotify Jam link Mosaix accepts. */
export function isJamUrl(url: unknown): url is string {
    return typeof url === "string" && url.length <= MAX_URL_LENGTH && JAM_URL.test(url);
}

/** Title as plain text: no control characters, at most 80 characters. */
export function cleanTitle(title: unknown): string {
    if (typeof title !== "string") return "";
    // eslint-disable-next-line no-control-regex
    return [...title.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()].slice(0, MAX_TITLE_LENGTH).join("");
}

/**
 * The running Jam of one state event, or null.
 *
 * @param checker - The checking service of the room, or null if there is none.
 */
export function parseJam(event: MatrixEvent, checker: string | null): Jam | null {
    if (event.getType() !== JAM_EVENT_TYPE) return null;
    const userId = jamOwner(event.getStateKey());
    if (!userId) return null;
    // Only the member themselves shares their Jam; only the checking service
    // corrects it
    const sender = event.getSender();
    const fromChecker = checker !== null && sender === checker && sender !== userId;
    if (sender !== userId && !fromChecker) return null;
    const content = event.getContent();
    if (content.status !== "active" || !isJamUrl(content.url)) return null;
    const startedTs = typeof content.started_ts === "number" ? content.started_ts : event.getTs();
    return {
        userId,
        url: content.url,
        title: cleanTitle(content.title),
        startedTs,
        // Only the checking service confirms that a Jam is running
        checkedTs: fromChecker && typeof content.checked_ts === "number" ? content.checked_ts : null,
    };
}

/** The running Jams of members of a room, newest first. */
export function activeJams(room: Room, checker = jamChecker(room)): Jam[] {
    return room.currentState
        .getStateEvents(JAM_EVENT_TYPE)
        .map((event) => parseJam(event, checker))
        .filter((jam): jam is Jam => jam !== null && room.getMember(jam.userId)?.membership === "join")
        .sort((a, b) => b.startedTs - a.startedTs);
}

/** Content for sharing a Jam. checked_ts and ended_reason are the server's. */
export function jamContent(url: string, title: string, now = Date.now()): Record<string, unknown> {
    return { url, title: cleanTitle(title), started_ts: now, status: "active" };
}

/** Content for ending one's Jam. */
export function endedJamContent(): Record<string, unknown> {
    return { status: "ended" };
}
