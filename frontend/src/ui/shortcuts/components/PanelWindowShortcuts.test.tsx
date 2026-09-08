import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { nativePanelPublication } from '@/core/panel-windows/publicationQueue';
import { PanelWindowShortcuts } from './PanelWindowShortcuts';

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: never) => void>,
  requestTabClose: vi.fn(async () => undefined),
  acknowledgeClose: vi.fn(async () => undefined),
  updateSnapshot: vi.fn<(_windowName: string, _snapshot: unknown) => Promise<void>>(
    async () => undefined
  ),
  openDevTools: vi.fn(async () => undefined),
  closePanel: vi.fn(),
  closeAll: vi.fn(),
  focusPanel: vi.fn(),
  focusWindow: vi.fn(async () => undefined),
  commitTabClose: vi.fn(),
  reportError: vi.fn(),
  frozen: false,
  blocker: null as null | { panelId?: string; reason: 'unsaved-yaml'; focus: () => void },
  tabs: ['panel-a', 'panel-b'] as string[],
  acknowledgeGuard: vi.fn(async () => undefined),
  acknowledgeQuit: vi.fn(async () => undefined),
  acknowledgeClusterClose: vi.fn(async () => undefined),
  freeze: vi.fn(),
  freezeCluster: vi.fn(),
  releaseTransfer: vi.fn(),
  acceptTabTransfer: vi.fn(async () => undefined),
  beginOpen: vi.fn(async () => undefined),
  failTabTransfer: vi.fn(async () => undefined),
  upsertOwnedPanel: vi.fn(() => 'panel-c'),
  movePanelBetweenGroups: vi.fn(),
  applicationShortcutsProps: null as null | {
    enabled: boolean;
    execute: (command: backend.ApplicationMenuCommand) => void;
  },
  backendExecute: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomReset: vi.fn(),
  minimiseWindow: vi.fn(async () => undefined),
  maximiseWindow: vi.fn(async () => undefined),
  restoreWindow: vi.fn(async () => undefined),
  toggleMaximise: vi.fn(async () => undefined),
}));

vi.mock('@/core/panel-windows', () => ({
  acknowledgePanelWindowClose: mocks.acknowledgeClose,
  acknowledgeClusterPanelClose: mocks.acknowledgeClusterClose,
  onClusterPanelCloseRequested: (handler: (event: never) => void) => {
    mocks.handlers.clusterClose = handler;
    return () => undefined;
  },
  onClusterPanelCloseSettled: (handler: (event: never) => void) => {
    mocks.handlers.clusterCloseSettled = handler;
    return () => undefined;
  },
  requestPanelTabClose: mocks.requestTabClose,
  updatePanelWindowSnapshot: mocks.updateSnapshot,
  onPanelTabCloseAuthorized: (handler: (event: never) => void) => {
    mocks.handlers.authorized = handler;
    return () => undefined;
  },
  onPanelWindowCloseRequested: (handler: (event: never) => void) => {
    mocks.handlers.windowClose = handler;
    return () => undefined;
  },
  onPanelWindowFocusRequested: (handler: (event: never) => void) => {
    mocks.handlers.focus = handler;
    return () => undefined;
  },
  onPanelWindowGuardRequested: (handler: (event: never) => void) => {
    mocks.handlers.guard = handler;
    return () => undefined;
  },
  acknowledgePanelWindowGuard: mocks.acknowledgeGuard,
  failPanelTabTransfer: mocks.failTabTransfer,
  acknowledgeApplicationQuitPreflight: mocks.acknowledgeQuit,
  acceptPanelTabTransfer: mocks.acceptTabTransfer,
  beginPanelWindowOpen: mocks.beginOpen,
  onApplicationQuitPreflightRequested: (handler: (event: never) => void) => {
    mocks.handlers.quit = handler;
    return () => undefined;
  },
  onApplicationQuitPreflightSettled: (handler: (event: never) => void) => {
    mocks.handlers.quitSettled = handler;
    return () => undefined;
  },
  onPanelTabTransferRequested: (handler: (event: never) => void) => {
    mocks.handlers.transferSource = handler;
    return () => undefined;
  },
  onPanelTabTransferInsertRequested: (handler: (event: never) => void) => {
    mocks.handlers.tabTransferInsert = handler;
    return () => undefined;
  },
  onPanelTabTransferCommitted: (handler: (event: never) => void) => {
    mocks.handlers.tabTransferCommitted = handler;
    return () => undefined;
  },
  onPanelTabTransferFailed: (handler: (event: never) => void) => {
    mocks.handlers.tabTransferFailed = handler;
    return () => undefined;
  },
}));

