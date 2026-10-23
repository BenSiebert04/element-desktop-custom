// End-to-end test of playback volume and muting inside the shipped web app
// (official Element Web + our Element Call widget, as in the desktop app):
// Anna and Ben join a call from Element Web; Ben sets Anna to 200 %, mutes
// her for himself and unmutes her again; Anna mutes her microphone.
//
// Usage (backend from start.sh running, web app assembled in build/webapp):
//   node e2e/element-web-volume.e2e.mjs
// With BEN_CDP=http://localhost:<port>, Ben is the real desktop app instead
// (started with --remote-debugging-port=<port>, see e2e/README.md).

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../element-call/package.json"));
const { chromium } = require("@playwright/test");
const RESULTS = path.join(here, "results");
const WORK = path.join(here, ".work");
mkdirSync(RESULTS, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const webapp = path.join(WORK, "webapp-volume");
rmSync(webapp, { recursive: true, force: true });
cpSync(path.join(here, "../build/webapp"), webapp, { recursive: true });
writeFileSync(
    path.join(webapp, "config.json"),
    JSON.stringify({
        default_server_config: { "m.homeserver": { base_url: "http://localhost:8008", server_name: "localhost:8448" } },
        brand: "Mosaix",
    }),
);
const server = spawn("node", [path.join(here, "serve.mjs"), webapp, "8083"], { stdio: "ignore" });
const roomId = execFileSync(path.join(WORK, "venv/bin/python"), [path.join(here, "create-room.py")]).toString().trim();
const BASE = "http://localhost:8083";

// In every frame: record audio contexts and gain nodes, to read what is played
function hooks() {
    window.__contexts = [];
    window.__gains = [];
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
        constructor(...args) {
            super(...args);
            window.__contexts.push(this);
        }
    };
    const createGain = Original.prototype.createGain;
    Original.prototype.createGain = function (...args) {
        const node = createGain.apply(this, args);
        window.__gains.push(node);
        return node;
    };
}

async function login(name) {
    // Optionally Ben in the real desktop app, started with --remote-debugging-port
    if (name === "Ben" && process.env.BEN_CDP) {
        const browser = await chromium.connectOverCDP(process.env.BEN_CDP);
        const page = browser.contexts()[0].pages().find((p) => p.url().startsWith("vector://")) ?? browser.contexts()[0].pages()[0];
        page.on("console", (m) => {
            if (/volume|audio/i.test(m.text()) && m.type() !== "debug") log(name, "console:", m.text().slice(0, 300));
        });
        await page.waitForURL(/vector:\/\//, { timeout: 30000 });
        await page.evaluate(() => (location.hash = "#/login"));
        await page.getByLabel("Username").fill(name.toLowerCase(), { timeout: 30000 });
        await page.getByLabel("Password").fill("testpass123");
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.getByRole("button", { name: "Dismiss" }).click({ timeout: 30000 }).catch(() => {});
        await page.evaluate((r) => (location.hash = `#/room/${r}`), roomId);
        await page.getByRole("button", { name: "Later" }).click({ timeout: 5000 }).catch(() => {});
        // The hooks for the call frame (it is created later)
        await page.context().addInitScript(hooks).catch(() => {});
        return { name, browser, page, remote: true };
    }
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH,
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ["microphone", "camera"] });
    await context.addInitScript(hooks);
    const page = await context.newPage();
    page.on("console", (m) => {
        if (/volume|audio/i.test(m.text()) && m.type() !== "debug") log(name, "console:", m.text().slice(0, 300));
    });
    await page.goto(`${BASE}/#/login`);
    await page.getByLabel("Username").fill(name.toLowerCase());
    await page.getByLabel("Password").fill("testpass123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Dismiss" }).click({ timeout: 30000 }).catch(() => {});
    await page.goto(`${BASE}/#/room/${roomId}`);
    await page.getByRole("button", { name: "Later" }).click({ timeout: 5000 }).catch(() => {});
    return { name, browser, page };
}

