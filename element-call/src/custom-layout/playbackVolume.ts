/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * Playback volumes above 100 %.
 *
 * LiveKit can only play a remote track louder than 100 % while the track is
 * played through an audio context (gain node); a plain <audio> element throws
 * for volumes above 1. Which way a track is played can change while the call
 * runs (see LivekitRoomAudioRenderer), so the volume the user asked for is
 * remembered here and applied again whenever a track switches to the audio
 * context.
 */

import { type RemoteParticipant, Track } from "livekit-client";

type AudioSource = Track.Source.Microphone | Track.Source.ScreenShareAudio;

const requested = new Map<string, number>();
const keyOf = (identity: string, source: Track.Source): string =>
  `${identity}\u0000${source}`;

/** Sets a participant's playback volume (0..MAX_PLAYBACK_VOLUME). */
export function setPlaybackVolume(
  participant: RemoteParticipant,
  volume: number,
  source: AudioSource = Track.Source.Microphone,
): void {
  requested.set(keyOf(participant.identity, source), volume);
  // Called exactly as Element Call does (the microphone is LiveKit's default)
  const apply = (v: number): void =>
    source === Track.Source.Microphone
      ? participant.setVolume(v)
      : participant.setVolume(v, source);
  try {
    apply(volume);
  } catch {
    // Played through an <audio> element right now: 100 % until the track
    // switches to the audio context
    apply(Math.min(volume, 1));
  }
}

/** The playback volume the user asked for, if any. */
export function requestedPlaybackVolume(
  identity: string,
  source: Track.Source,
): number | undefined {
  return requested.get(keyOf(identity, source));
}
