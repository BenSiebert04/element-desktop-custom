#!/usr/bin/env node
// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Applies the Mosaix branding to a checkout of Element Desktop
// (apps/desktop in the element-web monorepo). Only files are added or
// replaced; no upstream source file is modified:
//
//  - variant.json            (app name, app id, protocol; used via $VARIANT_PATH)
//  - electron-builder.custom.ts (Windows installer settings)
//  - build/icon.png, build/icon.ico (app icon)
//  - webapp/                 (the assembled web app, if --webapp is given)
//
// Usage: node scripts/prepare-desktop.mjs <path to apps/desktop> [--webapp build/webapp]

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [desktopDirArg, ...rest] = process.argv.slice(2);
if (!desktopDirArg) {
    console.error("Usage: node scripts/prepare-desktop.mjs <apps/desktop> [--webapp <dir>]");
    process.exit(1);
}
const desktopDir = path.resolve(desktopDirArg);
const pkg = JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8"));
if (pkg.name !== "element-desktop") throw new Error(`${desktopDir} is not Element Desktop`);

const copy = (from, to) => {
    cpSync(path.join(root, from), path.join(desktopDir, to), { recursive: true });
    console.log(`${from} -> ${path.join(desktopDir, to)}`);
};

// Mosaix's changes to Element Desktop (see scripts/element-web.mjs)
const checkoutRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: desktopDir, encoding: "utf8" }).trim();
const desktopPatchDir = path.join(root, "element-web", "patches-desktop");
for (const patch of existsSync(desktopPatchDir) ? readdirSync(desktopPatchDir).filter((f) => f.endsWith(".patch")).sort() : []) {
    const file = path.join(desktopPatchDir, patch);
    const applied = spawnSync("git", ["apply", "--reverse", "--check", file], { cwd: checkoutRoot }).status === 0;
    if (applied) {
        console.log(`patch ${patch} (already applied)`);
        continue;
    }
    execFileSync("git", ["apply", "--whitespace=nowarn", file], { cwd: checkoutRoot, stdio: "inherit" });
    console.log(`patch ${patch}`);
}

copy("branding/variant.json", "variant.json");
copy("desktop/electron-builder.custom.ts", "electron-builder.custom.ts");
copy("branding/build/icon.png", "build/icon.png");
copy("branding/build/icon.ico", "build/icon.ico");

const webappIndex = rest.indexOf("--webapp");
if (webappIndex !== -1) {
    const webapp = path.resolve(rest[webappIndex + 1]);
    if (!existsSync(path.join(webapp, "index.html"))) throw new Error(`No web app in ${webapp}`);
    rmSync(path.join(desktopDir, "webapp"), { recursive: true, force: true });
    cpSync(webapp, path.join(desktopDir, "webapp"), { recursive: true });
    console.log(`${webapp} -> ${path.join(desktopDir, "webapp")}`);
}
