import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dataAccessMocks = vi.hoisted(() => ({
  requestRefreshDomain: vi.fn(() => Promise.resolve()),
}));

const refreshMocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  useRefreshScopedDomain: vi.fn(),
}));

const kubeconfigMocks = vi.hoisted(() => ({
  selectedClusterId: 'cluster-a',
}));

const namespaceMocks = vi.hoisted(() => ({
  selectedNamespaceClusterId: 'cluster-a',
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: dataAccessMocks.requestRefreshDomain,
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: refreshMocks.setScopedDomainEnabled,
  },
  useRefreshScopedDomain: refreshMocks.useRefreshScopedDomain,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => kubeconfigMocks,
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => namespaceMocks,
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/object-map/ObjectMap', () => ({
  default: ({ isRefreshing }: { isRefreshing?: boolean }) => (
    <div data-testid="object-map" data-refreshing={String(isRefreshing)} />
  ),
}));

const snapshotState = {
  current: {
    status: 'idle',
    data: null,
    error: null,
  },
};

refreshMocks.useRefreshScopedDomain.mockImplementation(() => snapshotState.current);

const renderNsViewMap = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    const { default: NsViewMap } = await import('./NsViewMap');
    root.render(<NsViewMap namespace="default" />);
    await Promise.resolve();
  });

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
  refreshMocks.useRefreshScopedDomain.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('NsViewMap', () => {
  it('shows a loading notice while an idle namespace map startup fetch is pending', async () => {
    const { container, unmount } = await renderNsViewMap();

    expect(container.textContent).toContain('Loading namespace map');
    expect(container.textContent).not.toContain('No data yet');
    expect(dataAccessMocks.requestRefreshDomain).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'object-map',
        reason: 'startup',
      })
    );

    await unmount();
  });
});
