import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanelCoordinator } from './WorkspacePanelCoordinator';

const mocks = vi.hoisted(() => ({
  eventHandlers: {} as Record<string, (event: never) => void>,
  moveRequest: null as
    | null
    | ((group: never, position: 'right' | 'bottom' | 'floating') => boolean),
  externalTabDrop: null as null | ((payload: never, group: string, index: number) => void),
  tabTearOff: null as null | ((payload: never, cursor: { x: number; y: number }) => void),
  canStartTabDrag: null as null | ((panelId: string) => boolean),
  tabDragIdentity: null as null | {
    windowName: string;
    ownerWindowName: string;
    clusterId: string;
    getTabSnapshot: (panelId: string) => unknown;
  },
  clusterPreflight: null as null | ((clusterId: string) => Promise<boolean>),
  beginOpen: vi.fn(async (owner: string, snapshot: unknown) => ({
    owner,
    snapshot,
  })),
  commitWindow: vi.fn(),
  dockWindow: vi.fn(),
  removeWindow: vi.fn(),
  acknowledgeDock: vi.fn<() => Promise<void>>(async () => undefined),
  failTransfer: vi.fn<() => Promise<void>>(async () => undefined),
  requestGuard: vi.fn(async (..._args: unknown[]) => undefined),
  acknowledgeQuit: vi.fn(async () => undefined),
  acknowledgeWorkspaceClose: vi.fn(async () => undefined),
  authorizeObjectOpen: vi.fn(async () => undefined),
  authorizeTabClose: vi.fn(async () => undefined),
  requestTabTransfer: vi.fn(async (_caller: string, _request: unknown) => undefined),
  acceptTabTransfer: vi.fn(async () => undefined),
  failTabTransfer: vi.fn(async () => undefined),
  focusPanelWindow: vi.fn(async () => undefined),
  requestPanelClose: vi.fn(async () => undefined),
  syncPanelWindowSnapshot: vi.fn(),
  panelIdsForPanelWindow: vi.fn(() => ['panel-a']),
  removeOwnedPanel: vi.fn(),
  upsertOwnedPanel: vi.fn(),
  getOwnedPanel: vi.fn((_clusterId: string, _panelId: string): unknown => null),
  panelIdsForCluster: vi.fn(() => ['panel-a']),
  nativeWindowNamesForCluster: vi.fn(() => ['panel-1']),
  focusPanel: vi.fn(),
  dockPanelGroup: vi.fn(),
  detachPanelGroup: vi.fn(),
  discardPanelLayouts: vi.fn(),
  tabGroups: {
    right: { tabs: ['panel-a'], activeTab: 'panel-a' as string | null },
    bottom: { tabs: [] as string[], activeTab: null as string | null },
    floating: [],
  },
  focusOwnerWindow: vi.fn(async () => undefined),
  objectPanelLayoutDefaults: {
    dockedRightWidth: 500,
    dockedBottomHeight: 300,
    floatingWidth: 720,
    floatingHeight: 560,
  },
  openPanels: new Map<string, typeof objectRef>(),
  nativeLocations: new Map<string, { windowName: string; groupId: string }>(),
  pendingNativeOpenPanelIds: new Set<string>(),
  blocker: null as null | { reason: 'unsaved-yaml'; focus: () => void },
  reportError: vi.fn(),
}));

vi.mock('@/core/settings/appPreferences', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getObjectPanelLayoutDefaults: () => mocks.objectPanelLayoutDefaults,
}));

vi.mock('@/core/desktop-runtime', () => ({
  getWindowIdentity: () => 'workspace-1',
  focusWindow: mocks.focusOwnerWindow,
}));

vi.mock('@/core/panel-windows', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const event = (name: string) => (handler: (event: never) => void) => {
    mocks.eventHandlers[name] = handler;
    return () => undefined;
  };
  return {
    ...actual,
    beginPanelWindowOpen: mocks.beginOpen,
    acknowledgePanelWindowDock: mocks.acknowledgeDock,
    acknowledgeWorkspaceWindowClose: mocks.acknowledgeWorkspaceClose,
    authorizePanelObjectOpen: mocks.authorizeObjectOpen,
    authorizePanelTabClose: mocks.authorizeTabClose,
    requestPanelTabTransfer: mocks.requestTabTransfer,
    acceptPanelTabTransfer: mocks.acceptTabTransfer,
    failPanelTabTransfer: mocks.failTabTransfer,
    focusPanelWindow: mocks.focusPanelWindow,
    failPanelWindowTransfer: mocks.failTransfer,
    requestPanelWindowClose: mocks.requestPanelClose,
    requestPanelWindowGuard: mocks.requestGuard,
    acknowledgeApplicationQuitPreflight: mocks.acknowledgeQuit,
    onPanelWindowOpened: event('opened'),
    onPanelWindowSnapshotUpdated: event('snapshot'),
    onPanelTabCloseRequested: event('tabClose'),
    onPanelWindowDockRequested: event('dock'),
    onPanelWindowClosed: event('closed'),
    onOwnerCloseRequested: event('ownerClose'),
    onPanelObjectOpenRequested: event('objectOpen'),
    onApplicationQuitPreflightRequested: event('applicationQuit'),
    onPanelWindowGuardResult: event('guardResult'),
    onPanelTabTransferRequested: event('tabTransferRequested'),
    onPanelTabTransferCommitted: event('tabTransferCommitted'),
    onPanelTabTransferFailed: event('tabTransferFailed'),
  };
});

const objectRef = {
  clusterId: 'cluster-1',
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'default',
  name: 'api',
};

