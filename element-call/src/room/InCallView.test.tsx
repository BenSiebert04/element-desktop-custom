/*
Copyright 2025 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import { act, render, type RenderResult } from "@testing-library/react";
import { type LocalParticipant } from "livekit-client";
import { BehaviorSubject, of } from "rxjs";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@vector-im/compound-web";
import { RoomContext, useLocalParticipant } from "@livekit/components-react";
import userEvent from "@testing-library/user-event";

import { ActiveCall, InCallView } from "./InCallView";
import {
  mockLivekitRoom,
  mockLocalParticipant,
  mockMediaDevices,
  mockMuteStates,
  mockRemoteParticipant,
  mockRtcMembership,
  type MockRTCSession,
} from "../utils/test";
import { E2eeType } from "../e2ee/e2eeType";
import {
  getBasicCallViewModelEnvironment,
  getBasicRTCSession,
} from "../utils/test-viewmodel";
import {
  type CallViewModel,
  type CallViewModelOptions,
} from "../state/CallViewModel/CallViewModel";
import { alice, local } from "../utils/test-fixtures";
import { ReactionsSenderProvider } from "../reactions/useReactionsSender";
import { useRoomEncryptionSystem } from "../e2ee/sharedKeyManagement";
import { LivekitRoomAudioRenderer } from "../livekit/MatrixAudioRenderer";
import { MediaDevicesContext } from "../MediaDevicesContext";
import { type MediaDevices as ECMediaDevices } from "../state/MediaDevices";
import { AppBar } from "../AppBar";
import { type MatrixInfo } from "./VideoPreview";
import { ProcessorProvider } from "../livekit/TrackProcessorContext";
import { initializeWidget } from "../widget";
import { RootElementProvider } from "../RootElementContext";
import { constant } from "../state/Behavior";
import { testScope } from "../utils/test";
import {
  createCustomLayoutViewModel,
  type CustomLayoutViewModel,
} from "../custom-layout/CustomLayoutViewModel";
import {
  type KeyValueStore,
  LayoutStorage,
} from "../custom-layout/layoutStorage";
import {
  type CustomLayoutConfig,
  standardViewConfig,
} from "../custom-layout/layoutConfig";

initializeWidget();
vi.hoisted(
  () =>
    // Use globalThis rather than global because vite-plugin-node-polyfills seems
    // to rewrite global into an import which then interferes with vitest's hoisting
    // which runs before imports.
    (globalThis.ImageData = class MockImageData {
      public data: number[] = [];
    } as unknown as typeof ImageData),
);

vi.mock("../soundUtils");
vi.mock("../useAudioContext");
vi.mock("../tile/GridTile");
vi.mock("../tile/SpotlightTile");
vi.mock("@livekit/components-react");
vi.mock("livekit-client/e2ee-worker?worker");
vi.mock("../e2ee/sharedKeyManagement");
vi.mock("../livekit/MatrixAudioRenderer");
vi.mock("react-use-measure", () => ({
  default: (): [() => void, object] => [(): void => {}, {}],
}));

const localRtcMember = mockRtcMembership("@carol:example.org", "CCCC");
const localParticipant = mockLocalParticipant({
  identity: "@local:example.org:AAAAAA",
});
const remoteParticipant = mockRemoteParticipant({
  identity: "@alice:example.org:AAAAAA",
});

const matrixInfo = {
  userId: "",
  displayName: "",
  avatarUrl: "",
  roomId: "",
  roomName: "",
  roomAlias: null,
  roomAvatar: null,
  e2eeSystem: { kind: E2eeType.NONE },
} satisfies MatrixInfo;

let useRoomEncryptionSystemMock: MockedFunction<typeof useRoomEncryptionSystem>;

beforeEach(() => {
  vi.clearAllMocks();

  // MatrixAudioRenderer is tested separately.
  (
    LivekitRoomAudioRenderer as MockedFunction<typeof LivekitRoomAudioRenderer>
  ).mockImplementation((_props) => {
    return <div>mocked: MatrixAudioRenderer</div>;
  });
  (
    useLocalParticipant as MockedFunction<typeof useLocalParticipant>
  ).mockImplementation(
    () =>
      ({
        isScreenShareEnabled: false,
        localParticipant: localRtcMember as unknown as LocalParticipant,
      }) as unknown as ReturnType<typeof useLocalParticipant>,
  );
  useRoomEncryptionSystemMock =
    useRoomEncryptionSystem as typeof useRoomEncryptionSystemMock;
  useRoomEncryptionSystemMock.mockReturnValue({ kind: E2eeType.NONE });
});
interface CreateInCallViewArgs {
  mediaDevices?: ECMediaDevices;
  callViewModelOptions?: Partial<CallViewModelOptions>;
  /** If true, wraps the rendered tree in an AppBar provider */
  withAppBar?: boolean;
  /**
   * [element-custom] The stored custom layout of the room. Defaults to
   * Element Call's standard view.
   */
  customLayout?: Partial<CustomLayoutConfig>;
  /** Overrides of individual call view model members. */
  vmOverrides?: Partial<CallViewModel>;
}

