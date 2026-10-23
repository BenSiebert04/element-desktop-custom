// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Platform independent parts: what is captured for which source, and the
// jitter buffer of the hidden player.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { captureTarget, windowHandle } = require("../lib/index.cjs");

const OWN = 1000;
const processOf = (hwnd) => ({ 11: 4242, 12: OWN })[hwnd] ?? 0;

test("a window shares the sound of its application only", () => {
    assert.equal(windowHandle("window:11:0"), 11);
    assert.deepEqual(captureTarget("window:11:0", OWN, processOf), { pid: 4242, mode: "include" });
});

test("a screen shares the system's sound without Mosaix", () => {
    assert.deepEqual(captureTarget("screen:0:0", OWN, processOf), { pid: OWN, mode: "exclude" });
});

test("nothing for Mosaix's own windows, unknown windows or other sources", () => {
    assert.equal(captureTarget("window:12:0", OWN, processOf), null);
    assert.equal(captureTarget("window:99:0", OWN, processOf), null);
    assert.equal(captureTarget("web-contents-media-stream:1", OWN, processOf), null);
    assert.equal(captureTarget("", OWN, processOf), null);
});

function loadWorklet() {
    let Processor;
    const context = {
        AudioWorkletProcessor: class {
            constructor() {
                this.port = { onmessage: null };
            }
        },
        registerProcessor: (_name, cls) => (Processor = cls),
    };
    vm.runInNewContext(readFileSync(new URL("../lib/player-worklet.js", import.meta.url), "utf8"), context);
    const player = new Processor();
    const send = (frames, value) => {
        const chunk = new Float32Array(frames * 2);
        for (let i = 0; i < frames; i++) {
            chunk[2 * i] = value;
            chunk[2 * i + 1] = -value;
        }
        player.port.onmessage({ data: chunk });
    };
    const render = () => {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        player.process([], [[left, right]]);
        return { left, right };
    };
    return { player, send, render };
}

test("the player waits for 100 ms of sound, then plays it in order", () => {
    const { send, render } = loadWorklet();
    for (let i = 0; i < 9; i++) send(480, 0.5); // 90 ms
    assert.equal(render().left[0], 0, "still buffering");
    send(480, 0.25);
    const out = render();
    assert.equal(out.left[0], 0.5);
    assert.equal(out.right[0], -0.5);
});

test("the player keeps the delay below 400 ms", () => {
    const { player, send, render } = loadWorklet();
    for (let i = 0; i < 50; i++) send(480, i + 1); // 500 ms
    assert.ok(player.frames <= 19200, `buffered ${player.frames} frames`);
    assert.equal(player.stats.trims, 1);
    // The oldest sound was dropped
    assert.ok(render().left[0] > 1);
});

test("the player plays silence when it runs dry and buffers again", () => {
    const { player, send, render } = loadWorklet();
    send(4800, 1);
    for (let i = 0; i < 37; i++) render(); // 4736 frames
    const out = render();
    assert.equal(out.left[0], 1);
    assert.equal(out.left[127], 0, "silence after the end");
    assert.equal(player.stats.underruns, 1);
    send(480, 1);
    assert.equal(render().left[0], 0, "buffering again");
});

test("the player follows a faster or slower capture without cracks", () => {
    // Too much buffered (the capture runs faster): one frame per render
    // quantum is skipped; too little (slower): one is played twice
    const fast = loadWorklet();
    for (let i = 0; i < 20; i++) fast.send(480, 0.5); // 200 ms
    const before = fast.player.frames;
    fast.render();
    assert.equal(before - fast.player.frames, 129, "128 frames played, one skipped");
    assert.equal(fast.player.stats.skipped, 1);

    const slow = loadWorklet();
    for (let i = 0; i < 10; i++) slow.send(480, 0.5); // 100 ms: starts
    for (let i = 0; i < 16; i++) slow.render(); // below 2880 frames (60 ms)
    const frames = slow.player.frames;
    slow.render();
    assert.equal(frames - slow.player.frames, 127, "128 frames played, one of them twice");
    assert.ok(slow.player.stats.repeated >= 1);
    assert.equal(slow.player.stats.underruns, 0);
});
