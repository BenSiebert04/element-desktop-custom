/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { MenuItem, ToggleMenuItem } from "@vector-im/compound-web";
import {
  PinIcon,
  PopOutIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { type PopoutViewModel } from "./popout";
import { isDesktopApp } from "./desktopBridge";
import { useBehavior } from "../useBehavior";

/**
 * The pop-out entries of a stream's (context) menu: open it in a window of
 * its own (or close that window) and, in the desktop app, whether pop-outs
 * stay on top of all other windows.
 */
export const PopoutMenuItems: FC<{
  popouts: PopoutViewModel;
  streamKey: string;
}> = ({ popouts, streamKey }) => {
  const { t } = useTranslation();
  const open = useBehavior(popouts.open$).includes(streamKey);
  const alwaysOnTop = useBehavior(popouts.alwaysOnTop$);
  return (
    <>
      <MenuItem
        Icon={PopOutIcon}
        label={
          open
            ? t("custom_layout.popout.close")
            : t("custom_layout.popout.open")
        }
        onSelect={() =>
          open ? popouts.close(streamKey) : popouts.open(streamKey)
        }
        data-testid="custom-layout-popout"
      />
      {isDesktopApp() && (
        <ToggleMenuItem
          Icon={PinIcon}
          label={t("custom_layout.popout.always_on_top")}
          checked={alwaysOnTop}
          onSelect={(e) => {
            // Keep the menu open
            e.preventDefault();
            popouts.setAlwaysOnTop(!alwaysOnTop);
          }}
          data-testid="custom-layout-popout-on-top"
        />
      )}
    </>
  );
};
