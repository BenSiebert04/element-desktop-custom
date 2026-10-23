/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * Tells the Mosaix desktop app that the screen share has stopped, so that it
 * ends the capture of the shared sound right away. Element Call runs in an
 * iframe of Element Web, which the desktop app gives an IPC bridge
 * (`window.electron`). Elsewhere (browser, other origin) this does nothing.
 */
export function notifyDesktopScreenShareStopped(
  top: Window | null = window.top,
): void {
  callDesktop(top, "mosaixScreenShareStopped", []);
}

type Send = (channel: string, payload: unknown) => void;

function desktopSend(top: Window | null): Send | null {
  try {
    const send = (top as unknown as { electron?: { send?: unknown } } | null)
      ?.electron?.send;
    return typeof send === "function" ? (send as Send) : null;
  } catch {
    // A parent of another origin: not the desktop app
    return null;
  }
}

function callDesktop(top: Window | null, name: string, args: unknown[]): void {
  try {
    desktopSend(top)?.call(
      (top as unknown as { electron: unknown }).electron,
      "ipcCall",
      { id: -1, name, args },
    );
  } catch {
    // Not the desktop app
  }
}

/** Whether Element Call runs in the Mosaix desktop app. */
export function isDesktopApp(top: Window | null = window.top): boolean {
  return desktopSend(top) !== null;
}

/**
 * Keeps a pop-out window (by its window name) on top of all other windows, or
 * not. Only the desktop app can do this; elsewhere it does nothing.
 */
export function setDesktopPopoutAlwaysOnTop(
  windowName: string,
  onTop: boolean,
  top: Window | null = window.top,
): void {
  callDesktop(top, "mosaixPopoutAlwaysOnTop", [windowName, onTop]);
}
