/*
Copyright 2026 Element Custom contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

/**
 * electron-builder configuration of Element Custom.
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
    win: {
        ...upstream.win,
        target: ["nsis", "zip"],
        // Keep "Element Custom" distinct from the official app in Windows
        artifactName: "Element-Custom-${version}-${arch}.${ext}",
    },
    nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: "Element Custom",
        uninstallDisplayName: "Element Custom",
        // Never touch the user's data (and certainly not the official app's)
        deleteAppDataOnUninstall: false,
        artifactName: "Element-Custom-Setup-${version}-${arch}.${ext}",
    },
};

export default config;
