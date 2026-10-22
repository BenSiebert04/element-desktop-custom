/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { useCallback } from "react";

import { useEventEmitterState } from "../../hooks/useEventEmitter";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import { PrivateVoiceStore } from "./PrivateVoiceStore";
import { type PrivateVoiceRoom } from "./parser";

export interface PrivateVoiceRoomState {
    /** The managed room, or null if the room is not managed. */
    room: PrivateVoiceRoom | null;
    /** Whether call start controls must be hidden in this room. */
    hideCallControls: boolean;
    /** Whether the configuration could not be confirmed by a successful sync. */
    stale: boolean;
}

/**
 * The managed state of a room, kept up to date with the configuration.
 */
export function usePrivateVoiceRoom(roomId: string | undefined): PrivateVoiceRoomState {
    const store = PrivateVoiceStore.instance;
    const read = useCallback(
        (): PrivateVoiceRoomState => ({
            room: roomId ? store.getRoom(roomId) : null,
            hideCallControls: roomId ? store.isManagedTextRoom(roomId) : false,
            stale: store.isStale,
        }),
        [roomId, store],
    );
    return useEventEmitterState(store, UPDATE_EVENT, read);
}