const widget = (page) => page.frameLocator('iframe[src*="widgets/element-call"]');
const callFrame = (page) => page.frames().find((f) => f.url().includes("widgets/element-call"));

/** What Ben's call frame plays: audio elements, contexts and gain nodes. */
const playback = (page) =>
    callFrame(page).evaluate(() => ({
        audio: [...document.querySelectorAll("audio")].map((a) => ({
            muted: a.muted,
            volume: a.volume,
            paused: a.paused,
            tracks: a.srcObject?.getAudioTracks().length ?? 0,
        })),
        contexts: window.__contexts.map((c) => c.state),
        gains: window.__gains.map((g) => Math.round(g.gain.value * 100) / 100),
    }));

const people = [];
let failed = false;
try {
    for (const name of ["Anna", "Ben"]) people.push(await login(name));
    const [anna, ben] = people;
    await anna.page.getByRole("button", { name: /Video call/i }).first().click();
    await anna.page.getByRole("menuitem", { name: "Element Call" }).click({ timeout: 5000 }).catch(() => {});
    for (const x of people) {
        if (x !== anna) {
            const join = x.page.getByRole("button", { name: "Join", exact: true });
            await join.last().waitFor({ timeout: 30000 });
            await join.last().click();
        }
        await widget(x.page).getByTestId("lobby_joinCall").click({ timeout: 15000 }).catch(() => {});
        await widget(x.page).getByTestId("incall_leave").waitFor({ timeout: 30000 });
        log(x.name, "in call");
    }
    const b = ben.page;
    const annaTile = widget(b).locator('[data-testid="custom-layout-tile"][data-stream-kind="camera"]').filter({ hasText: "Anna" });
    await annaTile.waitFor({ timeout: 30000 });
    await b.waitForTimeout(3000);
    log("Ben plays at the start:", JSON.stringify(await playback(b)));

    const menu = async () => {
        await annaTile.click({ button: "right", position: { x: 60, y: 60 } });
        const m = widget(b).getByRole("menu");
        await m.waitFor();
        return m;
    };

    // 200 %
    let m = await menu();
    const slider = m.getByRole("slider").first();
    await slider.focus();
    await b.keyboard.press("End");
    await b.waitForTimeout(1500);
    await b.keyboard.press("Escape");
    const loud = await playback(b);
    log("Ben plays Anna at 200 %:", JSON.stringify(loud));

    // 50 %
    m = await menu();
    await m.getByRole("slider").first().focus();
    for (let i = 0; i < 15; i++) await b.keyboard.press("ArrowLeft");
    await b.waitForTimeout(1500);
    await b.keyboard.press("Escape");
    const half = await playback(b);
    log("Ben plays Anna at lower volume:", JSON.stringify(half));

    // Mute for me
    m = await menu();
    await m.getByRole("menuitemcheckbox", { name: "Mute for me" }).click();
    await b.waitForTimeout(1500);
    await b.keyboard.press("Escape");
    const muted = await playback(b);
    log("Ben muted Anna:", JSON.stringify(muted));

    // Anna's voice goes through Web Audio (the audio element itself is
    // muted): the gain of her track follows the menu
    assert.ok(loud.audio.every((a) => a.muted), "played through Web Audio");
    assert.ok(loud.contexts.includes("running"));
    assert.ok(loud.gains.includes(2), `gain 2 at 200 % (${loud.gains})`);
    assert.ok(!half.gains.includes(2) && half.gains.some((g) => g > 1 && g < 2), `lower gain (${half.gains})`);
    assert.ok(muted.gains.includes(0) && !muted.gains.some((g) => g > 1), `gain 0 when muted (${muted.gains})`);
    log("OK volume and 'Mute for me' work inside Element Web");
    await b.screenshot({ path: path.join(RESULTS, "element-web-volume.png") });
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    for (const x of people) await x.page.screenshot({ path: path.join(RESULTS, `element-web-volume-error-${x.name}.png`) }).catch(() => {});
} finally {
    for (const x of people) if (!x.remote) await x.browser.close();
    server.kill();
}
process.exit(failed ? 1 : 0);
