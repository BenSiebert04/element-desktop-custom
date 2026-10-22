// End-to-end test of the custom call layout against a real MatrixRTC backend
// (see e2e/README.md). Three browsers join one call; two of them share their
// screens. The test checks, from the third participant's point of view:
//
//  - both screen shares are shown at the same time as large tiles, with video
//  - hiding a camera removes only that tile; the participant stays in the call
//  - with everything hidden no video is received any more, audio still is
//  - the two-streams preset with a 70/30 split and hidden cameras
//  - a participant leaving
//  - restoring Element Call's standard view
//
// Usage: node e2e/call-layout.e2e.mjs   (backend from e2e/start.sh running)

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

const browserArgs = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--mute-audio",
    "--auto-select-desktop-capture-source=Entire screen",
];

// Keep a handle on every RTCPeerConnection to read WebRTC statistics
function hookPeerConnections() {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (...args) {
        const pc = new Original(...args);
        window.__pcs.push(pc);
        return pc;
    };
    window.RTCPeerConnection.prototype = Original.prototype;
}

async function client(name) {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: browserArgs });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        permissions: ["microphone", "camera", "clipboard-read", "clipboard-write"],
    });
    await context.addInitScript(hookPeerConnections);
    const page = await context.newPage();
    page.on("pageerror", (e) => log(name, "page error:", String(e).slice(0, 200)));
    return { name, browser, page };
}

async function received(page) {
    return page.evaluate(async () => {
        let video = 0;
        let audio = 0;
        for (const pc of window.__pcs)
            for (const s of (await pc.getStats()).values())
                if (s.type === "inbound-rtp") {
                    if (s.kind === "video") video += s.bytesReceived;
                    else audio += s.bytesReceived;
                }
        return { video, audio };
    });
}

/** Received kB/s of video and audio over the given period. */
async function rate(page, ms = 5000) {
    const a = await received(page);
    await page.waitForTimeout(ms);
    const b = await received(page);
    return { video: (b.video - a.video) / ms, audio: (b.audio - a.audio) / ms };
}

const tiles = (page) =>
    page.$$eval('[data-testid="custom-layout-tile"]', (els) =>
        els.map((e) => {
            const r = e.getBoundingClientRect();
            return {
                kind: e.dataset.streamKind,
                role: e.dataset.role,
                name: e.textContent,
                x: r.x,
                y: r.y,
                w: r.width,
                h: r.height,
                video: e.querySelector('[data-video-enabled="true"] video') !== null,
            };
        }),
    );

const anna = await client("Anna");
const ben = await client("Ben");
const clara = await client("Clara");
let failed = false;

