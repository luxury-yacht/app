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
  getDomainState,
} = vi.hoisted(() => {
  const orchestratorMock = {
    updateContext: vi.fn(),
    setDomainEnabled: vi.fn(),
    resetDomain: vi.fn(),
    setScopedDomainEnabled: vi.fn(),
    triggerManualRefresh: vi.fn().mockResolvedValue(undefined),
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
    isStreamingDomain: vi.fn().mockReturnValue(false),
  };

  const capabilityMockBag = {
    registerNamespaceCapabilityDefinitions: vi.fn(),
    evaluateNamespacePermissions: vi.fn(),
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
  useRefreshDomain: (domain: string) => getDomainState(domain),
  useRefreshScopedDomainStates: () => scopedStates,
}));

vi.mock('@/core/capabilities', async () => {
  const actual = await vi.importActual<typeof import('@/core/capabilities')>('@/core/capabilities');
  return {
    ...actual,
    registerNamespaceCapabilityDefinitions: capabilityMocks.registerNamespaceCapabilityDefinitions,
    evaluateNamespacePermissions: capabilityMocks.evaluateNamespacePermissions,
  };
});

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ viewType: viewState.value }),
}));

vi.mock('@/core/refresh/store', () => ({
  resetScopedDomainState: (...args: unknown[]) => storeMocks.resetScopedDomainState(...args),
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
    scopedStates['namespace:team-a'] = {
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
    });
    expect(orchestrator.setDomainEnabled).toHaveBeenCalledWith('namespace-config', true);
    expect(orchestrator.triggerManualRefresh).toHaveBeenCalledWith(
      'namespace-config',
      expect.objectContaining({ suppressSpinner: false })
    );
    expect(capabilityMocks.registerNamespaceCapabilityDefinitions).toHaveBeenCalledWith(
      'team-a',
      expect.any(Array),
      expect.objectContaining({ ttlMs: expect.any(Number) })
    );
    expect(capabilityMocks.evaluateNamespacePermissions).toHaveBeenCalledWith('team-a');
    expect(contextRef.current?.config.data).toEqual([]);
  });

  it('switches active resources and toggles scoped pods access', async () => {
    scopedStates['namespace:team-a'] = {
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
      'namespace:team-a',
      true
    );

    await act(async () => {
      context?.setActiveResourceType('network');
      await Promise.resolve();
    });

    expect(orchestrator.setDomainEnabled).toHaveBeenCalledWith('namespace-network', true);
  });

  it('resets domains and triggers reload when the namespace changes', async () => {
    scopedStates['namespace:team-a'] = {
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

    orchestrator.triggerManualRefresh.mockClear();
    orchestrator.resetDomain.mockClear();
    storeMocks.resetScopedDomainState.mockClear();

    scopedStates['namespace:team-b'] = {
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

    expect(orchestrator.resetDomain).toHaveBeenCalledWith('namespace-workloads');
    expect(orchestrator.triggerManualRefresh).toHaveBeenCalledWith(
      'namespace-workloads',
      expect.objectContaining({ suppressSpinner: false })
    );
    expect(orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'pods',
      'namespace:team-b',
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
      orchestrator.setDomainEnabled.mock.calls
        .filter(([, enabled]) => enabled)
        .map(([domain]) => domain)
    );
    expect(Array.from(initialEnabledDomains)).toEqual(['namespace-workloads']);

    orchestrator.triggerManualRefresh.mockClear();
    orchestrator.setDomainEnabled.mockClear();

    await render(
      <NamespaceResourcesProvider namespace="alpha" activeView="config">
        <ActiveResourceDisplay />
      </NamespaceResourcesProvider>
    );

    await runTimers();

    expect(getActiveResource()).toBe('config');

    const reenabledDomains = new Set(
      orchestrator.setDomainEnabled.mock.calls
        .filter(([, enabled]) => enabled)
        .map(([domain]) => domain)
    );
    expect(Array.from(reenabledDomains)).toEqual(['namespace-config']);

    const invokedDomains = orchestrator.triggerManualRefresh.mock.calls.map((call) => call[0]);
    expect(invokedDomains).toContain('namespace-config');
  });

  it('forces capability refresh when a resource refresh is invoked', async () => {
    vi.useFakeTimers();

    await render(
      <NamespaceResourcesProvider namespace="alpha" activeView="workloads">
        <RefreshTrigger />
      </NamespaceResourcesProvider>
    );

    await runTimers();

    const forcedRefresh = capabilityMocks.registerNamespaceCapabilityDefinitions.mock.calls.some(
      ([, , options]) => options?.force === true
    );
    expect(forcedRefresh).toBe(true);
  });
});
