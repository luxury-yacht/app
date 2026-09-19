/**
 * frontend/src/modules/namespace/components/NsViewMap.test.tsx
 *
 * Verifies namespace object-map startup loading while the scoped refresh
 * lifecycle is brokered through core data-access.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dataAccessMocks = vi.hoisted(() => ({
  requestRefreshDomain: vi.fn(() => Promise.resolve()),
  setRefreshDomainEnabled: vi.fn(),
  leases: new Map<string, number>(),
  enabled: new Set<string>(),
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

vi.mock('@/core/data-access/dataAccess', () => ({
  requestRefreshDomain: dataAccessMocks.requestRefreshDomain,
  setRefreshDomainEnabled: dataAccessMocks.setRefreshDomainEnabled,
  acquireRefreshDomainLease: ({ scope }: { scope: string }) => {
    dataAccessMocks.leases.set(scope, (dataAccessMocks.leases.get(scope) ?? 0) + 1);
    dataAccessMocks.enabled.add(scope);
  },
  releaseRefreshDomainLease: ({ scope }: { scope: string }) => {
    const count = (dataAccessMocks.leases.get(scope) ?? 1) - 1;
    dataAccessMocks.leases.set(scope, count);
    if (!count) dataAccessMocks.enabled.delete(scope);
  },
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
  default: () => <div data-testid="object-map" />,
}));

const snapshotState = {
  current: {
    status: 'idle',
    data: null,
    error: null,
  },
};

refreshMocks.useRefreshScopedDomain.mockImplementation(() => snapshotState.current);

const renderNsViewMap = async (namespace = 'default') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    const { default: NsViewMap } = await import('./NsViewMap');
    root.render(<NsViewMap namespace={namespace} />);
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
  dataAccessMocks.leases.clear();
  dataAccessMocks.enabled.clear();
  dataAccessMocks.setRefreshDomainEnabled.mockImplementation(({ scope, enabled }) => {
    if (enabled) dataAccessMocks.enabled.add(scope);
    else dataAccessMocks.enabled.delete(scope);
  });
  dataAccessMocks.requestRefreshDomain.mockClear();
  dataAccessMocks.setRefreshDomainEnabled.mockClear();
  refreshMocks.setScopedDomainEnabled.mockClear();
  refreshMocks.useRefreshScopedDomain.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('NsViewMap', () => {
  it('retains polling until the last namespace map owner unmounts', async () => {
    const first = await renderNsViewMap();
    const second = await renderNsViewMap();
    const scope = [...dataAccessMocks.enabled][0];
    await first.unmount();
    const enabledAfterFirstRelease = dataAccessMocks.enabled.has(scope);
    await second.unmount();
    expect(enabledAfterFirstRelease).toBe(true);
    expect(dataAccessMocks.enabled.has(scope)).toBe(false);
  });

  it('does not acquire or fetch an invalid empty namespace scope', async () => {
    const view = await renderNsViewMap('');
    await view.unmount();
    expect(dataAccessMocks.enabled.size).toBe(0);
    expect(dataAccessMocks.requestRefreshDomain).not.toHaveBeenCalled();
  });

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
