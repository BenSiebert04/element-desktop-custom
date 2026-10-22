/*
Copyright 2026 Element Custom contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import {
  type FC,
  type FormEvent,
  type ReactNode,
  useId,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import { Button, IconButton, Text } from "@vector-im/compound-web";
import {
  CloseIcon,
  DeleteIcon,
  PinIcon,
  SaveIcon,
  ShareScreenSolidIcon,
  UnpinIcon,
  VideoCallSolidIcon,
  VisibilityOffIcon,
  VisibilityOnIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { useBehavior } from "../useBehavior";
import {
  type CustomLayoutViewModel,
  type CustomStream,
} from "./CustomLayoutViewModel";
import { isStreamVisible, type PresetId } from "./layoutConfig";
import { type Size } from "./computePlacements";
import styles from "./LayoutPanel.module.css";

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "default", label: "custom_layout.preset_default" },
  { id: "auto", label: "custom_layout.preset_auto" },
  { id: "grid", label: "custom_layout.preset_grid" },
  { id: "two-streams", label: "custom_layout.preset_two_streams" },
  { id: "four-streams", label: "custom_layout.preset_four_streams" },
  { id: "main-sidebar", label: "custom_layout.preset_main_sidebar" },
  { id: "free", label: "custom_layout.preset_free" },
];

/** Small schematic previews of the presets. */
type Box = [number, number, number, number];

const PresetPreview: FC<{ id: PresetId }> = ({ id }) => {
  const boxes = (
    {
    default: [
      [2, 2, 26, 20],
      [30, 2, 16, 9],
      [30, 13, 16, 9],
    ],
    auto: [
      [2, 2, 21, 14],
      [25, 2, 21, 14],
      [2, 18, 10, 6],
      [14, 18, 10, 6],
      [26, 18, 10, 6],
    ],
    grid: [
      [2, 2, 14, 10],
      [17, 2, 14, 10],
      [32, 2, 14, 10],
      [2, 13, 14, 10],
      [17, 13, 14, 10],
      [32, 13, 14, 10],
    ],
    "two-streams": [
      [2, 2, 21, 15],
      [25, 2, 21, 15],
      [9, 19, 9, 5],
      [20, 19, 9, 5],
      [31, 19, 9, 5],
    ],
    "four-streams": [
      [2, 2, 21, 10],
      [25, 2, 21, 10],
      [2, 14, 21, 10],
      [25, 14, 21, 10],
    ],
    "main-sidebar": [
      [2, 2, 33, 22],
      [37, 2, 9, 6],
      [37, 10, 9, 6],
      [37, 18, 9, 6],
    ],
    free: [
      [3, 3, 24, 14],
      [20, 10, 22, 13],
      [36, 3, 9, 6],
    ],
    } satisfies Record<PresetId, Box[]>
  )[id];
  return (
    <svg viewBox="0 0 48 26" className={styles.preview} aria-hidden>
      {boxes.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={1.5} />
      ))}
    </svg>
  );
};

const StreamRow: FC<{
  vm: CustomLayoutViewModel;
  stream: CustomStream;
  visible: boolean;
  pinned: boolean;
}> = ({ vm, stream, visible, pinned }) => {
  const { t } = useTranslation();
  const displayName = useBehavior(stream.media.displayName$);
  const Icon = stream.kind === "screen" ? ShareScreenSolidIcon : VideoCallSolidIcon;
  const kindLabel =
    stream.kind === "screen"
      ? t("custom_layout.screen")
      : t("custom_layout.camera");
  const name = `${displayName}${stream.local ? ` ${t("custom_layout.you")}` : ""}`;
  return (
    <li
      className={classNames(styles.stream, { [styles.hidden]: !visible })}
      data-testid="custom-layout-stream-row"
      data-stream-key={stream.key}
      data-visible={visible}
    >
      <Icon width={18} height={18} aria-hidden className={styles.kindIcon} />
      <span className={styles.streamName} title={`${name} – ${kindLabel}`}>
        <Text as="span" size="sm" weight="medium">
          {name}
        </Text>
        <Text as="span" size="xs" className={styles.kindLabel}>
          {kindLabel}
        </Text>
      </span>
      <IconButton
        size="28px"
        tooltip={pinned ? t("custom_layout.unpin") : t("custom_layout.pin")}
        aria-pressed={pinned}
        onClick={() => vm.togglePinned(stream.key)}
      >
        {pinned ? <UnpinIcon /> : <PinIcon />}
      </IconButton>
      <IconButton
        size="28px"
        tooltip={visible ? t("custom_layout.hide") : t("custom_layout.show")}
        aria-pressed={!visible}
        onClick={() => vm.setHidden(stream.key, visible)}
        data-testid="custom-layout-toggle-visibility"
      >
        {visible ? <VisibilityOnIcon /> : <VisibilityOffIcon />}
      </IconButton>
    </li>
  );
};

interface Props {
  vm: CustomLayoutViewModel;
  /** Size of the call area, used when switching to the free layout. */
  canvasSize: Size;
  className?: string;
}

/**
 * The "customise layout" side panel.
 */