export function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
function createInCallView(args: CreateInCallViewArgs = {}): RenderResult & {
  rtcSession: MockRTCSession;
  vm: CallViewModel;
  customLayoutVm: CustomLayoutViewModel;
} {
  const mediaDevices = args.mediaDevices ?? mockMediaDevices({});
  const muteState = mockMuteStates();
  const livekitRoom = mockLivekitRoom(
    {
      localParticipant,
    },
    {
      remoteParticipants$: of([remoteParticipant]),
    },
  );
  const env = getBasicCallViewModelEnvironment(
    [local, alice],
    undefined,
    mediaDevices,
    args.callViewModelOptions,
  );
  const { footerVm, developerSettingsVm, rtcSession } = env;
  const vm: CallViewModel = { ...env.vm, ...args.vmOverrides };

  rtcSession.joined = true;
  const room = rtcSession.room;
  const client = room.client;

  const storage = new LayoutStorage(memoryStore());
  storage.saveRoom(room.roomId, {
    ...standardViewConfig(),
    ...args.customLayout,
  });
  const customLayoutVm = createCustomLayoutViewModel(testScope(), {
    roomId: room.roomId,
    storage,
    userMedia$: vm.customLayoutUserMedia$,
    screenShares$: vm.customLayoutScreenShares$,
  });

  const inCallView = (
    <InCallView
      client={client}
      rtcSession={rtcSession.asMockedSession()}
      muteStates={muteState}
      vm={vm}
      footerVm={footerVm}
      developerSettingsVm={developerSettingsVm}
      customLayoutVm={customLayoutVm}
      matrixInfo={matrixInfo}
      matrixRoom={room}
      onShareClick={null}
    />
  );

  const content = args.withAppBar ? <AppBar>{inCallView}</AppBar> : inCallView;

  const renderResult = render(
    <BrowserRouter>
      <MediaDevicesContext value={mediaDevices}>
        <ReactionsSenderProvider
          vm={vm}
          rtcSession={rtcSession.asMockedSession()}
        >
          <TooltipProvider>
            <RoomContext value={livekitRoom}>{content}</RoomContext>
          </TooltipProvider>
        </ReactionsSenderProvider>
      </MediaDevicesContext>
    </BrowserRouter>,
  );
  return {
    ...renderResult,
    rtcSession,
    vm,
    customLayoutVm,
  };
}

