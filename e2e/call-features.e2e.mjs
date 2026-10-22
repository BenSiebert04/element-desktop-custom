// End-to-end test of transparency, layers, volume boost and the hidden chip
// in a real call (local backend, see e2e/README.md). Anna and Ben join one
// call; the checks are made from Ben's point of view:
//
//  - standard view: a tile's menu opens "Customise layout"
//  - free layout: transparency and layers from the tile menu, a higher layer
//    stays in front of a tile brought to the front
//  - Anna's volume set to 200 %: her audio is played through a gain of 2
//  - leaving and joining again: Anna is still at 200 %
//  - the "n hidden" chip shows while the mouse moves and is gone 5 s later
//
// Usage: node e2e/call-features.e2e.mjs   (backend from e2e/start.sh running)

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

// Record every gain node so that the effective playback gain can be read
function hookGainNodes() {
    window.__gains = [];
    const original = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function (...args) {
        const node = original.apply(this, args);
        window.__gains.push(node);
        return node;
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
    await context.addInitScript(hookGainNodes);
    const page = await context.newPage();
    page.on("pageerror", (e) => log(name, "page error:", String(e).slice(0, 200)));
    return { name, browser, page };
}

const gains = (page) => page.evaluate(() => window.__gains.map((g) => Math.round(g.gain.value * 100) / 100));
const annaTile = (page) => page.locator('[data-testid="custom-layout-tile"][data-stream-kind="camera"]').filter({ hasText: "Anna" });

async function openTileMenu(page, tile) {
    await tile.click({ button: "right", position: { x: 60, y: 60 } });
    await page.getByRole("menu").waitFor();
}

const anna = await client("Anna");
const ben = await client("Ben");
let failed = false;

try {
    await anna.page.goto(BASE);
    await anna.page.getByTestId("home_callName").fill("Features E2E");
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

    // Standard view: the tile menu offers the layout panel
    await b.getByTestId("custom-layout-button").click();
    await b.getByTestId("custom-layout-reset").click();
    assert.equal(await b.locator('[data-testid="custom-layout"]').count(), 0);
    const standardTile = b.getByTestId("videoTile").filter({ hasText: "Anna" });
    await openTileMenu(b, standardTile);
    await b.getByRole("menuitem", { name: "Customise layout" }).click();
    await b.getByTestId("custom-layout-panel").waitFor();
    log("OK standard view: tile menu opens the layout panel");

    // Free layout: transparency and layers
    await b.getByTestId("custom-layout-preset-free").click();
    await b.getByTestId("custom-layout-button").click(); // close the panel
    await openTileMenu(b, annaTile(b));
    const thumb = b.getByTestId("custom-layout-transparency").getByRole("slider");
    await thumb.focus();
    for (let i = 0; i < 8; i++) await b.keyboard.press("ArrowRight"); // 8 x 5 %
    await b.getByTestId("custom-layout-transparency").getByText("Transparency: 40 %").waitFor();
    await b.getByTestId("custom-layout-layer").getByRole("button", { name: /higher/ }).click();
    await b.keyboard.press("Escape");
    assert.equal(await annaTile(b).evaluate((e) => e.style.opacity), "0.6");
    // Ben's own tile brought to the front stays behind Anna's (layer 1)
    const benTile = b.locator('[data-testid="custom-layout-tile"][data-stream-kind="camera"]').filter({ hasText: "Ben" });
    await openTileMenu(b, benTile);
    await b.getByRole("menuitem", { name: "Bring to front" }).click();
    const z = async (tile) => Number(await tile.evaluate((e) => e.style.zIndex));
    assert.ok((await z(annaTile(b))) > (await z(benTile)), "higher layer in front");
    await b.screenshot({ path: path.join(RESULTS, "features-1-transparency-layers.png") });
    log("OK transparency 40 % and layer 1 in front of a tile brought to the front");

    // Volume 200 %
    await openTileMenu(b, annaTile(b));
    // The first slider of the menu (its tooltip names it by the percentage)
    const volume = b.getByRole("menu").getByRole("slider").first();
    await volume.focus();
    await b.keyboard.press("End");
    assert.equal(await volume.getAttribute("aria-valuenow"), "2");
    await b.keyboard.press("Escape");
    await b.waitForTimeout(1500); // the gain ramps up
    assert.ok((await gains(b)).includes(2), `playback gain 2 (gains: ${await gains(b)})`);
    const audio = await b.evaluate(() =>
        [...document.querySelectorAll("audio")].map((a) => ({ muted: a.muted, paused: a.paused })),
    );
    assert.ok(audio.length > 0 && audio.every((a) => a.muted), "audio routed through Web Audio");
    const stored = JSON.parse(await b.evaluate(() => localStorage.getItem("element-custom.volume.v1") ?? "{}"));
    assert.deepEqual(Object.values(stored), [{ microphone: 2 }], `stored per person (${JSON.stringify(stored)})`);
    log("OK Anna at 200 %: playback gain 2, remembered for her Matrix ID");

    // Leave and join again: still 200 %
    await b.getByTestId("incall_leave").click();
    await b.getByText("your call has ended").waitFor({ timeout: 30000 });
    await b.goto(link);
    await b.reload(); // same URL: make sure the call page loads again
    await b.getByTestId("lobby_joinCall").click({ timeout: 60000 });
    await annaTile(b).waitFor({ timeout: 30000 });
    // No interaction needed: the remembered volume applies by itself
    for (let i = 0; i < 20 && !(await gains(b)).includes(2); i++) await b.waitForTimeout(500);
    assert.ok((await gains(b)).includes(2), `gain 2 again after rejoining (gains: ${await gains(b)})`);
    await openTileMenu(b, annaTile(b));
    assert.equal(await b.getByRole("menu").getByRole("slider").first().getAttribute("aria-valuenow"), "2");
    await b.keyboard.press("Escape");
    log("OK volume remembered for Anna in the next call");

    // The hidden chip only shows while the mouse moves
    await annaTile(b).hover();
    await annaTile(b).getByTestId("custom-layout-hide").click();
    await b.mouse.move(700, 400);
    await b.mouse.move(710, 410);
    await b.getByTestId("custom-layout-hidden-chip").waitFor({ timeout: 2000 });
    await b.waitForTimeout(5500);
    assert.equal(await b.getByTestId("custom-layout-hidden-chip").count(), 0, "chip gone after 5 s");
    await b.mouse.move(600, 300);
    await b.getByTestId("custom-layout-hidden-chip").waitFor({ timeout: 2000 });
    log("OK hidden chip only while the mouse moves");
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    for (const x of [anna, ben])
        await x.page.screenshot({ path: path.join(RESULTS, `features-error-${x.name}.png`) }).catch(() => {});
} finally {
    for (const x of [anna, ben]) await x.browser.close();
}
process.exit(failed ? 1 : 0);
