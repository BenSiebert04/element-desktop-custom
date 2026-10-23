/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { MenuItem, Separator } from "@vector-im/compound-web";
import { GridIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type CustomLayoutViewModel } from "./CustomLayoutViewModel";
import { PopoutMenuItems } from "./PopoutMenuItems";
import { useBehavior } from "../useBehavior";

/**
 * The entries of a tile's menu in Element Call's standard view: open the
 * "customise layout" panel and pop the tile's stream out.
 */
export const OpenLayoutMenuItem: FC<{
  vm: CustomLayoutViewModel;
  /** The stream of the tile, if it can be popped out. */
  streamKey?: string;
}> = ({ vm, streamKey }) => {
  const { t } = useTranslation();
  const streams = useBehavior(vm.streams$);
  const poppable =
    streamKey !== undefined && streams.some((s) => s.key === streamKey);
  return (
    <>
      <Separator />
      <MenuItem
        Icon={GridIcon}
        label={t("custom_layout.button_label")}
        onSelect={() => vm.setPanelOpen(true)}
      />
      {poppable && (
        <PopoutMenuItems popouts={vm.popouts} streamKey={streamKey} />
      )}
    </>
  );
};
