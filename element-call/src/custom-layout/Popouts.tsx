/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import {
  type CSSProperties,
  type FC,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { type ElementInfo, type Track, TrackEvent } from "livekit-client";
import { logger } from "matrix-js-sdk/lib/logger";

import {
  type CustomLayoutViewModel,
  type CustomStream,
} from "./CustomLayoutViewModel";
import {
  type PopoutViewModel,
  popoutFeatures,
  popoutWindowName,
} from "./popout";
import { isDesktopApp, setDesktopPopoutAlwaysOnTop } from "./desktopBridge";
import { useBehavior } from "../useBehavior";
import { constant } from "../state/Behavior";

/** How long the pop-out's buttons stay visible after the mouse stopped. */
export const POPOUT_CONTROLS_IDLE_MS = 2500;

const constFalse$ = constant(false);
const constTrue$ = constant(true);

/**
 * Tells LiveKit's adaptive stream about a pop-out's video: always visible, in
 * the size of the pop-out, and like picture-in-picture, so that the video
 * keeps playing while the call window is minimised or behind a game.
 */
export function popoutElementInfo(element: HTMLVideoElement): ElementInfo {
  const view = element.ownerDocument.defaultView;
  let observer: ResizeObserver | undefined;
  const info: ElementInfo = {
    element,
    visible: true,
    pictureInPicture: true,
    visibilityChangedAt: 0,
    width: () => element.clientWidth,
    height: () => element.clientHeight,
    observe: () => {
      const Observer =
        (view as (Window & typeof globalThis) | null)?.ResizeObserver ??
        globalThis.ResizeObserver;
      if (!Observer) return;
      observer = new Observer(() => info.handleResize?.());
      observer.observe(element);
    },
    stopObserving: () => observer?.disconnect(),
  };
  return info;
}

interface AdaptiveTrack {
  isAdaptiveStream: boolean;
  observeElementInfo(info: ElementInfo): void;
  stopObservingElementInfo(info: ElementInfo): void;
}

function isAdaptive(track: Track): track is Track & AdaptiveTrack {
  return (
    "observeElementInfo" in track &&
    (track as unknown as AdaptiveTrack).isAdaptiveStream === true
  );
}

/** Plays a track in a video element of the pop-out. */
function usePopoutVideo(
  video: HTMLVideoElement | null,
  track: Track | undefined,
): void {
  useEffect(() => {
    if (!video || !track) return;
    const attach = (): void => {
      video.srcObject = new MediaStream([track.mediaStreamTrack]);
      // Autoplay of a muted video is allowed; a failure needs no handling
      Promise.resolve()
        .then(async () => video.play())
        .catch(() => {});
    };
    attach();
    // A local camera gets a new media track when the device changes
    track.on(TrackEvent.Restarted, attach);
    let info: ElementInfo | undefined;
    if (isAdaptive(track)) {
      info = popoutElementInfo(video);
      track.observeElementInfo(info);
    }
    return (): void => {
      track.off(TrackEvent.Restarted, attach);
      if (info && isAdaptive(track)) track.stopObservingElementInfo(info);
      video.srcObject = null;
    };
  }, [video, track]);
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    background: "#000",
    color: "#fff",
    font: "14px system-ui, sans-serif",
    overflow: "hidden",
    userSelect: "none",
  },
  video: {
    position: "absolute",
    inset: 0,
    inlineSize: "100%",
    blockSize: "100%",
    objectFit: "contain",
  },
  placeholder: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    opacity: 0.8,
  },
  name: {
    position: "absolute",
    insetInlineStart: 8,
    insetBlockEnd: 8,
    padding: "2px 8px",
    borderRadius: 6,
    background: "rgba(0, 0, 0, 0.6)",
    maxInlineSize: "calc(100% - 16px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  speaking: {
    position: "absolute",
    inset: 0,
    border: "3px solid #0dbd8b",
    pointerEvents: "none",
  },
  controls: {
    position: "absolute",
    insetInlineEnd: 8,
    insetBlockStart: 8,
    display: "flex",
    gap: 6,
    transition: "opacity 150ms",
  },
  button: {
    padding: "4px 10px",
    border: "1px solid rgba(255, 255, 255, 0.4)",
    borderRadius: 6,
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    font: "inherit",
    cursor: "pointer",
  },
};

interface ContentProps {
  stream: CustomStream;
  popouts: PopoutViewModel;
  doc: Document;
  desktop: boolean;
}