describe("InCallView", () => {
  describe("rendering", () => {
    it("renders", () => {
      const { container } = createInCallView();
      expect(container).toMatchSnapshot();
    });
  });

  describe("audioOutputSwitcher", () => {
    it("is visible and can be clicked", async () => {
      const user = userEvent.setup();
      const switchFn = vi.fn();
      // Create mediaDevices with a speaker and an earpiece available,
      // with the speaker currently selected.
      // This is needed so that the audio switcher button is visible
      const available$ = new BehaviorSubject(
        new Map<string, { type: "speaker" } | { type: "earpiece" }>([
          ["speaker-id", { type: "speaker" }],
          ["earpiece-id", { type: "earpiece" }],
        ]),
      );
      const selected$ = new BehaviorSubject({
        id: "speaker-id",
        virtualEarpiece: false,
      });

      const mediaDevices = mockMediaDevices({
        audioOutput: {
          available$,
          selected$,
          select: switchFn,
        },
      });

      const { getByRole } = createInCallView({ mediaDevices });
      // The button should be visible. When current output is "speaker",
      const audioOutputBtn = getByRole("button", { name: "Loudspeaker" });
      expect(audioOutputBtn).toBeVisible();

      await user.click(audioOutputBtn);

      // Clicking the button should call select -> switchFn with the earpiece device id
      expect(switchFn).toHaveBeenCalledWith("earpiece-id");
    });
  });
});

describe("InCallView with the custom layout", () => {
  it("replaces the standard grid while a custom preset is active", () => {
    const { container, queryByTestId } = createInCallView({
      customLayout: { preset: "auto" },
    });
    expect(queryByTestId("custom-layout")).not.toBeNull();
    const tiles = container.querySelectorAll(
      '[data-testid="custom-layout-tile"]',
    );
    expect(tiles.length).toBeGreaterThan(0);
  });

  it("keeps a hidden participant audible", () => {
    const livekitRoomItems = [
      {
        livekitRoom: mockLivekitRoom({ localParticipant }),
        url: "https://sfu.example.org",
        participants: [remoteParticipant.identity],
      },
    ];
    const { container, customLayoutVm, vm } = createInCallView({
      customLayout: { preset: "auto" },
      vmOverrides: { livekitRoomItems$: constant(livekitRoomItems) },
    });
    const audioRenderer = LivekitRoomAudioRenderer as MockedFunction<
      typeof LivekitRoomAudioRenderer
    >;
    const audioPropsBefore = audioRenderer.mock.lastCall?.[0];
    expect(audioPropsBefore?.validIdentities).toEqual([
      remoteParticipant.identity,
    ]);
    const before = container.querySelectorAll(
      '[data-testid="custom-layout-tile"]',
    ).length;
    const remote = customLayoutVm.streams$.value.find((s) => !s.local)!;
    act(() => customLayoutVm.setUserHidden(remote.userId, true));
    expect(
      container.querySelectorAll('[data-testid="custom-layout-tile"]'),
    ).toHaveLength(before - 1);
    // The participant is still in the call...
    expect(vm.customLayoutUserMedia$.value.map((m) => m.userId)).toContain(
      remote.userId,
    );
    // ...and the audio of the call is rendered exactly as before, unaffected
    // by what is shown on screen
    const audioPropsAfter = audioRenderer.mock.lastCall?.[0];
    expect(audioPropsAfter?.validIdentities).toEqual(
      audioPropsBefore?.validIdentities,
    );
    expect(audioPropsAfter?.muted).toBe(false);
  });

  it("opens the layout panel from the footer", async () => {
    const user = userEvent.setup();
    const { getByTestId, queryByTestId } = createInCallView({
      customLayout: { preset: "auto" },
    });
    expect(queryByTestId("custom-layout-panel")).toBeNull();
    await user.click(getByTestId("custom-layout-button"));
    expect(getByTestId("custom-layout-panel")).toBeVisible();
  });

  it("restores the standard view completely", async () => {
    const user = userEvent.setup();
    const { getByTestId, queryByTestId, container } = createInCallView({
      customLayout: { preset: "free", hideCameras: true },
    });
    await user.click(getByTestId("custom-layout-button"));
    await user.click(getByTestId("custom-layout-reset"));
    expect(queryByTestId("custom-layout")).toBeNull();
    // Element Call's grid is back
    expect(container.querySelector("[data-layout]")).not.toBeNull();
  });
});