try {
    // Anna creates the call, Ben and Clara join through the invite link
    await anna.page.goto(BASE);
    await anna.page.getByTestId("home_callName").fill("Layout E2E");
    await anna.page.getByTestId("home_displayName").fill("Anna");
    await anna.page.getByTestId("home_go").click();
    await anna.page.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    await anna.page.getByRole("button", { name: "Invite" }).click();
    await anna.page.getByTestId("modal_inviteLink").click();
    const link = await anna.page.evaluate("navigator.clipboard.readText()");
    await anna.page.keyboard.press("Escape");
    for (const x of [ben, clara]) {
        await x.page.goto(link);
        await x.page.getByTestId("joincall_displayName").fill(x.name);
        await x.page.getByTestId("joincall_joincall").click();
        await x.page.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    }
    log("3 participants in the call");

    // Anna and Ben share their screens at the same time
    for (const x of [anna, ben]) await x.page.getByRole("switch", { name: "Share screen" }).click();
    const c = clara.page;
    await c.waitForFunction(
        () => document.querySelectorAll('[data-stream-kind="screen"] [data-video-enabled="true"] video').length === 2,
        null,
        { timeout: 30000 },
    );
    await c.waitForTimeout(3000);
    await c.screenshot({ path: path.join(RESULTS, "1-two-screen-shares.png") });
    let t = await tiles(c);
    const screens = t.filter((x) => x.kind === "screen");
    assert.equal(screens.length, 2, "two screen share tiles");
    assert.ok(screens.every((x) => x.role === "primary" && x.video), "both screen shares large and playing");
    assert.equal(Math.round(screens[0].y), Math.round(screens[1].y), "screen shares side by side");
    assert.ok(t.filter((x) => x.kind === "camera").every((x) => x.role === "secondary"), "cameras small");
    log("OK two screen shares side by side, cameras small below");

    // Hide Ben's camera only
    const benCamera = c.locator('[data-stream-kind="camera"]').filter({ hasText: "Ben" });
    await benCamera.hover();
    await benCamera.getByTestId("custom-layout-hide").click();
    t = await tiles(c);
    assert.equal(t.filter((x) => x.kind === "camera").length, 2, "Ben's camera hidden");
    assert.equal(t.filter((x) => x.kind === "screen").length, 2, "Ben's screen share still shown");
    log("OK camera and screen share hidden separately");

    // Hide everything: video reception stops, audio continues
    await c.getByTestId("custom-layout-button").click();
    for (const button of await c.getByTestId("custom-layout-toggle-visibility").all())
        if ((await button.getAttribute("aria-pressed")) === "false") await button.click();
    await c.waitForTimeout(4000);
    const hiddenRate = await rate(c);
    log("received with everything hidden (kB/s):", hiddenRate);
    assert.equal((await tiles(c)).length, 0, "no tiles");
    assert.ok(hiddenRate.video < 1, "no video received while hidden");
    assert.ok(hiddenRate.audio > 1, "audio still received while hidden");
    assert.ok((await c.locator("audio").count()) >= 2, "remote audio still playing");
    log("OK hidden participants stay audible, their video is not received");

    // Two streams 70/30, cameras hidden
    await c.getByTestId("custom-layout-show-all").click();
    await c.getByTestId("custom-layout-preset-two-streams").click();
    await c.getByTestId("custom-layout-hide-cameras").check();
    await c.getByTestId("custom-layout-button").click(); // close the panel
    const divider = await c.getByTestId("custom-layout-divider-split").boundingBox();
    await c.mouse.move(divider.x + 4, divider.y + 100);
    await c.mouse.down();
    await c.mouse.move(divider.x + 4 + 0.2 * 1380, divider.y + 100, { steps: 10 });
    await c.mouse.up();
    await c.waitForTimeout(3000);
    await c.screenshot({ path: path.join(RESULTS, "2-two-streams-70-30.png") });
    t = await tiles(c);
    assert.equal(t.length, 2);
    const share = t[0].w / (t[0].w + t[1].w);
    assert.ok(share > 0.65 && share < 0.75, `70/30 split (got ${share.toFixed(2)})`);
    log("OK 70/30 split by dragging the divider");

    // Ben leaves
    await ben.page.getByTestId("incall_leave").click();
    await c.waitForFunction(
        () => document.querySelectorAll('[data-testid="custom-layout-tile"]').length === 1,
        null,
        { timeout: 30000 },
    );
    t = await tiles(c);
    assert.equal(t[0].role, "primary");
    log("OK participant leaving: remaining screen share takes the space");

    // Back to the standard view
    await c.getByTestId("custom-layout-button").click();
    await c.getByTestId("custom-layout-reset").click();
    assert.equal(await c.locator('[data-testid="custom-layout"]').count(), 0);
    await c.screenshot({ path: path.join(RESULTS, "3-standard-view.png") });
    log("OK standard view restored");
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    for (const x of [anna, ben, clara])
        await x.page.screenshot({ path: path.join(RESULTS, `error-${x.name}.png`) }).catch(() => {});
} finally {
    for (const x of [anna, ben, clara]) await x.browser.close();
}
process.exit(failed ? 1 : 0);
