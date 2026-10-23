// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// A separate application (own process) with a window that plays a sine tone.
// Usage: electron tone.cjs <frequency>

"use strict";

const { app, BrowserWindow } = require("electron");

const frequency = Number(process.argv.at(-1));
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(async () => {
    const title = `Mosaix Tone ${frequency}`;
    const win = new BrowserWindow({ width: 320, height: 200, title, webPreferences: { backgroundThrottling: false } });
    await win.loadURL(`data:text/html,<title>${encodeURIComponent(title)}</title><h1>${frequency} Hz</h1>`);
    await win.webContents.executeJavaScript(`
        const c = new AudioContext();
        const o = c.createOscillator();
        o.frequency.value = ${frequency};
        const g = c.createGain();
        g.gain.value = 0.5;
        o.connect(g).connect(c.destination);
        o.start();
        c.resume();
    `);
});
