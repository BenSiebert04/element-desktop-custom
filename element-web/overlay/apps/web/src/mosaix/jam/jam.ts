/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// Spotify Jams shared in a jam channel (kind "jam" in the Private Voice
// configuration). Each member has at most one entry: a state event of type
// JAM_EVENT_TYPE whose state key is their Matrix ID. The server checks the
// entries and marks ended ones; Mosaix only shows valid, running Jams.

import { type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

export const JAM_EVENT_TYPE = "io.github.bensiebert04.mosaix.jam";

const MAX_URL_LENGTH = 512;
const MAX_TITLE_LENGTH = 80;

// Only links to a Spotify Jam, nothing else is ever shown or opened
const JAM_URL = /^https:\/\/(?:open\.spotify\.com\/socialsession|spotify\.link)\/[A-Za-z0-9]+(?:\?[A-Za-z0-9=&_.%-]*)?$/;

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

/** The running Jam of one state event, or null. */
export function parseJam(event: MatrixEvent): Jam | null {
    if (event.getType() !== JAM_EVENT_TYPE) return null;
    const userId = event.getStateKey();
    // Only the member themselves can share their Jam
    if (!userId || event.getSender() !== userId) return null;
    const content = event.getContent();
    if (content.status !== "active" || !isJamUrl(content.url)) return null;
    const startedTs = typeof content.started_ts === "number" ? content.started_ts : event.getTs();
    return {
        userId,
        url: content.url,
        title: cleanTitle(content.title),
        startedTs,
        checkedTs: typeof content.checked_ts === "number" ? content.checked_ts : null,
    };
}

/** The running Jams of members of a room, newest first. */
export function activeJams(room: Room): Jam[] {
    return room.currentState
        .getStateEvents(JAM_EVENT_TYPE)
        .map(parseJam)
        .filter((jam): jam is Jam => jam !== null && room.getMember(jam.userId)?.membership === "join")
        .sort((a, b) => b.startedTs - a.startedTs);
}

/** Content for sharing a Jam. */
export function jamContent(url: string, title: string, now = Date.now()): Record<string, unknown> {
    return { url, title: cleanTitle(title), started_ts: now, status: "active" };
}

/** Content for ending one's Jam. */
export function endedJamContent(): Record<string, unknown> {
    return { status: "ended" };
}
