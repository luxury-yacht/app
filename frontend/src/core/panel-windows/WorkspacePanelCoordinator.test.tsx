import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelLifecycleGuardRegistry } from './panelLifecycleGuards';
import { WorkspacePanelCoordinator } from './WorkspacePanelCoordinator';

vi.mock('./ClusterTabTransferCoordinator', () => ({ ClusterTabTransferCoordinator: () => null }));

vi.mock('./WorkspacePanelSync', () => ({
  WorkspacePanelSync: ({ children }: { children: React.ReactNode }) => children,
  useIncomingGroupTransfers: () => mocks.incoming,
  usePanelWorkspaceSync: () => ({
    flush: mocks.flushPublication,
    quiesceCluster: async () => {
      await mocks.flushPublication();
      return vi.fn();
    },
    groupsForCluster: () => [],
  }),
}));

const mocks = vi.hoisted(() => ({
  eventHandlers: {} as Record<string, (event: never) => void>,
  moveRequest: null as
    | null
    | ((group: never, position: 'right' | 'bottom' | 'floating') => boolean),
  tabMoveRequest: null as
    | null
    | ((payload: never, position: 'right' | 'bottom' | 'floating') => void),
  externalTabDrop: null as null | ((payload: never, group: string, index: number) => void),
  tabTearOff: null as null | ((payload: never, cursor: { x: number; y: number }) => void),
  clusterTearOff: null as null | ((payload: never, cursor: { x: number; y: number }) => void),
  selectedClusterIds: ['cluster-1'],
  incoming: [] as unknown[],
  guardRegistry: null as PanelLifecycleGuardRegistry | null,
  freeze: vi.fn(),
  releaseTransfer: vi.fn(),
  setActiveKubeconfig: vi.fn(),
  requestClusterTransfer: vi.fn(async (_caller: string, _request: unknown) => undefined),
  canStartTabDrag: null as null | ((panelId: string) => boolean),
  canFloatPanel: null as null | ((panelId: string) => boolean),
  tabDragIdentity: null as null | {
    windowName: string;
    clusterId: string;
    getTabSnapshot: (panelId: string) => unknown;
  },
  closeClusterPanels: vi.fn(async (_window: string, _cluster: string) => true),
  clusterPreflight: null as null | ((clusterId: string) => Promise<{ release: () => void } | null>),
  beginOpen: vi.fn(async (owner: string, snapshot: unknown) => ({
    owner,
    snapshot,
  })),
  flushPublication: vi.fn(async () => undefined),
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
  frozen: false,
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
    acknowledgePanelTransfer: mocks.acknowledgeDock,
    acknowledgeWorkspaceWindowClose: mocks.acknowledgeWorkspaceClose,
    closeClusterView: mocks.closeClusterPanels,
    authorizePanelObjectOpen: mocks.authorizeObjectOpen,
    authorizePanelTabClose: mocks.authorizeTabClose,
    requestPanelTabTransfer: mocks.requestTabTransfer,
    requestClusterTabTransfer: mocks.requestClusterTransfer,
    acceptPanelTabTransfer: mocks.acceptTabTransfer,
    failPanelTabTransfer: mocks.failTabTransfer,
    failPanelWindowTransfer: mocks.failTransfer,
    requestPanelWindowGuard: mocks.requestGuard,
    acknowledgeApplicationQuitPreflight: mocks.acknowledgeQuit,
    onPanelWindowOpened: event('opened'),
    onPanelWindowSnapshotUpdated: event('snapshot'),
    onPanelTabCloseRequested: event('tabClose'),
    onPanelWindowClosed: event('closed'),
    onPanelWindowTransferFailed: event('windowTransferFailed'),
    onWorkspaceCloseRequested: event('ownerClose'),
    onPanelObjectOpenRequested: event('objectOpen'),
    onApplicationQuitPreflightRequested: event('applicationQuit'),
    onApplicationQuitPreflightSettled: event('applicationQuitSettled'),
    onPanelWindowGuardResult: event('guardResult'),
    onPanelTabTransferRequested: event('tabTransferRequested'),
    onPanelWorkspaceFocusRequested: event('workspaceFocus'),
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
    restorePanelTabs: mocks.dockWindow,
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
    registerClusterClosePreflight: (preflight: typeof mocks.clusterPreflight) => {
      mocks.clusterPreflight = preflight;
      return () => undefined;
    },
    selectedClusterIds: mocks.selectedClusterIds,
    managedClusterIds: mocks.selectedClusterIds,
    selectedKubeconfigs: ['cluster-1', 'cluster-2'],
    getClusterMeta: (value: string) => ({ id: value, name: value }),
    setActiveKubeconfig: mocks.setActiveKubeconfig,
    selectedClusterId: 'cluster-1',
  }),
}));