vi.mock('@/core/panel-windows/panelLifecycleGuards', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePanelLifecycleGuardRegistry: () => ({
    freeze: mocks.freeze,
    freezeCluster: mocks.freezeCluster,
    releaseTransfer: mocks.releaseTransfer,
    isFrozen: () => mocks.frozen,
    isClusterFrozen: () => mocks.frozen,
    firstBlocker: () => mocks.blocker,
  }),
}));

vi.mock('@/core/desktop-runtime', () => ({
  onEvent: (name: string, handler: (event: never) => void) => {
    mocks.handlers[name] = handler;
    return () => undefined;
  },
  focusWindow: mocks.focusWindow,
  openDevTools: mocks.openDevTools,
  maximiseWindow: mocks.maximiseWindow,
  minimiseWindow: mocks.minimiseWindow,
  restoreWindow: mocks.restoreWindow,
  toggleMaximise: mocks.toggleMaximise,
}));

vi.mock('@/core/contexts/ZoomContext', () => ({
  useZoom: () => ({
    zoomIn: mocks.zoomIn,
    zoomOut: mocks.zoomOut,
    resetZoom: mocks.zoomReset,
  }),
}));

vi.mock('@/ui/layout/ApplicationMenuCommandContext', () => ({
  executeBackendApplicationMenuCommand: mocks.backendExecute,
}));

vi.mock('./ApplicationMenuShortcuts', () => ({
  ApplicationMenuShortcuts: (props: NonNullable<typeof mocks.applicationShortcutsProps>) => {
    mocks.applicationShortcutsProps = props;
    return null;
  },
}));

vi.mock('@/modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useObjectPanelActiveTabs: () => new Map(),
  useObjectPanelState: () => ({
    closePanel: mocks.closePanel,
    onCloseObjectPanel: mocks.closeAll,
    openPanels: new Map([
      [
        'panel-a',
        {
          clusterId: 'cluster-1',
          group: 'apps',
          version: 'v1',
          kind: 'Deployment',
          namespace: 'default',
          name: 'api',
        },
      ],
      [
        'panel-b',
        {
          clusterId: 'cluster-1',
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: 'default',
          name: 'api-1',
        },
      ],
    ]),
    upsertOwnedPanel: mocks.upsertOwnedPanel,
  }),
}));

vi.mock('@/ui/dockable', () => ({
  useDockablePanelContext: () => ({
    tabGroups: {
      right: { tabs: mocks.tabs, activeTab: mocks.tabs[0] ?? null },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    },
    focusPanel: mocks.focusPanel,
    commitTabClose: mocks.commitTabClose,
    movePanelBetweenGroups: mocks.movePanelBetweenGroups,
  }),
}));

vi.mock('@/utils/errorHandler', () => ({
  reportOperationalError: mocks.reportError,
}));

const descriptor = {
  windowName: 'panel-1',
  ownerWindowName: 'workspace-1',
  clusterId: 'cluster-1',
  groupId: 'group-1',
  state: 'live',
  snapshot: {
    schemaVersion: 1,
    transferId: 'transfer-1',
    ownerWindowName: 'workspace-1',
    clusterId: 'cluster-1',
    groupId: 'group-1',
    tabs: [],
    activePanelId: 'panel-a',
  },
} as never;

