/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { MenuItem, Separator } from "@vector-im/compound-web";
import {
  CollapseIcon,
  ExpandIcon,
  FullScreenIcon,
  GridIcon,
  PinIcon,
  UnpinIcon,
  UserIcon,
  VisibilityOffIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { type CustomLayoutViewModel } from "./CustomLayoutViewModel";
import { useBehavior } from "../useBehavior";

interface Props {
  vm: CustomLayoutViewModel;
  streamKey: string;
  userId: string;
  onFullscreen: () => void;
}

/**
 * The layout-related entries of a stream's (context) menu.
 */
export const StreamMenuItems: FC<Props> = ({
  vm,
  streamKey,
  userId,
  onFullscreen,
}) => {
  const { t } = useTranslation();
  const config = useBehavior(vm.config$);
  const maximised = useBehavior(vm.maximised$);
  const streams = useBehavior(vm.streams$);
  const pinned = config.pinned.includes(streamKey);
  const isMaximised = maximised === streamKey;
  const userHasOtherStreams = streams.some(
    (s) => s.userId === userId && s.key !== streamKey,
  );

  return (
    <>
      <Separator />
      <MenuItem
        Icon={pinned ? UnpinIcon : PinIcon}
        label={pinned ? t("custom_layout.unpin") : t("custom_layout.pin")}
        onSelect={() => vm.togglePinned(streamKey)}
      />
      <MenuItem
        Icon={isMaximised ? CollapseIcon : ExpandIcon}
        label={
          isMaximised ? t("custom_layout.restore") : t("custom_layout.maximise")
        }
        onSelect={() => vm.setMaximised(isMaximised ? null : streamKey)}
      />
      <MenuItem
        Icon={FullScreenIcon}
        label={t("custom_layout.fullscreen")}
        onSelect={onFullscreen}
      />
      <MenuItem
        Icon={VisibilityOffIcon}
        label={t("custom_layout.hide")}
        onSelect={() => vm.setHidden(streamKey, true)}
      />
      {userHasOtherStreams && (
        <MenuItem
          Icon={UserIcon}
          label={t("custom_layout.hide_participant")}
          onSelect={() => vm.setUserHidden(userId, true)}
        />
      )}
      <MenuItem
        Icon={GridIcon}
        label={t("custom_layout.button_label")}
        onSelect={() => vm.setPanelOpen(true)}
      />
    </>
  );
};
