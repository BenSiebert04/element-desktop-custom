// End-to-end test of pop-outs in a real call (local backend, see
// e2e/README.md). Anna and Ben join one call; Ben pops Anna's camera out:
//
//  - "Pop out" in the tile menu opens a window of its own that plays the video
//  - the window's size and place are remembered for Anna's camera
//  - with the call window in the background (as while gaming), Anna's video
//    stops arriving without a pop-out, but keeps arriving with one
//  - the pop-out closes from its own button, from the menu and with the call
//  - "always on top" is only offered in the desktop app
//
// Usage: node e2e/popout.e2e.mjs   (backend from e2e/start.sh running)

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
    // Every peer connection, to read the received video
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (...args) {
        const pc = new Original(...args);
        window.__pcs.push(pc);
        return pc;
    };
    window.RTCPeerConnection.prototype = Original.prototype;
    // Put the page in the background, as when the call window is minimised
    window.__setHidden = (hidden) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        document.dispatchEvent(new Event("visibilitychange"));
    };
}

async function client(name) {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH,
        args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--mute-audio",
            "--autoplay-policy=no-user-gesture-required",
        ],
    });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        permissions: ["microphone", "camera", "clipboard-read", "clipboard-write"],
    });
    await context.addInitScript(hooks);
    const page = await context.newPage();
    page.on("pageerror", (e) => log(name, "page error:", String(e).slice(0, 200)));
    return { name, browser, page };
}

/** Video bytes received so far. */
const videoBytes = (page) =>
    page.evaluate(async () => {
        let total = 0;
        for (const pc of window.__pcs)
            for (const s of (await pc.getStats()).values())
                if (s.type === "inbound-rtp" && s.kind === "video") total += s.bytesReceived;
        return total;
    });

/**
 * Video bytes received within 3 s, after LiveKit had time to react (it waits
 * 5 s before pausing video in the background).
 */
async function videoRate(page) {
    await page.waitForTimeout(7000);
    const before = await videoBytes(page);
    await page.waitForTimeout(3000);
    return (await videoBytes(page)) - before;
}

const annaTile = (page) =>
    page.locator('[data-testid="custom-layout-tile"][data-stream-kind="camera"]').filter({ hasText: "Anna" });

async function annaMenu(page) {
    await annaTile(page).click({ button: "right", position: { x: 60, y: 60 } });
    return page.getByRole("menu");
}

async function popOutAnna(page) {
    const popupEvent = page.waitForEvent("popup");
    await (await annaMenu(page)).getByRole("menuitem", { name: "Pop out" }).click();
    const popup = await popupEvent;
    await popup.getByTestId("popout").waitFor();
    return popup;
}

/** Whether a pop-out's video is playing (frames arrive). */
async function playing(popup) {
    const time = () => popup.getByTestId("popout-video").evaluate((v) => [v.videoWidth, v.currentTime]);
    for (let i = 0; i < 30; i++) {
        const [width, t0] = await time();
        await popup.waitForTimeout(500);
        const [, t1] = await time();
        if (width > 0 && t1 > t0) return true;
    }
    return false;
}

const anna = await client("Anna");
const ben = await client("Ben");
let failed = false;

try {
    await anna.page.goto(BASE);
    await anna.page.getByTestId("home_callName").fill("Popout E2E");
    await anna.page.getByTestId("home_displayName").fill("Anna");
    await anna.page.getByTestId("home_go").click();
    await anna.page.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    await anna.page.getByRole("button", { name: "Invite" }).click();
    await anna.page.getByTestId("modal_inviteLink").click();
    const link = await anna.page.evaluate("navigator.clipboard.readText()");
    await anna.page.keyboard.press("Escape");
    const b = ben.page;
    await b.goto(link);
    await b.getByTestId("joincall_displayName").fill("Ben");
    await b.getByTestId("joincall_joincall").click();
    await b.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    await annaTile(b).waitFor({ timeout: 30000 });
    log("2 participants in the call");

    // Pop Anna's camera out
    let popup = await popOutAnna(b);
    assert.equal(await popup.title(), "Anna – Mosaix");
    assert.ok(await playing(popup), "Anna's video plays in the pop-out");
    await popup.mouse.move(100, 100);
    await popup.getByTestId("popout-controls").and(popup.locator('[data-visible="true"]')).waitFor();
    assert.equal(await popup.getByTestId("popout-always-on-top").count(), 0, "no 'always on top' in a browser");
    assert.equal((await b.getByRole("menu").count()), 0);
    assert.equal(
        await (await annaMenu(b)).getByRole("menuitem", { name: "Close pop-out" }).count(),
        1,
        "the menu now offers to close it",
    );
    await b.keyboard.press("Escape");
    await popup.screenshot({ path: path.join(RESULTS, "popout-1-window.png") });
    log("OK Anna's camera in a window of its own");

    // Size and place are remembered for Anna's camera
    await popup.setViewportSize({ width: 520, height: 300 });
    await b.waitForTimeout(1500);
    const places = JSON.parse(await b.evaluate(() => localStorage.getItem("element-custom.popouts.v1") ?? "{}")).places;
    const annaPlace = Object.entries(places ?? {}).find(([k]) => k.endsWith("|camera") && !k.includes("Ben"));
    assert.ok(annaPlace, `place stored (${JSON.stringify(places)})`);
    assert.deepEqual([annaPlace[1].width, annaPlace[1].height], [520, 300]);
    log("OK pop-out size remembered for Anna's camera");

    // Closed from its own button
    const closed = popup.waitForEvent("close");
    await popup.mouse.move(120, 120);
    await popup.getByTestId("popout-close").click();
    await closed;
    log("OK pop-out closed from its own button");

    // In the background, video only keeps arriving with a pop-out
    await b.evaluate(() => window.__setHidden(true));
    const withoutPopout = await videoRate(b);
    popup = await popOutAnna(b);
    const withPopout = await videoRate(b);
    log("video bytes in 3 s with the call in the background:", { withoutPopout, withPopout });
    assert.ok(withPopout > 20000, "video keeps arriving for the pop-out");
    assert.ok(withoutPopout < withPopout / 5, "without a pop-out the video pauses in the background");
    assert.ok(await playing(popup), "the pop-out still plays");
    await b.evaluate(() => window.__setHidden(false));
    log("OK pop-out keeps playing while the call window is in the background");

    // Closed from the menu, and with the call
    let gone = popup.waitForEvent("close");
    await (await annaMenu(b)).getByRole("menuitem", { name: "Close pop-out" }).click();
    await gone;
    popup = await popOutAnna(b);
    gone = popup.waitForEvent("close");
    await b.getByTestId("incall_leave").click();
    await gone;
    log("OK pop-out closed from the menu and when leaving the call");
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    for (const x of [anna, ben])
        await x.page.screenshot({ path: path.join(RESULTS, `popout-error-${x.name}.png`) }).catch(() => {});
} finally {
    for (const x of [anna, ben]) await x.browser.close();
}
process.exit(failed ? 1 : 0);
