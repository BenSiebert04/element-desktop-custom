// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Plays interleaved stereo float32 chunks with a small jitter buffer: starts
// after 20 ms of audio, and drops the oldest audio above 200 ms so that the
// delay can't grow.

const START_FRAMES = 960; // 20 ms at 48 kHz
const MAX_FRAMES = 9600; // 200 ms
const TRIM_TO_FRAMES = 2400; // 50 ms

class PcmPlayer extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.offset = 0; // in samples, within queue[0]
        this.frames = 0; // buffered frames
        this.playing = false;
        this.port.onmessage = (event) => {
            const chunk = event.data;
            this.queue.push(chunk);
            this.frames += chunk.length / 2;
            if (this.frames > MAX_FRAMES) {
                while (this.queue.length > 1 && this.frames > TRIM_TO_FRAMES) {
                    const dropped = this.queue.shift();
                    this.frames -= (dropped.length - this.offset) / 2;
                    this.offset = 0;
                }
            }
        };
    }

    process(_inputs, outputs) {
        const [left, right] = outputs[0];
        if (!this.playing && this.frames < START_FRAMES) return true;
        this.playing = true;
        for (let i = 0; i < left.length; i++) {
            const chunk = this.queue[0];
            if (!chunk) {
                // Ran dry: silence, then buffer again
                left[i] = right[i] = 0;
                this.playing = false;
                continue;
            }
            left[i] = chunk[this.offset];
            right[i] = chunk[this.offset + 1];
            this.offset += 2;
            this.frames--;
            if (this.offset >= chunk.length) {
                this.queue.shift();
                this.offset = 0;
            }
        }
        return true;
    }
}

registerProcessor("mosaix-pcm-player", PcmPlayer);
