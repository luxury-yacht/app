/**
 * frontend/src/modules/shell-session/ShellSessionsPanel.test.tsx
 *
 * Tests for shell session panel attach behavior.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ShellSessionsPanel from './ShellSessionsPanel';
import { objectPanelId } from '@/core/contexts/ObjectPanelStateContext';

const listShellSessionsMock = vi.hoisted(() => vi.fn());
const closeShellSessionMock = vi.hoisted(() => vi.fn());

vi.mock('@wailsjs/go/backend/App', () => ({
  ListShellSessions: listShellSessionsMock,
  CloseShellSession: closeShellSessionMock,
}));

const runtimeHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>());
const eventsOnMock = vi.hoisted(() =>
  vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    runtimeHandlers.set(event, handler);
    return vi.fn(() => {
      const current = runtimeHandlers.get(event);
      if (current === handler) {
        runtimeHandlers.delete(event);
      }
    });
  })
);

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: eventsOnMock,
}));

const panelStateMock = vi.hoisted(() => ({
  isOpen: true,
  setOpen: vi.fn(),
  toggle: vi.fn(),
  position: 'right' as 'right' | 'bottom' | 'floating',
  setPosition: vi.fn(),
  size: { width: 360, height: 420 },
  setSize: vi.fn(),
  floatingPosition: { x: 80, y: 80 },
  setFloatingPosition: vi.fn(),
}));
const switchTabMock = vi.hoisted(() => vi.fn());
const dockableContextState = vi.hoisted(() => ({
  tabGroups: {
    right: { tabs: [] as string[], activeTab: null as string | null },
    bottom: { tabs: [] as string[], activeTab: null as string | null },
    floating: [] as Array<{ groupId: string; tabs: string[]; activeTab: string | null }>,
  },
}));

vi.mock('@ui/dockable', () => ({
  DockablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dockable-panel">{children}</div>
  ),
  useDockablePanelState: () => panelStateMock,
  useDockablePanelContext: () => ({
    tabGroups: dockableContextState.tabGroups,
    switchTab: switchTabMock,
  }),
}));

const openWithObjectMock = vi.hoisted(() => vi.fn());
const requestObjectPanelTabMock = vi.hoisted(() => vi.fn());

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
  }),
}));

vi.mock('@modules/object-panel/objectPanelTabRequests', () => ({
  requestObjectPanelTab: requestObjectPanelTabMock,
}));

const setActiveKubeconfigMock = vi.hoisted(() => vi.fn());
const kubeconfigState = vi.hoisted(() => ({
  selectedClusterId: 'cluster-a',
  selectedKubeconfigs: ['selection-a', 'selection-b'],
  getClusterMeta: (selection: string) => {
    if (selection === 'selection-a') {
      return { id: 'cluster-a', name: 'a' };
    }
    if (selection === 'selection-b') {
      return { id: 'cluster-b', name: 'b' };
    }
    return { id: '', name: '' };
  },
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: kubeconfigState.selectedClusterId,
    selectedKubeconfigs: kubeconfigState.selectedKubeconfigs,
    getClusterMeta: kubeconfigState.getClusterMeta,
    setActiveKubeconfig: setActiveKubeconfigMock,
  }),
}));

const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

describe('ShellSessionsPanel attach action', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const baseSession = {
    sessionId: 'shell-1',
    clusterId: 'cluster-a',
    clusterName: 'cluster-a',
    namespace: 'default',
    podName: 'web-abc',
    container: 'app',
    command: ['/bin/sh'],
    startedAt: '2026-02-16T00:00:00Z',
  };

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    vi.clearAllMocks();
    runtimeHandlers.clear();
    listShellSessionsMock.mockResolvedValue([baseSession]);
    closeShellSessionMock.mockResolvedValue(undefined);
    panelStateMock.isOpen = true;
    panelStateMock.position = 'right';
    dockableContextState.tabGroups.right.activeTab = null;
    dockableContextState.tabGroups.right.tabs = [];
    dockableContextState.tabGroups.bottom.activeTab = null;
    dockableContextState.tabGroups.bottom.tabs = [];
    dockableContextState.tabGroups.floating = [];
    kubeconfigState.selectedClusterId = 'cluster-a';
    kubeconfigState.selectedKubeconfigs = ['selection-a', 'selection-b'];
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  const renderPanel = async () => {
    await act(async () => {
      root.render(<ShellSessionsPanel />);
      await Promise.resolve();
    });
  };

  it('attaches immediately when session matches active cluster', async () => {
    await renderPanel();

    const attachButton = document.querySelector('.ss-attach-button') as HTMLButtonElement;
    expect(attachButton).toBeTruthy();

    await act(async () => {
      attachButton.click();
      await Promise.resolve();
    });

    expect(setActiveKubeconfigMock).not.toHaveBeenCalled();
    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'Pod',
      name: 'web-abc',
      namespace: 'default',
      clusterId: 'cluster-a',
      clusterName: 'cluster-a',
    });
    expect(requestObjectPanelTabMock).toHaveBeenCalledWith(
      objectPanelId({
        kind: 'Pod',
        name: 'web-abc',
        namespace: 'default',
        clusterId: 'cluster-a',
        clusterName: 'cluster-a',
      }),
      'shell'
    );
  });

  it('switches cluster first, then opens the pod panel for cross-cluster sessions', async () => {
    listShellSessionsMock.mockResolvedValue([
      {
        ...baseSession,
        sessionId: 'shell-2',
        clusterId: 'cluster-b',
        clusterName: 'cluster-b',
      },
    ]);

    await renderPanel();

    const attachButton = document.querySelector('.ss-attach-button') as HTMLButtonElement;
    expect(attachButton).toBeTruthy();

    await act(async () => {
      attachButton.click();
      await Promise.resolve();
    });

    expect(setActiveKubeconfigMock).toHaveBeenCalledWith('selection-b');
    expect(openWithObjectMock).not.toHaveBeenCalled();

    kubeconfigState.selectedClusterId = 'cluster-b';
    await act(async () => {
      root.render(<ShellSessionsPanel />);
      await Promise.resolve();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'Pod',
      name: 'web-abc',
      namespace: 'default',
      clusterId: 'cluster-b',
      clusterName: 'cluster-b',
    });
    expect(requestObjectPanelTabMock).toHaveBeenCalledWith(
      objectPanelId({
        kind: 'Pod',
        name: 'web-abc',
        namespace: 'default',
        clusterId: 'cluster-b',
        clusterName: 'cluster-b',
      }),
      'shell'
    );
  });

  it('auto-opens the panel without stealing active right-side tab focus', async () => {
    panelStateMock.isOpen = false;
    listShellSessionsMock.mockResolvedValue([]);
    dockableContextState.tabGroups.right.activeTab = 'port-forwards';
    dockableContextState.tabGroups.right.tabs = ['port-forwards'];

    await renderPanel();

    const listHandler = runtimeHandlers.get('object-shell:list');
    expect(listHandler).toBeTruthy();

    await act(async () => {
      listHandler?.([baseSession]);
      await Promise.resolve();
    });

    expect(panelStateMock.setOpen).toHaveBeenCalledWith(true);
    expect(switchTabMock).not.toHaveBeenCalled();

    panelStateMock.isOpen = true;
    dockableContextState.tabGroups.right.activeTab = 'shell-sessions';
    dockableContextState.tabGroups.right.tabs = ['port-forwards', 'shell-sessions'];
    await act(async () => {
      root.render(<ShellSessionsPanel />);
      await Promise.resolve();
    });

    expect(switchTabMock).toHaveBeenCalledWith('right', 'port-forwards');
  });

  it('auto-opens without stealing focus when the panel is docked to the bottom', async () => {
    panelStateMock.isOpen = false;
    panelStateMock.position = 'bottom';
    listShellSessionsMock.mockResolvedValue([]);
    dockableContextState.tabGroups.bottom.activeTab = 'app-logs';
    dockableContextState.tabGroups.bottom.tabs = ['app-logs'];

    await renderPanel();

    const listHandler = runtimeHandlers.get('object-shell:list');
    expect(listHandler).toBeTruthy();

    await act(async () => {
      listHandler?.([baseSession]);
      await Promise.resolve();
    });

    expect(panelStateMock.setOpen).toHaveBeenCalledWith(true);
    expect(switchTabMock).not.toHaveBeenCalled();

    panelStateMock.isOpen = true;
    dockableContextState.tabGroups.bottom.activeTab = 'shell-sessions';
    dockableContextState.tabGroups.bottom.tabs = ['app-logs', 'shell-sessions'];
    await act(async () => {
      root.render(<ShellSessionsPanel />);
      await Promise.resolve();
    });

    expect(switchTabMock).toHaveBeenCalledWith('bottom', 'app-logs');
  });
});