describe("ActiveCall", () => {
  it("creates the view models and renders the call", async () => {
    const mediaDevices = mockMediaDevices({});
    const { rtcSession, matrixRoom } = getBasicRTCSession([local, alice]);
    const { findByTestId } = render(
      <BrowserRouter>
        <MediaDevicesContext value={mediaDevices}>
          <ProcessorProvider>
            <TooltipProvider>
              <RoomContext value={mockLivekitRoom({ localParticipant })}>
                <ActiveCall
                  client={matrixRoom.client}
                  rtcSession={rtcSession.asMockedSession()}
                  matrixRoom={matrixRoom}
                  muteStates={mockMuteStates()}
                  matrixInfo={matrixInfo}
                  onShareClick={null}
                  e2eeSystem={{ kind: E2eeType.NONE }}
                  onLeft={(): void => {}}
                />
              </RoomContext>
            </TooltipProvider>
          </ProcessorProvider>
        </MediaDevicesContext>
      </BrowserRouter>,
    );
    // Rendering at all proves ActiveCall created all of its view models
    expect(await findByTestId("incall_leave")).toBeVisible();
  });

  it("lays the call out for the size of its root element", async () => {
    // jsdom has no layout and no ResizeObserver: the root reports whatever
    // size we say, and the observer notifies whenever we tell it to
    let size = { width: 1000, height: 800 };
    const root = document.createElement("div");
    Object.defineProperty(root, "clientWidth", { get: () => size.width });
    Object.defineProperty(root, "clientHeight", { get: () => size.height });
    document.body.appendChild(root);

    const observers: (() => void)[] = [];
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      public constructor(private readonly callback: ResizeObserverCallback) {}
      public observe(): void {
        observers.push(() => this.callback([], this as ResizeObserver));
      }
      public unobserve(): void {}
      public disconnect(): void {}
    } as unknown as typeof ResizeObserver;

    try {
      const mediaDevices = mockMediaDevices({});
      const { rtcSession, matrixRoom } = getBasicRTCSession([local, alice]);
      const { findByTestId, container } = render(
        <BrowserRouter>
          <RootElementProvider value={root}>
            <MediaDevicesContext value={mediaDevices}>
              <ProcessorProvider>
                <TooltipProvider>
                  <RoomContext value={mockLivekitRoom({ localParticipant })}>
                    <ActiveCall
                      client={matrixRoom.client}
                      rtcSession={rtcSession.asMockedSession()}
                      matrixRoom={matrixRoom}
                      muteStates={mockMuteStates()}
                      matrixInfo={matrixInfo}
                      onShareClick={null}
                      e2eeSystem={{ kind: E2eeType.NONE }}
                      onLeft={(): void => {}}
                    />
                  </RoomContext>
                </TooltipProvider>
              </ProcessorProvider>
            </MediaDevicesContext>
          </RootElementProvider>
        </BrowserRouter>,
        { container: root },
      );
      await findByTestId("incall_leave");
      const call = container.querySelector("[data-layout]")!;
      expect(call.getAttribute("data-layout")).not.toBe("pip");

      // The host shrinks the container to a corner of its page. The window has
      // not changed at all — what matters is the element we were given.
      size = { width: 300, height: 300 };
      act(() => observers.forEach((notify) => notify()));
      expect(call.getAttribute("data-layout")).toBe("pip");

      size = { width: 1000, height: 800 };
      act(() => observers.forEach((notify) => notify()));
      expect(call.getAttribute("data-layout")).not.toBe("pip");
    } finally {
      window.ResizeObserver = originalResizeObserver;
      root.remove();
    }
  });
});