vi.mock('@/core/panel-windows/panelLifecycleGuards', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePanelLifecycleGuardRegistry: () =>
    mocks.guardRegistry ?? {
      freeze: mocks.freeze,
      freezeCluster: vi.fn(),
      releaseTransfer: mocks.releaseTransfer,
      isFrozen: () => mocks.frozen,
      isClusterFrozen: () => mocks.frozen,
      firstBlocker: () => mocks.blocker,
    },
}));

vi.mock('@/utils/errorHandler', () => ({
  reportOperationalError: mocks.reportError,
}));

vi.mock('@/ui/dockable', () => ({
  DockablePanelProvider: ({
    children,
    onGroupMoveRequest,
    onTabMoveRequest,
    onExternalTabDrop,
    onTabTearOff,
    onClusterTabTearOff,
    tabDragIdentity,
    canStartTabDrag,
    canFloatPanel,
  }: {
    children: React.ReactNode;
    onGroupMoveRequest: typeof mocks.moveRequest;
    onTabMoveRequest: typeof mocks.tabMoveRequest;
    onExternalTabDrop: typeof mocks.externalTabDrop;
    onTabTearOff: typeof mocks.tabTearOff;
    onClusterTabTearOff: typeof mocks.clusterTearOff;
    tabDragIdentity: typeof mocks.tabDragIdentity;
    canStartTabDrag: typeof mocks.canStartTabDrag;
    canFloatPanel: typeof mocks.canFloatPanel;
  }) => {
    mocks.moveRequest = onGroupMoveRequest;
    mocks.tabMoveRequest = onTabMoveRequest;
    mocks.externalTabDrop = onExternalTabDrop;
    mocks.tabTearOff = onTabTearOff;
    mocks.clusterTearOff = onClusterTabTearOff;
    mocks.tabDragIdentity = tabDragIdentity;
    mocks.canStartTabDrag = canStartTabDrag;
    mocks.canFloatPanel = canFloatPanel;
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

// The registry reports an opened window with the tabs the directory committed
// to it and the renderer the group came from.
const openedEvent = (windowName: string, snapshot: object) => {
  const begun = snapshot as Record<string, unknown>;
  return {
    windowName,
    transferId: begun.transferId,
    sourceWindowName: begun.sourceWindowName,
    clusterId: begun.clusterId,
    groupId: begun.groupId,
    tabs: begun.tabs,
  };
};

describe('WorkspacePanelCoordinator', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.blocker = null;
    mocks.frozen = false;
    mocks.incoming = [];
    mocks.guardRegistry = null;
    mocks.selectedClusterIds = ['cluster-1'];
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
    await renderCoordinator();
  });

  const renderCoordinator = async () => {
    await act(async () => {
      root.render(
        <WorkspacePanelCoordinator>
          <div data-testid="source" />
        </WorkspacePanelCoordinator>
      );
      await Promise.resolve();
    });
  };

  // The directory lists a native group moving into this view's bottom dock.
  const receiveDockBack = async (overrides: Record<string, unknown> = {}) => {
    mocks.incoming = [
      {
        transferId: 'dock-1',
        clusterId: 'cluster-1',
        sourceWindowName: 'panel-1',
        groupId: 'bottom',
        insertIndex: 0,
        tabs: [tabTransferRequest().tab],
        activePanelId: 'panel-a',
        ...overrides,
      },
    ];
    await renderCoordinator();
  };

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('hands cross-cluster focus to the dockable owner before the panel registers', async () => {
    await act(async () => {
      mocks.eventHandlers.workspaceFocus?.({
        clusterId: 'cluster-1',
        panelId: 'new-related-panel',
      } as never);
    });
    expect(mocks.focusPanel).toHaveBeenCalledWith('new-related-panel', 'cluster-1');
  });

  it.each([
    { name: 'last cluster tab', clusters: ['cluster-1'], source: 'workspace-1', allowed: true },
    { name: 'empty window', clusters: [], source: 'workspace-1', allowed: false },
    {
      name: 'multiple cluster tabs',
      clusters: ['cluster-1', 'cluster-2'],
      source: 'workspace-1',
      allowed: true,
    },
    {
      name: 'foreign source window',
      clusters: ['cluster-1', 'cluster-2'],
      source: 'workspace-2',
      allowed: false,
    },
    {
      name: 'removed cluster tab',
      clusters: ['cluster-2', 'cluster-3'],
      source: 'workspace-1',
      allowed: false,
    },
  ])('gates cluster tear-off for $name', async ({ clusters, source, allowed }) => {
    mocks.selectedClusterIds = clusters;
    await act(async () =>
      root.render(
        <WorkspacePanelCoordinator>
          <div />
        </WorkspacePanelCoordinator>
      )
    );
    expect(mocks.clusterTearOff).toBeTypeOf('function');
    await act(async () =>
      mocks.clusterTearOff?.(
        {
          kind: 'cluster-tab',
          clusterId: 'cluster-1',
          selection: 'cluster-1',
          sourceWindowName: source,
        } as never,
        { x: 0, y: 0 }
      )
    );

    if (allowed) {
      expect(mocks.requestClusterTransfer).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          sourceWindowName: 'workspace-1',
          targetWindowName: '',
          clusterId: 'cluster-1',
        })
      );
    } else {
      expect(mocks.requestClusterTransfer).not.toHaveBeenCalled();
    }
  });

  it.each([
    { x: 1925, y: 100 },
    { x: -1100, y: 200 },
    { x: 0, y: 0 },
  ])('preserves cluster tear-off screen position $x, $y', async (cursor) => {
    mocks.selectedClusterIds = ['cluster-1', 'cluster-2'];
    await act(async () =>
      root.render(
        <WorkspacePanelCoordinator>
          <div />
        </WorkspacePanelCoordinator>
      )
    );
    await act(async () =>
      mocks.clusterTearOff?.(
        {
          kind: 'cluster-tab',
          clusterId: 'cluster-1',
          selection: 'cluster-1',
          sourceWindowName: 'workspace-1',
        } as never,
        cursor
      )
    );
    expect(mocks.requestClusterTransfer).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        sourceWindowName: 'workspace-1',
        targetWindowName: '',
        clusterId: 'cluster-1',
        dropPosition: cursor,
      })
    );
  });

  it('closes an app view without guarding or closing cluster panel windows', async () => {
    await act(async () => {
      mocks.eventHandlers.ownerClose?.({
        windowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
    });
    expect(mocks.requestGuard).not.toHaveBeenCalled();
    expect(mocks.acknowledgeWorkspaceClose).toHaveBeenCalledWith('workspace-1');
  });

  it('preflights only this renderer when the registry requests application quit', async () => {
    await act(async () => {
      mocks.eventHandlers.applicationQuit?.({
        windowName: 'workspace-1',
        transactionId: 'quit-shared',
        panelWindows: [],
      } as never);
    });
    expect(mocks.requestGuard).not.toHaveBeenCalled();
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('workspace-1', 'quit-shared', true);
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
        ...openedEvent('panel-other', snapshot),
        sourceWindowName: 'workspace-other',
      } as never)
    );
    expect(mocks.commitWindow).not.toHaveBeenCalled();
    expect(mocks.detachPanelGroup).not.toHaveBeenCalled();

    await act(async () => mocks.eventHandlers.opened?.(openedEvent('panel-1', snapshot) as never));
    expect(mocks.detachPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a']);
    expect(mocks.discardPanelLayouts).toHaveBeenCalledWith('cluster-1', ['panel-a']);
    expect(mocks.removeOwnedPanel).toHaveBeenCalledWith('cluster-1', 'panel-a');
    expect(mocks.detachPanelGroup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeOwnedPanel.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
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

  it('offers Float only for open object panels, never for app-wide panels', () => {
    expect(mocks.canFloatPanel?.('panel-a')).toBe(true);
    expect(mocks.canFloatPanel?.('app-logs')).toBe(false);
    expect(mocks.canFloatPanel?.('diagnostics')).toBe(false);
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

  it('names this app window when its tab-move callback requests the other docked edge', async () => {
    const tab = mocks.tabDragIdentity?.getTabSnapshot('panel-a');
    await act(async () => {
      mocks.tabMoveRequest?.(
        {
          kind: 'dockable-tab',
          panelId: 'panel-a',
          sourceGroupId: 'right',
          sourceWindowName: 'workspace-1',
          clusterId: 'cluster-1',
          tab,
        } as never,
        'bottom'
      );
    });
    expect(mocks.requestTabTransfer).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        sourceWindowName: 'workspace-1',
        targetWindowName: 'workspace-1',
        targetKind: 'workspace',
        targetGroupId: 'bottom',
      })
    );
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

    await act(async () => mocks.eventHandlers.opened?.(openedEvent('panel-2', snapshot) as never));
    expect(mocks.detachPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a']);
  });

  it('requests a drop onto this view and mounts it only when the directory lists the move', async () => {
    const tab = {
      kind: 'object',
      panelId: 'panel-a',
      objectRef: { ...objectRef, namespace: objectRef.namespace ?? '' },
      activeView: 'details',
    };
    mocks.tabGroups.right = { tabs: [], activeTab: null };

    await act(async () => {
      mocks.externalTabDrop?.(
        {
          kind: 'dockable-tab',
          panelId: 'panel-a',
          sourceGroupId: 'right',
          sourceWindowGroupId: 'native-group-1',
          sourceWindowName: 'panel-1',
          clusterId: 'cluster-1',
          tab,
        } as never,
        'right',
        0
      );
      await Promise.resolve();
    });
    const request = mocks.requestTabTransfer.mock.calls[0]?.[1] as { transferId: string };
    expect(request).toMatchObject({
      targetKind: 'workspace',
      targetWindowName: 'workspace-1',
      targetGroupId: 'right',
    });
    expect(mocks.dockPanelGroup).not.toHaveBeenCalled();

    await receiveDockBack({ transferId: request.transferId, groupId: 'right', tabs: [tab] });
    expect(mocks.dockWindow).toHaveBeenCalledWith(expect.objectContaining({ tabs: [tab] }));
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith(
      'cluster-1',
      ['panel-a'],
      'panel-a',
      'right',
      0
    );
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
    expect(mocks.flushPublication).not.toHaveBeenCalled();
    expect(mocks.detachPanelGroup).not.toHaveBeenCalled();

    await act(async () => mocks.eventHandlers.tabTransferCommitted?.({ request } as never));
    expect(mocks.detachPanelGroup).toHaveBeenCalledWith('cluster-1', ['panel-a']);
    expect(mocks.removeOwnedPanel).toHaveBeenCalledWith('cluster-1', 'panel-a');
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
      action: 'accept-tab-transfer',
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
      action: 'accept-tab-transfer',
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
    expect(mocks.dockWindow).toHaveBeenCalledWith(snapshot);
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith(
      'cluster-1',
      ['panel-a'],
      'panel-a',
      'right',
      undefined
    );
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

    expect(mocks.dockWindow).toHaveBeenCalledWith(snapshot);
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith(
      'cluster-1',
      ['panel-a'],
      'panel-a',
      'right',
      undefined
    );
  });

  it('mounts a dock-back group the directory targets here and acknowledges once it is visible', async () => {
    mocks.tabGroups.right = { tabs: [], activeTab: null };
    await receiveDockBack();
    expect(mocks.freeze).toHaveBeenCalledWith('dock-1', ['panel-a']);
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith(
      'cluster-1',
      ['panel-a'],
      'panel-a',
      'bottom',
      0
    );
    expect(mocks.dockWindow).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'cluster-1', activePanelId: 'panel-a' })
    );
    expect(mocks.acknowledgeDock).not.toHaveBeenCalled();

    mocks.tabGroups.bottom = { tabs: ['panel-a'], activeTab: 'panel-a' };
    await renderCoordinator();
    await renderCoordinator();
    expect(mocks.acknowledgeDock).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeDock).toHaveBeenCalledWith('workspace-1', 'dock-1', true);
    expect(mocks.flushPublication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acknowledgeDock.mock.invocationCallOrder[0]
    );
    expect(mocks.dockPanelGroup).toHaveBeenCalledOnce();
  });

  it('shows the target cluster before acknowledging a dock-back into it', async () => {
    await receiveDockBack({ clusterId: 'cluster-2' });
    expect(mocks.setActiveKubeconfig).toHaveBeenCalledWith('cluster-2');
    expect(mocks.acknowledgeDock).not.toHaveBeenCalled();
  });

  it('mounts a dropped tab where it was dropped', async () => {
    await receiveDockBack({ transferId: 'drop-1', groupId: 'right', insertIndex: 1 });
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith(
      'cluster-1',
      ['panel-a'],
      'panel-a',
      'right',
      1
    );
  });

  it('asks the directory to cancel a move whose commit fails', async () => {
    mocks.acknowledgeDock.mockRejectedValueOnce(new Error('commit failed'));
    mocks.tabGroups.bottom = { tabs: ['panel-a'], activeTab: 'panel-a' };
    await receiveDockBack();
    expect(mocks.acknowledgeDock).toHaveBeenLastCalledWith('workspace-1', 'dock-1', false);
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });

  it('mounts a cluster view move but leaves its handoff to the cluster coordinator', async () => {
    mocks.tabGroups.bottom = { tabs: ['panel-a'], activeTab: 'panel-a' };
    await receiveDockBack({ transferId: 'view-1', view: true });
    expect(mocks.dockPanelGroup).toHaveBeenCalledWith(
      'cluster-1',
      ['panel-a'],
      'panel-a',
      'bottom',
      0
    );
    await renderCoordinator();
    expect(mocks.acknowledgeDock).not.toHaveBeenCalled();
    expect(mocks.freeze).not.toHaveBeenCalled();
  });

  it('releases the move guard once the directory stops listing the transfer', async () => {
    mocks.guardRegistry = new PanelLifecycleGuardRegistry();
    await receiveDockBack();
    expect(mocks.guardRegistry.isFrozen()).toBe(true);
    mocks.incoming = [];
    await renderCoordinator();
    expect(mocks.guardRegistry.isFrozen()).toBe(false);
  });

  it('routes a tab menu float separately from a complete group float', async () => {
    mocks.openPanels.set('panel-b', { ...objectRef, name: 'second' });
    await act(async () => {
      mocks.moveRequest?.(
        { groupKey: 'right', tabs: ['panel-a', 'panel-b'], activeTab: 'panel-b' } as never,
        'floating'
      );
    });
    expect(mocks.beginOpen).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        tabs: [
          expect.objectContaining({ panelId: 'panel-a' }),
          expect.objectContaining({ panelId: 'panel-b' }),
        ],
        activePanelId: 'panel-b',
      })
    );
    const tab = mocks.tabDragIdentity?.getTabSnapshot('panel-a');
    await act(async () => {
      mocks.tabMoveRequest?.(
        {
          kind: 'dockable-tab',
          panelId: 'panel-a',
          sourceGroupId: 'right',
          sourceWindowName: 'workspace-1',
          clusterId: 'cluster-1',
          tab,
        } as never,
        'floating'
      );
    });
    expect(mocks.requestTabTransfer).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ targetKind: 'new-window', tab })
    );
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

  it('rejects an incoming move while another transaction freezes this view', async () => {
    mocks.frozen = true;
    await receiveDockBack();
    expect(mocks.acknowledgeDock).toHaveBeenCalledWith('workspace-1', 'dock-1', false);
    expect(mocks.dockPanelGroup).not.toHaveBeenCalled();
    expect(mocks.freeze).not.toHaveBeenCalled();
    await renderCoordinator();
    expect(mocks.acknowledgeDock).toHaveBeenCalledOnce();
  });

  it('waits for the cluster panel windows before removing the cluster tab', async () => {
    let finish!: (allowed: boolean) => void;
    mocks.closeClusterPanels.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    let settled = false;
    const preflight = mocks.clusterPreflight;
    if (!preflight) {
      throw new Error('Cluster close preflight was not registered');
    }
    const result = preflight('cluster-1').then((allowed) => {
      settled = true;
      return allowed;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.closeClusterPanels).toHaveBeenCalledWith('workspace-1', 'cluster-1');
    expect(settled).toBe(false);
    finish(false);
    expect(await result).toBeNull();
  });

  it('keeps this cluster view mounted when its local YAML is unsaved', async () => {
    const focus = vi.fn();
    mocks.blocker = { reason: 'unsaved-yaml', focus };
    expect(await mocks.clusterPreflight?.('cluster-1')).toBeNull();
    expect(focus).toHaveBeenCalledOnce();
    expect(mocks.flushPublication).not.toHaveBeenCalled();
  });

  it('denies quit and keeps the app view open when publication fails', async () => {
    mocks.flushPublication.mockRejectedValueOnce(new Error('publication failed'));
    await act(async () =>
      mocks.eventHandlers.applicationQuit?.({
        windowName: 'workspace-1',
        transactionId: 'quit-failed',
      } as never)
    );
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('workspace-1', 'quit-failed', false);
    expect(mocks.acknowledgeWorkspaceClose).not.toHaveBeenCalled();
  });

  it('flushes docked panels before acknowledging app close', async () => {
    await act(async () => mocks.eventHandlers.ownerClose?.({ windowName: 'workspace-1' } as never));
    expect(mocks.flushPublication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acknowledgeWorkspaceClose.mock.invocationCallOrder[0]
    );
  });
});
