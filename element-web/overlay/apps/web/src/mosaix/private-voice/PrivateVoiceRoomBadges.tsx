/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { Badge, Tooltip } from "@vector-im/compound-web";

import { _t } from "../../languageHandler";
import { type PrivateVoiceRoomState } from "./usePrivateVoiceRoom";

interface Props {
    state: PrivateVoiceRoomState;
    /** Whether the room is actually encrypted, from its room state. */
    isEncrypted: boolean;
}

/**
 * Small labels in the room header of a managed room: voice room, Discord
 * bridging (exactly as configured: audio is not video, text is shared text)
 * and whether the configuration is out of date.
 *
 * Deliberately no lock icon: encryption is shown by Element from the room
 * state. The configured expectation is only used to point out a mismatch.
 */
export function PrivateVoiceRoomBadges({ state, isEncrypted }: Props): JSX.Element | null {
    const room = state.room;
    if (!room) return null;

    const badges: JSX.Element[] = [];
    if (room.kind === "voice") {
        badges.push(
            <Badge key="voice" kind="grey">
                {_t("mosaix|private_voice|voice_room")}
            </Badge>,
        );
    }
    if (room.matrixOnly) {
        badges.push(
            <Tooltip key="matrix-only" label={_t("mosaix|private_voice|matrix_only_tooltip")}>
                <Badge kind="grey">{_t("mosaix|private_voice|matrix_only")}</Badge>
            </Tooltip>,
        );
    } else {
        for (const medium of room.bridgedMedia) {
            badges.push(
                <Tooltip
                    key={medium}
                    label={
                        medium === "audio"
                            ? _t("mosaix|private_voice|bridged_audio_tooltip")
                            : _t("mosaix|private_voice|bridged_text_tooltip")
                    }
                >
                    <Badge kind="blue">
                        {medium === "audio"
                            ? _t("mosaix|private_voice|bridged_audio")
                            : _t("mosaix|private_voice|bridged_text")}
                    </Badge>
                </Tooltip>,
            );
        }
    }
    if (room.expectedEncryption === "e2ee" && !isEncrypted) {
        badges.push(
            <Tooltip key="encryption" label={_t("mosaix|private_voice|not_encrypted_tooltip")}>
                <Badge kind="red">{_t("mosaix|private_voice|not_encrypted")}</Badge>
            </Tooltip>,
        );
    }
    if (state.stale) {
        badges.push(
            <Tooltip key="stale" label={_t("mosaix|private_voice|stale_tooltip")}>
                <Badge kind="grey">{_t("mosaix|private_voice|stale")}</Badge>
            </Tooltip>,
        );
    }

    return (
        <span className="mx_RoomHeader_privateVoice" data-testid="private-voice-badges">
            {badges}
        </span>
    );
}
