// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Test helpers: tone files and measuring which tones a signal contains.

import { writeFileSync } from "node:fs";

/** Writes a 16-bit stereo 48 kHz WAV file with a sine tone. */
export function writeToneWav(file, frequency, seconds = 2) {
    const rate = 48000;
    const frames = rate * seconds;
    const data = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames; i++) {
        const v = Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 0.5 * 32767);
        data.writeInt16LE(v, i * 4);
        data.writeInt16LE(v, i * 4 + 2);
    }
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(data.length, 40);
    writeFileSync(file, Buffer.concat([header, data]));
}

/** Amplitude of one frequency in a mono signal (Goertzel). */
export function toneLevel(samples, frequency, rate = 48000) {
    const k = (2 * Math.PI * frequency) / rate;
    const coefficient = 2 * Math.cos(k);
    let s1 = 0;
    let s2 = 0;
    for (const x of samples) {
        const s = x + coefficient * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    const power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
    return (2 * Math.sqrt(Math.max(power, 0))) / samples.length;
}

/** The left channel of interleaved stereo chunks. */
export function leftChannel(chunks) {
    const total = chunks.reduce((n, c) => n + c.length / 2, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of chunks) for (let i = 0; i < c.length; i += 2) out[o++] = c[i];
    return out;
}
