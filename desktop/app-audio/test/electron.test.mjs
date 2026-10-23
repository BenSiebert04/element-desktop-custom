// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Runs test/electron/main.cjs in Electron on Windows (needs an audio output
// device) and checks the sound of real screen shares.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const windows = process.platform === "win32";

test("screen share sound in Electron", { skip: !windows, timeout: 120000 }, () => {
    const electronPath = require("electron");
    const main = fileURLToPath(new URL("./electron/main.cjs", import.meta.url));
    const output = execFileSync(electronPath, [main], { encoding: "utf8", timeout: 110000 });
    const line = output.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
    assert.ok(line, `no result in:\n${output}`);
    const r = JSON.parse(line.slice(7));
    console.log(JSON.stringify(r, null, 2));
    assert.equal(r.error, undefined);
    assert.equal(r.supported, true);

    // The captured level of a tone varies between runs (0.03 to 0.1), while
    // sound that must not be captured measures 0: "heard" means clearly above
    // silence, "not heard" at most a tenth of what is heard.
    const HEARD = 0.01;

    // Sharing the window of the 440 Hz app: only its sound
    assert.equal(r.window.audioTrack, true);
    assert.ok(r.window.t440 > HEARD, "the shared app is heard");
    assert.ok(r.window.t880 < r.window.t440 / 10, "another app is not");
    assert.ok(r.window.t660 < r.window.t440 / 10, "the call (this app) is not");

    // Sharing the screen: every app, but not this one
    assert.equal(r.screen.audioTrack, true);
    assert.ok(r.screen.t440 > HEARD && r.screen.t880 > HEARD, "all other apps are heard");
    assert.ok(r.screen.t660 < Math.min(r.screen.t440, r.screen.t880) / 10, "the call is not heard twice");

    // The capture ends with the screen share
    assert.equal(r.windowCaptureStopped, true);
    assert.equal(r.screenCaptureStopped, true);
});
