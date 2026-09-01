import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanelCoordinator } from './WorkspacePanelCoordinator';

const mocks = vi.hoisted(() => ({
  eventHandlers: {} as Record<string, (event: never) => void>,
  moveRequest: null as
    | null
    | ((group: never, position: 'right' | 'bottom' | 'floating') => boolean),
  clusterPreflight: null as null | ((clusterId: string) => Promise<boolean>),
  beginOpen: vi.fn(async (owner: string, snapshot: unknown) => ({ owner, snapshot })),
  commitWindow: vi.fn(),
  dockWindow: vi.fn(),
  removeWindow: vi.fn(),
  acknowledgeDock: vi.fn<() => Promise<void>>(async () => undefined),
  failTransfer: vi.fn<() => Promise<void>>(async () => undefined),
  requestGuard: vi.fn(async () => undefined),
  acknowledgeQuit: vi.fn(async () => undefined),
  requestClusterClose: vi.fn(async () => undefined),
  acknowledgeWorkspaceClose: vi.fn(async () => undefined),
  authorizeObjectOpen: vi.fn(async () => undefined),
  authorizeTabClose: vi.fn(async () => undefined),
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
  discardPanelLayouts: vi.fn(),
  focusOwnerWindow: vi.fn(async () => undefined),
  openPanels: new Map<string, typeof objectRef>(),
  nativeLocations: new Map<string, { windowName: string; groupId: string }>(),
  blocker: null as null | { reason: 'unsaved-yaml'; focus: () => void },
  reportError: vi.fn(),
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
    focusPanelWindow: mocks.focusPanelWindow,
    failPanelWindowTransfer: mocks.failTransfer,
    requestClosePanelWindowsForCluster: mocks.requestClusterClose,
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

vi.mock('@/modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useObjectPanelActiveTabs: () => new Map([['panel-a', 'details']]),
  useObjectPanelState: () => ({
    openPanels: mocks.openPanels,
    nativeLocations: mocks.nativeLocations,
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
  }: {
    children: React.ReactNode;
    onGroupMoveRequest: typeof mocks.moveRequest;
  }) => {
    mocks.moveRequest = onGroupMoveRequest;
    return children;
  },
  useDockablePanelContext: () => ({
    tabGroups: {
      right: { tabs: ['panel-a'], activeTab: 'panel-a' },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    },
    focusPanel: mocks.focusPanel,
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
    mocks.getOwnedPanel.mockReturnValue(null);
    mocks.panelIdsForCluster.mockReturnValue(['panel-a']);
    mocks.nativeWindowNamesForCluster.mockReturnValue(['panel-1']);
    mocks.panelIdsForPanelWindow.mockReturnValue(['panel-a']);
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

    const snapshot = mocks.beginOpen.mock.calls[0]?.[1] as Record<string, unknown>;
    await act(async () =>
      mocks.eventHandlers.opened?.({ windowName: 'panel-1', snapshot } as never)
    );
    expect(mocks.commitWindow).toHaveBeenCalledWith(snapshot, 'panel-1');
  });

  it('waits for native child close acknowledgement before allowing cluster close', async () => {
    let result: boolean | undefined;
    await act(async () => {
      void mocks.clusterPreflight?.('cluster-1').then((allowed) => {
        result = allowed;
      });
      await Promise.resolve();
    });
    expect(mocks.requestClusterClose).toHaveBeenCalledWith('workspace-1', 'cluster-1');
    expect(result).toBeUndefined();

    await act(async () => {
      mocks.eventHandlers.closed?.({ windowName: 'panel-1', clusterId: 'cluster-1' } as never);
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
    expect(mocks.dockWindow).toHaveBeenCalledWith(snapshot, 'bottom');
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
    mocks.acknowledgeDock.mockImplementationOnce(() => new Promise<void>(() => undefined));
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
        { groupKey: 'right', tabs: ['panel-missing'], activeTab: null } as never,
        'floating'
      )
    ).toBe(true);
    expect(mocks.beginOpen).not.toHaveBeenCalled();

    mocks.openPanels.set('panel-a', objectRef);
    mocks.openPanels.set('panel-other', { ...objectRef, clusterId: 'cluster-2', name: 'other' });
    const panel = document.createElement('div');
    panel.dataset.panelId = 'panel-a';
    panel.getBoundingClientRect = () => ({ left: 10, top: 20, width: 600, height: 400 }) as DOMRect;
    document.body.appendChild(panel);
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
    panel.remove();

    const transferred = mocks.beginOpen.mock.calls[mocks.beginOpen.mock.calls.length - 1]?.[1] as {
      tabs: Array<{ panelId: string }>;
      initialBounds: { width: number; height: number };
    };
    expect(transferred.tabs.map((tab) => tab.panelId)).toEqual(['panel-a']);
    expect(transferred.initialBounds).toMatchObject({ width: 600, height: 400 });
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
    expect(mocks.removeOwnedPanel).toHaveBeenCalledWith('cluster-1', 'panel-a');
    expect(mocks.authorizeTabClose).toHaveBeenCalledWith('workspace-1', 'panel-1', 'panel-a');
  });

  it('rolls a tab directory entry back when child authorization fails', async () => {
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

    expect(mocks.upsertOwnedPanel).toHaveBeenCalledWith(objectRef, 'details', {
      kind: 'docked',
      edge: 'bottom',
    });
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
    mocks.requestClusterClose.mockRejectedValueOnce(new Error('native close failed'));
    await expect(mocks.clusterPreflight?.('cluster-failed')).resolves.toBe(false);
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'request-cluster-close' })
    );
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

  it('authorizes owner close only after all owned panel windows close', async () => {
    await act(async () => {
      mocks.eventHandlers.ownerClose?.({
        ownerWindowName: 'workspace-1',
        panelWindows: ['panel-1'],
      } as never);
      await Promise.resolve();
    });
    expect(mocks.requestPanelClose).toHaveBeenCalledWith('workspace-1', 'panel-1', 'owner-close');
    expect(mocks.acknowledgeWorkspaceClose).not.toHaveBeenCalled();

    await act(async () => {
      mocks.eventHandlers.closed?.({ windowName: 'panel-1', clusterId: 'cluster-1' } as never);
      await Promise.resolve();
    });
    expect(mocks.acknowledgeWorkspaceClose).toHaveBeenCalledWith('workspace-1');
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
    expect(mocks.upsertOwnedPanel).toHaveBeenCalledWith(
      expect.objectContaining(objectRef),
      'details',
      { kind: 'panel-window', windowName: 'panel-1', groupId: 'group-1' }
    );
    expect(mocks.authorizeObjectOpen).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      expect.any(String),
      objectRef,
      'details'
    );

    mocks.getOwnedPanel.mockReturnValue({
      nativeLocation: { windowName: 'panel-existing', groupId: 'group-existing' },
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
