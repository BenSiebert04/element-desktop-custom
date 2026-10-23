// End-to-end test of Private Voice in the shipped web app against the local
// backend (start.sh). private-voice-setup.py creates a space with four category
// sub-spaces, managed text and voice rooms, an unmanaged room and a direct
// message. The test then writes the manifest into Anna's account data while she
// is logged in, as the server side does, and checks the rendered UI:
//
//  - the four categories appear live as sections, in manifest order
//  - a managed text room has no call buttons (not even disabled ones), and its
//    chat history from before the configuration is still there
//  - a managed voice room opens the call lobby without joining by itself; after
//    joining, camera and screen share work
//  - the unmanaged direct message keeps its call buttons
//  - removing the configuration removes only the presentation
//
// Usage (backend running, web app assembled in build/webapp):
//   node e2e/private-voice.e2e.mjs

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
const HS = "http://localhost:8008";
const TYPE = "io.github.bensiebert04.mosaix.private_voice";
mkdirSync(RESULTS, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const webapp = path.join(WORK, "webapp-pv");
rmSync(webapp, { recursive: true, force: true });
cpSync(path.join(here, "../build/webapp"), webapp, { recursive: true });
writeFileSync(
    path.join(webapp, "config.json"),
    JSON.stringify({
        default_server_config: { "m.homeserver": { base_url: HS, server_name: "localhost:8448" } },
        brand: "Mosaix",
    }),
);
const server = spawn("node", [path.join(here, "serve.mjs"), webapp, "8082"], { stdio: "ignore" });
const BASE = "http://localhost:8082";
const setup = JSON.parse(
    execFileSync(path.join(WORK, "venv/bin/python"), [path.join(here, "private-voice-setup.py")]).toString(),
);
const { manifest } = setup;

// Anna's own session for writing her account data; the token stays in memory
const { access_token: token } = await (
    await fetch(`${HS}/_matrix/client/v3/login`, {
        method: "POST",
        body: JSON.stringify({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: "pvanna" },
            password: "testpass123",
        }),
    })
).json();
async function putAccountData(content) {
    const resp = await fetch(
        `${HS}/_matrix/client/v3/user/${encodeURIComponent(manifest.user_id)}/account_data/${TYPE}`,
        { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(content) },
    );
    assert.ok(resp.ok, `account data written (${resp.status})`);
}
// Start without configuration (a previous run may have left one)
await putAccountData({});

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
    permissions: ["microphone", "camera"],
});
const page = await context.newPage();
const roomList = () => page.locator(".mx_RoomListPanel");
const header = () => page.locator(".mx_RoomHeader");
const widget = () => page.frameLocator('iframe[src*="widgets/element-call"]');
const CATEGORY_NAMES = ["Allgemein", "Gaming", "Projekte", "Archiv"];

async function openRoom(roomId) {
    await page.goto(`${BASE}/#/room/${roomId}`);
    const view = roomId === setup.space ? page.locator(".mx_SpaceRoomView") : header();
    await view.waitFor({ timeout: 30000 });
}
async function headerCallButtons() {
    return header()
        .getByRole("button")
        .evaluateAll((buttons) =>
            buttons
                .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "")
                .filter((label) => /call|join|anruf|beitreten/i.test(label)),
        );
}
async function sectionTitles() {
    return roomList()
        .locator('[role="gridcell"] > button[aria-expanded]')
        .evaluateAll((buttons) => buttons.map((b) => b.innerText.split("\n")[0].trim()));
}

