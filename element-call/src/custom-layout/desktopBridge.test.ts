/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { notifyDesktopScreenShareStopped } from "./desktopBridge";

describe("notifyDesktopScreenShareStopped", () => {
  it("tells the desktop app through Element Web's IPC bridge", () => {
    const send = vi.fn();
    notifyDesktopScreenShareStopped({
      electron: { send },
    } as unknown as Window);
    expect(send).toHaveBeenCalledWith("ipcCall", {
      id: -1,
      name: "mosaixScreenShareStopped",
      args: [],
    });
  });

  it("does nothing outside the desktop app", () => {
    expect(() => notifyDesktopScreenShareStopped({} as Window)).not.toThrow();
    expect(() => notifyDesktopScreenShareStopped(null)).not.toThrow();
    const crossOrigin = new Proxy(
      {},
      {
        get: () => {
          throw new DOMException("Blocked", "SecurityError");
        },
      },
    ) as Window;
    expect(() => notifyDesktopScreenShareStopped(crossOrigin)).not.toThrow();
  });
});
