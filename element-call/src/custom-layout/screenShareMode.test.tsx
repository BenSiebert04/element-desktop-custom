/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@vector-im/compound-web";
import { type LocalVideoTrack } from "livekit-client";

import {
  applyScreenShareMode,
  currentScreenShareMode,
  screenShareAudio,
  screenShareMode,
  SCREEN_SHARE_AUDIO_CAPTURE,
  withScreenShareAudio,
  withScreenShareAudioPublish,
  withScreenShareMode,
} from "./screenShareMode";
import { ScreenShareModeButton } from "./ScreenShareModeButton";

afterEach(() => {
  screenShareMode.setValue("standard");
  screenShareAudio.setValue(true);
});

const capture = { selfBrowserSurface: "include" as const };

describe("screen sharing modes", () => {
  it("leaves Element Call's options alone in the standard mode", () => {
    const publish = { videoCodec: "vp9" as const };
    expect(withScreenShareMode("standard", capture, publish)).toEqual([
      capture,
      publish,
    ]);
  });

  it("readability: full resolution first, frames drop if needed", () => {
    const [c, p] = withScreenShareMode("readability", capture, {
      videoCodec: "vp9",
    });
    // 0 x 0: not limited, the screen's own resolution
    expect(c).toMatchObject({
      selfBrowserSurface: "include",
      resolution: { width: 0, height: 0, frameRate: 30 },
      contentHint: "text",
    });
    expect(p).toMatchObject({
      videoCodec: "vp9",
      degradationPreference: "maintain-resolution",
      screenShareEncoding: { maxFramerate: 30 },
    });
  });

  it("speed: 60 fps first, resolution and quality drop if needed", () => {
    const [c, p] = withScreenShareMode("speed", capture, undefined);
    expect(c).toMatchObject({
      resolution: { width: 1920, height: 1080, frameRate: 60 },
      contentHint: "motion",
    });
    expect(p).toMatchObject({
      degradationPreference: "maintain-framerate",
      screenShareEncoding: { maxFramerate: 60 },
    });
  });

  it("treats unknown stored modes as standard", () => {
    screenShareMode.setValue("turbo" as never);
    expect(currentScreenShareMode()).toBe("standard");
  });

  it("switches a running screen share without picking the screen again", async () => {
    const params = { encodings: [{ maxBitrate: 1, maxFramerate: 1 }] };
    const mediaStreamTrack = {
      contentHint: "detail",
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    };
    const sender = {
      getParameters: vi.fn(() => params),
      setParameters: vi.fn().mockResolvedValue(undefined),
    };
    const track = {
      mediaStreamTrack,
      sender,
      setDegradationPreference: vi.fn().mockResolvedValue(undefined),
    } as unknown as LocalVideoTrack;

    await applyScreenShareMode(track, "speed");
    expect(mediaStreamTrack.contentHint).toBe("motion");
    expect(mediaStreamTrack.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    });
    expect(track.setDegradationPreference).toHaveBeenCalledWith(
      "maintain-framerate",
    );
    expect(sender.setParameters).toHaveBeenCalledWith({
      encodings: [{ maxBitrate: 6_000_000, maxFramerate: 60 }],
    });

    await applyScreenShareMode(track, "readability");
    expect(mediaStreamTrack.contentHint).toBe("text");
    // No size limit: back to the screen's own resolution
    expect(mediaStreamTrack.applyConstraints).toHaveBeenLastCalledWith({
      frameRate: { ideal: 30 },
    });
    expect(track.setDegradationPreference).toHaveBeenLastCalledWith(
      "maintain-resolution",
    );
  });

  it("changes only the full-size simulcast layer's bitrate", async () => {
    const params = {
      encodings: [
        { scaleResolutionDownBy: 3, maxBitrate: 150_000, maxFramerate: 15 },
        { scaleResolutionDownBy: 1, maxBitrate: 2_500_000, maxFramerate: 15 },
      ],
    };
    const sender = {
      getParameters: () => params,
      setParameters: vi.fn().mockResolvedValue(undefined),
    };
    const track = {
      mediaStreamTrack: {
        applyConstraints: vi.fn().mockResolvedValue(undefined),
      },
      sender,
      setDegradationPreference: vi.fn().mockResolvedValue(undefined),
    } as unknown as LocalVideoTrack;
    await applyScreenShareMode(track, "readability");
    expect(sender.setParameters).toHaveBeenCalledWith({
      encodings: [
        { scaleResolutionDownBy: 3, maxBitrate: 150_000, maxFramerate: 30 },
        { scaleResolutionDownBy: 1, maxBitrate: 8_000_000, maxFramerate: 30 },
      ],
    });
  });

  it("keeps going when the browser refuses a change", async () => {
    const track = {
      mediaStreamTrack: {
        applyConstraints: vi.fn().mockRejectedValue(new Error("no")),
      },
      sender: undefined,
      setDegradationPreference: vi.fn().mockResolvedValue(undefined),
    } as unknown as LocalVideoTrack;
    await applyScreenShareMode(track, "readability");
    expect(track.setDegradationPreference).toHaveBeenCalled();
  });
});

describe("sharing the sound", () => {
  it("asks for the sound with the screen, or explicitly not", () => {
    const audio = { autoGainControl: true };
    expect(withScreenShareAudio({ audio }, true)).toEqual({
      audio: SCREEN_SHARE_AUDIO_CAPTURE,
      systemAudio: "include",
    });
    expect(withScreenShareAudio({ audio }, false)).toEqual({
      audio: false,
      systemAudio: "exclude",
    });
  });

  it("takes the sound as it is, without voice processing, in stereo", () => {
    expect(SCREEN_SHARE_AUDIO_CAPTURE).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
      channelCount: 2,
    });
  });

  it("sends the sound as stereo music without DTX", () => {
    const publish = withScreenShareAudioPublish({ dtx: true, simulcast: true });
    expect(publish).toMatchObject({
      dtx: false,
      forceStereo: true,
      simulcast: true,
      audioPreset: { maxBitrate: 128_000 },
    });
    expect(withScreenShareAudioPublish(undefined).dtx).toBe(false);
  });

  it("is on by default and can be switched off in the menu", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <ScreenShareModeButton size="lg" enabled={false} onClick={() => {}} />
      </TooltipProvider>,
    );
    await user.click(screen.getByTestId("screen-share-mode-button"));
    const toggle = screen.getByRole("menuitemcheckbox", {
      name: "Share audio",
    });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(screenShareAudio.getValue()).toBe(false);
    // The menu stays open
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Share audio" }),
    ).not.toBeChecked();
  });
});

describe("ScreenShareModeButton", () => {
  it("shares the screen and lets the user pick the mode", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TooltipProvider>
        <ScreenShareModeButton size="lg" enabled={false} onClick={onClick} />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("switch", { name: "Share screen" }));
    expect(onClick).toHaveBeenCalled();

    await user.click(screen.getByTestId("screen-share-mode-button"));
    expect(screen.getByTestId("screen-share-mode-standard")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByTestId("screen-share-mode-speed"));
    expect(screenShareMode.getValue()).toBe("speed");

    await user.click(screen.getByTestId("screen-share-mode-button"));
    expect(screen.getByTestId("screen-share-mode-speed")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("screen-share-mode-speed")).toHaveTextContent(
      "High speed",
    );
  });
});