let failed = false;
try {
    await page.goto(`${BASE}/#/login`);
    await page.getByLabel("Username").fill("pvanna");
    await page.getByLabel("Password").fill("testpass123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Dismiss" }).click({ timeout: 30000 }).catch(() => {});

    // Without configuration: the space shows the rooms as usual, the text room has calls
    await openRoom(setup.space);
    await openRoom(setup.rooms.general_text);
    assert.ok((await headerCallButtons()).length > 0, "call buttons without configuration");
    for (const name of CATEGORY_NAMES) assert.equal(await roomList().getByText(name, { exact: true }).count(), 0);
    log("OK baseline without configuration");

    // The server side writes the configuration: applied live, without a reload
    await putAccountData(manifest);
    for (const name of CATEGORY_NAMES) await roomList().getByText(name, { exact: true }).first().waitFor({ timeout: 30000 });
    const titles = await sectionTitles();
    log("sections:", JSON.stringify(titles));
    const order = CATEGORY_NAMES.map((n) => titles.indexOf(n));
    assert.ok(order.every((i) => i >= 0), "all four categories are sections");
    assert.deepEqual([...order].sort((a, b) => a - b), order, "categories in manifest order");
    for (const r of manifest.spaces[0].rooms) {
        // The jam channel's name also shows the number of running Jams
        const name = r.kind === "jam" ? `${r.name} · ♪ 1 live` : r.name;
        assert.equal(await roomList().getByText(name, { exact: true }).count(), 1, `${r.name} listed once`);
    }
    await page.screenshot({ path: path.join(RESULTS, "private-voice-1-categories.png") });
    log("OK four categories applied live, each room listed once with its configured name");

    // Jam channel: Ben's running Jam with a join button, sharing and ending one's own
    assert.equal(await roomList().getByText("🎵 Jams · ♪ 1 live", { exact: true }).count(), 1, "jam count in the list");
    await openRoom(setup.rooms.jams);
    const panel = page.getByTestId("jam-panel");
    await panel.waitFor({ timeout: 15000 });
    const benCard = panel.locator('[data-testid="jam-card"]').filter({ hasText: "Bens Abendmix" });
    await assert.doesNotReject(benCard.getByText("7 minutes").waitFor({ timeout: 5000 }));
    assert.equal(
        await benCard.getByTestId("jam-join").getAttribute("href"),
        "https://open.spotify.com/socialsession/BenJam42",
    );
    assert.deepEqual(await headerCallButtons(), [], "no calls in the jam channel");
    await panel.getByTestId("jam-share").click();
    await panel.getByTestId("jam-link").fill("https://example.org/not-a-jam");
    assert.equal(await panel.getByTestId("jam-share-submit").getAttribute("aria-disabled"), "true");
    await panel.getByTestId("jam-link").fill("https://open.spotify.com/socialsession/AnnaJam7");
    await panel.getByTestId("jam-title").fill("Annas Playlist");
    await panel.getByTestId("jam-share-submit").click();
    await panel.locator('[data-testid="jam-card"]').filter({ hasText: "Annas Playlist" }).waitFor({ timeout: 15000 });
    await roomList().getByText("🎵 Jams · ♪ 2 live", { exact: true }).waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(RESULTS, "private-voice-6-jams.png") });
    await panel.getByTestId("jam-end").click();
    await panel.locator('[data-testid="jam-card"]').filter({ hasText: "Annas Playlist" }).waitFor({ state: "detached", timeout: 15000 });
    log("OK jam channel: running Jam with join link, own Jam shared and ended, live count in the list");

    // Managed text room: no call buttons at all, history preserved
    await openRoom(setup.rooms.general_text);
    assert.deepEqual(await headerCallButtons(), [], "no call buttons in a managed text room");
    assert.equal(await header().locator("button[disabled], button[aria-disabled='true']").count(), 0);
    await page.getByText("Nachricht vor der Konfiguration").waitFor({ timeout: 15000 });
    await page.getByRole("textbox", { name: /message/i }).fill("Nachricht nach der Konfiguration");
    await page.keyboard.press("Enter");
    await page.getByText("Nachricht nach der Konfiguration").last().waitFor({ timeout: 15000 });
    await assert.doesNotReject(header().getByText("Discord: text").waitFor({ timeout: 5000 }));
    await page.screenshot({ path: path.join(RESULTS, "private-voice-2-text-room.png") });
    log("OK managed text room: no call buttons, history kept, messaging works");

    // Managed voice room: lobby, no automatic join
    await roomList().getByText("🔊 Treffpunkt", { exact: true }).click();
    await widget().getByTestId("lobby_joinCall").waitFor({ timeout: 45000 });
    assert.equal(await widget().getByTestId("incall_leave").count(), 0, "not joined automatically");
    await page.screenshot({ path: path.join(RESULTS, "private-voice-3-voice-lobby.png") });
    log("OK managed voice room opens the lobby without joining");

    await widget().getByTestId("lobby_joinCall").click();
    await widget().getByTestId("incall_leave").waitFor({ timeout: 30000 });
    const video = widget().getByRole("switch", { name: /video|camera/i }).first();
    if ((await video.getAttribute("aria-checked")) !== "true") await video.click();
    await widget().getByRole("switch", { name: "Share screen" }).click();
    const frame = () => page.frames().find((f) => f.url().includes("widgets/element-call"));
    await frame().waitForFunction(
        // Own camera and own screen share, both actually playing
        () => [...document.querySelectorAll("video")].filter((v) => v.videoWidth > 0 && !v.paused).length >= 2,
        null,
        { timeout: 30000 },
    );
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(RESULTS, "private-voice-4-voice-call.png") });
    await widget().getByTestId("incall_leave").click();
    await widget().getByTestId("incall_leave").waitFor({ state: "detached", timeout: 30000 });
    log("OK joined the voice room with camera and screen share");

    // Unmanaged direct message keeps its call buttons
    await openRoom(setup.dm);
    for (const name of ["Voice call", "Video call"]) {
        const button = header().getByRole("button", { name, exact: true });
        await button.waitFor({ timeout: 15000 });
        assert.equal(await button.isEnabled(), true, `${name} enabled in the direct message`);
    }
    const dmButtons = await headerCallButtons();
    await page.screenshot({ path: path.join(RESULTS, "private-voice-5-direct-message.png") });
    log("OK direct message keeps", JSON.stringify(dmButtons));

    // Removing the configuration only removes the presentation
    await putAccountData({ ...manifest, revision: "2".repeat(64), spaces: [] });
    await openRoom(setup.space);
    await roomList().getByText("Allgemein", { exact: true }).waitFor({ state: "detached", timeout: 30000 });
    await openRoom(setup.rooms.general_text);
    assert.ok((await headerCallButtons()).length > 0, "call buttons back after removal");
    await page.getByText("Nachricht nach der Konfiguration").waitFor({ timeout: 15000 });
    log("OK removal restores the normal view, history kept");
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    await page.screenshot({ path: path.join(RESULTS, "private-voice-error.png") }).catch(() => {});
} finally {
    await putAccountData({}).catch(() => {});
    await browser.close();
    server.kill();
}
process.exit(failed ? 1 : 0);
