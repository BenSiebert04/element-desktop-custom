/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * electron-builder configuration of Mosaix.
 *
 * This file is copied next to Element Desktop's own `electron-builder.ts`
 * (apps/desktop in element-web) by scripts/prepare-desktop.mjs. It takes the
 * upstream configuration unchanged and only overrides the Windows packaging:
 * an NSIS installer (per user, installation directory selectable) and a
 * portable zip instead of Squirrel/MSI. Name, app id and protocol come from
 * the variant file (branding/variant.json via $VARIANT_PATH).
 */

import upstream from "./electron-builder.ts";

const config = {
    ...upstream,
    // No update feed at all: Mosaix must never be replaced by an
    // official Element release (this also avoids an app-update.yml)
    publish: null,
    // Sound for screen sharing (desktop/app-audio), copied here by
    // scripts/prepare-desktop.mjs --app-audio; outside app.asar because of the
    // native module
    extraResources: [...(upstream.extraResources ?? []), { from: "app-audio", to: "app-audio" }],
    win: {
        ...upstream.win,
        target: ["nsis", "zip"],
        // Keep "Mosaix" distinct from the official app in Windows
        artifactName: "Mosaix-${version}-${arch}.${ext}",
    },
    nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: "Mosaix",
        uninstallDisplayName: "Mosaix",
        // Never touch the user's data (and certainly not the official app's)
        deleteAppDataOnUninstall: false,
        artifactName: "Mosaix-Setup-${version}-${arch}.${ext}",
    },
};

export default config;
