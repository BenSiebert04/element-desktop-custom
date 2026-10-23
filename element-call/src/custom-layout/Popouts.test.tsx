/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { act, render, screen } from "@testing-library/react";
import { BehaviorSubject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ElementInfo } from "livekit-client";

import { constant } from "../state/Behavior";
import { testScope } from "../utils/test";
import { type CustomStream } from "./CustomLayoutViewModel";
import {
  createPopoutStorage,
  createPopoutViewModel,
  type PopoutViewModel,
  popoutWindowName,
} from "./popout";
import { popoutElementInfo, PopoutWindow } from "./Popouts";
import { type KeyValueStore } from "./layoutStorage";

class MemoryStore implements KeyValueStore {
  public readonly data = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  public removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** A pop-out window as `window.open` returns it, with a document of its own. */
function fakeWindow(): Window & { close: ReturnType<typeof vi.fn> } {
  const events = new EventTarget();
  const doc = document.implementation.createHTMLDocument("");
  const win = {
    document: doc,
    closed: false,
    screenX: 1920,
    screenY: 40,
    innerWidth: 400,
    innerHeight: 225,
    close: vi.fn(() => {
      Object.assign(win, { closed: true });
    }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  return win as unknown as Window & { close: ReturnType<typeof vi.fn> };
}

function fakeTrack(): {
  mediaStreamTrack: object;
  isAdaptiveStream: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  observeElementInfo: ReturnType<typeof vi.fn>;
  stopObservingElementInfo: ReturnType<typeof vi.fn>;
} {
  return {
    mediaStreamTrack: { kind: "video" },
    isAdaptiveStream: true,
    on: vi.fn(),
    off: vi.fn(),
    observeElementInfo: vi.fn(),
    stopObservingElementInfo: vi.fn(),
  };
}

function stream(
  track: object | undefined,
  kind: "camera" | "screen" = "camera",
): CustomStream {
  return {
    key: `@alice:example.org:DEV:0${kind === "screen" ? ":screen-share" : ""}`,
    kind,
    userId: "@alice:example.org",
    local: false,
    media: {
      displayName$: constant("Alice"),
      video$: constant(track ? { publication: { track } } : undefined),
      ...(kind === "camera"
        ? { videoEnabled$: constant(true), speaking$: constant(false) }
        : {}),
    },
  } as unknown as CustomStream;
}

describe("PopoutWindow", () => {
  let popouts: PopoutViewModel;
  let store: MemoryStore;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal(
      "MediaStream",
      class {
        public constructor(public readonly tracks: object[]) {}
      },
    );
    send = vi.fn();
    (window as unknown as { electron?: unknown }).electron = { send };
    store = new MemoryStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { electron?: unknown }).electron;
  });

  const setup = (
    s: CustomStream,
    win: Window | null,
  ): ReturnType<typeof vi.fn> => {
    popouts = createPopoutViewModel(
      testScope(),
      new BehaviorSubject([s]),
      createPopoutStorage(store),
    );
    popouts.open(s.key);
    const openWindow = vi.fn(() => win);
    render(
      <PopoutWindow stream={s} popouts={popouts} openWindow={openWindow} />,
    );
    return openWindow;
  };

  it("opens a window for the stream and plays its video there", () => {
    const track = fakeTrack();
    const s = stream(track);
    const win = fakeWindow();
    popouts = createPopoutViewModel(
      testScope(),
      new BehaviorSubject([s]),
      createPopoutStorage(store),
    );
    popouts.rememberBounds(s, { left: 1920, top: 40, width: 400, height: 225 });
    const openWindow = vi.fn(() => win);
    const { unmount } = render(
      <PopoutWindow stream={s} popouts={popouts} openWindow={openWindow} />,
    );
    expect(openWindow).toHaveBeenCalledWith(
      popoutWindowName(s.key),
      "popup=yes,width=400,height=225,left=1920,top=40",
    );
    const doc = win.document;
    expect(doc.querySelector('[data-testid="popout"]')).not.toBeNull();
    expect(doc.title).toBe("Alice – Mosaix");
    const video = doc.querySelector("video")!;
    expect((video.srcObject as unknown as { tracks: object[] }).tracks).toEqual(
      [track.mediaStreamTrack],
    );
    // LiveKit treats the pop-out like picture-in-picture: the video keeps
    // playing while the call window is minimised
    expect(track.observeElementInfo).toHaveBeenCalledTimes(1);
    const info = track.observeElementInfo.mock.calls[0][0] as ElementInfo;
    expect(info.element).toBe(video);
    expect(info.visible).toBe(true);
    expect(info.pictureInPicture).toBe(true);

    unmount();
    expect(track.stopObservingElementInfo).toHaveBeenCalledWith(info);
    expect(win.close).toHaveBeenCalled();
  });

  it("names a screen share's window after its owner", () => {
    const win = fakeWindow();
    setup(stream(fakeTrack(), "screen"), win);
    expect(win.document.title).toBe("Alice's screen – Mosaix");
  });

  it("ends the pop-out when its window is closed or blocked", () => {
    const s = stream(fakeTrack());
    const win = fakeWindow();
    setup(s, win);
    expect(popouts.open$.value).toEqual([s.key]);
    act(() => {
      Object.assign(win, { closed: true });
      win.dispatchEvent(new Event("pagehide"));
    });
    expect(popouts.open$.value).toEqual([]);

    setup(s, null);
    expect(popouts.open$.value).toEqual([]);
  });

  it("remembers where the window was", () => {
    const s = stream(fakeTrack());
    const win = fakeWindow();
    setup(s, win);
    Object.assign(win, { screenX: -1200, screenY: 300, innerWidth: 640 });
    act(() => {
      win.dispatchEvent(new Event("resize"));
    });
    expect(popouts.boundsFor(s)).toEqual({
      left: -1200,
      top: 300,
      width: 640,
      height: 225,
    });
  });

  it("closes from its own button and keeps itself on top on request", () => {
    const s = stream(fakeTrack());
    const win = fakeWindow();
    setup(s, win);
    const name = popoutWindowName(s.key);
    expect(send).toHaveBeenLastCalledWith("ipcCall", {
      id: -1,
      name: "mosaixPopoutAlwaysOnTop",
      args: [name, false],
    });
    const doc = win.document;
    act(() => {
      (
        doc.querySelector('[data-testid="popout-always-on-top"]') as HTMLElement
      ).click();
    });
    expect(popouts.alwaysOnTop$.value).toBe(true);
    expect(send).toHaveBeenLastCalledWith("ipcCall", {
      id: -1,
      name: "mosaixPopoutAlwaysOnTop",
      args: [name, true],
    });
    act(() => {
      (
        doc.querySelector('[data-testid="popout-close"]') as HTMLElement
      ).click();
    });
    expect(popouts.open$.value).toEqual([]);
  });

  it("shows the name instead of a video when the camera is off", () => {
    const win = fakeWindow();
    setup(stream(undefined), win);
    const doc = win.document;
    expect(doc.querySelector("video")!.style.display).toBe("none");
    expect(doc.body.textContent).toContain("Alice");
    // No "always on top" outside the desktop app
    expect(screen.queryByTestId("popout-always-on-top")).toBeNull();
  });
});

describe("popoutElementInfo", () => {
  it("reports the size of the pop-out's video", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "clientWidth", { value: 320 });
    Object.defineProperty(video, "clientHeight", { value: 180 });
    const info = popoutElementInfo(video);
    expect([info.width(), info.height()]).toEqual([320, 180]);
    expect(() => {
      info.observe();
      info.stopObserving();
    }).not.toThrow();
  });
});
