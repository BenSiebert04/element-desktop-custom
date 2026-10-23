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

test("the player waits for 20 ms of sound, then plays it in order", () => {
    const { send, render } = loadWorklet();
    send(480, 0.5); // 10 ms
    assert.equal(render().left[0], 0, "still buffering");
    send(480, 0.25);
    const out = render();
    assert.equal(out.left[0], 0.5);
    assert.equal(out.right[0], -0.5);
});

test("the player keeps the delay below 200 ms", () => {
    const { player, send, render } = loadWorklet();
    for (let i = 0; i < 30; i++) send(480, i); // 300 ms
    assert.ok(player.frames <= 9600, `buffered ${player.frames} frames`);
    // The oldest sound was dropped
    assert.ok(render().left[0] > 0);
});

test("the player plays silence when it runs dry and buffers again", () => {
    const { send, render } = loadWorklet();
    send(960, 1);
    for (let i = 0; i < 7; i++) render(); // 896 frames
    const out = render();
    assert.equal(out.left[0], 1);
    assert.equal(out.left[127], 0, "silence after the end");
});
