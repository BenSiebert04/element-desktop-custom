/*
Copyright 2026 Mosaix contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import { Button, Menu, MenuItem } from "@vector-im/compound-web";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import { useObservableEagerState } from "observable-hooks";

import { ShareScreenButton } from "../button";
import styles from "../components/MediaMuteAndSwitchButton.module.css";
import modeStyles from "./ScreenShareModeButton.module.css";
import { SCREEN_SHARE_MODES, screenShareMode } from "./screenShareMode";

interface Props {
  size: "md" | "lg";
  enabled: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * The screen share button, with a menu to choose the mode: standard,
 * readability (resolution first) or speed (frame rate first).
 */
export const ScreenShareModeButton: FC<Props> = ({
  size,
  enabled,
  onClick,
  className,
}) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const stored = useObservableEagerState(screenShareMode.value$);
  // Unknown stored values count as "standard"
  const mode = SCREEN_SHARE_MODES.includes(stored) ? stored : "standard";

  return (
    <div
      className={classNames(className, styles.container, {
        [styles.containerOpen]: menuOpen,
      })}
    >
      <ShareScreenButton
        size={size}
        enabled={enabled}
        onClick={onClick}
        data-testid="incall_screenshare"
      />
      <Menu
        title={t("custom_layout.screen_share_mode.title")}
        showTitle
        open={menuOpen}
        onOpenChange={setMenuOpen}
        side="top"
        trigger={
          <Button
            iconOnly
            className={classNames(styles.menuButton, {
              [styles.chevronIconOpen]: menuOpen,
            })}
            Icon={menuOpen ? ChevronUpIcon : ChevronDownIcon}
            kind="tertiary"
            size={size}
            aria-label={t("custom_layout.screen_share_mode.title")}
            data-testid="screen-share-mode-button"
          />
        }
      >
        {SCREEN_SHARE_MODES.map((m) => (
          <MenuItem
            key={m}
            hideChevron
            label={null}
            Icon={
              <CheckIcon
                width={24}
                height={24}
                className={classNames(modeStyles.check, {
                  [modeStyles.unchecked]: m !== mode,
                })}
                aria-hidden
              />
            }
            aria-checked={m === mode}
            role="menuitemradio"
            data-testid={`screen-share-mode-${m}`}
            onSelect={() => screenShareMode.setValue(m)}
          >
            <span className={modeStyles.text}>
              <span className={modeStyles.name}>
                {t(`custom_layout.screen_share_mode.${m}`)}
              </span>
              <span className={modeStyles.description}>
                {t(`custom_layout.screen_share_mode.${m}_description`)}
              </span>
            </span>
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
};
