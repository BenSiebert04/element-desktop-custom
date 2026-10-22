// End-to-end test of the shipped web app (official Element Web + our Element
// Call widget, as packaged into the desktop app) against the local backend:
// three users log in through Element Web, exchange an encrypted message,
// start a group call from the room header and two of them share their screens.
//
// Usage (backend from start.sh running, web app assembled in build/webapp):
//   node e2e/element-web.e2e.mjs

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

// Serve the assembled web app with a config pointing at the local homeserver
const webapp = path.join(WORK, "webapp");
rmSync(webapp, { recursive: true, force: true });
cpSync(path.join(here, "../build/webapp"), webapp, { recursive: true });
writeFileSync(
    path.join(webapp, "config.json"),
    JSON.stringify({
        default_server_config: { "m.homeserver": { base_url: "http://localhost:8008", server_name: "localhost:8448" } },
        brand: "Mosaix",
    }),
);
const server = spawn("node", [path.join(here, "serve.mjs"), webapp, "8081"], { stdio: "ignore" });
const roomId = execFileSync(path.join(WORK, "venv/bin/python"), [path.join(here, "create-room.py")]).toString().trim();
const BASE = "http://localhost:8081";

const args = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--mute-audio",
    "--auto-select-desktop-capture-source=Entire screen",
];

async function login(name) {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ["microphone", "camera"] });
    const page = await context.newPage();
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
const people = [];
let failed = false;
try {
    for (const name of ["Anna", "Ben", "Clara"]) people.push(await login(name));
    const [anna, ben, clara] = people;

    // Messaging still works (encrypted room)
    await anna.page.getByRole("textbox", { name: /message/i }).fill("Hallo aus Mosaix");
    await anna.page.keyboard.press("Enter");
    await ben.page.getByText("Hallo aus Mosaix").waitFor({ timeout: 30000 });
    log("OK encrypted message delivered");

    // Anna starts the call, the others join from the timeline
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
    for (const x of [anna, ben]) await widget(x.page).getByRole("switch", { name: "Share screen" }).click();

    const frame = () => clara.page.frames().find((f) => f.url().includes("widgets/element-call"));
    await frame().waitForFunction(
        () => document.querySelectorAll('[data-stream-kind="screen"] [data-video-enabled="true"] video').length === 2,
        null,
        { timeout: 30000 },
    );
    await clara.page.waitForTimeout(2000);
    await clara.page.screenshot({ path: path.join(RESULTS, "element-web-two-screen-shares.png") });
    const tiles = await frame().$$eval('[data-testid="custom-layout-tile"]', (els) =>
        els.map((e) => ({ kind: e.dataset.streamKind, role: e.dataset.role })),
    );
    assert.equal(tiles.filter((t) => t.kind === "screen" && t.role === "primary").length, 2);
    // The footer (call controls) sits below the tiles
    const footerTop = await frame().$eval('[data-testid="footer-container"]', (e) => e.getBoundingClientRect().top);
    const tilesBottom = await frame().$$eval('[data-testid="custom-layout-tile"]', (els) =>
        Math.max(...els.map((e) => e.getBoundingClientRect().bottom)),
    );
    assert.ok(footerTop >= tilesBottom - 1, "footer below the tiles");
    log("OK two screen shares side by side inside Element Web");

    // The layout is stored per room in the app's profile
    await widget(clara.page).getByTestId("custom-layout-button").click();
    await widget(clara.page).getByTestId("custom-layout-preset-main-sidebar").click();
    const stored = await frame().evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("element-custom")));
    assert.ok(stored.some((k) => k.endsWith(roomId)), "layout stored for the room");
    log("OK layout stored for room", roomId);
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    for (const x of people) await x.page.screenshot({ path: path.join(RESULTS, `element-web-error-${x.name}.png`) }).catch(() => {});
} finally {
    for (const x of people) await x.browser.close();
    server.kill();
}
process.exit(failed ? 1 : 0);
