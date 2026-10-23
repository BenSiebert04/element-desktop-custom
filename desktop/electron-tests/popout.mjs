// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Pop-out windows in real Electron, set up like Element Desktop: a sandboxed
// window with context isolation shows a page that embeds Element Call in an
// iframe with Element Web's widget sandbox flags. The iframe opens a pop-out
// with window.open and fills it itself.
//
// Usage: electron desktop/electron-tests/popout.mjs <built popouts.js>
// (the main process module of the desktop patch, built by tsc into lib/).
// Prints "RESULT {...}" and exits with 0 if everything held.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, protocol, screen } from "electron";

const lib = await import(pathToFileURL(path.resolve(process.argv.at(-1))).href);
const { isPopoutRequest, POPOUT_WINDOW_OPTIONS, registerPopout, setPopoutAlwaysOnTop } = lib;

const WIDGET_SANDBOX =
    "allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-presentation allow-downloads";
const pages = {
    "/index.html": `<!doctype html><title>Mosaix</title><iframe id="call" sandbox="${WIDGET_SANDBOX}" src="app://mosaix/call.html"></iframe>`,
    "/call.html": "<!doctype html><title>Call</title><p>call</p>",
    "/elsewhere.html": "<!doctype html><title>Elsewhere</title>",
};

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
// As in Element Desktop; only left out where Chromium cannot sandbox at all
// (running as root in a container, started with --no-sandbox)
if (!process.argv.includes("--no-sandbox")) app.enableSandbox();

const result = {};
const fail = (message) => {
    result.error = message;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, timeout = 5000) {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(50)) if (await check()) return;
    throw new Error(`timed out: ${what}`);
}

app.whenReady().then(async () => {
    try {
        protocol.handle("app", (request) => {
            const page = pages[new URL(request.url).pathname];
            return new Response(page ?? "not found", {
                status: page ? 200 : 404,
                headers: { "content-type": "text/html" },
            });
        });
        const main = new BrowserWindow({
            show: true,
            webPreferences: { contextIsolation: true, nodeIntegration: false },
        });
        // As in the desktop patch (webcontents-handler.ts)
        const created = [];
        main.webContents.setWindowOpenHandler((details) =>
            isPopoutRequest(details)
                ? { action: "allow", overrideBrowserWindowOptions: POPOUT_WINDOW_OPTIONS }
                : { action: "deny" },
        );
        main.webContents.on("did-create-window", (win, details) => {
            if (isPopoutRequest(details)) {
                registerPopout(win, details.frameName, screen);
                created.push({ win, name: details.frameName });
            }
        });
        await main.loadURL("app://mosaix/index.html");
        await until(() => main.webContents.mainFrame.frames.length === 1, "call iframe");
        const call = main.webContents.mainFrame.frames[0];
        await until(async () => (await call.executeJavaScript("document.readyState")) === "complete", "iframe loaded");

        // Element Call opens a pop-out far off any screen and fills it itself
        const NAME = "mosaix-popout-_alice_example_org_DEV_0-1a2b3c";
        result.opened = await call.executeJavaScript(`(() => {
            const win = window.open("", ${JSON.stringify(NAME)}, "popup=yes,width=400,height=225,left=-20000,top=50");
            if (!win) return false;
            window.__popout = win;
            const p = win.document.createElement("p");
            p.textContent = "Anna";
            win.document.body.replaceChildren(p);
            return true;
        })()`);
        await until(() => created.length === 1, "pop-out window created");
        const { win } = created[0];
        result.name = created[0].name === NAME;
        await until(async () => (await win.webContents.executeJavaScript("document.body.textContent")) === "Anna", "content");
        result.filledByCall = true;

        // Moved onto a screen
        const b = win.getBounds();
        result.onScreen = screen
            .getAllDisplays()
            .some(({ workArea: a }) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height);
        result.bounds = b;
        result.menuBar = win.isMenuBarVisible();

        // Always on top on request
        setPopoutAlwaysOnTop(NAME, true);
        result.onTop = win.isAlwaysOnTop();
        setPopoutAlwaysOnTop(NAME, false);
        result.notOnTop = !win.isAlwaysOnTop();

        // Nothing else opens, and the pop-out cannot navigate
        result.otherNameBlocked = await call.executeJavaScript(`window.open("", "other", "popup") === null`);
        result.urlBlocked = await call.executeJavaScript(
            `window.open("app://mosaix/elsewhere.html", ${JSON.stringify(NAME + "x")}, "popup") === null`,
        );
        await win.webContents.executeJavaScript(`location.href = "app://mosaix/elsewhere.html"; true`).catch(() => {});
        await sleep(500);
        result.stayed = win.webContents.getURL() === "about:blank";
        result.windows = BrowserWindow.getAllWindows().length;

        // Closing from Element Call closes the window
        await call.executeJavaScript("window.__popout.close(); true");
        await until(() => win.isDestroyed(), "pop-out closed");
        result.closed = true;
    } catch (e) {
        fail(String(e?.stack ?? e));
    }
    const ok =
        !result.error &&
        ["opened", "name", "filledByCall", "onScreen", "onTop", "notOnTop", "otherNameBlocked", "urlBlocked", "stayed", "closed"].every(
            (k) => result[k] === true,
        ) &&
        result.menuBar === false &&
        result.windows === 2;
    console.log("RESULT " + JSON.stringify(result));
    app.exit(ok ? 0 : 1);
});
