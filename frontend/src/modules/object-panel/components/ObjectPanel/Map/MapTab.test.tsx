import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelObjectData } from '../types';

const dataAccessMocks = vi.hoisted(() => ({
  requestRefreshDomain: vi.fn(() => Promise.resolve()),
}));

const refreshMocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
}));

const refreshStoreMocks = vi.hoisted(() => ({
  useRefreshScopedDomain: vi.fn(),
}));

const objectPanelMocks = vi.hoisted(() => ({
  openWithObject: vi.fn(),
}));

const navigateMocks = vi.hoisted(() => ({
  navigateToView: vi.fn(),
}));

const errorHandlerMocks = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: dataAccessMocks.requestRefreshDomain,
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: refreshMocks,
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: refreshStoreMocks.useRefreshScopedDomain,
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => objectPanelMocks,
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => navigateMocks,
}));

vi.mock('@/utils/errorHandler', () => ({
  errorHandler: errorHandlerMocks,
}));

type SnapshotStatus = 'idle' | 'loading' | 'ready' | 'updating' | 'initialising' | 'error';

type Snapshot = {
  status: SnapshotStatus;
  data?: unknown;
  error?: string | null;
};

const snapshotState: { current: Snapshot } = {
  current: {
    status: 'idle',
    data: null,
    error: null,
  },
};

refreshStoreMocks.useRefreshScopedDomain.mockImplementation(() => snapshotState.current);

const objectData: PanelObjectData = {
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  resource: 'deployments',
  namespace: 'default',
  name: 'web',
};

const waitForEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderMapTab = async (
  props: Partial<{
    objectData: PanelObjectData | null;
    isActive: boolean;
    mapScope: string | null;
  }> = {}
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    const { default: MapTab } = await import('./MapTab');
    root.render(
      <MapTab
        objectData={objectData}
        isActive={true}
        mapScope="cluster-a|default:apps/v1:Deployment:web"
        {...props}
      />
    );
  });
  await waitForEffects();

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

beforeEach(() => {
  snapshotState.current = {
    status: 'idle',
    data: null,
    error: null,
  };
  dataAccessMocks.requestRefreshDomain.mockClear();
  refreshMocks.setScopedDomainEnabled.mockClear();
  objectPanelMocks.openWithObject.mockClear();
  navigateMocks.navigateToView.mockClear();
  errorHandlerMocks.handle.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MapTab', () => {
  it('renders the loading state while the object-map snapshot is initialising', async () => {
    snapshotState.current = {
      status: 'initialising',
      data: null,
      error: null,
    };

    const { container, unmount } = await renderMapTab();

    expect(container.textContent).toContain('Loading object map');
    expect(container.textContent).not.toContain('No data yet');

    await unmount();
  });

  it('renders an error when the object-map snapshot failed without cached data', async () => {
    snapshotState.current = {
      status: 'error',
      data: null,
      error: 'unable to build object map',
    };

    const { container, unmount } = await renderMapTab();

    expect(container.querySelector('.map-tab__message--error')?.textContent).toBe(
      'unable to build object map'
    );
    expect(container.textContent).not.toContain('No data yet');

    await unmount();
  });

  it('renders the empty waiting state when there is no payload, error, or active load', async () => {
    const { container, unmount } = await renderMapTab();

    expect(container.textContent).toContain('No data yet.');

    await unmount();
  });
});
