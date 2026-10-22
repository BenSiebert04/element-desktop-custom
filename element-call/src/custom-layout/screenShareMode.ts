/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * Modes for sharing the screen:
 *
 *  - `standard`: Element Call's / LiveKit's defaults (1080p, 15 fps).
 *  - `readability`: The screen's full resolution comes first. If the
 *    connection or the encoder can't keep up, frames are dropped, the picture
 *    stays sharp (text, code, documents).
 *  - `speed`: The frame rate comes first (up to 60 fps). If the connection or
 *    the encoder can't keep up, resolution and quality are lowered so that the
 *    motion stays smooth (games, videos).
 */

import {
  type LocalVideoTrack,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
} from "livekit-client";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";

import { Setting } from "../settings/settings";

export type ScreenShareMode = "standard" | "readability" | "speed";

export const SCREEN_SHARE_MODES: readonly ScreenShareMode[] = [
  "standard",
  "readability",
  "speed",
];

export const screenShareMode = new Setting<ScreenShareMode>(
  "element-custom-screen-share-mode",
  "standard",
);

/** The mode to use, falling back to `standard` for unknown stored values. */
export function currentScreenShareMode(): ScreenShareMode {
  const mode = screenShareMode.getValue();
  return SCREEN_SHARE_MODES.includes(mode) ? mode : "standard";
}

interface ModeSettings {
  /** Capture resolution; 0 x 0 means the screen's own resolution. */
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  contentHint: "detail" | "text" | "motion";
  degradationPreference: RTCDegradationPreference;
}

const MODES: Record<ScreenShareMode, ModeSettings> = {
  // LiveKit's defaults for screen sharing
  standard: {
    width: 1920,
    height: 1080,
    frameRate: 15,
    maxBitrate: 2_500_000,
    contentHint: "detail",
    degradationPreference: "maintain-resolution",
  },
  readability: {
    width: 0,
    height: 0,
    frameRate: 30,
    maxBitrate: 8_000_000,
    contentHint: "text",
    degradationPreference: "maintain-resolution",
  },
  speed: {
    width: 1920,
    height: 1080,
    frameRate: 60,
    maxBitrate: 6_000_000,
    contentHint: "motion",
    degradationPreference: "maintain-framerate",
  },
};

export function screenShareModeSettings(mode: ScreenShareMode): ModeSettings {
  return MODES[mode];
}

/**
 * Applies a mode to the options for starting a screen share. `standard`
 * leaves them as they are.
 */
export function withScreenShareMode(
  mode: ScreenShareMode,
  capture: ScreenShareCaptureOptions,
  publish: TrackPublishOptions | undefined,
): [ScreenShareCaptureOptions, TrackPublishOptions | undefined] {
  if (mode === "standard") return [capture, publish];
  const m = MODES[mode];
  return [
    {
      ...capture,
      resolution: { width: m.width, height: m.height, frameRate: m.frameRate },
      contentHint: m.contentHint,
    },
    {
      ...publish,
      screenShareEncoding: {
        maxBitrate: m.maxBitrate,
        maxFramerate: m.frameRate,
      },
      degradationPreference: m.degradationPreference,
    },
  ];
}

/** The capture constraints of a mode, for a screen share already running. */
export function screenShareModeConstraints(
  mode: ScreenShareMode,
): MediaTrackConstraints {
  const m = MODES[mode];
  return m.width > 0
    ? {
        width: { ideal: m.width },
        height: { ideal: m.height },
        frameRate: { ideal: m.frameRate },
      }
    : // The screen's own resolution
      { frameRate: { ideal: m.frameRate } };
}

/**
 * Switches a running screen share to another mode, without asking the user
 * to pick the screen again.
 */
export async function applyScreenShareMode(
  track: LocalVideoTrack,
  mode: ScreenShareMode,
): Promise<void> {
  const logger = rootLogger.getChild("[ScreenShareMode]");
  const m = MODES[mode];
  const mediaTrack = track.mediaStreamTrack;
  mediaTrack.contentHint = m.contentHint;
  try {
    await mediaTrack.applyConstraints(screenShareModeConstraints(mode));
  } catch (e) {
    logger.warn("Could not change the capture of the screen share", e);
  }
  const sender = track.sender;
  try {
    await track.setDegradationPreference(m.degradationPreference);
    if (!sender) return;
    const params = sender.getParameters();
    const encodings = params.encodings ?? [];
    // Simulcast: only the full-size layer gets the mode's bitrate, smaller
    // layers keep theirs
    const top = encodings.reduce<RTCRtpEncodingParameters | undefined>(
      (best, e) =>
        best === undefined ||
        (e.scaleResolutionDownBy ?? 1) < (best.scaleResolutionDownBy ?? 1)
          ? e
          : best,
      undefined,
    );
    for (const encoding of encodings) encoding.maxFramerate = m.frameRate;
    if (top) top.maxBitrate = m.maxBitrate;
    await sender.setParameters(params);
  } catch (e) {
    logger.warn("Could not change the encoding of the screen share", e);
  }
}
