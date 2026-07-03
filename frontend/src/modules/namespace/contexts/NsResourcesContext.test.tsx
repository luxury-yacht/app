/**
 * frontend/src/modules/namespace/contexts/NsResourcesContext.test.tsx
 *
 * Test suite for NsResourcesContext: active namespace/tab tracking, the
 * orchestrator context publication, and single-namespace permission priming.
 * The context deliberately holds NO domain leases and fetches NO data — the
 * query-backed tables own their rows (pinned below).
 */
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NamespaceResourcesProvider, useNamespaceResources } from './NsResourcesContext';

const { orchestrator, capabilityMocks, viewState, contextRef } = vi.hoisted(() => {
  const orchestratorMock = {
    updateContext: vi.fn(),
    setDomainEnabled: vi.fn(),
    resetDomain: vi.fn(),
    resetScopedDomain: vi.fn(),
    setScopedDomainEnabled: vi.fn(),
    acquireScopedDomainLease: vi.fn(),
    releaseScopedDomainLease: vi.fn(),
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
    isStreamingDomain: vi.fn().mockReturnValue(false),
  };

  return {
    orchestrator: orchestratorMock,
    capabilityMocks: { queryNamespacePermissions: vi.fn() },
    viewState: { value: 'namespace' as string },
    contextRef: {
      current: null as ReturnType<typeof useNamespaceResources> | null,
    },
  };
});

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

const TestConsumer: React.FC = () => {
  const context = useNamespaceResources();
  contextRef.current = context;
  return null;
};

describe('NamespaceResourcesProvider', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    contextRef.current = null;
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

  const render = async (element: React.ReactElement) => {
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
  };

  it('throws when useNamespaceResources is called outside the provider', () => {
    const OutsideConsumer = () => {
      useNamespaceResources();
      return null;
    };

    expect(() => {
      act(() => {
        root.render(<OutsideConsumer />);
      });
    }).toThrowError('useNamespaceResources must be used within NamespaceResourcesProvider');
  });

  it('holds NO base-scope lease and issues NO fetch — the query-backed tables own their data', async () => {
    // Field evidence for the cut: two namespace-workloads fetches per metric
    // tick — the table's typed-query page PLUS this context's base-scope
    // copy, whose rows were rendered NOWHERE (full consumer audit: manager
    // read bookkeeping fields only; AllNamespacesView read .error only;
    // every tab view is query-backed and holds its own lifecycle lease).
    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

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

  it('tracks the active resource type and exposes the setter', async () => {
    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="config">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    expect(contextRef.current?.activeResourceType).toBe('config');

    await act(async () => {
      contextRef.current?.setActiveResourceType('storage');
      await Promise.resolve();
    });
    expect(contextRef.current?.activeResourceType).toBe('storage');
  });

  it('defaults the active view to workloads when none is provided', async () => {
    await render(
      <NamespaceResourcesProvider namespace="team-a">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    expect(contextRef.current?.activeResourceType).toBe('workloads');
  });

  it('clears the orchestrator namespace context outside the namespace view', async () => {
    viewState.value = 'cluster';
    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    expect(orchestrator.updateContext).toHaveBeenCalledWith({
      selectedNamespace: undefined,
      selectedNamespaceClusterId: undefined,
    });
  });

  it('does not prime permissions for the all-namespaces sentinel', async () => {
    await render(
      <NamespaceResourcesProvider namespace="namespace:all" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    expect(capabilityMocks.queryNamespacePermissions).not.toHaveBeenCalled();
  });

  it('follows namespace prop changes', async () => {
    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );
    expect(contextRef.current?.currentNamespace).toBe('team-a');

    await render(
      <NamespaceResourcesProvider namespace="team-b" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );
    expect(contextRef.current?.currentNamespace).toBe('team-b');
    expect(orchestrator.updateContext).toHaveBeenCalledWith({
      selectedNamespace: 'team-b',
      selectedNamespaceClusterId: testClusterId,
    });
  });
});
