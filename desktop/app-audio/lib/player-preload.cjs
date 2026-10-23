// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Hidden player window: plays the captured sound (interleaved stereo float32,
// 48 kHz) received over a MessagePort from the main process.

"use strict";

const { ipcRenderer } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// Loaded as a blob: works the same from the app's resources and in tests
const workletUrl = URL.createObjectURL(
    new Blob([fs.readFileSync(path.join(__dirname, "player-worklet.js"), "utf8")], {
        type: "text/javascript",
    }),
);

const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
const node = context.audioWorklet
    .addModule(workletUrl)
    .then(() => {
        const player = new AudioWorkletNode(context, "mosaix-pcm-player", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        player.connect(context.destination);
        return player;
    });

ipcRenderer.on("mosaix-app-audio-port", (event) => {
    const [port] = event.ports;
    void node.then((player) => {
        port.onmessage = (message) => {
            const chunk = message.data;
            player.port.postMessage(chunk, [chunk.buffer]);
        };
        port.start();
        void context.resume();
    });
});
