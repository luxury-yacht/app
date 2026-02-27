import ReactDOM from 'react-dom/client';
import { act } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionsStatus from './SessionsStatus';

const listShellSessionsMock = vi.hoisted(() => vi.fn());
const listPortForwardsMock = vi.hoisted(() => vi.fn());
const stopPortForwardMock = vi.hoisted(() => vi.fn());
const browserOpenURLMock = vi.hoisted(() => vi.fn());

vi.mock('@wailsjs/go/backend/App', () => ({
  ListShellSessions: listShellSessionsMock,
  ListPortForwards: listPortForwardsMock,
  StopPortForward: stopPortForwardMock,
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: browserOpenURLMock,
}));

const statusIndicatorMock = vi.hoisted(() =>
  vi.fn(({ message }: { message: ReactNode }) => (
    <div data-testid="status-indicator-message">{message}</div>
  ))
);

vi.mock('@shared/components/status/StatusIndicator', () => ({
  default: statusIndicatorMock,
}));

const openWithObjectMock = vi.hoisted(() => vi.fn());
const requestObjectPanelTabMock = vi.hoisted(() => vi.fn());
const objectPanelIdMock = vi.hoisted(() => vi.fn(() => 'object-panel:pod:web-abc'));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
  }),
}));

vi.mock('@modules/object-panel/objectPanelTabRequests', () => ({
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
    stopPortForwardMock.mockResolvedValue(undefined);
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
      })
    );
    expect(objectPanelIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        name: 'web-abc',
      })
    );
    expect(requestObjectPanelTabMock).toHaveBeenCalledWith('object-panel:pod:web-abc', 'shell');
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
});
