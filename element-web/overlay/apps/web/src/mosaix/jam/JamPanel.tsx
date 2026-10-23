/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useState } from "react";
import { Button } from "@vector-im/compound-web";
import { type Room, RoomStateEvent } from "matrix-js-sdk/src/matrix";

import { _t } from "../../languageHandler";
import { useMatrixClientContext } from "../../contexts/MatrixClientContext";
import { useTypedEventEmitter } from "../../hooks/useEventEmitter";
import MemberAvatar from "../../components/views/avatars/MemberAvatar";
import { usePrivateVoiceRoom } from "../private-voice/usePrivateVoiceRoom";
import { activeJams, endedJamContent, isJamUrl, type Jam, JAM_EVENT_TYPE, jamContent } from "./jam";

/** Re-renders every minute (for "running for … minutes"). */
function useMinuteClock(): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

/** The running Jams of a room, kept up to date. */
export function useActiveJams(room: Room): Jam[] {
    const [jams, setJams] = useState(() => activeJams(room));
    useEffect(() => setJams(activeJams(room)), [room]);
    const update = useCallback(() => setJams(activeJams(room)), [room]);
    useTypedEventEmitter(room, RoomStateEvent.Events, (event) => {
        if (event.getType() === JAM_EVENT_TYPE) update();
    });
    useTypedEventEmitter(room, RoomStateEvent.Members, update);
    return jams;
}

function JamCard({ room, jam, own, now }: { room: Room; jam: Jam; own: boolean; now: number }): JSX.Element {
    const client = useMatrixClientContext();
    const member = room.getMember(jam.userId);
    const minutes = Math.max(0, Math.floor((now - jam.startedTs) / 60000));
    const [busy, setBusy] = useState(false);
    const end = async (): Promise<void> => {
        setBusy(true);
        try {
            await client.sendStateEvent(room.roomId, JAM_EVENT_TYPE as any, endedJamContent(), jam.userId);
        } finally {
            setBusy(false);
        }
    };
    return (
        <li className="mx_JamPanel_card" data-testid="jam-card" data-user-id={jam.userId}>
            <MemberAvatar member={member} size="36px" />
            <div className="mx_JamPanel_cardText">
                <span className="mx_JamPanel_name">{member?.name ?? jam.userId}</span>
                {jam.title && <span className="mx_JamPanel_title">{jam.title}</span>}
                <span className="mx_JamPanel_meta">{_t("mosaix|jam|running_minutes", { count: minutes })}</span>
            </div>
            <div className="mx_JamPanel_actions">
                {own ? (
                    <Button kind="secondary" size="md" disabled={busy} onClick={() => void end()} data-testid="jam-end">
                        {_t("mosaix|jam|end")}
                    </Button>
                ) : (
                    <Button
                        as="a"
                        kind="primary"
                        size="md"
                        href={jam.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        data-testid="jam-join"
                    >
                        {_t("mosaix|jam|join")}
                    </Button>
                )}
            </div>
        </li>
    );
}

function ShareForm({ room, onDone }: { room: Room; onDone: () => void }): JSX.Element {
    const client = useMatrixClientContext();
    const [url, setUrl] = useState("");
    const [title, setTitle] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const link = url.trim();
    const valid = isJamUrl(link);

    const share = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        try {
            const userId = client.getSafeUserId();
            await client.sendStateEvent(room.roomId, JAM_EVENT_TYPE as any, jamContent(link, title), userId);
            onDone();
        } catch {
            setError(_t("mosaix|jam|share_failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="mx_JamPanel_form" onSubmit={(e) => void share(e)} data-testid="jam-share-form">
            <p className="mx_JamPanel_hint">{_t("mosaix|jam|share_hint")}</p>
            <input
                className="mx_JamPanel_input"
                type="url"
                placeholder="https://open.spotify.com/socialsession/…"
                aria-label={_t("mosaix|jam|link")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={link !== "" && !valid}
                data-testid="jam-link"
            />
            {link !== "" && !valid && <p className="mx_JamPanel_error">{_t("mosaix|jam|invalid_link")}</p>}
            <input
                className="mx_JamPanel_input"
                type="text"
                maxLength={80}
                placeholder={_t("mosaix|jam|title_placeholder")}
                aria-label={_t("mosaix|jam|title")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="jam-title"
            />
            {error && <p className="mx_JamPanel_error">{error}</p>}
            <div className="mx_JamPanel_formActions">
                <Button kind="tertiary" size="md" type="button" onClick={onDone}>
                    {_t("action|cancel")}
                </Button>
                <Button kind="primary" size="md" type="submit" disabled={!valid || busy} data-testid="jam-share-submit">
                    {_t("mosaix|jam|share")}
                </Button>
            </div>
        </form>
    );
}

/**
 * The Jams of a jam channel, shown above its timeline: who is running a
 * Spotify Jam, with a button to join it, and sharing one's own Jam.
 */
export function JamPanel({ room }: { room: Room }): JSX.Element | null {
    const client = useMatrixClientContext();
    const managed = usePrivateVoiceRoom(room.roomId);
    const jams = useActiveJams(room);
    const now = useMinuteClock();
    const [sharing, setSharing] = useState(false);
    if (managed.room?.kind !== "jam") return null;

    const ownId = client.getSafeUserId();
    const ownJam = jams.find((j) => j.userId === ownId);

    return (
        <section className="mx_JamPanel" aria-label={_t("mosaix|jam|title_panel")} data-testid="jam-panel">
            <header className="mx_JamPanel_header">
                <h2>{_t("mosaix|jam|running", { count: jams.length })}</h2>
                {!ownJam && !sharing && (
                    <Button kind="secondary" size="md" onClick={() => setSharing(true)} data-testid="jam-share">
                        {_t("mosaix|jam|share_own")}
                    </Button>
                )}
            </header>
            {sharing && !ownJam && <ShareForm room={room} onDone={() => setSharing(false)} />}
            {jams.length === 0 && !sharing && <p className="mx_JamPanel_empty">{_t("mosaix|jam|empty")}</p>}
            {jams.length > 0 && (
                <ul className="mx_JamPanel_list">
                    {jams.map((jam) => (
                        <JamCard key={jam.userId} room={room} jam={jam} own={jam.userId === ownId} now={now} />
                    ))}
                </ul>
            )}
        </section>
    );
}
