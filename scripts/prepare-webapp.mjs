#!/usr/bin/env node
// Copyright 2026 Element Custom contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Assembles the web app that is packaged into Element Custom:
//
//  1. Downloads the official, prebuilt Element Web release named in
//     upstream.json and verifies its SHA-256 checksum.
//  2. Replaces the bundled Element Call widget (widgets/element-call) with our
//     own build from element-call/dist.
//  3. Adds our config.json (branding/config.json).
//
// Usage: node scripts/prepare-webapp.mjs [--out build/webapp] [--element-call element-call/dist]

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
};

const upstream = JSON.parse(readFileSync(path.join(root, "upstream.json"), "utf8"));
const outDir = path.resolve(root, arg("--out", "build/webapp"));
const callDist = path.resolve(root, arg("--element-call", "element-call/dist"));
const cacheDir = path.join(root, "build", "cache");

function sha256(file) {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function download(url, file) {
    console.log(`Downloading ${url}`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
    writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
}

async function main() {
    const { webappTarball, webappTarballSha256, tag } = upstream.elementWeb;
    if (!existsSync(path.join(callDist, "index.html"))) {
        throw new Error(`Element Call build not found in ${callDist}; run "pnpm build:embedded" in element-call first`);
    }

    mkdirSync(cacheDir, { recursive: true });
    const tarball = path.join(cacheDir, path.basename(new URL(webappTarball).pathname));
    if (!existsSync(tarball) || sha256(tarball) !== webappTarballSha256) {
        await download(webappTarball, tarball);
    }
    const actual = sha256(tarball);
    if (actual !== webappTarballSha256) {
        throw new Error(`Checksum mismatch for ${tarball}: expected ${webappTarballSha256}, got ${actual}`);
    }
    console.log(`Verified Element Web ${tag} (sha256 ${actual})`);

    // Extract into a fresh directory
    const extractDir = path.join(cacheDir, "extract");
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });
    // Relative paths: bsdtar on Windows would read "C:" as a remote host
    execFileSync("tar", ["-xzf", path.relative(extractDir, tarball), "-C", "."], {
        cwd: extractDir,
        stdio: "inherit",
    });
    const [top] = readdirSync(extractDir);
    const webapp = path.join(extractDir, top);

    // Swap in our Element Call
    const widgetDir = path.join(webapp, "widgets", "element-call");
    if (!existsSync(widgetDir)) throw new Error("The Element Web release has no widgets/element-call directory");
    rmSync(widgetDir, { recursive: true, force: true });
    cpSync(callDist, widgetDir, { recursive: true });

    // Sanity check: the widget must contain the custom layout
    const assets = readdirSync(path.join(widgetDir, "assets")).filter((f) => f.endsWith(".js"));
    const hasCustomLayout = assets.some((f) =>
        readFileSync(path.join(widgetDir, "assets", f), "utf8").includes("custom-layout-button"),
    );
    if (!hasCustomLayout) throw new Error("The Element Call build does not contain the custom layout");

    // Our configuration (no update server, no analytics)
    cpSync(path.join(root, "branding", "config.json"), path.join(webapp, "config.json"));

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(path.dirname(outDir), { recursive: true });
    cpSync(webapp, outDir, { recursive: true });
    rmSync(extractDir, { recursive: true, force: true });
    console.log(`Web app ready in ${outDir}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