const PopoutContent: FC<ContentProps> = ({ stream, popouts, doc, desktop }) => {
  const { t } = useTranslation();
  const { media } = stream;
  const displayName = useBehavior(media.displayName$);
  const trackRef = useBehavior(media.video$);
  const videoEnabled = useBehavior(
    "videoEnabled$" in media ? media.videoEnabled$ : constTrue$,
  );
  const speaking = useBehavior(
    "speaking$" in media ? media.speaking$ : constFalse$,
  );
  const mirror = useBehavior(
    "mirror$" in media && media.mirror$ ? media.mirror$ : constFalse$,
  );
  const alwaysOnTop = useBehavior(popouts.alwaysOnTop$);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  usePopoutVideo(video, trackRef?.publication?.track);

  const title =
    stream.kind === "screen"
      ? t("custom_layout.popout.screen_title", { name: displayName })
      : displayName;
  useEffect(() => {
    doc.title = `${title} – Mosaix`;
  }, [doc, title]);

  // The buttons only show while the mouse moves over the pop-out
  const [active, setActive] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const view = doc.defaultView;
    const onActivity = (): void => {
      setActive(true);
      if (timer !== undefined) view?.clearTimeout(timer);
      timer = view?.setTimeout(() => setActive(false), POPOUT_CONTROLS_IDLE_MS);
    };
    const onLeave = (): void => setActive(false);
    doc.addEventListener("pointermove", onActivity);
    doc.addEventListener("pointerdown", onActivity);
    doc.addEventListener("keydown", onActivity);
    doc.documentElement.addEventListener("pointerleave", onLeave);
    return (): void => {
      if (timer !== undefined) view?.clearTimeout(timer);
      doc.removeEventListener("pointermove", onActivity);
      doc.removeEventListener("pointerdown", onActivity);
      doc.removeEventListener("keydown", onActivity);
      doc.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [doc]);

  const showVideo = trackRef?.publication?.track !== undefined && videoEnabled;

  return (
    <div
      style={styles.root}
      data-testid="popout"
      data-stream-kind={stream.kind}
    >
      <video
        ref={setVideo}
        style={{
          ...styles.video,
          display: showVideo ? "block" : "none",
          transform: mirror ? "scaleX(-1)" : undefined,
        }}
        muted
        playsInline
        autoPlay
        disablePictureInPicture
        data-testid="popout-video"
      />
      {!showVideo && <div style={styles.placeholder}>{displayName}</div>}
      {speaking && <div style={styles.speaking} />}
      <div style={styles.name}>{title}</div>
      <div
        style={{ ...styles.controls, opacity: active ? 1 : 0 }}
        data-testid="popout-controls"
        data-visible={active}
      >
        {desktop && (
          <button
            type="button"
            style={styles.button}
            aria-pressed={alwaysOnTop}
            title={t("custom_layout.popout.always_on_top_description")}
            onClick={() => popouts.setAlwaysOnTop(!alwaysOnTop)}
            data-testid="popout-always-on-top"
          >
            {alwaysOnTop ? "📌 " : ""}
            {t("custom_layout.popout.always_on_top")}
          </button>
        )}
        <button
          type="button"
          style={styles.button}
          onClick={() => popouts.close(stream.key)}
          data-testid="popout-close"
        >
          {t("custom_layout.popout.close")}
        </button>
      </div>
    </div>
  );
};

interface WindowProps {
  stream: CustomStream;
  popouts: PopoutViewModel;
  /** For tests: how a window is opened. */
  openWindow?: (name: string, features: string) => Window | null;
}

const defaultOpenWindow = (name: string, features: string): Window | null =>
  window.open("", name, features);

/**
 * The window of one pop-out. Its content lives in this document (React
 * portal), so it plays the very same tracks as the call itself.
 */
export const PopoutWindow: FC<WindowProps> = ({
  stream,
  popouts,
  openWindow = defaultOpenWindow,
}) => {
  const [doc, setDoc] = useState<Document | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const name = popoutWindowName(stream.key);
  const latest = useRef({ stream, popouts, openWindow });
  latest.current = { stream, popouts, openWindow };
  const desktop = isDesktopApp();
  const alwaysOnTop = useBehavior(popouts.alwaysOnTop$);

  useEffect(() => {
    const { stream, popouts, openWindow } = latest.current;
    const win = openWindow(name, popoutFeatures(popouts.boundsFor(stream)));
    if (!win) {
      logger.warn("[custom-layout] The pop-out window was blocked");
      popouts.close(stream.key);
      return;
    }
    const d = win.document;
    d.title = "Mosaix";
    d.documentElement.lang = document.documentElement.lang;
    d.body.style.margin = "0";
    d.body.style.background = "#000";
    const root = d.createElement("div");
    d.body.replaceChildren(root);
    setDoc(d);
    setContainer(root);

    let last = "";
    const remember = (): void => {
      if (win.closed) return;
      const bounds = {
        left: win.screenX,
        top: win.screenY,
        width: win.innerWidth,
        height: win.innerHeight,
      };
      const key = JSON.stringify(bounds);
      if (key === last || bounds.width <= 0 || bounds.height <= 0) return;
      last = key;
      latest.current.popouts.rememberBounds(latest.current.stream, bounds);
    };
    // Windows do not tell when they move: look every second
    const timer = window.setInterval(remember, 1000);
    win.addEventListener("resize", remember);
    const onClosed = (): void => {
      remember();
      latest.current.popouts.close(latest.current.stream.key);
    };
    win.addEventListener("pagehide", onClosed);
    // The call window goes away: take the pop-out with it
    const onUnload = (): void => win.close();
    window.addEventListener("pagehide", onUnload);

    return (): void => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onUnload);
      win.removeEventListener("resize", remember);
      win.removeEventListener("pagehide", onClosed);
      remember();
      if (!win.closed) win.close();
      setContainer(null);
      setDoc(null);
    };
  }, [name]);

  useEffect(() => {
    if (container) setDesktopPopoutAlwaysOnTop(name, alwaysOnTop);
  }, [container, name, alwaysOnTop]);

  if (!container || !doc) return null;
  return createPortal(
    <PopoutContent
      stream={stream}
      popouts={popouts}
      doc={doc}
      desktop={desktop}
    />,
    container,
  );
};

/** All open pop-outs of the call. */
export const Popouts: FC<{ vm: CustomLayoutViewModel }> = ({ vm }) => {
  const open = useBehavior(vm.popouts.open$);
  const streams = useBehavior(vm.streams$);
  return (
    <>
      {open.map((key) => {
        const stream = streams.find((s) => s.key === key);
        return stream ? (
          <PopoutWindow key={key} stream={stream} popouts={vm.popouts} />
        ) : null;
      })}
    </>
  );
};
