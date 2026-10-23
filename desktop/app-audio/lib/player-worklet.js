// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Plays interleaved stereo float32 chunks with a jitter buffer. The chunks
// come from the capture through the main process, whose event loop can stall
// for a while, and the capture's clock is not the player's clock. So:
//
//  - start once 100 ms are buffered (covers stalls of the main process)
//  - keep the buffer around that: above 160 ms one frame per render quantum
//    is skipped, below 60 ms one is played twice (a rate change below 1 %,
//    inaudible, instead of a crack)
//  - only in an emergency: silence when it runs dry (then buffer again), and
//    dropping the oldest sound above 400 ms

const START_FRAMES = 4800; // 100 ms at 48 kHz
const LOW_FRAMES = 2880; // 60 ms
const HIGH_FRAMES = 7680; // 160 ms
const MAX_FRAMES = 19200; // 400 ms
const TRIM_TO_FRAMES = 4800; // 100 ms

class PcmPlayer extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.offset = 0; // in samples, within queue[0]
        this.frames = 0; // buffered frames
        this.playing = false;
        this.stats = { underruns: 0, trims: 0, skipped: 0, repeated: 0 };
        this.port.onmessage = (event) => {
            if (event.data === "stats") {
                this.port.postMessage({ ...this.stats, buffered: this.frames });
                return;
            }
            const chunk = event.data;
            this.queue.push(chunk);
            this.frames += chunk.length / 2;
            if (this.frames > MAX_FRAMES) {
                this.stats.trims++;
                while (this.queue.length > 1 && this.frames > TRIM_TO_FRAMES) {
                    const dropped = this.queue.shift();
                    this.frames -= (dropped.length - this.offset) / 2;
                    this.offset = 0;
                }
            }
        };
    }

    /** Moves on by one frame. */
    advance() {
        this.offset += 2;
        this.frames--;
        if (this.offset >= this.queue[0].length) {
            this.queue.shift();
            this.offset = 0;
        }
    }

    process(_inputs, outputs) {
        const [left, right] = outputs[0];
        if (!this.playing && this.frames < START_FRAMES) return true;
        this.playing = true;
        // At most one correction per render quantum, in its middle
        let correction = 0;
        if (this.frames > HIGH_FRAMES) correction = 1;
        else if (this.frames < LOW_FRAMES) correction = -1;
        const at = left.length >> 1;
        for (let i = 0; i < left.length; i++) {
            if (!this.queue[0]) {
                // Ran dry: silence, then buffer again
                left[i] = right[i] = 0;
                if (this.playing) this.stats.underruns++;
                this.playing = false;
                continue;
            }
            if (i === at && correction === 1 && this.frames > 1) {
                // Skip a frame: the buffer shrinks a little
                this.advance();
                this.stats.skipped++;
            }
            const chunk = this.queue[0];
            left[i] = chunk[this.offset];
            right[i] = chunk[this.offset + 1];
            // Play this frame twice: the buffer grows a little
            if (i === at && correction === -1) {
                this.stats.repeated++;
                continue;
            }
            this.advance();
        }
        return true;
    }
}

registerProcessor("mosaix-pcm-player", PcmPlayer);
