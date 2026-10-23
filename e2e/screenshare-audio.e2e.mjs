// End-to-end test of screen share sound on the receiving side (local
// backend, see e2e/README.md). Anna shares a browser tab that plays a tone,
// with "Share audio" on. Checked from Ben's side:
//
//  - the server forwards the screen share's sound as its own track
//  - the screen share tile offers volume and "Mute for me"
//  - 200 % and muting change the playback gain of that sound only
//
// Usage: node e2e/screenshare-audio.e2e.mjs   (backend from e2e/start.sh running)

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../element-call/package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.env.EC_URL ?? "http://localhost:8080";
const RESULTS = path.join(here, "results");
mkdirSync(RESULTS, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function hooks() {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (...args) {
        const pc = new Original(...args);
        window.__pcs.push(pc);
        return pc;
    };
    window.RTCPeerConnection.prototype = Original.prototype;
    window.__gains = [];
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function (...args) {
        const node = createGain.apply(this, args);
        window.__gains.push(node);
        return node;
    };
}

async function client(name, extraArgs = []) {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH,
        args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--mute-audio",
            "--autoplay-policy=no-user-gesture-required",
            ...extraArgs,
        ],
    });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        permissions: ["microphone", "camera", "clipboard-read", "clipboard-write"],
    });
    await context.addInitScript(hooks);
    const page = await context.newPage();
    page.on("pageerror", (e) => log(name, "page error:", String(e).slice(0, 200)));
    return { name, browser, context, page };
}

/** Audio received per track (kind "audio" inbound-rtp), in bytes. */
const inboundAudio = (page) =>
    page.evaluate(async () => {
        const out = [];
        for (const pc of window.__pcs)
            for (const s of (await pc.getStats()).values())
                if (s.type === "inbound-rtp" && s.kind === "audio") out.push(s.bytesReceived);
        return out;
    });
const gains = (page) => page.evaluate(() => window.__gains.map((g) => Math.round(g.gain.value * 100) / 100));

// Anna's tab capture picks the tab titled "Tone tab"
const anna = await client("Anna", ["--auto-select-tab-capture-source-by-title=Tone tab"]);
const ben = await client("Ben");
let failed = false;

try {
    const a = anna.page;
    // The tab Anna will share, playing 440 Hz
    const tone = await anna.context.newPage();
    await tone.goto("data:text/html,<title>Tone tab</title><h1>Tone</h1>");
    await tone.evaluate(() => {
        const c = new AudioContext();
        const o = c.createOscillator();
        o.frequency.value = 440;
        o.connect(c.destination);
        o.start();
        return c.resume();
    });
    await a.bringToFront();

    await a.goto(BASE);
    await a.getByTestId("home_callName").fill("Screenshare audio E2E");
    await a.getByTestId("home_displayName").fill("Anna");
    await a.getByTestId("home_go").click();
    await a.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    await a.getByRole("button", { name: "Invite" }).click();
    await a.getByTestId("modal_inviteLink").click();
    const link = await a.evaluate("navigator.clipboard.readText()");
    await a.keyboard.press("Escape");
    const b = ben.page;
    await b.goto(link);
    await b.getByTestId("joincall_displayName").fill("Ben");
    await b.getByTestId("joincall_joincall").click();
    await b.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    await b.waitForTimeout(3000);
    const before = (await inboundAudio(b)).length;
    log("audio tracks at Ben before sharing:", before);

    // Anna shares the tab with its sound ("Share audio" is on by default)
    await a.getByRole("switch", { name: "Share screen" }).click();
    const shareTile = b.locator('[data-testid="custom-layout-tile"][data-stream-kind="screen"]');
    await shareTile.waitFor({ timeout: 30000 });
    await b.waitForTimeout(4000);
    const first = await inboundAudio(b);
    await b.waitForTimeout(3000);
    const second = await inboundAudio(b);
    log("audio tracks at Ben while sharing:", first.length, "bytes:", second);
    assert.equal(first.length, before + 1, "one more audio track: the screen share's sound");
    assert.ok(second.every((bytes, i) => bytes > (first[i] ?? 0)), "all audio tracks are receiving");
    log("OK the server forwards the screen share's sound to Ben");

    // Ben: 200 % for the screen share's sound, then mute it
    const gainsBefore = await gains(b);
    await shareTile.click({ button: "right", position: { x: 80, y: 80 } });
    const menu = b.getByRole("menu");
    await menu.getByRole("menuitemcheckbox", { name: "Mute for me" }).waitFor();
    await menu.getByRole("slider").first().focus();
    await b.keyboard.press("End");
    await b.waitForTimeout(1500);
    let g = await gains(b);
    log("gains before:", gainsBefore, "at 200 %:", g);
    assert.ok(g.includes(2), "screen share sound at gain 2");
    assert.ok(!gainsBefore.includes(2));
    await menu.getByRole("menuitemcheckbox", { name: "Mute for me" }).click();
    await b.waitForTimeout(1500);
    g = await gains(b);
    log("muted:", g);
    assert.ok(!g.includes(2) && g.includes(0), "screen share sound muted");
    await b.keyboard.press("Escape");
    // Anna's voice is untouched: her camera tile still offers its own, unmuted volume
    const camera = b.locator('[data-testid="custom-layout-tile"][data-stream-kind="camera"]').filter({ hasText: "Anna" });
    await camera.click({ button: "right", position: { x: 80, y: 80 } });
    const voiceMute = b.getByRole("menu").getByRole("menuitemcheckbox", { name: "Mute for me" });
    assert.equal(await voiceMute.isChecked(), false, "Anna's voice not muted");
    await b.keyboard.press("Escape");
    await b.screenshot({ path: path.join(RESULTS, "screenshare-audio-receiver.png") });
    log("OK Ben can set the screen share's volume (200 %) and mute it, separately from Anna's voice");
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    for (const x of [anna, ben])
        await x.page.screenshot({ path: path.join(RESULTS, `screenshare-audio-error-${x.name}.png`) }).catch(() => {});
} finally {
    for (const x of [anna, ben]) await x.browser.close();
}
process.exit(failed ? 1 : 0);
