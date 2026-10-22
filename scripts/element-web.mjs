#!/usr/bin/env node
// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Mosaix's changes to Element Web are kept in this repository as
//
//   element-web/overlay/   new files, copied into the checkout as they are
//   element-web/patches/   changes to upstream files, applied with `git apply`
//   element-web/patches-desktop/
//                          changes to Element Desktop (apps/desktop/src), applied
//                          by scripts/prepare-desktop.mjs
//
// Usage:
//   node scripts/element-web.mjs apply  <element-web checkout>
//       Applies overlay and patches to a clean checkout of the tag in upstream.json.
//   node scripts/element-web.mjs export <element-web checkout>
//       Writes the changes made in a development checkout back to this repository.
//       Changes to package manifests and the lockfile are never exported.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overlayDir = path.join(root, "element-web", "overlay");
const patchDir = path.join(root, "element-web", "patches");
const PATCH_FILE = "mosaix.patch";
const desktopPatchDir = path.join(root, "element-web", "patches-desktop");
const DESKTOP_PATCH_FILE = "mosaix-desktop.patch";
/** Element Desktop code we change (new files included). */
const DESKTOP_PATHS = ["apps/desktop/src"];
/** Our new code lives here in the checkout; it is copied, not patched. */
const OVERLAY_PATHS = ["apps/web/src/mosaix"];
/** Never part of the patch (local install workarounds must not leak into the build). */
const EXCLUDED = [":(exclude)package.json", ":(exclude)**/package.json", ":(exclude)pnpm-lock.yaml", ":(exclude)apps/desktop"];

const [command, checkoutArg] = process.argv.slice(2);
if (!["apply", "export"].includes(command) || !checkoutArg) {
    console.error("Usage: node scripts/element-web.mjs apply|export <element-web checkout>");
    process.exit(1);
}
const checkout = path.resolve(checkoutArg);
const git = (...args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

if (command === "apply") {
    for (const p of OVERLAY_PATHS) {
        const from = path.join(overlayDir, p);
        if (existsSync(from)) cpSync(from, path.join(checkout, p), { recursive: true });
        console.log(`overlay ${p}`);
    }
    for (const patch of readdirSync(patchDir).filter((f) => f.endsWith(".patch")).sort()) {
        execFileSync("git", ["apply", "--whitespace=nowarn", path.join(patchDir, patch)], {
            cwd: checkout,
            stdio: "inherit",
        });
        console.log(`patch ${patch}`);
    }
} else {
    for (const p of OVERLAY_PATHS) {
        const to = path.join(overlayDir, p);
        rmSync(to, { recursive: true, force: true });
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(path.join(checkout, p), to, { recursive: true });
        console.log(`overlay ${p}`);
    }
    const diff = git("diff", "--", ".", ...OVERLAY_PATHS.map((p) => `:(exclude)${p}`), ...EXCLUDED);
    mkdirSync(patchDir, { recursive: true });
    writeFileSync(path.join(patchDir, PATCH_FILE), diff);
    console.log(`patch ${PATCH_FILE}: ${diff.split("\n").filter((l) => l.startsWith("diff --git")).length} files`);

    // New files in Element Desktop become part of its patch
    git("add", "--intent-to-add", "--", ...DESKTOP_PATHS);
    const desktopDiff = git("diff", "--", ...DESKTOP_PATHS);
    mkdirSync(desktopPatchDir, { recursive: true });
    writeFileSync(path.join(desktopPatchDir, DESKTOP_PATCH_FILE), desktopDiff);
    console.log(
        `patch ${DESKTOP_PATCH_FILE}: ${desktopDiff.split("\n").filter((l) => l.startsWith("diff --git")).length} files`,
    );
}
