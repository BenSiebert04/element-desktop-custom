#!/usr/bin/env node
// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Assembles the web app that is packaged into Mosaix:
//
//  1. Takes the Element Web build made from the tag in upstream.json with our
//     changes applied (scripts/element-web.mjs apply, then `pnpm run build`).
//  2. Replaces the bundled Element Call widget (widgets/element-call) with our
//     own build from element-call/dist.
//  3. Adds our config.json (branding/config.json).
//
// Usage: node scripts/prepare-webapp.mjs --from <Element Web webapp dir> [--out build/webapp]
//                                        [--element-call element-call/dist]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
};

const fromArg = arg("--from");
const outDir = path.resolve(root, arg("--out", "build/webapp"));
const callDist = path.resolve(root, arg("--element-call", "element-call/dist"));

/** True if one of the JavaScript files directly in `dir` contains `needle`. */
function bundleContains(dir, needle) {
    return readdirSync(dir)
        .filter((f) => f.endsWith(".js"))
        .some((f) => readFileSync(path.join(dir, f), "utf8").includes(needle));
}

async function main() {
    if (!fromArg) throw new Error("Missing --from <Element Web webapp dir>");
    const webappBuild = path.resolve(root, fromArg);
    if (!existsSync(path.join(webappBuild, "index.html"))) {
        throw new Error(`Element Web build not found in ${webappBuild}`);
    }
    if (!existsSync(path.join(callDist, "index.html"))) {
        throw new Error(`Element Call build not found in ${callDist}; run "pnpm build:embedded" in element-call first`);
    }

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(path.dirname(outDir), { recursive: true });
    cpSync(webappBuild, outDir, { recursive: true });

    // Sanity check: the web app must contain our Element Web changes
    const bundles = readdirSync(path.join(outDir, "bundles"));
    if (!bundles.some((b) => bundleContains(path.join(outDir, "bundles", b), "io.github.bensiebert04.mosaix.private_voice"))) {
        throw new Error("The Element Web build does not contain the Mosaix changes");
    }

    // Swap in our Element Call
    const widgetDir = path.join(outDir, "widgets", "element-call");
    if (!existsSync(widgetDir)) throw new Error("The Element Web build has no widgets/element-call directory");
    rmSync(widgetDir, { recursive: true, force: true });
    cpSync(callDist, widgetDir, { recursive: true });

    // Sanity check: the widget must contain the custom layout
    if (!bundleContains(path.join(widgetDir, "assets"), "custom-layout-button")) {
        throw new Error("The Element Call build does not contain the custom layout");
    }

    // Our configuration (no update server, no analytics)
    cpSync(path.join(root, "branding", "config.json"), path.join(outDir, "config.json"));
    console.log(`Web app ready in ${outDir}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
