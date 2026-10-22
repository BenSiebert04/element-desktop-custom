/*
Copyright 2026 Element Custom contributors.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import {
  type CSSProperties,
  type ReactNode,
  type FC,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import { Button } from "@vector-im/compound-web";
import {
  CollapseIcon,
  DragGridIcon,
  ExitFullScreenIcon,
  ExpandIcon,
  FullScreenIcon,
  PinIcon,
  UnpinIcon,
  VisibilityOffIcon,
  VisibilityOnIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { useBehavior } from "../useBehavior";
import { constant } from "../state/Behavior";
import { GridTileViewModel } from "../state/TileViewModel";
import { GridTile } from "../tile/GridTile";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";
import {
  type CustomLayoutViewModel,
  type CustomStream,
} from "./CustomLayoutViewModel";
import {
  computeLayout,
  type Divider,
  type Placement,
  type Rect,
  type Size,
} from "./computePlacements";
import { type CustomLayoutConfig, type RatioId } from "./layoutConfig";
import { ScreenShareTile } from "./ScreenShareTile";
import { StreamMenuItems } from "./StreamMenuItems";
import styles from "./CustomLayoutView.module.css";

/** Pointer movement (px) before a press on a tile turns into a drag. */
const DRAG_THRESHOLD = 5;
/** Smallest size (px) a free tile can be resized to. */
const MIN_TILE_W = 96;
const MIN_TILE_H = 54;
/** Inner padding of the canvas. */
const PADDING = 8;

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

type Interaction =
  | {
      type: "move";
      key: string;
      pointerId: number;
      startX: number;
      startY: number;
      origin: Rect;
      current: Rect;
      started: boolean;
    }
  | {
      type: "resize";
      key: string;
      edge: Edge;
      pointerId: number;
      startX: number;
      startY: number;
      origin: Rect;
      current: Rect;
    }
  | { type: "divider"; divider: Divider; pointerId: number; value: number };

function ratioKey(id: RatioId): keyof CustomLayoutConfig {
  switch (id) {
    case "split":
      return "splitRatio";
    case "strip":
      return "stripRatio";
    case "sidebar":
      return "sidebarRatio";
  }
}

export function resizeRect(
  origin: Rect,
  edge: Edge,
  dx: number,
  dy: number,
  bounds: Size,
): Rect {
  let { x, y, w, h } = origin;
  if (edge.includes("e")) w = Math.min(bounds.width - x, origin.w + dx);
  if (edge.includes("s")) h = Math.min(bounds.height - y, origin.h + dy);
  if (edge.includes("w")) {
    const right = origin.x + origin.w;
    x = Math.min(Math.max(0, origin.x + dx), right - MIN_TILE_W);
    w = right - x;
  }
  if (edge.includes("n")) {
    const bottom = origin.y + origin.h;
    y = Math.min(Math.max(0, origin.y + dy), bottom - MIN_TILE_H);
    h = bottom - y;
  }
  return { x, y, w: Math.max(MIN_TILE_W, w), h: Math.max(MIN_TILE_H, h) };
}

export function moveRect(
  origin: Rect,
  dx: number,
  dy: number,
  bounds: Size,
): Rect {
  return {
    ...origin,
    x: Math.min(
      Math.max(0, origin.x + dx),
      Math.max(0, bounds.width - origin.w),
    ),
    y: Math.min(
      Math.max(0, origin.y + dy),
      Math.max(0, bounds.height - origin.h),
    ),
  };
}

function hitTest(
  tiles: Placement[],
  x: number,
  y: number,
  except: string,
): string | null {
  const hit = tiles.find(
    (t) =>
      t.key !== except &&
      x >= t.x &&
      x <= t.x + t.w &&
      y >= t.y &&
      y <= t.y + t.h,
  );
  return hit?.key ?? null;
}

