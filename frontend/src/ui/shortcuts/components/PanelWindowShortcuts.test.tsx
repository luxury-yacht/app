import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelWindowShortcuts } from './PanelWindowShortcuts';

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: never) => void>,
  requestTabClose: vi.fn(async () => undefined),
  acknowledgeClose: vi.fn(async () => undefined),
  updateSnapshot: vi.fn(async () => undefined),
  routeCommand: vi.fn(async () => undefined),
  closePanel: vi.fn(),
  closeAll: vi.fn(),
  focusPanel: vi.fn(),
  focusWindow: vi.fn(async () => undefined),
  commitTabClose: vi.fn(),
  blocker: null as null | { panelId?: string; reason: 'unsaved-yaml'; focus: () => void },
  tabs: ['panel-a', 'panel-b'] as string[],
  acknowledgeGuard: vi.fn(async () => undefined),
}));

vi.mock('@/core/panel-windows', () => ({
  acknowledgePanelWindowClose: mocks.acknowledgeClose,
  requestPanelTabClose: mocks.requestTabClose,
  updatePanelWindowSnapshot: mocks.updateSnapshot,
  routePanelWindowCommand: mocks.routeCommand,
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
  }),
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

    expect(mocks.commitTabClose).toHaveBeenCalledWith('panel-a');
    expect(mocks.acknowledgeClose).toHaveBeenCalledWith('panel-1');
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
