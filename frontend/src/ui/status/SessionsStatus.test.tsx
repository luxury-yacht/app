import ReactDOM from 'react-dom/client';
import { act } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionsStatus from './SessionsStatus';

const listShellSessionsMock = vi.hoisted(() => vi.fn());
const listPortForwardsMock = vi.hoisted(() => vi.fn());
const listRuntimeOperationsMock = vi.hoisted(() => vi.fn());
const stopPortForwardMock = vi.hoisted(() => vi.fn());
const browserOpenURLMock = vi.hoisted(() => vi.fn());

vi.mock('@wailsjs/go/backend/App', () => ({
  ListShellSessions: listShellSessionsMock,
  ListPortForwards: listPortForwardsMock,
  ListRuntimeOperations: listRuntimeOperationsMock,
  StopPortForward: stopPortForwardMock,
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: browserOpenURLMock,
}));

const statusIndicatorMock = vi.hoisted(() =>
  vi.fn(
    ({
      message,
      closeSignal,
      status,
    }: {
      message: ReactNode;
      closeSignal?: unknown;
      status?: string;
    }) => (
      <div
        data-testid="status-indicator-message"
        data-close-signal={String(closeSignal ?? '')}
        data-status={status ?? ''}
      >
        {message}
      </div>
    )
  )
);

vi.mock('@shared/components/status/StatusIndicator', () => ({
  default: statusIndicatorMock,
}));

const openWithObjectMock = vi.hoisted(() => vi.fn());
const requestObjectPanelTabMock = vi.hoisted(() => vi.fn());
const getRequestedObjectPanelTabMock = vi.hoisted(() => vi.fn());
const objectPanelIdMock = vi.hoisted(() => vi.fn(() => 'object-panel:pod:web-abc'));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
  }),
}));

vi.mock('@modules/object-panel/objectPanelTabRequests', () => ({
  getRequestedObjectPanelTab: getRequestedObjectPanelTabMock,
  requestObjectPanelTab: requestObjectPanelTabMock,
}));

vi.mock('@/core/contexts/ObjectPanelStateContext', () => ({
  objectPanelId: objectPanelIdMock,
}));

