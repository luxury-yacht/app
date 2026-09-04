import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  blocker: null as null | { panelId?: string; reason: 'unsaved-yaml'; focus: () => void },
  tabs: ['panel-a', 'panel-b'] as string[],
  acknowledgeGuard: vi.fn(async () => undefined),
  failTabTransfer: vi.fn(async () => undefined),
  upsertOwnedPanel: vi.fn(() => 'panel-c'),
  movePanelBetweenGroups: vi.fn(),
}));

vi.mock('@/core/panel-windows', () => ({
  acknowledgePanelWindowClose: mocks.acknowledgeClose,
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

vi.mock('@/core/panel-windows/panelLifecycleGuards', () => ({
  usePanelLifecycleGuardRegistry: () => ({
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
    mocks.tabs = ['panel-a', 'panel-b'];
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

  it('reports whether the whole native group can participate in application quit', async () => {
    await act(async () => {
      mocks.handlers.guard?.({ requestId: 'guard-1', windowName: 'panel-1' } as never);
      await Promise.resolve();
    });
    expect(mocks.acknowledgeGuard).toHaveBeenCalledWith('panel-1', 'guard-1', true);

    mocks.acknowledgeGuard.mockClear();
    const focus = vi.fn();
    mocks.blocker = { reason: 'unsaved-yaml', focus };
    await act(async () => {
      mocks.handlers.guard?.({ requestId: 'guard-2', windowName: 'panel-1' } as never);
      await Promise.resolve();
    });
    expect(focus).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeGuard).toHaveBeenCalledWith('panel-1', 'guard-2', false);
  });
});
