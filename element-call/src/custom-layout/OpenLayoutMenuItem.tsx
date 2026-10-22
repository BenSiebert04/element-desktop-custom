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

/**
 * The entry that opens the "customise layout" panel from a tile's menu in
 * Element Call's standard view.
 */
export const OpenLayoutMenuItem: FC<{ vm: CustomLayoutViewModel }> = ({
  vm,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <Separator />
      <MenuItem
        Icon={GridIcon}
        label={t("custom_layout.button_label")}
        onSelect={() => vm.setPanelOpen(true)}
      />
    </>
  );
};
