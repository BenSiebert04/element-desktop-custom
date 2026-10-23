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
  try {
    const bridge = (
      top as unknown as {
        electron?: { send?: (channel: string, payload: unknown) => void };
      } | null
    )?.electron;
    bridge?.send?.("ipcCall", {
      id: -1,
      name: "mosaixScreenShareStopped",
      args: [],
    });
  } catch {
    // A parent of another origin: not the desktop app
  }
}
