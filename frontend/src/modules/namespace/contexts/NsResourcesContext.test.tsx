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
    setScopedDomainEnabled: vi.fn(),
    triggerManualRefresh: vi.fn(),
    fetchScopedDomain: vi.fn(),
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

  return {
    orchestrator: orchestratorMock,
    capabilityMocks: capabilityMockBag,
    storeMocks: storeMockBag,
    viewState: viewStateBag,
    domainStates: domainStateMap,
    scopedStates: scopedStateBag,
    contextRef: contextHolder,
  };
});

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: orchestrator,
  useRefreshDomain: (domain: string) => {
    if (!domainStates.has(domain)) {
      domainStates.set(domain, {
        status: 'idle',
        data: null,
        error: null,
        lastUpdated: null,
      });
    }
    return domainStates.get(domain);
  },
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('throws when useNamespaceResources is called outside the provider', () => {
    const OutsideConsumer = () => {
      useNamespaceResources();
      return null;
    };

    expect(() =>
      act(() => {
        root.render(<OutsideConsumer />);
      })
    ).toThrowError('useNamespaceResources must be used within NamespaceResourcesProvider');
  });

  it('enables the active domain, registers capabilities, and performs manual refresh', async () => {
    scopedStates['namespace:team-a'] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: null,
    };

    await act(async () => {
      root.render(
        <NamespaceResourcesProvider namespace="team-a" activeView="config">
          <TestConsumer />
        </NamespaceResourcesProvider>
      );
      await Promise.resolve();
    });

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

    await act(async () => {
      root.render(
        <NamespaceResourcesProvider namespace="team-a" activeView="workloads">
          <TestConsumer />
        </NamespaceResourcesProvider>
      );
      await Promise.resolve();
    });

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

    await act(async () => {
      root.render(
        <NamespaceResourcesProvider namespace="team-a" activeView="workloads">
          <TestConsumer />
        </NamespaceResourcesProvider>
      );
      await Promise.resolve();
    });

    orchestrator.triggerManualRefresh.mockClear();
    orchestrator.resetDomain.mockClear();
    storeMocks.resetScopedDomainState.mockClear();

    scopedStates['namespace:team-b'] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: null,
    };

    await act(async () => {
      root.render(
        <NamespaceResourcesProvider namespace="team-b" activeView="workloads">
          <TestConsumer />
        </NamespaceResourcesProvider>
      );
      await Promise.resolve();
    });

    vi.advanceTimersByTime(150);
    await Promise.resolve();

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
    vi.useRealTimers();
  });
});
