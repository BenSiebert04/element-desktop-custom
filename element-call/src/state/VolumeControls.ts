/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { combineLatest, map, merge, of, Subject, switchMap } from "rxjs";

import { type Behavior } from "./Behavior";
import { type ObservableScope } from "./ObservableScope";
import { accumulate } from "../utils/observable";

/**
 * Controls for audio playback volume.
 */
export interface VolumeControls {
  /**
   * The volume to which the audio is set, as a scalar multiplier.
   */
  playbackVolume$: Behavior<number>;
  /**
   * Whether playback of this audio is disabled.
   */
  playbackMuted$: Behavior<boolean>;
  togglePlaybackMuted: () => void;
  adjustPlaybackVolume: (value: number) => void;
  commitPlaybackVolume: () => void;
}

interface VolumeControlsInputs {
  pretendToBeDisconnected$: Behavior<boolean>;
  /**
   * The callback to run to notify the module performing audio playback of the
   * requested volume.
   */
  sink$: Behavior<(volume: number) => void>;
  /**
   * [element-custom] The volume to start with (e.g. remembered from an
   * earlier call). Defaults to 1.
   */
  initialVolume?: number;
  /**
   * [element-custom] Called with the new volume whenever the user commits a
   * change (end of a slider drag, mute toggle), e.g. to remember it.
   */
  onVolumeCommitted?: (volume: number) => void;
}

/**
 * Creates a set of controls for audio playback volume and syncs this with the
 * audio playback module for the duration of the scope.
 */
export function createVolumeControls(
  scope: ObservableScope,
  {
    pretendToBeDisconnected$,
    sink$,
    initialVolume = 1,
    onVolumeCommitted,
  }: VolumeControlsInputs,
): VolumeControls {
  // [element-custom] Unmuting a person stored as muted goes back to 100 %
  const initialState = {
    volume: initialVolume,
    committedVolume: initialVolume === 0 ? 1 : initialVolume,
  };
  const toggleMuted$ = new Subject<"toggle mute">();
  const adjustVolume$ = new Subject<number>();
  const commitVolume$ = new Subject<"commit">();

  const playbackVolume$ = scope.behavior<number>(
    merge(toggleMuted$, adjustVolume$, commitVolume$).pipe(
      accumulate(initialState, (state, event) => {
        switch (event) {
          case "toggle mute":
            return {
              ...state,
              volume: state.volume === 0 ? state.committedVolume : 0,
            };
          case "commit":
            // Dragging the slider to zero should have the same effect as
            // muting: keep the original committed volume, as if it were never
            // dragged
            return {
              ...state,
              committedVolume:
                state.volume === 0 ? state.committedVolume : state.volume,
            };
          default:
            // Volume adjustment
            return { ...state, volume: event };
        }
      }),
      map(({ volume }) => volume),
    ),
  );

  // Sync the requested volume with the audio playback module
  combineLatest([
    sink$,
    // The playback volume, taking into account whether we're supposed to
    // pretend that the audio stream is disconnected (since we don't necessarily
    // want that to modify the UI state).
    pretendToBeDisconnected$.pipe(
      switchMap((disconnected) => (disconnected ? of(0) : playbackVolume$)),
    ),
  ])
    .pipe(scope.bind())
    .subscribe(([sink, volume]) => sink(volume));

  // [element-custom] Report committed changes (after the state has updated)
  if (onVolumeCommitted)
    merge(toggleMuted$, commitVolume$)
      .pipe(scope.bind())
      .subscribe(() => onVolumeCommitted(playbackVolume$.value));

  return {
    playbackVolume$,
    playbackMuted$: scope.behavior<boolean>(
      playbackVolume$.pipe(map((volume) => volume === 0)),
    ),
    togglePlaybackMuted: () => toggleMuted$.next("toggle mute"),
    adjustPlaybackVolume: (value: number) => adjustVolume$.next(value),
    commitPlaybackVolume: () => commitVolume$.next("commit"),
  };
}