const setActiveKubeconfigMock = vi.hoisted(() => vi.fn());
const kubeconfigState = vi.hoisted(() => ({
  selectedClusterId: 'cluster-a',
  selectedKubeconfigs: ['selection-a', 'selection-b'],
  getClusterMeta: (selection: string) => {
    if (selection === 'selection-a') return { id: 'cluster-a', name: 'a' };
    if (selection === 'selection-b') return { id: 'cluster-b', name: 'b' };
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

describe('SessionsStatus shell session jump action', () => {
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
    startedAt: '2026-02-20T00:00:00Z',
  };

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    vi.clearAllMocks();
    listShellSessionsMock.mockResolvedValue([baseShellSession]);
    listPortForwardsMock.mockResolvedValue([]);
    listRuntimeOperationsMock.mockResolvedValue([
      {
        id: baseShellSession.sessionId,
        type: 'shell',
        clusterId: baseShellSession.clusterId,
        clusterName: baseShellSession.clusterName,
        target: {
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: baseShellSession.namespace,
          name: baseShellSession.podName,
        },
        status: 'open',
        startedAt: baseShellSession.startedAt,
      },
    ]);
    stopPortForwardMock.mockResolvedValue(undefined);
    getRequestedObjectPanelTabMock.mockReturnValue('shell');
    kubeconfigState.selectedClusterId = 'cluster-a';
    kubeconfigState.selectedKubeconfigs = ['selection-a', 'selection-b'];
    (
      window as typeof window & {
        runtime?: {
          EventsOn: (event: string, handler: (...args: unknown[]) => void) => () => void;
        };
      }
    ).runtime = {
      EventsOn: vi.fn((_event, _handler) => vi.fn()),
    };
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

  const renderStatus = async () => {
    await act(async () => {
      root.render(<SessionsStatus />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const latestCloseSignal = () =>
    statusIndicatorMock.mock.calls[statusIndicatorMock.mock.calls.length - 1]?.[0]?.closeSignal as
      | number
      | undefined;

  it('opens and focuses the shell tab immediately for sessions on the active cluster', async () => {
    await renderStatus();

    const openButton = document.querySelector('.as-shell-session-jump') as HTMLButtonElement;
    expect(openButton).toBeTruthy();

    await act(async () => {
      openButton.click();
      await Promise.resolve();
    });

    expect(setActiveKubeconfigMock).not.toHaveBeenCalled();
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'web-abc',
        namespace: 'default',
        clusterId: 'cluster-a',
        clusterName: 'cluster-a',
        group: '',
        version: 'v1',
      })
    );
    expect(objectPanelIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        name: 'web-abc',
      })
    );
    expect(requestObjectPanelTabMock).toHaveBeenCalledWith('object-panel:pod:web-abc', 'shell');
    expect(latestCloseSignal()).toBe(1);
  });

  it('keeps the sessions panel open when the shell tab request is not verified', async () => {
    getRequestedObjectPanelTabMock.mockReturnValue(undefined);
    await renderStatus();

    const openButton = document.querySelector('.as-shell-session-jump') as HTMLButtonElement;
    expect(openButton).toBeTruthy();
    expect(latestCloseSignal()).toBe(0);

    await act(async () => {
      openButton.click();
      await Promise.resolve();
    });

    expect(openWithObjectMock).toHaveBeenCalled();
    expect(requestObjectPanelTabMock).toHaveBeenCalledWith('object-panel:pod:web-abc', 'shell');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        action: 'jumpToShellSession',
        sessionId: 'shell-1',
        clusterId: 'cluster-a',
      })
    );
    expect(latestCloseSignal()).toBe(0);
  });

  it('requests a cluster switch before opening a shell session on another cluster', async () => {
    kubeconfigState.selectedClusterId = '';
    listShellSessionsMock.mockResolvedValue([
      {
        ...baseShellSession,
        sessionId: 'shell-2',
        clusterId: 'cluster-b',
        clusterName: 'cluster-b',
      },
    ]);
    listRuntimeOperationsMock.mockResolvedValue([
      {
        id: 'shell-2',
        type: 'shell',
        clusterId: 'cluster-b',
        clusterName: 'cluster-b',
        target: {
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: baseShellSession.namespace,
          name: baseShellSession.podName,
        },
        status: 'open',
        startedAt: baseShellSession.startedAt,
      },
    ]);

    await renderStatus();

    const openButton = document.querySelector('.as-shell-session-jump') as HTMLButtonElement;
    expect(openButton).toBeTruthy();

    await act(async () => {
      openButton.click();
      await Promise.resolve();
    });

    expect(setActiveKubeconfigMock).toHaveBeenCalledWith('selection-b');
    expect(openWithObjectMock).not.toHaveBeenCalled();
  });

  it('does not render node drains in the shell and port-forward sessions panel', async () => {
    listShellSessionsMock.mockResolvedValue([]);
    listPortForwardsMock.mockResolvedValue([]);
    listRuntimeOperationsMock.mockResolvedValue([
      {
        id: 'drain-1',
        type: 'drain',
        clusterId: 'cluster-a',
        clusterName: 'cluster-a',
        target: {
          group: '',
          version: 'v1',
          kind: 'Node',
          name: 'node-a',
        },
        status: 'active',
        startedAt: baseShellSession.startedAt,
      },
    ]);

    await renderStatus();

    expect(document.body.textContent).not.toContain('Node Drains');
    expect(document.body.textContent).not.toContain('node-a');
    expect(document.body.textContent).toContain('No active shell sessions or port forwards');
    expect(
      statusIndicatorMock.mock.calls[statusIndicatorMock.mock.calls.length - 1]?.[0]?.status
    ).toBe('inactive');
  });
});