const tabTransferRequest = (overrides: Record<string, unknown> = {}) => ({
  transferId: 'tab-transfer-test',
  sourceWindowName: 'workspace-1',
  targetWindowName: 'panel-2',
  ownerWindowName: 'workspace-1',
  clusterId: 'cluster-1',
  sourceGroupId: 'right',
  targetGroupId: 'native-group-2',
  targetIndex: 0,
  targetKind: 'panel-window',
  cursorX: 0,
  cursorY: 0,
  tab: {
    kind: 'object',
    panelId: 'panel-a',
    objectRef: { ...objectRef, namespace: objectRef.namespace ?? '' },
    activeView: 'details',
  },
  ...overrides,
});

vi.mock('@/modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useObjectPanelActiveTabs: () => new Map([['panel-a', 'details']]),
  useObjectPanelState: () => ({
    openPanels: mocks.openPanels,
    nativeLocations: mocks.nativeLocations,
    pendingNativeOpenPanelIds: mocks.pendingNativeOpenPanelIds,
    commitPanelWindow: mocks.commitWindow,
    dockPanelWindow: mocks.dockWindow,
    removePanelWindow: mocks.removeWindow,
    getOwnedPanel: mocks.getOwnedPanel,
    panelIdsForCluster: mocks.panelIdsForCluster,
    nativeWindowNamesForCluster: mocks.nativeWindowNamesForCluster,
    panelIdsForPanelWindow: mocks.panelIdsForPanelWindow,
    syncPanelWindowSnapshot: mocks.syncPanelWindowSnapshot,
    removeOwnedPanel: mocks.removeOwnedPanel,
    upsertOwnedPanel: mocks.upsertOwnedPanel,
  }),
}));

vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    registerClusterClosePreflight: (preflight: (clusterId: string) => Promise<boolean>) => {
      mocks.clusterPreflight = preflight;
      return () => undefined;
    },
    selectedClusterIds: ['cluster-1'],
    selectedKubeconfigs: ['cluster-1'],
    getClusterMeta: (value: string) => ({ id: value, name: value }),
    setActiveKubeconfig: vi.fn(),
    selectedClusterId: 'cluster-1',
  }),
}));

vi.mock('@/core/panel-windows/panelLifecycleGuards', () => ({
  usePanelLifecycleGuardRegistry: () => ({
    firstBlocker: () => mocks.blocker,
  }),
}));

vi.mock('@/utils/errorHandler', () => ({
  reportOperationalError: mocks.reportError,
}));

vi.mock('@/ui/dockable', () => ({
  DockablePanelProvider: ({
    children,
    onGroupMoveRequest,
    onExternalTabDrop,
    onTabTearOff,
    tabDragIdentity,
    canStartTabDrag,
  }: {
    children: React.ReactNode;
    onGroupMoveRequest: typeof mocks.moveRequest;
    onExternalTabDrop: typeof mocks.externalTabDrop;
    onTabTearOff: typeof mocks.tabTearOff;
    tabDragIdentity: typeof mocks.tabDragIdentity;
    canStartTabDrag: typeof mocks.canStartTabDrag;
  }) => {
    mocks.moveRequest = onGroupMoveRequest;
    mocks.externalTabDrop = onExternalTabDrop;
    mocks.tabTearOff = onTabTearOff;
    mocks.tabDragIdentity = tabDragIdentity;
    mocks.canStartTabDrag = canStartTabDrag;
    return children;
  },
  useDockablePanelContext: () => ({
    tabGroups: mocks.tabGroups,
    focusPanel: mocks.focusPanel,
    dockPanelGroup: mocks.dockPanelGroup,
    detachPanelGroup: mocks.detachPanelGroup,
    discardPanelLayouts: mocks.discardPanelLayouts,
  }),
}));

