/*
Copyright 2026 Element Custom contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { type FC, type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  Menu,
  MenuItem,
  ToggleMenuItem,
} from "@vector-im/compound-web";
import {
  MicOffIcon,
  OverflowHorizontalIcon,
  ShareScreenSolidIcon,
  VolumeOffIcon,
  VolumeOnIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { MediaView } from "../tile/MediaView";
import { Slider } from "../Slider";
import { useBehavior } from "../useBehavior";
import { type ScreenShareViewModel } from "../state/media/ScreenShareViewModel";
import { type RemoteScreenShareViewModel } from "../state/media/RemoteScreenShareViewModel";
import { constant } from "../state/Behavior";
import gridTileStyles from "../tile/GridTile.module.css";
import styles from "./CustomLayoutView.module.css";

interface Props {
  vm: ScreenShareViewModel;
  className?: string;
  targetWidth: number;
  targetHeight: number;
  showNameTags: boolean;
  focusable: boolean;
  /** Layout-related menu entries. */
  extraMenuItems?: ReactNode;
}

const alwaysEnabled = constant(true);
const alwaysDisabled = constant(false);

const RemoteVolumeItems: FC<{ vm: RemoteScreenShareViewModel }> = ({ vm }) => {
  const { t } = useTranslation();
  const muted = useBehavior(vm.playbackMuted$);
  const volume = useBehavior(vm.playbackVolume$);
  return (
    <>
      <ToggleMenuItem
        Icon={MicOffIcon}
        label={t("video_tile.mute_for_me")}
        checked={muted}
        onSelect={(e) => {
          e.preventDefault();
          vm.togglePlaybackMuted();
        }}
      />
      <MenuItem
        as="div"
        Icon={muted ? VolumeOffIcon : VolumeOnIcon}
        label={null}
        onSelect={null}
      >
        <Slider
          className={gridTileStyles.volumeSlider}
          label={t("video_tile.volume")}
          value={volume}
          onValueChange={vm.adjustPlaybackVolume}
          onValueCommit={vm.commitPlaybackVolume}
          min={0}
          max={1}
          step={0.01}
        />
      </MenuItem>
    </>
  );
};

/**
 * A tile showing one screen share, sized to fit its content without cropping.
 */
export const ScreenShareTile: FC<Props> = ({
  vm,
  className,
  extraMenuItems,
  focusable,
  ...props
}) => {
  const { t } = useTranslation();
  const video = useBehavior(vm.video$);
  const unencryptedWarning = useBehavior(vm.unencryptedWarning$);
  const focusUrl = useBehavior(vm.focusUrl$);
  const displayName = useBehavior(vm.displayName$);
  const mxcAvatarUrl = useBehavior(vm.mxcAvatarUrl$);
  const videoEnabled = useBehavior(vm.local ? alwaysEnabled : vm.videoEnabled$);
  const hasAudio = useBehavior(vm.local ? alwaysDisabled : vm.audioEnabled$);
  const [menuOpen, setMenuOpen] = useState(false);

  const menu = (
    <>
      {!vm.local && hasAudio && <RemoteVolumeItems vm={vm} />}
      {extraMenuItems}
    </>
  );

  const trigger = useMemo(
    () => (
      <button
        aria-label={t("common.options")}
        tabIndex={focusable ? undefined : -1}
      >
        <OverflowHorizontalIcon aria-hidden width={20} height={20} />
      </button>
    ),
    [t, focusable],
  );

  const title = `${displayName} – ${t("custom_layout.screen")}`;

  return (
    <ContextMenu
      title={title}
      hasAccessibleAlternative
      trigger={
        <MediaView
          className={className}
          video={video}
          videoFit="contain"
          mirror={false}
          userId={vm.userId}
          videoEnabled={videoEnabled}
          unencryptedWarning={unencryptedWarning}
          displayName={displayName}
          mxcAvatarUrl={mxcAvatarUrl}
          focusable={focusable}
          focusUrl={focusUrl}
          data-stream-kind="screen"
          nameTagLeadingIcon={
            <ShareScreenSolidIcon
              width={20}
              height={20}
              aria-hidden
              className={styles.screenIcon}
            />
          }
          primaryButton={
            <Menu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              title={title}
              trigger={trigger}
              side="left"
              align="start"
            >
              {menu}
            </Menu>
          }
          {...props}
        />
      }
    >
      {menu}
    </ContextMenu>
  );
};