export const LayoutPanel: FC<Props> = ({ vm, canvasSize, className }) => {
  const { t } = useTranslation();
  const config = useBehavior(vm.config$);
  const streams = useBehavior(vm.streams$);
  const saved = useBehavior(vm.savedLayouts$);
  const hasGlobalDefault = useBehavior(vm.hasGlobalDefault$);
  const [name, setName] = useState("");
  const nameId = useId();
  const titleId = useId();

  const screens = streams.filter((s) => s.kind === "screen");
  const cameras = streams.filter((s) => s.kind === "camera");
  const hiddenCount = streams.filter((s) => !isStreamVisible(config, s)).length;

  const onSave = (e: FormEvent): void => {
    e.preventDefault();
    if (name.trim() === "") return;
    vm.saveNamed(name);
    setName("");
  };

  const row = (s: CustomStream): ReactNode => (
    <StreamRow
      key={s.key}
      vm={vm}
      stream={s}
      visible={isStreamVisible(config, s)}
      pinned={config.pinned.includes(s.key)}
    />
  );

  return (
    <aside
      className={classNames(styles.panel, className)}
      aria-labelledby={titleId}
      data-testid="custom-layout-panel"
      // Don't let the call view treat interactions here as screen taps
      onPointerUp={(e) => e.stopPropagation()}
    >
      <header className={styles.header}>
        <Text as="h2" size="lg" weight="semibold" id={titleId}>
          {t("custom_layout.button_label")}
        </Text>
        <IconButton
          size="32px"
          tooltip={t("action.close")}
          onClick={() => vm.setPanelOpen(false)}
        >
          <CloseIcon />
        </IconButton>
      </header>

      <section>
        <Text as="h3" size="sm" weight="semibold" className={styles.heading}>
          {t("custom_layout.presets_heading")}
        </Text>
        <div className={styles.presets} role="radiogroup">
          {PRESETS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={config.preset === id}
              className={styles.preset}
              onClick={() => vm.setPreset(id, canvasSize)}
              data-testid={`custom-layout-preset-${id}`}
            >
              <PresetPreview id={id} />
              <Text as="span" size="xs" weight="medium">
                {t(label as "custom_layout.preset_auto")}
              </Text>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className={styles.sectionHeader}>
          <Text as="h3" size="sm" weight="semibold" className={styles.heading}>
            {t("custom_layout.streams_heading")} ({streams.length})
          </Text>
          {hiddenCount > 0 && (
            <Button
              kind="tertiary"
              size="md"
              onClick={vm.showAll}
              data-testid="custom-layout-show-all"
            >
              {t("custom_layout.show_all")}
            </Button>
          )}
        </div>
        <Text as="p" size="xs" className={styles.hint}>
          {t("custom_layout.hidden_hint")}
        </Text>
        <Text as="h4" size="xs" weight="semibold" className={styles.subheading}>
          {t("custom_layout.screen_shares")}
        </Text>
        {screens.length === 0 ? (
          <Text as="p" size="xs" className={styles.hint}>
            {t("custom_layout.no_screen_shares")}
          </Text>
        ) : (
          <ul className={styles.streams}>{screens.map(row)}</ul>
        )}
        <div className={styles.sectionHeader}>
          <Text
            as="h4"
            size="xs"
            weight="semibold"
            className={styles.subheading}
          >
            {t("custom_layout.cameras")}
          </Text>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.hideCameras}
              onChange={(e) => vm.setHideCameras(e.target.checked)}
              data-testid="custom-layout-hide-cameras"
            />
            <Text as="span" size="xs">
              {t("custom_layout.hide_cameras")}
            </Text>
          </label>
        </div>
        <ul className={styles.streams}>{cameras.map(row)}</ul>
      </section>

      <section>
        <Text as="h3" size="sm" weight="semibold" className={styles.heading}>
          {t("custom_layout.saved_heading")}
        </Text>
        <form className={styles.saveForm} onSubmit={onSave}>
          <label htmlFor={nameId} className={styles.visuallyHidden}>
            {t("custom_layout.save_name_label")}
          </label>
          <input
            id={nameId}
            className={styles.input}
            value={name}
            placeholder={t("custom_layout.save_name_label")}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            data-testid="custom-layout-save-name"
          />
          <Button
            kind="secondary"
            size="md"
            Icon={SaveIcon}
            type="submit"
            disabled={name.trim() === ""}
          >
            {t("custom_layout.save")}
          </Button>
        </form>
        {saved.length === 0 ? (
          <Text as="p" size="xs" className={styles.hint}>
            {t("custom_layout.no_saved")}
          </Text>
        ) : (
          <ul className={styles.saved}>
            {saved.map((s) => (
              <li key={s.name} data-testid="custom-layout-saved">
                <Text as="span" size="sm" className={styles.streamName}>
                  {s.name}
                </Text>
                <Button
                  kind="tertiary"
                  size="md"
                  onClick={() => vm.loadNamed(s.name)}
                >
                  {t("custom_layout.load")}
                </Button>
                <IconButton
                  size="28px"
                  tooltip={t("custom_layout.delete")}
                  onClick={() => vm.deleteNamed(s.name)}
                >
                  <DeleteIcon />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <Button kind="secondary" size="md" onClick={vm.setAsGlobalDefault}>
            {t("custom_layout.set_global")}
          </Button>
          {hasGlobalDefault && (
            <Button kind="tertiary" size="md" onClick={vm.clearGlobalDefault}>
              {t("custom_layout.clear_global")}
            </Button>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        <Text as="p" size="xs" className={styles.hint}>
          {t("custom_layout.room_note")}
        </Text>
        <Button
          kind="secondary"
          destructive
          size="md"
          onClick={vm.resetToStandard}
          data-testid="custom-layout-reset"
        >
          {t("custom_layout.reset")}
        </Button>
      </footer>
    </aside>
  );
};
