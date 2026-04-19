/**
 * frontend/src/modules/namespace/contexts/NsResourcesContext.test.tsx
 *
 * Test suite for NsResourcesContext.
 * Covers key behaviors and edge cases for NsResourcesContext.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NamespaceResourcesProvider, useNamespaceResources } from './NsResourcesContext';

const {
  orchestrator,
  capabilityMocks,
  storeMocks,
  viewState,
  domainStates,
  scopedStates,
  contextRef,
} = vi.hoisted(() => {
  const orchestratorMock = {
    updateContext: vi.fn(),
    setDomainEnabled: vi.fn(),
    resetDomain: vi.fn(),
    resetScopedDomain: vi.fn(),
    setScopedDomainEnabled: vi.fn(),
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
    isStreamingDomain: vi.fn().mockReturnValue(false),
  };

  const capabilityMockBag = {
    queryNamespacePermissions: vi.fn(),
  };

  const storeMockBag = {
    resetScopedDomainState: vi.fn(),
  };

  const viewStateBag = { value: 'namespace' as const };

  const domainStateMap = new Map<string, any>();
  const scopedStateBag: Record<string, any> = {};
  const contextHolder: { current: ReturnType<typeof useNamespaceResources> | null } = {
    current: null,
  };

  const createDomainState = () => ({
    status: 'idle',
    data: null,
    error: null,
    lastUpdated: null,
  });

  const getDomainState = (domain: string) => {
    if (!domainStateMap.has(domain)) {
      domainStateMap.set(domain, createDomainState());
    }
    return domainStateMap.get(domain);
  };

  return {
    orchestrator: orchestratorMock,
    capabilityMocks: capabilityMockBag,
    storeMocks: storeMockBag,
    viewState: viewStateBag,
    domainStates: domainStateMap,
    scopedStates: scopedStateBag,
    contextRef: contextHolder,
    getDomainState,
  };
});

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: orchestrator,
  useRefreshScopedDomain: (_domain: string, scope: string) =>
    scopedStates[scope] ?? { status: 'idle', data: null, error: null, lastUpdated: null },
  useRefreshScopedDomainStates: () => scopedStates,
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

vi.mock('@/core/refresh/store', () => ({
  resetScopedDomainState: (...args: unknown[]) => storeMocks.resetScopedDomainState(...args),
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

const ActiveResourceDisplay: React.FC = () => {
  const { activeResourceType } = useNamespaceResources();
  return <span data-testid="active-resource">{activeResourceType ?? 'none'}</span>;
};

const RefreshTrigger: React.FC = () => {
  const { workloads } = useNamespaceResources();
  React.useEffect(() => {
    void workloads.refresh();
  }, [workloads]);
  return null;
};

const getActiveResource = () =>
  document.querySelector('[data-testid="active-resource"]')?.textContent ?? '';

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
    domainStates.clear();
    Object.keys(scopedStates).forEach((key) => delete scopedStates[key]);

    Object.values(orchestrator).forEach((value) => {
      if (typeof value === 'function') {
        value.mockClear();
      }
    });
    Object.values(capabilityMocks).forEach((value) => value.mockClear());
    Object.values(storeMocks).forEach((value) => value.mockClear());

    viewState.value = 'namespace';
    orchestrator.isStreamingDomain.mockReturnValue(false);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  const render = async (element: React.ReactElement) => {
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
  };

  const runTimers = async () => {
    await act(async () => {
      vi.runAllTimers();
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

  it('enables the active domain, registers capabilities, and performs manual refresh', async () => {
    scopedStates[`${testClusterId}|namespace:team-a`] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: null,
    };

    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="config">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    expect(orchestrator.updateContext).toHaveBeenCalledWith({
      selectedNamespace: 'team-a',
      selectedNamespaceClusterId: testClusterId,
    });
    expect(orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespace-config',
      `${testClusterId}|namespace:team-a`,
      true,
      undefined
    );
    expect(orchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespace-config',
      `${testClusterId}|namespace:team-a`,
      expect.objectContaining({ isManual: true })
    );
    expect(capabilityMocks.queryNamespacePermissions).toHaveBeenCalledWith('team-a', testClusterId);
    expect(contextRef.current?.config.data).toEqual([]);
  });

  it('switches active resources and toggles scoped pods access', async () => {
    scopedStates[`${testClusterId}|namespace:team-a`] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: null,
    };

    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    const context = contextRef.current;
    expect(context).toBeTruthy();

    orchestrator.setDomainEnabled.mockClear();
    orchestrator.setScopedDomainEnabled.mockClear();

    await act(async () => {
      context?.setActiveResourceType('pods');
      await Promise.resolve();
    });

    expect(orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'pods',
      `${testClusterId}|namespace:team-a`,
      true
    );

    await act(async () => {
      context?.setActiveResourceType('network');
      await Promise.resolve();
    });

    expect(orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespace-network',
      `${testClusterId}|namespace:team-a`,
      true,
      undefined
    );
  });

  it('resets domains and triggers reload when the namespace changes', async () => {
    scopedStates[`${testClusterId}|namespace:team-a`] = {
      status: 'ready',
      data: null,
      error: null,
      lastUpdated: null,
    };

    vi.useFakeTimers();

    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    orchestrator.fetchScopedDomain.mockClear();
    orchestrator.resetDomain.mockClear();
    storeMocks.resetScopedDomainState.mockClear();

    scopedStates[`${testClusterId}|namespace:team-b`] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: null,
    };

    await render(
      <NamespaceResourcesProvider namespace="team-b" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(orchestrator.resetScopedDomain).toHaveBeenCalledWith(
      'namespace-workloads',
      `${testClusterId}|namespace:team-b`
    );
    expect(orchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespace-workloads',
      `${testClusterId}|namespace:team-b`,
      expect.objectContaining({ isManual: true })
    );
    expect(orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'pods',
      `${testClusterId}|namespace:team-b`,
      false
    );
  });

  it('switches active resource when the tab changes', async () => {
    vi.useFakeTimers();

    await render(
      <NamespaceResourcesProvider namespace="alpha" activeView="workloads">
        <ActiveResourceDisplay />
      </NamespaceResourcesProvider>
    );

    await runTimers();

    expect(getActiveResource()).toBe('workloads');

    const initialEnabledDomains = new Set(
      orchestrator.setScopedDomainEnabled.mock.calls
        .filter(([, , enabled]) => enabled)
        .map(([domain]) => domain)
    );
    expect(Array.from(initialEnabledDomains)).toEqual(['namespace-workloads']);

    orchestrator.fetchScopedDomain.mockClear();
    orchestrator.setScopedDomainEnabled.mockClear();

    await render(
      <NamespaceResourcesProvider namespace="alpha" activeView="config">
        <ActiveResourceDisplay />
      </NamespaceResourcesProvider>
    );

    await runTimers();

    expect(getActiveResource()).toBe('config');

    const reenabledDomains = new Set(
      orchestrator.setScopedDomainEnabled.mock.calls
        .filter(([, , enabled]) => enabled)
        .map(([domain]) => domain)
    );
    expect(Array.from(reenabledDomains)).toEqual(['namespace-config']);

    const invokedDomains = orchestrator.fetchScopedDomain.mock.calls.map((call) => call[0]);
    expect(invokedDomains).toContain('namespace-config');
  });

  it('cancels pending load timer when namespace changes rapidly', async () => {
    vi.useFakeTimers();

    scopedStates[`${testClusterId}|namespace:ns-1`] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: null,
    };

    await render(
      <NamespaceResourcesProvider namespace="ns-1" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    orchestrator.fetchScopedDomain.mockClear();

    // Switch namespace before the 100ms timer fires
    scopedStates[`${testClusterId}|namespace:ns-2`] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: null,
    };

    await render(
      <NamespaceResourcesProvider namespace="ns-2" activeView="workloads">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    // Advance past both timers
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    // Only ns-2 should have been loaded — ns-1's timer should have been cancelled
    const fetchedScopes = orchestrator.fetchScopedDomain.mock.calls.map(
      (call: unknown[]) => call[1]
    );
    expect(fetchedScopes).not.toContain(`${testClusterId}|namespace:ns-1`);
    expect(fetchedScopes).toContain(`${testClusterId}|namespace:ns-2`);
  });

  it('cancels pending load timer on unmount', async () => {
    vi.useFakeTimers();

    scopedStates[`${testClusterId}|namespace:ephemeral`] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: null,
    };

    await render(
      <NamespaceResourcesProvider namespace="ephemeral" activeView="config">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    orchestrator.fetchScopedDomain.mockClear();

    // Unmount before the 100ms timer fires
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    // Advance past the timer
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    // No fetch should have fired for the unmounted namespace
    const fetchedScopes = orchestrator.fetchScopedDomain.mock.calls.map(
      (call: unknown[]) => call[1]
    );
    expect(fetchedScopes).not.toContain(`${testClusterId}|namespace:ephemeral`);

    // Re-create root for afterEach cleanup
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  it('forces capability refresh when a resource refresh is invoked', async () => {
    vi.useFakeTimers();

    await render(
      <NamespaceResourcesProvider namespace="alpha" activeView="workloads">
        <RefreshTrigger />
      </NamespaceResourcesProvider>
    );

    await runTimers();

    // The new permission system calls queryNamespacePermissions on mount.
    // registerNamespaceCapabilityDefinitions is now a no-op.
    expect(capabilityMocks.queryNamespacePermissions).toHaveBeenCalledWith('alpha', testClusterId);
  });

  it('preserves config data and metadata references when the scoped payload is unchanged', async () => {
    const scope = `${testClusterId}|namespace:team-a`;
    const sharedResources = [
      {
        kind: 'ConfigMap',
        name: 'app-config',
        namespace: 'team-a',
        clusterId: testClusterId,
      },
      {
        kind: 'Secret',
        name: 'app-secret',
        namespace: 'team-a',
        clusterId: testClusterId,
      },
    ];
    const sharedKinds = ['ConfigMap', 'Secret'];

    scopedStates[scope] = {
      status: 'ready',
      data: {
        resources: sharedResources,
        kinds: sharedKinds,
      },
      error: null,
      lastUpdated: null,
    };

    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="config">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    const firstDataRef = contextRef.current?.config.data;
    const firstMetaRef = contextRef.current?.config.meta;

    expect(firstDataRef).toBeTruthy();
    expect(firstMetaRef).toEqual({ kinds: sharedKinds });

    await render(
      <NamespaceResourcesProvider namespace="team-a" activeView="config">
        <TestConsumer />
      </NamespaceResourcesProvider>
    );

    expect(contextRef.current?.config.data).toBe(firstDataRef);
    expect(contextRef.current?.config.meta).toBe(firstMetaRef);
  });
});