interface Props {
  vm: CustomLayoutViewModel;
  width: number;
  height: number;
  showSpeakingIndicators: boolean;
  showNameTags: boolean;
  focusable: boolean;
  onOpenProfile: (() => void) | null;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean;
}

/**
 * The call area in the custom layout: renders each visible stream as a tile at
 * the position computed by `computeLayout`, and lets the user rearrange and
 * resize tiles with the mouse.
 *
 * Hidden streams are not rendered at all. Their video elements are therefore
 * detached, which lets LiveKit's adaptive stream pause the video subscription,
 * while their audio keeps playing through the call's separate audio renderer.
 */
export const CustomLayoutView: FC<Props> = ({
  vm,
  width,
  height,
  showSpeakingIndicators,
  showNameTags,
  focusable,
  onOpenProfile,
  className,
  style,
  "aria-hidden": ariaHidden,
}) => {
  const { t } = useTranslation();
  const config = useBehavior(vm.config$);
  const streams = useBehavior(vm.streams$);
  const maximised = useBehavior(vm.maximised$);

  const size = useMemo<Size>(
    () => ({
      width: Math.max(0, width - 2 * PADDING),
      height: Math.max(0, height - 2 * PADDING),
    }),
    [width, height],
  );

  // The interaction in progress, if any. Kept in a ref for the pointer
  // handlers and mirrored into state for rendering.
  const interactionRef = useRef<Interaction | null>(null);
  const [interaction, setInteractionState] = useState<Interaction | null>(null);
  const setInteraction = useCallback((i: Interaction | null) => {
    interactionRef.current = i;
    setInteractionState(i);
  }, []);

  // While a divider is dragged, preview the layout with the new ratio
  const effectiveConfig = useMemo<CustomLayoutConfig>(
    () =>
      interaction?.type === "divider"
        ? {
            ...config,
            [ratioKey(interaction.divider.id)]: interaction.value,
          }
        : config,
    [config, interaction],
  );

  const layout = useMemo(
    () => computeLayout(effectiveConfig, streams, size, maximised),
    [effectiveConfig, streams, size, maximised],
  );

  // Make sure that new streams get a stored position in the free layout
  useEffect(() => {
    if (config.preset === "free") vm.ensureFreeRects(size);
  }, [vm, config.preset, streams, size]);

  const streamsByKey = useMemo(
    () => new Map(streams.map((s) => [s.key, s])),
    [streams],
  );

  // One tile view model per camera, kept for as long as the media exists
  const gridTileVms = useRef(
    new WeakMap<UserMediaViewModel, GridTileViewModel>(),
  );
  const gridTileVm = (media: UserMediaViewModel): GridTileViewModel => {
    let tileVm = gridTileVms.current.get(media);
    if (!tileVm) {
      tileVm = new GridTileViewModel(constant(media));
      gridTileVms.current.set(media, tileVm);
    }
    return tileVm;
  };

  const frames = useRef(new Map<string, HTMLDivElement>());
  const [fullscreenKey, setFullscreenKey] = useState<string | null>(null);
  useEffect(() => {
    const doc = frames.current.values().next().value?.ownerDocument;
    if (!doc) return;
    const onChange = (): void => {
      const el = doc.fullscreenElement;
      const entry = [...frames.current.entries()].find(([, f]) => f === el);
      setFullscreenKey(entry ? entry[0] : null);
    };
    doc.addEventListener("fullscreenchange", onChange);
    return (): void => doc.removeEventListener("fullscreenchange", onChange);
  }, [layout.tiles.length]);

  const toggleFullscreen = useCallback(
    (key: string) => {
      const el = frames.current.get(key);
      const doc = el?.ownerDocument;
      if (!el || !doc) return;
      if (doc.fullscreenElement === el) {
        void doc.exitFullscreen();
        return;
      }
      // Fall back to maximising within the call if full screen is unavailable
      if (!el.requestFullscreen) {
        vm.setMaximised(key);
        return;
      }
      el.requestFullscreen().catch(() => vm.setMaximised(key));
    },
    [vm],
  );

  const toLocal = (
    e: ReactPointerEvent,
    canvas: HTMLElement,
  ): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left - PADDING, e.clientY - r.top - PADDING];
  };
  const canvasRef = useRef<HTMLDivElement>(null);

  // --- Moving tiles -------------------------------------------------------

  const onTilePointerDown = (e: ReactPointerEvent, tile: Placement): void => {
    if (e.button !== 0 || interactionRef.current) return;
    // Leave clicks on the tile's own controls alone
    if (
      (e.target as Element).closest(
        "button, input, [role=menu], [data-no-drag]",
      )
    )
      return;
    if (tile.role === "maximised") return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setInteraction({
      type: "move",
      key: tile.key,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: tile,
      current: tile,
      started: false,
    });
  };

  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const onTilePointerMove = (e: ReactPointerEvent): void => {
    const i = interactionRef.current;
    if (!i || i.type === "divider" || i.pointerId !== e.pointerId) return;
    const dx = e.clientX - i.startX;
    const dy = e.clientY - i.startY;
    if (i.type === "move") {
      const started = i.started || Math.hypot(dx, dy) >= DRAG_THRESHOLD;
      if (!started) return;
      const current = moveRect(i.origin, dx, dy, size);
      setInteraction({ ...i, started, current });
      if (config.preset !== "free" && canvasRef.current) {
        const [x, y] = toLocal(e, canvasRef.current);
        setDropTarget(hitTest(layout.tiles, x, y, i.key));
      }
    } else if (i.type === "resize") {
      setInteraction({
        ...i,
        current: resizeRect(i.origin, i.edge, dx, dy, size),
      });
    }
  };

  const toFraction = (r: Rect): Omit<Rect, never> => ({
    x: r.x / size.width,
    y: r.y / size.height,
    w: r.w / size.width,
    h: r.h / size.height,
  });

  const onTilePointerUp = (e: ReactPointerEvent): void => {
    const i = interactionRef.current;
    if (!i || i.pointerId !== e.pointerId) return;
    if (i.type === "move" && i.started) {
      if (config.preset === "free") {
        vm.setFreeRect(i.key, toFraction(i.current));
        vm.bringToFront(i.key);
      } else if (dropTarget !== null) {
        vm.swap(i.key, dropTarget);
      }
    } else if (i.type === "move" && config.preset === "free") {
      // A plain click brings a free tile to the front
      vm.bringToFront(i.key);
    } else if (i.type === "resize") {
      vm.setFreeRect(i.key, toFraction(i.current));
      vm.bringToFront(i.key);
    }
    setDropTarget(null);
    setInteraction(null);
  };

  const onPointerCancel = (): void => {
    setDropTarget(null);
    setInteraction(null);
  };

  // --- Resizing free tiles ------------------------------------------------

  const onHandlePointerDown = (
    e: ReactPointerEvent,
    tile: Placement,
    edge: Edge,
  ): void => {
    if (e.button !== 0 || interactionRef.current) return;
    e.stopPropagation();
    // Capture on the frame so that its move/up handlers receive the events
    const frame = frames.current.get(tile.key);
    frame?.setPointerCapture?.(e.pointerId);
    setInteraction({
      type: "resize",
      key: tile.key,
      edge,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: tile,
      current: tile,
    });
  };

  // --- Dividers -----------------------------------------------------------

  const onDividerPointerDown = (
    e: ReactPointerEvent,
    divider: Divider,
  ): void => {
    if (e.button !== 0 || interactionRef.current) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setInteraction({
      type: "divider",
      divider,
      pointerId: e.pointerId,
      value: config[ratioKey(divider.id)] as number,
    });
  };
  const onDividerPointerMove = (e: ReactPointerEvent): void => {
    const i = interactionRef.current;
    if (
      i?.type !== "divider" ||
      i.pointerId !== e.pointerId ||
      !canvasRef.current
    )
      return;
    const [x, y] = toLocal(e, canvasRef.current);
    const pos = i.divider.orientation === "vertical" ? x : y;
    setInteraction({
      ...i,
      value: (pos - i.divider.start) / i.divider.length,
    });
  };
  const onDividerPointerUp = (e: ReactPointerEvent): void => {
    const i = interactionRef.current;
    if (i?.type !== "divider" || i.pointerId !== e.pointerId) return;
    vm.setRatio(i.divider.id, i.value);
    setInteraction(null);
  };

  // --- Rendering ----------------------------------------------------------

  const renderTile = (tile: Placement): ReactNode => {
    const stream: CustomStream | undefined = streamsByKey.get(tile.key);
    if (!stream) return null;
    const active =
      interaction &&
      interaction.type !== "divider" &&
      interaction.key === tile.key &&
      (interaction.type === "resize" || interaction.started)
        ? interaction
        : null;
    const rect = active ? active.current : tile;
    const pinned = config.pinned.includes(tile.key);
    const isMaximised = maximised === tile.key;
    const isFullscreen = fullscreenKey === tile.key;
    const menuItems = (
      <StreamMenuItems
        vm={vm}
        streamKey={tile.key}
        userId={stream.userId}
        onFullscreen={() => toggleFullscreen(tile.key)}
      />
    );

    return (
      <div
        key={tile.key}
        ref={(el) => {
          if (el) frames.current.set(tile.key, el);
          else frames.current.delete(tile.key);
        }}
        className={classNames(styles.frame, {
          [styles.dragging]: active !== null,
          [styles.dropTarget]: dropTarget === tile.key,
          [styles.secondary]: tile.role === "secondary",
          [styles.free]: tile.role === "free",
        })}
        style={{
          transform: `translate(${rect.x}px, ${rect.y}px)`,
          width: rect.w,
          height: rect.h,
          zIndex: active ? 1000 : tile.z,
        }}
        data-testid="custom-layout-tile"
        data-stream-key={tile.key}
        data-stream-kind={stream.kind}
        data-role={tile.role}
        onPointerDown={(e) => onTilePointerDown(e, tile)}
        onPointerMove={onTilePointerMove}
        onPointerUp={onTilePointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest("button")) return;
          vm.setMaximised(isMaximised ? null : tile.key);
        }}
      >
        {stream.kind === "camera" ? (
          <GridTile
            vm={gridTileVm(stream.media as UserMediaViewModel)}
            onOpenProfile={onOpenProfile}
            targetWidth={rect.w}
            targetHeight={rect.h}
            className={styles.tile}
            showSpeakingIndicators={showSpeakingIndicators}
            showNameTags={showNameTags}
            showRingingStatus={false}
            showOutline={false}
            focusable={focusable}
            extraMenuItems={menuItems}
          />
        ) : (
          <ScreenShareTile
            vm={
              stream.media as Extract<
                CustomStream["media"],
                { type: "screen share" }
              >
            }
            className={styles.tile}
            targetWidth={rect.w}
            targetHeight={rect.h}
            showNameTags={showNameTags}
            focusable={focusable}
            extraMenuItems={menuItems}
          />
        )}
        <div className={styles.toolbar} data-no-drag>
          <span
            className={styles.grip}
            title={t("custom_layout.drag_to_move")}
            aria-hidden
          >
            <DragGridIcon width={16} height={16} />
          </span>
          <button
            type="button"
            aria-label={
              pinned ? t("custom_layout.unpin") : t("custom_layout.pin")
            }
            title={pinned ? t("custom_layout.unpin") : t("custom_layout.pin")}
            aria-pressed={pinned}
            tabIndex={focusable ? undefined : -1}
            onClick={() => vm.togglePinned(tile.key)}
          >
            {pinned ? (
              <UnpinIcon width={16} height={16} />
            ) : (
              <PinIcon width={16} height={16} />
            )}
          </button>
          <button
            type="button"
            aria-label={
              isMaximised
                ? t("custom_layout.restore")
                : t("custom_layout.maximise")
            }
            title={
              isMaximised
                ? t("custom_layout.restore")
                : t("custom_layout.maximise")
            }
            tabIndex={focusable ? undefined : -1}
            onClick={() => vm.setMaximised(isMaximised ? null : tile.key)}
          >
            {isMaximised ? (
              <CollapseIcon width={16} height={16} />
            ) : (
              <ExpandIcon width={16} height={16} />
            )}
          </button>
          <button
            type="button"
            aria-label={
              isFullscreen
                ? t("custom_layout.exit_fullscreen")
                : t("custom_layout.fullscreen")
            }
            title={
              isFullscreen
                ? t("custom_layout.exit_fullscreen")
                : t("custom_layout.fullscreen")
            }
            tabIndex={focusable ? undefined : -1}
            onClick={() => toggleFullscreen(tile.key)}
          >
            {isFullscreen ? (
              <ExitFullScreenIcon width={16} height={16} />
            ) : (
              <FullScreenIcon width={16} height={16} />
            )}
          </button>
          <button
            type="button"
            aria-label={t("custom_layout.hide")}
            title={t("custom_layout.hide")}
            tabIndex={focusable ? undefined : -1}
            onClick={() => vm.setHidden(tile.key, true)}
            data-testid="custom-layout-hide"
          >
            <VisibilityOffIcon width={16} height={16} />
          </button>
        </div>
        {tile.role === "free" &&
          EDGES.map((edge) => (
            <div
              key={edge}
              className={styles.handle}
              data-edge={edge}
              data-no-drag
              title={t("custom_layout.drag_to_resize")}
              onPointerDown={(e) => onHandlePointerDown(e, tile, edge)}
            />
          ))}
      </div>
    );
  };

  const hiddenCount = layout.hidden.length;
  const nothingVisible = layout.tiles.length === 0 && streams.length > 0;

  return (
    <div
      className={classNames(styles.canvas, className)}
      style={{ ...style, padding: PADDING }}
      aria-hidden={ariaHidden}
      data-testid="custom-layout"
      data-preset={config.preset}
    >
      <div className={styles.inner} ref={canvasRef}>
        {layout.tiles.map(renderTile)}
        {layout.dividers.map((d) => {
          const preview =
            interaction?.type === "divider" && interaction.divider.id === d.id;
          return (
            <div
              key={d.id}
              role="separator"
              aria-orientation={d.orientation}
              aria-label={t("custom_layout.resize_divider")}
              title={t("custom_layout.resize_divider")}
              className={classNames(styles.divider, {
                [styles.dividerActive]: preview,
              })}
              data-orientation={d.orientation}
              data-testid={`custom-layout-divider-${d.id}`}
              style={{ left: d.x, top: d.y, width: d.w, height: d.h }}
              onPointerDown={(e) => onDividerPointerDown(e, d)}
              onPointerMove={onDividerPointerMove}
              onPointerUp={onDividerPointerUp}
              onPointerCancel={onPointerCancel}
            />
          );
        })}
        {nothingVisible && (
          <div className={styles.empty}>
            <p>{t("custom_layout.all_hidden")}</p>
            <Button
              kind="primary"
              size="md"
              Icon={VisibilityOnIcon}
              onClick={vm.showAll}
            >
              {t("custom_layout.show_all")}
            </Button>
          </div>
        )}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          className={styles.hiddenChip}
          onClick={() => vm.setPanelOpen(true)}
          data-testid="custom-layout-hidden-chip"
          tabIndex={focusable ? undefined : -1}
        >
          <VisibilityOffIcon width={16} height={16} aria-hidden />
          {t("custom_layout.hidden_count", { count: hiddenCount })}
        </button>
      )}
    </div>
  );
};