describe('WorkspacePanelCoordinator', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.blocker = null;
    mocks.openPanels.clear();
    mocks.openPanels.set('panel-a', objectRef);
    mocks.nativeLocations.clear();
    mocks.pendingNativeOpenPanelIds.clear();
    mocks.getOwnedPanel.mockReturnValue(null);
    mocks.panelIdsForCluster.mockReturnValue(['panel-a']);
    mocks.nativeWindowNamesForCluster.mockReturnValue(['panel-1']);
    mocks.panelIdsForPanelWindow.mockReturnValue(['panel-a']);
    mocks.tabGroups.right = { tabs: ['panel-a'], activeTab: 'panel-a' };
    mocks.tabGroups.bottom = { tabs: [], activeTab: null };
    mocks.tabGroups.floating = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(
        <WorkspacePanelCoordinator>
          <div data-testid="source" />
        </WorkspacePanelCoordinator>
      );
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('keeps the owner source until the child acknowledges readiness', async () => {
    await act(async () => {
      mocks.moveRequest?.(
        { groupKey: 'right', tabs: ['panel-a'], activeTab: 'panel-a' } as never,
        'floating'
      );
      await Promise.resolve();
    });
    expect(mocks.beginOpen).toHaveBeenCalledOnce();
    expect(mocks.commitWindow).not.toHaveBeenCalled();
    expect(mocks.detachPanelGroup).not.toHaveBeenCalled();

    const snapshot = mocks.beginOpen.mock.calls[0]?.[1] as Record<string, unknown>;
    await act(async () =>
      mocks.eventHandlers.opened?.({
        windowName: 'panel-other',
        snapshot: { ...snapshot, ownerWindowName: 'workspace-other' },
      } as never)
    );
    expect(mocks.commitWindow).not.toHaveBeenCalled();
    expect(mocks.detachPanelGroup).not.toHaveBeenCalled();

    await act(async () =>
      mocks.eventHandlers.opened?.({
        windowName: 'panel-1',
        groupId: snapshot.groupId,
        snapshot,
      } as never)
    );
    expect(mocks.detachPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a']);
    expect(mocks.discardPanelLayouts).toHaveBeenCalledWith('cluster-1', ['panel-a']);
    expect(mocks.commitWindow).toHaveBeenCalledWith(snapshot, 'panel-1');
    expect(mocks.detachPanelGroup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.commitWindow.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it('starts only one native transfer while a group is already floating', async () => {
    const request = {
      groupKey: 'right',
      tabs: ['panel-a'],
      activeTab: 'panel-a',
    } as never;

    await act(async () => {
      mocks.moveRequest?.(request, 'floating');
      mocks.moveRequest?.(request, 'floating');
      await Promise.resolve();
    });

    expect(mocks.beginOpen).toHaveBeenCalledOnce();
  });

  it('allows clean tab drags and blocks guarded ones', () => {
    expect(mocks.canStartTabDrag?.('panel-a')).toBe(true);

    const focus = vi.fn();
    mocks.blocker = { reason: 'unsaved-yaml', focus };
    expect(mocks.canStartTabDrag?.('panel-a')).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('rejects workspace drops outside the docked edges', () => {
    const tab = mocks.tabDragIdentity?.getTabSnapshot('panel-a');
    mocks.externalTabDrop?.(
      {
        kind: 'dockable-tab',
        panelId: 'panel-a',
        sourceGroupId: 'right',
        sourceWindowGroupId: 'right',
        sourceWindowName: 'workspace-1',
        ownerWindowName: 'workspace-1',
        clusterId: 'cluster-1',
        tab,
      } as never,
      'floating-1',
      0
    );

    expect(mocks.requestTabTransfer).not.toHaveBeenCalled();
  });

  it('reports a workspace drop request that the registry rejects', async () => {
    const requestError = new Error('registry unavailable');
    mocks.requestTabTransfer.mockRejectedValueOnce(requestError);
    const tab = mocks.tabDragIdentity?.getTabSnapshot('panel-a');

    await act(async () => {
      mocks.externalTabDrop?.(
        {
          kind: 'dockable-tab',
          panelId: 'panel-a',
          sourceGroupId: 'native-group-1',
          sourceWindowGroupId: 'native-group-1',
          sourceWindowName: 'panel-1',
          ownerWindowName: 'workspace-1',
          clusterId: 'cluster-1',
          tab,
        } as never,
        'right',
        0
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.reportError).toHaveBeenCalledWith(requestError, {
      source: 'WorkspacePanelCoordinator',
      action: 'request-tab-drop',
      clusterId: 'cluster-1',
    });
  });

  it('ignores foreign tear-offs and reports an owned tear-off request failure', async () => {
    const tab = mocks.tabDragIdentity?.getTabSnapshot('panel-a');
    const payload = {
      kind: 'dockable-tab',
      panelId: 'panel-a',
      sourceGroupId: 'right',
      sourceWindowGroupId: 'right',
      sourceWindowName: 'panel-1',
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-1',
      tab,
    };

    mocks.tabTearOff?.(payload as never, { x: 1800, y: 500 });
    expect(mocks.requestTabTransfer).not.toHaveBeenCalled();

    const requestError = new Error('registry unavailable');
    mocks.requestTabTransfer.mockRejectedValueOnce(requestError);
    await act(async () => {
      mocks.tabTearOff?.(
        {
          ...payload,
          sourceWindowName: 'workspace-1',
        } as never,
        { x: 1800, y: 500 }
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.reportError).toHaveBeenCalledWith(requestError, {
      source: 'WorkspacePanelCoordinator',
      action: 'tear-off-tab',
      clusterId: 'cluster-1',
    });
  });

  it('tears off only the dragged tab and keeps its docked source until native readiness', async () => {
    mocks.getOwnedPanel.mockReturnValue({
      objectRef,
      activeView: 'details',
      dockedEdge: 'right',
    });
    const tab = mocks.tabDragIdentity?.getTabSnapshot('panel-a');

    await act(async () => {
      mocks.tabTearOff?.(
        {
          kind: 'dockable-tab',
          panelId: 'panel-a',
          sourceGroupId: 'right',
          sourceWindowGroupId: 'right',
          sourceWindowName: 'workspace-1',
          ownerWindowName: 'workspace-1',
          clusterId: 'cluster-1',
          tab,
        } as never,
        { x: 2200, y: 300 }
      );
      await Promise.resolve();
    });

    const request = mocks.requestTabTransfer.mock.calls[0]?.[1] as {
      transferId: string;
      targetKind: string;
      targetGroupId: string;
      cursorX: number;
      cursorY: number;
      tab: { panelId: string };
    };
    expect(request).toMatchObject({
      targetKind: 'new-window',
      cursorX: 2200,
      cursorY: 300,
      tab: { panelId: 'panel-a' },
    });
    expect(mocks.detachPanelGroup).not.toHaveBeenCalled();

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
      await Promise.resolve();
    });

    const snapshot = mocks.beginOpen.mock.calls[0]?.[1] as {
      transferId: string;
      tabs: Array<{ panelId: string }>;
      initialPositionAnchor: { x: number; y: number };
      useInitialPosition: boolean;
    };
    expect(snapshot.tabs).toEqual([expect.objectContaining({ panelId: 'panel-a' })]);
    expect(snapshot.initialPositionAnchor).toEqual({ x: 2200, y: 300 });
    expect(snapshot.useInitialPosition).toBe(true);
    expect(mocks.detachPanelGroup).not.toHaveBeenCalled();

    await act(async () =>
      mocks.eventHandlers.opened?.({
        windowName: 'panel-2',
        groupId: request.targetGroupId,
        snapshot,
      } as never)
    );
    expect(mocks.detachPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a']);
  });

  it('accepts a native tab into the mounted workspace target before source commit', async () => {
    const tab = {
      kind: 'object',
      panelId: 'panel-a',
      objectRef: { ...objectRef, namespace: objectRef.namespace ?? '' },
      activeView: 'details',
    };
    mocks.getOwnedPanel.mockReturnValue({
      objectRef,
      activeView: 'details',
      nativeLocation: { windowName: 'panel-1', groupId: 'native-group-1' },
    });

    await act(async () => {
      mocks.externalTabDrop?.(
        {
          kind: 'dockable-tab',
          panelId: 'panel-a',
          sourceGroupId: 'right',
          sourceWindowGroupId: 'native-group-1',
          sourceWindowName: 'panel-1',
          ownerWindowName: 'workspace-1',
          clusterId: 'cluster-1',
          tab,
        } as never,
        'right',
        0
      );
      await Promise.resolve();
    });
    const request = mocks.requestTabTransfer.mock.calls[0]?.[1] as {
      transferId: string;
      targetKind: string;
      targetWindowName: string;
      targetGroupId: string;
      tab: typeof tab;
    };
    expect(request).toMatchObject({
      targetKind: 'workspace',
      targetWindowName: 'workspace-1',
      targetGroupId: 'right',
    });

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.dockWindow).toHaveBeenCalledWith(
      expect.objectContaining({ tabs: [tab] }),
      'right'
    );
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith(
      'cluster-1',
      ['panel-a'],
      'panel-a',
      'right',
      0
    );
    expect(mocks.acceptTabTransfer).toHaveBeenCalledWith('workspace-1', request.transferId);
    expect(mocks.detachPanelGroup).not.toHaveBeenCalled();
  });

  it('removes a docked source tab only after an existing native target commits', async () => {
    mocks.getOwnedPanel.mockReturnValue({
      objectRef,
      activeView: 'details',
      dockedEdge: 'right',
    });
    const request = {
      transferId: 'tab-transfer-existing-native',
      sourceWindowName: 'workspace-1',
      targetWindowName: 'panel-2',
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-1',
      sourceGroupId: 'right',
      targetGroupId: 'native-group-2',
      targetIndex: 1,
      targetKind: 'panel-window',
      cursorX: 0,
      cursorY: 0,
      tab: {
        kind: 'object',
        panelId: 'panel-a',
        objectRef: { ...objectRef, namespace: objectRef.namespace ?? '' },
        activeView: 'details',
      },
    };

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
    });
    expect(mocks.acceptTabTransfer).toHaveBeenCalledWith(
      'workspace-1',
      'tab-transfer-existing-native'
    );
    expect(mocks.detachPanelGroup).not.toHaveBeenCalled();

    await act(async () => mocks.eventHandlers.tabTransferCommitted?.({ request } as never));
    expect(mocks.detachPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a']);
    expect(mocks.discardPanelLayouts).toHaveBeenCalledWith('cluster-1', ['panel-a']);
  });

  it('rejects a tab transfer whose claimed source group is not authoritative', async () => {
    mocks.getOwnedPanel.mockReturnValue({
      objectRef,
      activeView: 'details',
      dockedEdge: 'right',
    });
    const request = {
      transferId: 'tab-transfer-wrong-source-group',
      sourceWindowName: 'workspace-1',
      targetWindowName: 'panel-2',
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-1',
      sourceGroupId: 'bottom',
      targetGroupId: 'native-group-2',
      targetIndex: 0,
      targetKind: 'panel-window',
      cursorX: 0,
      cursorY: 0,
      tab: {
        kind: 'object',
        panelId: 'panel-a',
        objectRef: { ...objectRef, namespace: objectRef.namespace ?? '' },
        activeView: 'details',
      },
    };

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
    });

    expect(mocks.failTabTransfer).toHaveBeenCalledWith(
      'workspace-1',
      'tab-transfer-wrong-source-group'
    );
    expect(mocks.acceptTabTransfer).not.toHaveBeenCalled();
    expect(mocks.beginOpen).not.toHaveBeenCalled();
  });

  it('rejects a tab transfer after its source owner no longer contains the tab', async () => {
    const request = tabTransferRequest();

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
    });

    expect(mocks.failTabTransfer).toHaveBeenCalledWith('workspace-1', 'tab-transfer-test');
    expect(mocks.acceptTabTransfer).not.toHaveBeenCalled();
  });

  it('rejects a guarded docked source before accepting its tab transfer', async () => {
    const focus = vi.fn();
    mocks.blocker = { reason: 'unsaved-yaml', focus };
    mocks.getOwnedPanel.mockReturnValue({
      objectRef,
      activeView: 'details',
      dockedEdge: 'right',
    });
    const request = tabTransferRequest();

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
    });

    expect(focus).toHaveBeenCalledOnce();
    expect(mocks.failTabTransfer).toHaveBeenCalledWith('workspace-1', 'tab-transfer-test');
    expect(mocks.acceptTabTransfer).not.toHaveBeenCalled();
  });

  it('rejects a workspace transfer whose target is not a docked edge', async () => {
    mocks.getOwnedPanel.mockReturnValue({
      objectRef,
      activeView: 'details',
      dockedEdge: 'right',
    });
    const request = tabTransferRequest({
      targetKind: 'workspace',
      targetWindowName: 'workspace-1',
      targetGroupId: 'floating-1',
    });

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
    });

    expect(mocks.failTabTransfer).toHaveBeenCalledWith('workspace-1', 'tab-transfer-test');
    expect(mocks.dockWindow).not.toHaveBeenCalled();
  });

  it('fails and reports an existing native target that cannot accept the transfer', async () => {
    const acceptError = new Error('target unavailable');
    mocks.acceptTabTransfer.mockRejectedValueOnce(acceptError);
    mocks.getOwnedPanel.mockReturnValue({
      objectRef,
      activeView: 'details',
      dockedEdge: 'right',
    });
    const request = tabTransferRequest();

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.failTabTransfer).toHaveBeenCalledWith('workspace-1', 'tab-transfer-test');
    expect(mocks.reportError).toHaveBeenCalledWith(acceptError, {
      source: 'WorkspacePanelCoordinator',
      action: 'accept-native-tab-target',
      clusterId: 'cluster-1',
    });
  });

  it('fails and reports a torn-off tab whose new window cannot open', async () => {
    const openError = new Error('window unavailable');
    mocks.beginOpen.mockRejectedValueOnce(openError);
    mocks.getOwnedPanel.mockReturnValue({
      objectRef,
      activeView: 'details',
      dockedEdge: 'right',
    });
    const request = tabTransferRequest({
      targetWindowName: '',
      targetGroupId: 'new-native-group',
      targetKind: 'new-window',
      cursorX: 1800,
      cursorY: 500,
    });

    await act(async () => {
      mocks.eventHandlers.tabTransferRequested?.({ request } as never);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.failTabTransfer).toHaveBeenCalledWith('workspace-1', 'tab-transfer-test');
    expect(mocks.reportError).toHaveBeenCalledWith(openError, {
      source: 'WorkspacePanelCoordinator',
      action: 'open-torn-off-tab',
      clusterId: 'cluster-1',
    });
  });

  it('uses floating preferences when a hidden default-floating source has no DOM surface', async () => {
    mocks.pendingNativeOpenPanelIds.add('panel-a');

    await act(async () => {
      mocks.moveRequest?.(
        {
          groupKey: 'floating-1',
          tabs: ['panel-a'],
          activeTab: 'panel-a',
        } as never,
        'floating'
      );
      await Promise.resolve();
    });

    const snapshot = mocks.beginOpen.mock.calls[0]?.[1] as {
      initialBounds?: { x: number; y: number; width: number; height: number };
    };
    expect(snapshot.initialBounds).toEqual({
      x: 0,
      y: 0,
      width: 720,
      height: 560,
    });
  });

  it('docks a hidden default-floating source on the right when native open fails', async () => {
    mocks.pendingNativeOpenPanelIds.add('panel-a');
    mocks.beginOpen.mockRejectedValueOnce(new Error('native open failed'));

    await act(async () => {
      mocks.moveRequest?.(
        {
          groupKey: 'floating-1',
          tabs: ['panel-a'],
          activeTab: 'panel-a',
        } as never,
        'floating'
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const snapshot = mocks.beginOpen.mock.calls[0]?.[1];
    expect(mocks.dockWindow).toHaveBeenCalledWith(snapshot, 'right');
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a'], 'panel-a', 'right');
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'float-group' })
    );
  });

  it('docks a hidden default-floating source when the child closes before readiness', async () => {
    mocks.pendingNativeOpenPanelIds.add('panel-a');

    await act(async () => {
      mocks.moveRequest?.(
        {
          groupKey: 'floating-1',
          tabs: ['panel-a'],
          activeTab: 'panel-a',
        } as never,
        'floating'
      );
      await Promise.resolve();
    });

    const snapshot = mocks.beginOpen.mock.calls[0]?.[1] as {
      groupId: string;
      transferId: string;
    };
    await act(async () => {
      mocks.eventHandlers.closed?.({
        windowName: 'panel-1',
        clusterId: 'cluster-1',
        groupId: snapshot.groupId,
      } as never);
      await Promise.resolve();
    });

    expect(mocks.dockWindow).toHaveBeenCalledWith(snapshot, 'right');
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a'], 'panel-a', 'right');
  });

  it('waits for native child close acknowledgement before allowing cluster close', async () => {
    let result: boolean | undefined;
    await act(async () => {
      void mocks.clusterPreflight?.('cluster-1').then((allowed) => {
        result = allowed;
      });
      await Promise.resolve();
    });
    expect(mocks.requestGuard).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      expect.any(String),
      'cluster-close'
    );
    expect(result).toBeUndefined();

    const requestId = mocks.requestGuard.mock.calls[0]?.[2];
    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId,
        windowName: 'panel-1',
        allowed: true,
      } as never);
      await Promise.resolve();
    });
    expect(mocks.requestPanelClose).toHaveBeenCalledWith('workspace-1', 'panel-1', 'cluster-close');

    await act(async () => {
      mocks.eventHandlers.closed?.({
        windowName: 'panel-1',
        clusterId: 'cluster-1',
      } as never);
      await Promise.resolve();
    });
    expect(result).toBe(true);
  });

  it('discards cluster-scoped source layouts before forgetting a closed native window', async () => {
    mocks.panelIdsForPanelWindow.mockReturnValue(['panel-a', 'panel-b']);

    await act(async () => {
      mocks.eventHandlers.closed?.({
        windowName: 'panel-1',
        clusterId: 'cluster-1',
      } as never);
      await Promise.resolve();
    });

    expect(mocks.discardPanelLayouts).toHaveBeenCalledWith('cluster-1', ['panel-a', 'panel-b']);
    expect(mocks.removeWindow).toHaveBeenCalledWith('cluster-1', 'panel-1');
    expect(mocks.discardPanelLayouts.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeWindow.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it('acknowledges a dock handoff once after the owner target is mounted', async () => {
    let releaseDock!: () => void;
    mocks.acknowledgeDock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseDock = resolve;
        })
    );
    const snapshot = {
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-1',
      groupId: 'group-1',
      transferId: 'dock-transfer-1',
      tabs: [{ panelId: 'panel-a' }],
      activePanelId: 'panel-a',
    };

    await act(async () => {
      mocks.eventHandlers.dock?.({
        windowName: 'panel-1',
        transferId: 'dock-transfer-1',
        targetPosition: 'bottom',
        snapshot,
      } as never);
      await Promise.resolve();
    });
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith(
      'cluster-1',
      ['panel-a'],
      'panel-a',
      'bottom'
    );
    expect(mocks.dockWindow).toHaveBeenCalledWith(snapshot, 'bottom');
    expect(mocks.dockPanelGroup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dockWindow.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    expect(mocks.acknowledgeDock).toHaveBeenCalledOnce();

    await act(async () => {
      mocks.eventHandlers.ownerClose?.({
        ownerWindowName: 'workspace-1',
        panelWindows: [],
      } as never);
      await Promise.resolve();
    });
    expect(mocks.acknowledgeDock).toHaveBeenCalledOnce();

    await act(async () => {
      releaseDock();
      await Promise.resolve();
    });
  });

  it('rolls back a dock handoff when owner readiness times out', async () => {
    vi.useFakeTimers();
    mocks.tabGroups.right = { tabs: [], activeTab: null };
    const snapshot = {
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-1',
      groupId: 'group-1',
      transferId: 'dock-transfer-timeout',
      tabs: [{ panelId: 'panel-a' }],
    };

    await act(async () => {
      mocks.eventHandlers.dock?.({
        windowName: 'panel-1',
        transferId: 'dock-transfer-timeout',
        targetPosition: 'right',
        snapshot,
      } as never);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(mocks.failTransfer).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'dock-transfer-timeout'
    );
    expect(mocks.commitWindow).toHaveBeenCalledWith(snapshot, 'panel-1');
    expect(mocks.detachPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a']);
    expect(mocks.discardPanelLayouts).toHaveBeenCalledWith('cluster-1', ['panel-a']);
  });

  it('does not roll back a dock handoff while its acknowledgement is in flight', async () => {
    vi.useFakeTimers();
    let releaseDock!: () => void;
    mocks.acknowledgeDock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseDock = resolve;
        })
    );
    const snapshot = {
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-1',
      groupId: 'group-1',
      transferId: 'dock-transfer-acknowledging',
      tabs: [{ panelId: 'panel-a' }],
    };

    await act(async () => {
      mocks.eventHandlers.dock?.({
        windowName: 'panel-1',
        transferId: 'dock-transfer-acknowledging',
        targetPosition: 'right',
        snapshot,
      } as never);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(mocks.acknowledgeDock).toHaveBeenCalledOnce();
    expect(mocks.failTransfer).not.toHaveBeenCalled();
    expect(mocks.commitWindow).not.toHaveBeenCalledWith(snapshot, 'panel-1');

    await act(async () => {
      releaseDock();
      await Promise.resolve();
    });
  });

  it('fails an unresponsive owner close closed without acknowledging the workspace', async () => {
    vi.useFakeTimers();

    await act(async () => {
      mocks.eventHandlers.ownerClose?.({
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'owner-close-timeout' })
    );
  });

  it('acknowledges application quit only after every native group guard allows it', async () => {
    await act(async () => {
      mocks.eventHandlers.applicationQuit?.({
        transactionId: 'quit-1',
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
      await Promise.resolve();
    });
    expect(mocks.requestGuard).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'quit-1:panel-1',
      'application-quit'
    );
    expect(mocks.acknowledgeQuit).not.toHaveBeenCalled();

    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId: 'quit-1:panel-1',
        windowName: 'panel-1',
        allowed: true,
      } as never);
      await Promise.resolve();
    });
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('workspace-1', 'quit-1', true);
  });

  it('cancels application quit before contacting children when a docked panel blocks', async () => {
    const focus = vi.fn();
    mocks.blocker = { reason: 'unsaved-yaml', focus };

    await act(async () => {
      mocks.eventHandlers.applicationQuit?.({
        transactionId: 'quit-2',
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
      await Promise.resolve();
    });

    expect(focus).toHaveBeenCalledOnce();
    expect(mocks.requestGuard).not.toHaveBeenCalled();
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('workspace-1', 'quit-2', false);
  });

  it('handles non-floating, blocked, missing, and valid float requests at the owner boundary', async () => {
    expect(
      mocks.moveRequest?.(
        { groupKey: 'right', tabs: ['panel-a'], activeTab: 'panel-a' } as never,
        'bottom'
      )
    ).toBe(false);

    const focus = vi.fn();
    mocks.blocker = { reason: 'unsaved-yaml', focus };
    expect(
      mocks.moveRequest?.(
        { groupKey: 'right', tabs: ['panel-a'], activeTab: 'panel-a' } as never,
        'floating'
      )
    ).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    mocks.blocker = null;
    mocks.openPanels.clear();
    expect(
      mocks.moveRequest?.(
        {
          groupKey: 'right',
          tabs: ['panel-missing'],
          activeTab: null,
        } as never,
        'floating'
      )
    ).toBe(true);
    expect(mocks.beginOpen).not.toHaveBeenCalled();

    mocks.openPanels.set('panel-a', objectRef);
    mocks.openPanels.set('panel-other', {
      ...objectRef,
      clusterId: 'cluster-2',
      name: 'other',
    });
    await act(async () => {
      mocks.moveRequest?.(
        {
          groupKey: 'right',
          tabs: ['panel-a', 'panel-other'],
          activeTab: 'panel-a',
        } as never,
        'floating'
      );
      await Promise.resolve();
    });

    const transferred = mocks.beginOpen.mock.calls[mocks.beginOpen.mock.calls.length - 1]?.[1] as {
      tabs: Array<{ panelId: string }>;
      initialBounds: { x: number; y: number; width: number; height: number };
    };
    expect(transferred.tabs.map((panelTab) => panelTab.panelId)).toEqual(['panel-a']);
    expect(transferred.initialBounds).toEqual({
      x: 0,
      y: 0,
      width: 720,
      height: 560,
    });
  });

  it('routes snapshot and tab-close events only for this immutable owner', async () => {
    await act(async () => {
      mocks.eventHandlers.snapshot?.({
        windowName: 'panel-1',
        snapshot: { ownerWindowName: 'workspace-other' },
      } as never);
      mocks.eventHandlers.snapshot?.({
        windowName: 'panel-1',
        snapshot: { ownerWindowName: 'workspace-1' },
      } as never);
    });
    expect(mocks.syncPanelWindowSnapshot).toHaveBeenCalledOnce();

    const existing = {
      objectRef,
      activeView: 'details',
      nativeLocation: { windowName: 'panel-1', groupId: 'group-1' },
    };
    mocks.getOwnedPanel.mockReturnValue(existing as never);
    await act(async () => {
      mocks.eventHandlers.tabClose?.({
        ownerWindowName: 'workspace-1',
        sourceWindowName: 'panel-1',
        clusterId: 'cluster-1',
        panelId: 'panel-a',
      } as never);
      await Promise.resolve();
    });
    expect(mocks.removeOwnedPanel).not.toHaveBeenCalled();
    expect(mocks.authorizeTabClose).toHaveBeenCalledWith('workspace-1', 'panel-1', 'panel-a');
  });

  it('leaves the tab directory unchanged when child authorization fails', async () => {
    const existing = {
      objectRef,
      activeView: 'details',
      nativeLocation: null,
      dockedEdge: 'bottom',
    };
    mocks.getOwnedPanel.mockReturnValue(existing as never);
    mocks.authorizeTabClose.mockRejectedValueOnce(new Error('child unavailable'));

    await act(async () => {
      mocks.eventHandlers.tabClose?.({
        ownerWindowName: 'workspace-1',
        sourceWindowName: 'panel-1',
        clusterId: 'cluster-1',
        panelId: 'panel-a',
      } as never);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.removeOwnedPanel).not.toHaveBeenCalled();
    expect(mocks.upsertOwnedPanel).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'authorize-panel-tab-close' })
    );
  });

  it('blocks, immediately allows, and fails closed for cluster-close preflights', async () => {
    const focus = vi.fn();
    mocks.blocker = { reason: 'unsaved-yaml', focus };
    await expect(mocks.clusterPreflight?.('cluster-1')).resolves.toBe(false);
    expect(focus).toHaveBeenCalledOnce();

    mocks.blocker = null;
    mocks.nativeWindowNamesForCluster.mockReturnValue([]);
    await expect(mocks.clusterPreflight?.('cluster-empty')).resolves.toBe(true);

    mocks.nativeWindowNamesForCluster.mockReturnValue(['panel-1']);
    mocks.requestGuard.mockRejectedValueOnce(new Error('native guard failed'));
    await expect(mocks.clusterPreflight?.('cluster-failed')).resolves.toBe(false);
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'request-cluster-guard' })
    );
  });

  it('rejects a cluster close immediately when a native child guard denies it', async () => {
    let result: boolean | undefined;
    await act(async () => {
      void mocks.clusterPreflight?.('cluster-1').then((allowed) => {
        result = allowed;
      });
      await Promise.resolve();
    });
    const requestId = mocks.requestGuard.mock.calls[0]?.[2];

    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId,
        windowName: 'panel-1',
        allowed: false,
      } as never);
      await Promise.resolve();
    });

    expect(result).toBe(false);
    expect(mocks.requestPanelClose).not.toHaveBeenCalled();
    expect(mocks.focusOwnerWindow).toHaveBeenCalledWith('panel-1');
  });

  it('keeps every cluster child live until all native guards allow closing', async () => {
    mocks.nativeWindowNamesForCluster.mockReturnValue(['panel-1', 'panel-2']);
    let result: boolean | undefined;
    await act(async () => {
      void mocks.clusterPreflight?.('cluster-1').then((allowed) => {
        result = allowed;
      });
      await Promise.resolve();
    });
    const requestIds = new Map(
      mocks.requestGuard.mock.calls.map(([, windowName, requestId]) => [windowName, requestId])
    );

    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId: requestIds.get('panel-1'),
        windowName: 'panel-1',
        allowed: true,
      } as never);
      await Promise.resolve();
    });
    expect(mocks.requestPanelClose).not.toHaveBeenCalled();

    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId: requestIds.get('panel-2'),
        windowName: 'panel-2',
        allowed: false,
      } as never);
      await Promise.resolve();
    });

    expect(result).toBe(false);
    expect(mocks.requestPanelClose).not.toHaveBeenCalled();
    expect(mocks.focusOwnerWindow).toHaveBeenCalledWith('panel-2');
  });

  it('requests every cluster child close only after every native guard allows it', async () => {
    mocks.nativeWindowNamesForCluster.mockReturnValue(['panel-1', 'panel-2']);
    let result: boolean | undefined;
    await act(async () => {
      void mocks.clusterPreflight?.('cluster-1').then((allowed) => {
        result = allowed;
      });
      await Promise.resolve();
    });
    const requestIds = new Map(
      mocks.requestGuard.mock.calls.map(([, windowName, requestId]) => [windowName, requestId])
    );

    await act(async () => {
      for (const windowName of ['panel-1', 'panel-2']) {
        mocks.eventHandlers.guardResult?.({
          requestId: requestIds.get(windowName),
          windowName,
          allowed: true,
        } as never);
      }
      await Promise.resolve();
    });

    expect(mocks.requestPanelClose.mock.calls).toEqual(
      expect.arrayContaining([
        ['workspace-1', 'panel-1', 'cluster-close'],
        ['workspace-1', 'panel-2', 'cluster-close'],
      ])
    );
    expect(result).toBeUndefined();

    await act(async () => {
      mocks.eventHandlers.closed?.({
        windowName: 'panel-1',
        clusterId: 'cluster-1',
      } as never);
      mocks.eventHandlers.closed?.({
        windowName: 'panel-2',
        clusterId: 'cluster-1',
      } as never);
      await Promise.resolve();
    });
    expect(result).toBe(true);
  });

  it('fails a cluster close closed when its child never acknowledges', async () => {
    vi.useFakeTimers();
    let result: boolean | undefined;
    await act(async () => {
      void mocks.clusterPreflight?.('cluster-timeout').then((allowed) => {
        result = allowed;
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result).toBe(false);
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'cluster-close-timeout' })
    );
  });

  it('does not close an allowed cluster child when another native guard times out', async () => {
    vi.useFakeTimers();
    mocks.nativeWindowNamesForCluster.mockReturnValue(['panel-1', 'panel-2']);
    let result: boolean | undefined;
    await act(async () => {
      void mocks.clusterPreflight?.('cluster-timeout').then((allowed) => {
        result = allowed;
      });
      await Promise.resolve();
    });
    const panelOneRequest = mocks.requestGuard.mock.calls.find(
      ([, windowName]) => windowName === 'panel-1'
    )?.[2];
    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId: panelOneRequest,
        windowName: 'panel-1',
        allowed: true,
      } as never);
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(result).toBe(false);
    expect(mocks.requestPanelClose).not.toHaveBeenCalled();
  });

  it('authorizes owner close only after all owned panel windows close', async () => {
    await act(async () => {
      mocks.eventHandlers.ownerClose?.({
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
      await Promise.resolve();
    });
    expect(mocks.requestGuard).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      expect.any(String),
      'owner-close'
    );
    expect(mocks.acknowledgeWorkspaceClose).not.toHaveBeenCalled();

    const requestId = mocks.requestGuard.mock.calls[0]?.[2];
    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId,
        windowName: 'panel-1',
        allowed: true,
      } as never);
      await Promise.resolve();
    });
    expect(mocks.requestPanelClose).toHaveBeenCalledWith('workspace-1', 'panel-1', 'owner-close');

    await act(async () => {
      mocks.eventHandlers.closed?.({
        windowName: 'panel-1',
        clusterId: 'cluster-1',
      } as never);
      await Promise.resolve();
    });
    expect(mocks.acknowledgeWorkspaceClose).toHaveBeenCalledWith('workspace-1');
  });

  it('cancels owner close and focuses the child when a panel guard denies it', async () => {
    await act(async () => {
      mocks.eventHandlers.ownerClose?.({
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
      await Promise.resolve();
    });
    const requestId = mocks.requestGuard.mock.calls[0]?.[2];

    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId,
        windowName: 'panel-1',
        allowed: false,
      } as never);
      await Promise.resolve();
    });

    expect(mocks.focusOwnerWindow).toHaveBeenCalledWith('panel-1');
    expect(mocks.requestPanelClose).not.toHaveBeenCalled();
    expect(mocks.acknowledgeWorkspaceClose).not.toHaveBeenCalled();
  });

  it('keeps every owner child live when a later native guard denies closing', async () => {
    await act(async () => {
      mocks.eventHandlers.ownerClose?.({
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1', 'panel-2'],
      } as never);
      await Promise.resolve();
    });
    const requestIds = new Map(
      mocks.requestGuard.mock.calls.map(([, windowName, requestId]) => [windowName, requestId])
    );

    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId: requestIds.get('panel-1'),
        windowName: 'panel-1',
        allowed: true,
      } as never);
      await Promise.resolve();
    });
    expect(mocks.requestPanelClose).not.toHaveBeenCalled();

    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId: requestIds.get('panel-2'),
        windowName: 'panel-2',
        allowed: false,
      } as never);
      await Promise.resolve();
    });

    expect(mocks.requestPanelClose).not.toHaveBeenCalled();
    expect(mocks.acknowledgeWorkspaceClose).not.toHaveBeenCalled();
    expect(mocks.focusOwnerWindow).toHaveBeenCalledWith('panel-2');
  });

  it('does not close an allowed owner child when another native guard times out', async () => {
    vi.useFakeTimers();
    await act(async () => {
      mocks.eventHandlers.ownerClose?.({
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1', 'panel-2'],
      } as never);
      await Promise.resolve();
    });
    const panelOneRequest = mocks.requestGuard.mock.calls.find(
      ([, windowName]) => windowName === 'panel-1'
    )?.[2];
    await act(async () => {
      mocks.eventHandlers.guardResult?.({
        requestId: panelOneRequest,
        windowName: 'panel-1',
        allowed: true,
      } as never);
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(mocks.requestPanelClose).not.toHaveBeenCalled();
    expect(mocks.acknowledgeWorkspaceClose).not.toHaveBeenCalled();
  });

  it('allows immediate quit and fails closed on child denial or timeout', async () => {
    await act(async () => {
      mocks.eventHandlers.applicationQuit?.({
        transactionId: 'quit-empty',
        ownerWindowName: 'workspace-1',
        panelWindows: [],
      } as never);
      await Promise.resolve();
    });
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('workspace-1', 'quit-empty', true);

    await act(async () => {
      mocks.eventHandlers.applicationQuit?.({
        transactionId: 'quit-denied',
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
      mocks.eventHandlers.guardResult?.({
        requestId: 'quit-denied:panel-1',
        windowName: 'panel-1',
        allowed: false,
      } as never);
      await Promise.resolve();
    });
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('workspace-1', 'quit-denied', false);

    vi.useFakeTimers();
    await act(async () => {
      mocks.eventHandlers.applicationQuit?.({
        transactionId: 'quit-timeout',
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('workspace-1', 'quit-timeout', false);
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'application-quit-preflight' })
    );
  });

  it('authorizes same-cluster object opens and focuses an existing native owner', async () => {
    const request = {
      ownerWindowName: 'workspace-1',
      sourceWindowName: 'panel-1',
      clusterId: 'cluster-1',
      groupId: 'group-1',
      objectRef,
      activeView: 'details',
    };
    await act(async () => {
      mocks.eventHandlers.objectOpen?.(request as never);
      await Promise.resolve();
    });
    expect(mocks.upsertOwnedPanel).not.toHaveBeenCalled();
    expect(mocks.authorizeObjectOpen).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      expect.any(String),
      objectRef,
      'details'
    );

    mocks.getOwnedPanel.mockReturnValue({
      nativeLocation: {
        windowName: 'panel-existing',
        groupId: 'group-existing',
      },
    } as never);
    await act(async () => {
      mocks.eventHandlers.objectOpen?.(request as never);
      await Promise.resolve();
    });
    expect(mocks.focusPanelWindow).toHaveBeenCalledWith(
      'workspace-1',
      'panel-existing',
      expect.any(String)
    );
  });
});
