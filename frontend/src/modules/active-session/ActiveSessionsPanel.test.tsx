/**
 * frontend/src/modules/active-session/ActiveSessionsPanel.test.tsx
 *
 * Tests for ActiveSessionsPanel shell attach and auto-open behavior.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ActiveSessionsPanel from './ActiveSessionsPanel';
import { objectPanelId } from '@/core/contexts/ObjectPanelStateContext';

const listShellSessionsMock = vi.hoisted(() => vi.fn());
const closeShellSessionMock = vi.hoisted(() => vi.fn());
const listPortForwardsMock = vi.hoisted(() => vi.fn());
const stopPortForwardMock = vi.hoisted(() => vi.fn());

vi.mock('@wailsjs/go/backend/App', () => ({
  ListShellSessions: listShellSessionsMock,
  CloseShellSession: closeShellSessionMock,
  ListPortForwards: listPortForwardsMock,
  StopPortForward: stopPortForwardMock,
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
const browserOpenURLMock = vi.hoisted(() => vi.fn());

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: eventsOnMock,
  BrowserOpenURL: browserOpenURLMock,
}));

const panelStateMock = vi.hoisted(() => ({
  isOpen: true,
  setOpen: vi.fn(),
  toggle: vi.fn(),
  position: 'right' as 'right' | 'bottom' | 'floating',
  setPosition: vi.fn(),
  size: { width: 380, height: 460 },
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

vi.mock('@/components/dockable', () => ({
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

describe('ActiveSessionsPanel', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const baseShellSession = {
    sessionId: 'shell-1',
    clusterId: 'cluster-a',
    clusterName: 'cluster-a',
    namespace: 'default',
    podName: 'web-abc',
    container: 'app',
    command: ['/bin/sh'],
    startedAt: '2026-02-16T00:00:00Z',
  };

  const basePortForward = {
    id: 'pf-1',
    clusterId: 'cluster-a',
    clusterName: 'cluster-a',
    namespace: 'default',
    podName: 'web-abc',
    containerPort: 8080,
    localPort: 18080,
    targetKind: 'Pod',
    targetName: 'web-abc',
    status: 'active',
    statusReason: '',
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
    listShellSessionsMock.mockResolvedValue([baseShellSession]);
    closeShellSessionMock.mockResolvedValue(undefined);
    listPortForwardsMock.mockResolvedValue([]);
    stopPortForwardMock.mockResolvedValue(undefined);
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
      root.render(<ActiveSessionsPanel />);
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

  it('switches cluster first, then opens the pod panel for cross-cluster shell sessions', async () => {
    listShellSessionsMock.mockResolvedValue([
      {
        ...baseShellSession,
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
      root.render(<ActiveSessionsPanel />);
      await Promise.resolve();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'Pod',
      name: 'web-abc',
      namespace: 'default',
      clusterId: 'cluster-b',
      clusterName: 'cluster-b',
    });
  });

  it('auto-opens the panel without stealing focus when shell sessions appear', async () => {
    panelStateMock.isOpen = false;
    listShellSessionsMock.mockResolvedValue([]);
    listPortForwardsMock.mockResolvedValue([]);
    dockableContextState.tabGroups.right.activeTab = 'diagnostics';
    dockableContextState.tabGroups.right.tabs = ['diagnostics'];

    await renderPanel();

    const listHandler = runtimeHandlers.get('object-shell:list');
    expect(listHandler).toBeTruthy();

    await act(async () => {
      listHandler?.([baseShellSession]);
      await Promise.resolve();
    });

    expect(panelStateMock.setOpen).toHaveBeenCalledWith(true);
    expect(switchTabMock).not.toHaveBeenCalled();

    panelStateMock.isOpen = true;
    dockableContextState.tabGroups.right.activeTab = 'active-sessions';
    dockableContextState.tabGroups.right.tabs = ['diagnostics', 'active-sessions'];
    await act(async () => {
      root.render(<ActiveSessionsPanel />);
      await Promise.resolve();
    });

    expect(switchTabMock).toHaveBeenCalledWith('right', 'diagnostics');
  });

  it('auto-opens the panel when port forwards appear', async () => {
    panelStateMock.isOpen = false;
    listShellSessionsMock.mockResolvedValue([]);
    listPortForwardsMock.mockResolvedValue([]);

    await renderPanel();

    const listHandler = runtimeHandlers.get('portforward:list');
    expect(listHandler).toBeTruthy();

    await act(async () => {
      listHandler?.([basePortForward]);
      await Promise.resolve();
    });

    expect(panelStateMock.setOpen).toHaveBeenCalledWith(true);
  });

  it('renders reformatted port forward fields and connect/stop actions', async () => {
    listShellSessionsMock.mockResolvedValue([]);
    listPortForwardsMock.mockResolvedValue([
      {
        ...basePortForward,
        clusterName: 'cluster-main',
        namespace: 'payments',
        podName: 'api-0',
      },
    ]);

    await renderPanel();

    expect(document.body.textContent).toContain('cluster:');
    expect(document.body.textContent).toContain('namespace:');
    expect(document.body.textContent).toContain('pod:');
    expect(document.body.textContent).toContain('container:');
    expect(document.body.textContent).toContain('ports:');
    expect(document.body.textContent).toContain('8080:18080');

    const connectButton = document.querySelector('.as-pf-connect-button') as HTMLButtonElement;
    expect(connectButton).toBeTruthy();
    expect(connectButton.disabled).toBe(false);

    const stopButton = document.querySelector('.as-pf-actions .ss-stop-button') as HTMLButtonElement;
    expect(stopButton).toBeTruthy();
    expect(stopButton.textContent).toBe('Stop');

    await act(async () => {
      connectButton.click();
      await Promise.resolve();
    });

    expect(browserOpenURLMock).toHaveBeenCalledWith('http://localhost:18080');
  });
});
