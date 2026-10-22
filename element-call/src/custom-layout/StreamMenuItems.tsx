/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { MenuItem, Separator } from "@vector-im/compound-web";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CollapseIcon,
  ExpandIcon,
  FullScreenIcon,
  GridIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
  UnpinIcon,
  UserIcon,
  VisibilityOffIcon,
  VisibilityOnIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { type CustomLayoutViewModel } from "./CustomLayoutViewModel";
import { useBehavior } from "../useBehavior";
import { Slider } from "../Slider";
import {
  LAYER_MAX,
  OPACITY_MIN,
  streamLayer,
  streamOpacity,
} from "./layoutConfig";
import styles from "./StreamMenuItems.module.css";

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
  const free = config.preset === "free";
  const layer = streamLayer(config, streamKey);
  const transparency = 1 - streamOpacity(config, streamKey);
  const percent = (v: number): string => `${Math.round(v * 100)} %`;
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
      {free && (
        <>
          <MenuItem
            Icon={ArrowUpIcon}
            label={t("custom_layout.bring_to_front")}
            onSelect={() => vm.bringToFront(streamKey)}
          />
          <MenuItem
            Icon={ArrowDownIcon}
            label={t("custom_layout.send_to_back")}
            onSelect={() => vm.sendToBack(streamKey)}
          />
          <MenuItem as="div" Icon={GridIcon} label={null} onSelect={null}>
            <div className={styles.row} data-testid="custom-layout-layer">
              <span className={styles.label}>
                {t("custom_layout.layer", { layer })}
              </span>
              <button
                type="button"
                className={styles.stepper}
                aria-label={t("custom_layout.layer_down")}
                title={t("custom_layout.layer_down")}
                disabled={layer <= 0}
                onClick={() => vm.setLayer(streamKey, layer - 1)}
              >
                <MinusIcon width={16} height={16} />
              </button>
              <button
                type="button"
                className={styles.stepper}
                aria-label={t("custom_layout.layer_up")}
                title={t("custom_layout.layer_up")}
                disabled={layer >= LAYER_MAX}
                onClick={() => vm.setLayer(streamKey, layer + 1)}
              >
                <PlusIcon width={16} height={16} />
              </button>
            </div>
          </MenuItem>
        </>
      )}
      <MenuItem as="div" Icon={VisibilityOnIcon} label={null} onSelect={null}>
        <div className={styles.column} data-testid="custom-layout-transparency">
          <span className={styles.label}>
            {t("custom_layout.transparency", { value: percent(transparency) })}
          </span>
          <Slider
            className={styles.slider}
            label={t("custom_layout.transparency_label")}
            value={transparency}
            onValueChange={(v) => vm.setOpacity(streamKey, 1 - v)}
            min={0}
            max={1 - OPACITY_MIN}
            step={0.05}
            tooltipFormatter={percent}
          />
        </div>
      </MenuItem>
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