describe('PanelWindowShortcuts', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.handlers = {};
    mocks.blocker = null;
    mocks.frozen = false;
    mocks.tabs = ['panel-a', 'panel-b'];
    mocks.applicationShortcutsProps = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />);
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('asks the owner before closing an active tab', async () => {
    await act(async () => {
      mocks.handlers['menu:close']?.(undefined as never);
      await Promise.resolve();
    });
    expect(mocks.requestTabClose).toHaveBeenCalledWith('panel-1', 'panel-a');
    expect(mocks.closePanel).not.toHaveBeenCalled();

    await act(async () => mocks.handlers.authorized?.({ panelId: 'panel-a' } as never));
    expect(mocks.commitTabClose).toHaveBeenCalledWith('panel-a');
    expect(mocks.closePanel).not.toHaveBeenCalled();
  });

  const outgoingTabRequest = () => ({
    transferId: 'outgoing-panel-tab',
    sourceWindowName: 'panel-1',
    targetWindowName: '',
    sourceGroupId: 'group-1',
    targetGroupId: 'group-new',
    targetKind: 'new-window',
    targetIndex: 0,
    clusterId: 'cluster-1',
    tab: {
      kind: 'object',
      panelId: 'panel-b',
      activeView: 'details',
      objectRef: {
        clusterId: 'cluster-1',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'api-1',
      },
    },
  });

  it('publishes a frozen native source before creating the target and retains it until commit', async () => {
    const request = outgoingTabRequest();
    let publish: () => void = () => {
      throw new Error('Publication was not started');
    };
    const flush = vi.spyOn(nativePanelPublication, 'flush').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          publish = resolve;
        })
    );
    await act(async () => mocks.handlers.transferSource?.({ request } as never));
    expect(mocks.freeze).toHaveBeenCalledWith(request.transferId, ['panel-b']);
    expect(mocks.acceptTabTransfer).not.toHaveBeenCalled();
    expect(mocks.beginOpen).not.toHaveBeenCalled();
    await act(async () => publish());
    expect(mocks.acceptTabTransfer).toHaveBeenCalledWith('panel-1', request.transferId);
    expect(mocks.beginOpen).toHaveBeenCalledWith(
      'panel-1',
      expect.objectContaining({
        clusterId: 'cluster-1',
        tabs: [request.tab],
      })
    );
    expect(mocks.commitTabClose).not.toHaveBeenCalled();
    await act(async () => mocks.handlers.tabTransferCommitted?.({ request } as never));
    expect(mocks.commitTabClose).toHaveBeenCalledWith('panel-b');
    expect(mocks.releaseTransfer).toHaveBeenCalledWith(request.transferId);
    flush.mockRestore();
  });

  it('keeps the native source tab when creation of its tear-off target fails', async () => {
    const request = outgoingTabRequest();
    mocks.beginOpen.mockRejectedValueOnce(new Error('native window creation failed'));
    await act(async () => mocks.handlers.transferSource?.({ request } as never));
    expect(mocks.failTabTransfer).toHaveBeenCalledWith('panel-1', request.transferId);
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        action: 'accept-tab-transfer',
      })
    );
    await act(async () => mocks.handlers.tabTransferFailed?.({ request } as never));
    expect(mocks.releaseTransfer).toHaveBeenCalledWith(request.transferId);
    expect(mocks.commitTabClose).not.toHaveBeenCalled();
    expect(mocks.acknowledgeClose).not.toHaveBeenCalled();
  });

  it('rejects outgoing native tabs while the renderer is closing', async () => {
    const request = outgoingTabRequest();
    mocks.frozen = true;
    await act(async () => mocks.handlers.transferSource?.({ request } as never));
    expect(mocks.failTabTransfer).toHaveBeenCalledWith('panel-1', request.transferId);
    expect(mocks.acceptTabTransfer).not.toHaveBeenCalled();
    expect(mocks.beginOpen).not.toHaveBeenCalled();
  });

  it('guards cluster closure and releases the freeze when another panel denies it', async () => {
    const event = {
      windowName: 'panel-1',
      clusterId: 'cluster-1',
      transactionId: 'cluster-close-1',
    };
    await act(async () => mocks.handlers.clusterClose?.(event as never));
    expect(mocks.acknowledgeClusterClose).toHaveBeenCalledWith('panel-1', 'cluster-close-1', true);
    expect(mocks.freezeCluster).toHaveBeenCalledWith('cluster-close-1', 'cluster-1', [
      'panel-a',
      'panel-b',
    ]);
    expect(mocks.acknowledgeClose).not.toHaveBeenCalled();
    await act(async () => mocks.handlers.clusterCloseSettled?.(event as never));
    expect(mocks.releaseTransfer).toHaveBeenCalledWith('cluster-close-1');
  });

  it('rejects cluster close before readiness and while a transfer is frozen', async () => {
    const event = { windowName: 'panel-1', clusterId: 'cluster-1', transactionId: 'close-unready' };
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={false} />)
    );
    await act(async () => mocks.handlers.clusterClose?.(event as never));
    expect(mocks.acknowledgeClusterClose).toHaveBeenLastCalledWith(
      'panel-1',
      'close-unready',
      false
    );
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />)
    );
    mocks.frozen = true;
    await act(async () =>
      mocks.handlers.clusterClose?.({ ...event, transactionId: 'close-frozen' } as never)
    );
    expect(mocks.acknowledgeClusterClose).toHaveBeenLastCalledWith(
      'panel-1',
      'close-frozen',
      false
    );
    expect(mocks.freeze).not.toHaveBeenCalled();
  });

  it('ignores cluster close events addressed to another cluster or window', async () => {
    for (const event of [
      { windowName: 'panel-other', clusterId: 'cluster-1' },
      { windowName: 'panel-1', clusterId: 'cluster-other' },
    ]) {
      await act(async () => {
        mocks.handlers.clusterClose?.({ ...event, transactionId: 'foreign' } as never);
        mocks.handlers.clusterCloseSettled?.({ ...event, transactionId: 'foreign' } as never);
      });
    }
    expect(mocks.acknowledgeClusterClose).not.toHaveBeenCalled();
    expect(mocks.releaseTransfer).not.toHaveBeenCalled();
  });

  it('denies cluster closure when flushing the native panel fails', async () => {
    const error = new Error('panel publication failed');
    const flush = vi.spyOn(nativePanelPublication, 'flush').mockRejectedValueOnce(error);
    const event = {
      windowName: 'panel-1',
      clusterId: 'cluster-1',
      transactionId: 'close-flush-fails',
    };
    try {
      await act(async () => mocks.handlers.clusterClose?.(event as never));
      expect(mocks.acknowledgeClusterClose).toHaveBeenCalledWith(
        'panel-1',
        event.transactionId,
        false
      );
      expect(mocks.reportError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ action: 'cluster-close-preflight', clusterId: 'cluster-1' })
      );
      expect(mocks.acknowledgeClose).not.toHaveBeenCalled();
      await act(async () => mocks.handlers.clusterCloseSettled?.(event as never));
      expect(mocks.releaseTransfer).toHaveBeenCalledWith(event.transactionId);
    } finally {
      flush.mockRestore();
    }
  });

  it('reports a rejected acknowledgement and releases its freeze on settlement', async () => {
    const error = new Error('stale close transaction');
    mocks.acknowledgeClusterClose.mockRejectedValueOnce(error);
    const event = { windowName: 'panel-1', clusterId: 'cluster-1', transactionId: 'close-stale' };
    await act(async () => mocks.handlers.clusterClose?.(event as never));
    expect(mocks.reportError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ action: 'acknowledge-cluster-close', clusterId: 'cluster-1' })
    );
    await act(async () => mocks.handlers.clusterCloseSettled?.(event as never));
    expect(mocks.releaseTransfer).toHaveBeenCalledWith(event.transactionId);
  });

  it('denies cluster closure when this panel has unsaved YAML', async () => {
    mocks.blocker = { panelId: 'panel-a', reason: 'unsaved-yaml', focus: vi.fn() };
    await act(async () =>
      mocks.handlers.clusterClose?.({
        windowName: 'panel-1',
        clusterId: 'cluster-1',
        transactionId: 'cluster-close-2',
      } as never)
    );
    expect(mocks.acknowledgeClusterClose).toHaveBeenCalledWith('panel-1', 'cluster-close-2', false);
    expect(mocks.freeze).not.toHaveBeenCalled();
    expect(mocks.acknowledgeClose).not.toHaveBeenCalled();
  });

  it('answers application quit directly and preserves every panel when a local draft blocks', async () => {
    mocks.blocker = { panelId: 'panel-a', reason: 'unsaved-yaml', focus: vi.fn() };
    await act(async () => {
      mocks.handlers.quit?.({ windowName: 'panel-1', transactionId: 'quit-1' } as never);
    });
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('panel-1', 'quit-1', false);
    expect(mocks.acknowledgeClose).not.toHaveBeenCalled();
  });

  it('executes panel-local accelerators locally and routes owner commands through the backend', async () => {
    const execute = mocks.applicationShortcutsProps?.execute;
    expect(mocks.applicationShortcutsProps?.enabled).toBe(true);

    await act(async () => {
      execute?.(backend.ApplicationMenuCommand.ApplicationMenuCommandClose);
      execute?.(backend.ApplicationMenuCommand.ApplicationMenuCommandZoomIn);
      execute?.(backend.ApplicationMenuCommand.ApplicationMenuCommandSettings);
      await Promise.resolve();
    });

    expect(mocks.requestTabClose).toHaveBeenCalledWith('panel-1', 'panel-a');
    expect(mocks.zoomIn).toHaveBeenCalledOnce();
    expect(mocks.backendExecute).toHaveBeenCalledWith(
      backend.ApplicationMenuCommand.ApplicationMenuCommandSettings
    );
  });

  it('executes native window commands in the focused panel window', async () => {
    const execute = mocks.applicationShortcutsProps?.execute;

    await act(async () => {
      execute?.(backend.ApplicationMenuCommand.ApplicationMenuCommandMinimise);
      execute?.(backend.ApplicationMenuCommand.ApplicationMenuCommandMaximise);
      execute?.(backend.ApplicationMenuCommand.ApplicationMenuCommandRestore);
      execute?.(backend.ApplicationMenuCommand.ApplicationMenuCommandToggleMaximise);
      await Promise.resolve();
    });

    expect(mocks.minimiseWindow).toHaveBeenCalledOnce();
    expect(mocks.maximiseWindow).toHaveBeenCalledOnce();
    expect(mocks.restoreWindow).toHaveBeenCalledOnce();
    expect(mocks.toggleMaximise).toHaveBeenCalledOnce();
    expect(mocks.backendExecute).not.toHaveBeenCalled();
  });

  it('opens the inspector in the focused panel window', async () => {
    await act(async () => {
      mocks.handlers['debug:open-inspector']?.(undefined as never);
      await Promise.resolve();
    });

    expect(mocks.openDevTools).toHaveBeenCalledOnce();
  });

  it('reports an inspector failure without handling it in the owner window', async () => {
    mocks.openDevTools.mockRejectedValueOnce(new Error('inspector unavailable'));

    await act(async () => {
      mocks.handlers['debug:open-inspector']?.(undefined as never);
      await Promise.resolve();
    });

    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'open-inspector' })
    );
  });

  it('does not install accelerators or publish snapshots before native readiness', async () => {
    await act(async () => root.unmount());
    mocks.handlers = {};
    mocks.updateSnapshot.mockClear();
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={false} />);
      await Promise.resolve();
    });

    expect(mocks.handlers['menu:close']).toBeUndefined();
    expect(mocks.handlers['debug:open-inspector']).toBeUndefined();
    expect(mocks.updateSnapshot).not.toHaveBeenCalled();
    expect(mocks.applicationShortcutsProps?.enabled).toBe(false);
  });

  it('reports a rejected active-tab close request', async () => {
    mocks.requestTabClose.mockRejectedValueOnce(new Error('close unavailable'));

    await act(async () => {
      mocks.handlers['menu:close']?.(undefined as never);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'close-active-tab' })
    );
  });

  it('inserts an authorized transferred tab at the requested native-window index', async () => {
    const request = {
      transferId: 'tab-transfer-1',
      sourceWindowName: 'panel-2',
      targetWindowName: 'panel-1',
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-1',
      sourceGroupId: 'group-2',
      targetGroupId: 'group-1',
      targetIndex: 1,
      targetKind: 'panel-window',
      tab: {
        kind: 'object',
        panelId: 'panel-c',
        activeView: 'details',
        objectRef: {
          clusterId: 'cluster-1',
          group: 'apps',
          version: 'v1',
          kind: 'Deployment',
          namespace: 'default',
          name: 'worker',
        },
      },
    };

    await act(async () => mocks.handlers.tabTransferInsert?.({ request } as never));

    expect(mocks.upsertOwnedPanel).toHaveBeenCalledWith(request.tab.objectRef, 'details', {
      kind: 'panel-window',
      windowName: 'panel-1',
      groupId: 'group-1',
    });
    expect(mocks.movePanelBetweenGroups).toHaveBeenCalledWith('panel-c', 'right', 1);
    expect(mocks.failTabTransfer).not.toHaveBeenCalled();
  });

  it('removes only the committed source tab and closes a source window that becomes empty', async () => {
    const request = {
      transferId: 'tab-transfer-1',
      sourceWindowName: 'panel-1',
      targetWindowName: 'panel-2',
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-1',
      sourceGroupId: 'group-1',
      targetGroupId: 'group-2',
      targetKind: 'panel-window',
      tab: { panelId: 'panel-a' },
    };

    await act(async () => mocks.handlers.tabTransferCommitted?.({ request } as never));
    expect(mocks.commitTabClose).toHaveBeenCalledWith('panel-a');
    expect(mocks.acknowledgeClose).not.toHaveBeenCalled();

    mocks.commitTabClose.mockClear();
    await act(async () => root.unmount());
    mocks.tabs = ['panel-a'];
    root = ReactDOM.createRoot(container);
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />)
    );
    await act(async () => mocks.handlers.tabTransferCommitted?.({ request } as never));

    expect(mocks.commitTabClose).not.toHaveBeenCalled();
    expect(mocks.acknowledgeClose).toHaveBeenCalledWith('panel-1');
  });

  it('closes the native window only after owner authorization for the last tab', async () => {
    await act(async () => root.unmount());
    mocks.tabs = ['panel-a'];
    root = ReactDOM.createRoot(container);
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />)
    );

    await act(async () => {
      mocks.handlers['menu:close']?.(undefined as never);
      await Promise.resolve();
      mocks.handlers.authorized?.({ panelId: 'panel-a' } as never);
      await Promise.resolve();
    });

    expect(mocks.commitTabClose).not.toHaveBeenCalled();
    expect(mocks.acknowledgeClose).toHaveBeenCalledWith('panel-1');
  });

  it('preserves the last tab when the native close commit fails', async () => {
    await act(async () => root.unmount());
    mocks.tabs = ['panel-a'];
    mocks.acknowledgeClose.mockRejectedValueOnce(new Error('native close failed'));
    root = ReactDOM.createRoot(container);
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />)
    );

    await act(async () => {
      mocks.handlers.authorized?.({ panelId: 'panel-a' } as never);
      await Promise.resolve();
    });

    expect(mocks.commitTabClose).not.toHaveBeenCalled();
    expect(mocks.closeAll).not.toHaveBeenCalled();
  });

  it('rejects incoming panel tabs while the native renderer is closing', async () => {
    mocks.frozen = true;
    const request = {
      transferId: 'incoming-while-closing',
      clusterId: 'cluster-1',
      sourceWindowName: 'other',
      targetWindowName: 'panel-1',
      targetGroupId: 'group-1',
      targetIndex: 0,
      tab: {
        kind: 'object',
        panelId: 'panel-c',
        activeView: 'details',
        objectRef: {
          clusterId: 'cluster-1',
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: 'default',
          name: 'incoming',
        },
      },
    };
    await act(async () => mocks.handlers.tabTransferInsert({ request } as never));
    expect(mocks.failTabTransfer).toHaveBeenCalledWith('panel-1', request.transferId);
    expect(mocks.upsertOwnedPanel).not.toHaveBeenCalled();
  });

  it('freezes the native window throughout close publication', async () => {
    let publish: () => void = () => undefined;
    vi.spyOn(nativePanelPublication, 'flush').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          publish = resolve;
        })
    );
    await act(async () => mocks.handlers.windowClose({} as never));
    const freezesWhilePublishing = mocks.freeze.mock.calls.length;
    expect(mocks.acknowledgeClose).not.toHaveBeenCalled();
    await act(async () => {
      publish();
    });
    expect(freezesWhilePublishing).toBe(1);
    expect(mocks.acknowledgeClose).toHaveBeenCalledOnce();
    expect(mocks.releaseTransfer).toHaveBeenCalledOnce();
  });

  it('preserves the native group when a whole-window close commit fails', async () => {
    mocks.acknowledgeClose.mockRejectedValueOnce(new Error('native close failed'));

    await act(async () => {
      mocks.handlers.windowClose?.({} as never);
      await Promise.resolve();
    });

    expect(mocks.closeAll).not.toHaveBeenCalled();
    expect(mocks.commitTabClose).not.toHaveBeenCalled();
  });

  it('serializes live snapshot writes', async () => {
    await act(async () => root.unmount());
    mocks.updateSnapshot.mockReset();
    let resolveFirst: (() => void) | undefined;
    mocks.updateSnapshot
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValue(undefined);
    root = ReactDOM.createRoot(container);
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />)
    );
    expect(mocks.updateSnapshot).toHaveBeenCalledTimes(1);

    mocks.tabs = ['panel-b', 'panel-a'];
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />)
    );
    expect(mocks.updateSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.updateSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.updateSnapshot.mock.calls[1]?.[1]).toMatchObject({
      tabs: [
        expect.objectContaining({ panelId: 'panel-b' }),
        expect.objectContaining({ panelId: 'panel-a' }),
      ],
      activePanelId: 'panel-b',
    });
  });

  it('continues serialized snapshot writes after an earlier write fails', async () => {
    await act(async () => root.unmount());
    mocks.updateSnapshot.mockReset();
    let rejectFirst: ((error: Error) => void) | undefined;
    mocks.updateSnapshot
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockResolvedValue(undefined);
    root = ReactDOM.createRoot(container);
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />)
    );

    mocks.tabs = ['panel-b', 'panel-a'];
    await act(async () =>
      root.render(<PanelWindowShortcuts descriptor={descriptor} ready={true} />)
    );
    await act(async () => {
      rejectFirst?.(new Error('owner temporarily unavailable'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.updateSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'sync-panel-window-snapshot' })
    );
  });

  it('keeps the tab open and focuses a lifecycle blocker', async () => {
    const focus = vi.fn();
    mocks.blocker = { panelId: 'panel-b', reason: 'unsaved-yaml', focus };

    await act(async () => mocks.handlers['menu:close']?.(undefined as never));

    expect(focus).toHaveBeenCalledOnce();
    expect(mocks.focusPanel).toHaveBeenCalledWith('panel-b');
    expect(mocks.focusWindow).toHaveBeenCalledWith('panel-1');
    expect(mocks.requestTabClose).not.toHaveBeenCalled();
  });

  it('blocks native close and quit while an incoming tab is provisional', async () => {
    mocks.frozen = true;
    await act(async () => {
      mocks.handlers.quit?.({ transactionId: 'quit-moving', windowName: 'panel-1' } as never);
      mocks.handlers.windowClose?.({} as never);
    });
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('panel-1', 'quit-moving', false);
    expect(mocks.acknowledgeClose).not.toHaveBeenCalled();
  });

  it('reports its local quit preflight directly to the registry', async () => {
    await act(async () =>
      mocks.handlers.quit?.({ transactionId: 'quit-clean', windowName: 'panel-1' } as never)
    );
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('panel-1', 'quit-clean', true);
    const focus = vi.fn();
    mocks.blocker = { reason: 'unsaved-yaml', focus };
    await act(async () =>
      mocks.handlers.quit?.({ transactionId: 'quit-dirty', windowName: 'panel-1' } as never)
    );
    expect(focus).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeQuit).toHaveBeenCalledWith('panel-1', 'quit-dirty', false);
  });
});
