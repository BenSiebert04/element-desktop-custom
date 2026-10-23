// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// The native module on Windows (needs an audio output device): two processes
// play different tones; capturing one process includes only its tone,
// excluding it captures the other one.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

import { leftChannel, toneLevel, writeToneWav } from "./tones.mjs";

const require = createRequire(import.meta.url);
const windows = process.platform === "win32";
const native = windows ? require("../build/Release/app_audio.node") : null;

const players = {};

function playLooped(file) {
    // SoundPlayer plays in the PowerShell process itself
    const script = `$p = New-Object System.Media.SoundPlayer '${file}'; $p.PlayLooping(); Start-Sleep -Seconds 120`;
    return spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" });
}

async function captureFor(pid, mode, ms = 2500) {
    const chunks = [];
    const errors = [];
    const capture = new native.Capture(
        pid,
        mode,
        (chunk) => chunks.push(chunk),
        (message) => errors.push(message),
    );
    await sleep(ms);
    capture.stop();
    assert.deepEqual(errors, []);
    // Skip the first half second (start-up)
    const signal = leftChannel(chunks).subarray(24000);
    return { samples: signal.length, a: toneLevel(signal, 440), b: toneLevel(signal, 880) };
}

before(async () => {
    if (!windows) return;
    const dir = mkdtempSync(path.join(tmpdir(), "app-audio-"));
    for (const f of [440, 880]) {
        const file = path.join(dir, `tone-${f}.wav`);
        writeToneWav(file, f);
        players[f] = playLooped(file);
    }
    await sleep(3000);
});

after(() => {
    for (const p of Object.values(players)) p.kill();
});

test("process loopback is available", { skip: !windows }, () => {
    assert.equal(native.isSupported(), true);
});

test("include: only the sound of that process", { skip: !windows }, async () => {
    const r = await captureFor(players[440].pid, "include");
    console.log("include 440:", r);
    assert.ok(r.samples > 48000, "audio arrived");
    assert.ok(r.a > 0.05, "its tone is there");
    assert.ok(r.b < r.a / 10, "the other process is not");
});

test("exclude: everything but that process", { skip: !windows }, async () => {
    const r = await captureFor(players[440].pid, "exclude");
    console.log("exclude 440:", r);
    assert.ok(r.b > 0.05, "the other process is there");
    assert.ok(r.a < r.b / 10, "the excluded process is not");
});

test("rejects bad arguments", { skip: !windows }, () => {
    assert.throws(() => new native.Capture(0, "include", () => {}, () => {}));
    assert.throws(() => new native.Capture(1, "both", () => {}, () => {}));
});
