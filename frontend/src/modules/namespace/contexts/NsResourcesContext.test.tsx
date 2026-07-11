/**
 * frontend/src/modules/namespace/contexts/NsResourcesContext.test.tsx
 *
 * Test suite for NsResourcesContext: the namespace-view effects wrapper.
 * It publishes the selected namespace to the refresh orchestrator and primes
 * single-namespace permission checks. It deliberately holds NO domain
 * leases, fetches NO data, and exposes NO context value — the query-backed
 * tables own their rows, and the active tab lives in ViewStateContext.
 */
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NamespaceResourcesProvider } from './NsResourcesContext';

const { orchestrator, capabilityMocks, viewState } = vi.hoisted(() => ({
  orchestrator: {
    updateContext: vi.fn(),
    setScopedDomainEnabled: vi.fn(),
    acquireScopedDomainLease: vi.fn(),
    releaseScopedDomainLease: vi.fn(),
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
  },
  capabilityMocks: { queryNamespacePermissions: vi.fn() },
  viewState: { value: 'namespace' as string },
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: orchestrator,
}));

vi.mock('@/core/capabilities', async () => {
  const actual = await vi.importActual<typeof import('@/core/capabilities')>('@/core/capabilities');
  return {
    ...actual,
    queryNamespacePermissions: capabilityMocks.queryNamespacePermissions,
  };
});

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ viewType: viewState.value }),
}));

const testClusterId = 'test-cluster';

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: testClusterId }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({ selectedNamespaceClusterId: testClusterId }),
}));

describe('NamespaceResourcesProvider', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    Object.values(orchestrator).forEach((value) => {
      if (typeof value === 'function') {
        value.mockClear();
      }
    });
    capabilityMocks.queryNamespacePermissions.mockClear();
    viewState.value = 'namespace';
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const render = async (namespace?: string | null) => {
    await act(async () => {
      root.render(
        <NamespaceResourcesProvider namespace={namespace}>
          <div data-testid="child" />
        </NamespaceResourcesProvider>
      );
      await Promise.resolve();
    });
  };

  it('holds NO base-scope lease and issues NO fetch — the query-backed tables own their data', async () => {
    // Field evidence for the cut: two namespace-workloads fetches per metric
    // tick — the table's typed-query page PLUS this wrapper's base-scope
    // copy, whose rows were rendered NOWHERE.
    await render('team-a');

    expect(container.querySelector('[data-testid="child"]')).toBeTruthy();
    expect(orchestrator.acquireScopedDomainLease).not.toHaveBeenCalled();
    expect(orchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    expect(orchestrator.setScopedDomainEnabled).not.toHaveBeenCalled();

    // The load-bearing responsibilities stay: the orchestrator knows the
    // active namespace, and single-namespace permissions are primed.
    expect(orchestrator.updateContext).toHaveBeenCalledWith({
      selectedNamespace: 'team-a',
      selectedNamespaceClusterId: testClusterId,
    });
    expect(capabilityMocks.queryNamespacePermissions).toHaveBeenCalledWith('team-a', testClusterId);
  });

  it('clears the orchestrator namespace context outside the namespace view', async () => {
    viewState.value = 'cluster';
    await render('team-a');

    expect(orchestrator.updateContext).toHaveBeenCalledWith({
      selectedNamespace: undefined,
      selectedNamespaceClusterId: undefined,
    });
  });

  it('does not prime permissions for the all-namespaces sentinel', async () => {
    await render('namespace:all');

    expect(capabilityMocks.queryNamespacePermissions).not.toHaveBeenCalled();
  });

  it('follows namespace prop changes', async () => {
    await render('team-a');
    await render('team-b');

    expect(orchestrator.updateContext).toHaveBeenCalledWith({
      selectedNamespace: 'team-b',
      selectedNamespaceClusterId: testClusterId,
    });
  });
});
