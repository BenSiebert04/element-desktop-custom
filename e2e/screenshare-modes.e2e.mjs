// End-to-end test of the screen sharing modes in a real call (local backend,
// see e2e/README.md). Anna shares her screen; the test reads what her browser
// actually sends:
//
//  - "High speed": up to 60 fps, frame rate kept (maintain-framerate),
//    content hint "motion"
//  - switching to "Readability" while sharing, without picking the screen
//    again: full capture resolution, resolution kept (maintain-resolution),
//    content hint "text"
//  - Ben still receives the screen share
//  - "Share audio" decides whether the sound is requested with the screen
//
// Usage: node e2e/screenshare-modes.e2e.mjs   (backend from e2e/start.sh running)

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

function hookPeerConnections() {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (...args) {
        const pc = new Original(...args);
        window.__pcs.push(pc);
        return pc;
    };
    window.RTCPeerConnection.prototype = Original.prototype;
    // Record what the app asks getDisplayMedia for
    window.__displayMedia = [];
    const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = (options) => {
        window.__displayMedia.push(JSON.parse(JSON.stringify(options ?? {})));
        return getDisplayMedia(options);
    };
}

async function client(name) {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH,
        args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--mute-audio",
            "--auto-select-desktop-capture-source=Entire screen",
        ],
    });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        permissions: ["microphone", "camera", "clipboard-read", "clipboard-write"],
    });
    await context.addInitScript(hookPeerConnections);
    const page = await context.newPage();
    page.on("pageerror", (e) => log(name, "page error:", String(e).slice(0, 200)));
    return { name, browser, page };
}

/** What the browser sends for the screen share. */
const screenSender = (page) =>
    page.evaluate(() => {
        for (const pc of window.__pcs)
            for (const s of pc.getSenders()) {
                const t = s.track;
                if (t?.kind === "video" && t.contentHint && t.getSettings().displaySurface !== undefined) {
                    const p = s.getParameters();
                    const settings = t.getSettings();
                    return {
                        contentHint: t.contentHint,
                        degradationPreference: p.degradationPreference,
                        maxFramerate: p.encodings.map((e) => e.maxFramerate),
                        maxBitrate: p.encodings.map((e) => e.maxBitrate),
                        width: settings.width,
                        height: settings.height,
                        frameRate: settings.frameRate,
                    };
                }
            }
        return null;
    });

async function pickMode(page, mode) {
    await page.getByTestId("screen-share-mode-button").click();
    await page.getByTestId(`screen-share-mode-${mode}`).click();
}

const anna = await client("Anna");
const ben = await client("Ben");
let failed = false;

try {
    const a = anna.page;
    await a.goto(BASE);
    await a.getByTestId("home_callName").fill("Screenshare E2E");
    await a.getByTestId("home_displayName").fill("Anna");
    await a.getByTestId("home_go").click();
    await a.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    await a.getByRole("button", { name: "Invite" }).click();
    await a.getByTestId("modal_inviteLink").click();
    const link = await a.evaluate("navigator.clipboard.readText()");
    await a.keyboard.press("Escape");
    await ben.page.goto(link);
    await ben.page.getByTestId("joincall_displayName").fill("Ben");
    await ben.page.getByTestId("joincall_joincall").click();
    await ben.page.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    log("2 participants in the call");

    // High speed, chosen before sharing
    await pickMode(a, "speed");
    await a.getByRole("switch", { name: "Share screen" }).click();
    await ben.page.waitForFunction(
        () => document.querySelectorAll('[data-stream-kind="screen"] [data-video-enabled="true"] video').length === 1,
        null,
        { timeout: 30000 },
    );
    await a.waitForTimeout(3000);
    let s = await screenSender(a);
    log("speed:", JSON.stringify(s));
    assert.equal(s.contentHint, "motion");
    assert.equal(s.degradationPreference, "maintain-framerate");
    assert.ok(s.maxFramerate.includes(60), "up to 60 fps");
    assert.ok(s.frameRate > 15, `capture above Element's 15 fps (${s.frameRate})`);
    log("OK high speed: 60 fps, frame rate kept");

    // Readability, switched while sharing (no new screen picker)
    await pickMode(a, "readability");
    await a.waitForTimeout(2000);
    s = await screenSender(a);
    log("readability:", JSON.stringify(s));
    assert.equal(s.contentHint, "text");
    assert.equal(s.degradationPreference, "maintain-resolution");
    assert.ok(s.maxFramerate.every((f) => f <= 30), "at most 30 fps");
    assert.equal(Math.max(...s.maxBitrate), 8_000_000, "full-size layer 8 Mbit/s");
    if (s.maxBitrate.length > 1) assert.ok(Math.min(...s.maxBitrate) < 8_000_000, "small simulcast layer keeps its bitrate");
    const screenSize = await a.evaluate(() => [screen.width * devicePixelRatio, screen.height * devicePixelRatio]);
    assert.ok(s.width >= Math.min(screenSize[0], 1920) && s.height >= Math.min(screenSize[1], 1080), "full resolution");
    assert.equal(await a.getByRole("switch", { name: "Sharing screen" }).count(), 1, "still sharing");
    await ben.page.waitForFunction(
        () => document.querySelectorAll('[data-stream-kind="screen"] [data-video-enabled="true"] video').length === 1,
        null,
        { timeout: 10000 },
    );
    await ben.page.screenshot({ path: path.join(RESULTS, "screenshare-readability.png") });
    log("OK readability while sharing: full resolution, resolution kept, Ben still receives it");

    // The choice is remembered
    await a.getByTestId("screen-share-mode-button").click();
    assert.equal(await a.getByTestId("screen-share-mode-readability").getAttribute("aria-checked"), "true");
    await a.waitForTimeout(800); // menu animation
    await a.screenshot({ path: path.join(RESULTS, "screenshare-mode-menu.png") });
    log("OK mode menu shows the current mode");

    // Sound: asked for by default, not after switching it off
    let asked = await a.evaluate(() => window.__displayMedia.at(-1));
    assert.ok(asked.audio, "sound requested by default");
    assert.equal(asked.systemAudio, "include");
    await a.getByRole("menuitemcheckbox", { name: "Share audio" }).click();
    await a.keyboard.press("Escape");
    await a.getByRole("switch", { name: "Sharing screen" }).click(); // stop
    await a.getByRole("switch", { name: "Share screen" }).click(); // share again
    await a.getByRole("switch", { name: "Sharing screen" }).waitFor({ timeout: 15000 });
    asked = await a.evaluate(() => window.__displayMedia.at(-1));
    assert.equal(asked.audio, false, "no sound requested when switched off");
    assert.equal(asked.systemAudio, "exclude");
    log("OK share audio: requested by default, not when switched off");
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    for (const x of [anna, ben])
        await x.page.screenshot({ path: path.join(RESULTS, `screenshare-error-${x.name}.png`) }).catch(() => {});
} finally {
    for (const x of [anna, ben]) await x.browser.close();
}
process.exit(failed ? 1 : 0);
