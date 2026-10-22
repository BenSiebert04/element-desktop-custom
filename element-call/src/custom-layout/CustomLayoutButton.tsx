/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Button, Tooltip } from "@vector-im/compound-web";
import { GridIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { useBehavior } from "../useBehavior";
import { type CustomLayoutViewModel } from "./CustomLayoutViewModel";

interface Props {
  vm: CustomLayoutViewModel;
}

/**
 * The "customise layout" button shown in the call footer.
 */
export const CustomLayoutButton: FC<Props> = ({ vm }) => {
  const { t } = useTranslation();
  const open = useBehavior(vm.panelOpen$);
  const label = t("custom_layout.button_label");
  return (
    <Tooltip label={label}>
      <Button
        iconOnly
        Icon={GridIcon}
        kind={open ? "primary" : "secondary"}
        aria-label={label}
        aria-expanded={open}
        onClick={() => vm.setPanelOpen(!open)}
        data-testid="custom-layout-button"
      />
    </Tooltip>
  );
};
