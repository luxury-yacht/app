/**
 * frontend/src/modules/namespace/contexts/__tests__/NsResourcesContext.test.tsx
 *
 * Tests for NsResourcesContext.
 */
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NamespaceResourcesProvider, useNamespaceResources } from '../NsResourcesContext';

const { mockRefreshOrchestrator, domainStateMap, scopedDomainStateMap } = vi.hoisted(() => {
  const orchestrator = {
    setDomainEnabled: vi.fn<(domain: string, enabled: boolean) => void>(),
    resetDomain: vi.fn<(domain: string) => void>(),
    setScopedDomainEnabled: vi.fn<(domain: string, scope: string, enabled: boolean) => void>(),
    triggerManualRefresh:
      vi.fn<(domain: string, options?: { suppressSpinner?: boolean }) => Promise<void>>(),
    fetchScopedDomain: vi.fn<(domain: string, scope: string, options?: unknown) => Promise<void>>(),
    updateContext: vi.fn<(context: unknown) => void>(),
    isStreamingDomain: vi.fn<(domain: string) => boolean>(),
  };

  orchestrator.triggerManualRefresh.mockResolvedValue(undefined);
  orchestrator.fetchScopedDomain.mockResolvedValue(undefined);
  orchestrator.isStreamingDomain.mockReturnValue(false);

  return {
    mockRefreshOrchestrator: orchestrator,
    domainStateMap: {} as Record<string, any>,
    scopedDomainStateMap: {} as Record<string, Record<string, any>>,
  };
});

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mockRefreshOrchestrator,
  useRefreshDomain: (domain: string) => {
    const state = domainStateMap[domain];
    if (!state) {
      throw new Error(`Unexpected domain requested in test: ${domain}`);
    }
    return state;
  },
  useRefreshScopedDomainStates: (domain: string) => scopedDomainStateMap[domain] ?? {},
}));

const resetScopedDomainState = vi.hoisted(() => vi.fn());

vi.mock('@/core/refresh/store', () => ({
  resetScopedDomainState,
}));

const evaluateNamespacePermissions = vi.hoisted(() => vi.fn());
const registerNamespaceCapabilityDefinitions = vi.hoisted(() => vi.fn());

vi.mock('@/core/capabilities', async () => {
  const actual = await vi.importActual<typeof import('@/core/capabilities')>('@/core/capabilities');
  return {
    ...actual,
    evaluateNamespacePermissions,
    registerNamespaceCapabilityDefinitions,
  };
});

const viewStateRef: { viewType: string } = { viewType: 'namespace' };

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ viewType: viewStateRef.viewType }),
}));

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

describe('NamespaceResourcesProvider tab synchronisation', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockRefreshOrchestrator.setDomainEnabled.mockClear();
    mockRefreshOrchestrator.resetDomain.mockClear();
    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockRefreshOrchestrator.triggerManualRefresh.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();
    mockRefreshOrchestrator.updateContext.mockClear();
    mockRefreshOrchestrator.isStreamingDomain.mockImplementation(
      (domain: string) => domain === 'namespace-events'
    );
    evaluateNamespacePermissions.mockClear();
    registerNamespaceCapabilityDefinitions.mockClear();
    resetScopedDomainState.mockClear();

    initializeDomainStates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches active resource when the tab changes', () => {
    const { rerender, cleanup } = renderWithProvider(
      <NamespaceResourcesProvider namespace="alpha" activeView="workloads">
        <ActiveResourceDisplay />
      </NamespaceResourcesProvider>
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(getActiveResource()).toBe('workloads');

    const initialEnabledDomains = mockRefreshOrchestrator.setDomainEnabled.mock.calls
      .filter(([, enabled]) => enabled)
      .map(([domain]) => domain);
    expect(initialEnabledDomains).toEqual(['namespace-workloads']);

    expect(mockRefreshOrchestrator.triggerManualRefresh).toHaveBeenCalledWith(
      'namespace-workloads',
      expect.objectContaining({ suppressSpinner: expect.any(Boolean) })
    );

    mockRefreshOrchestrator.triggerManualRefresh.mockClear();
    mockRefreshOrchestrator.setDomainEnabled.mockClear();

    rerender(
      <NamespaceResourcesProvider namespace="alpha" activeView="config">
        <ActiveResourceDisplay />
      </NamespaceResourcesProvider>
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(getActiveResource()).toBe('config');

    const reenabledDomains = mockRefreshOrchestrator.setDomainEnabled.mock.calls
      .filter(([, enabled]) => enabled)
      .map(([domain]) => domain);
    expect(reenabledDomains).toEqual(['namespace-config']);

    const invokedDomains = mockRefreshOrchestrator.triggerManualRefresh.mock.calls.map(
      (call) => call[0]
    );
    expect(invokedDomains).toContain('namespace-config');
    const refreshCalls = mockRefreshOrchestrator.triggerManualRefresh.mock.calls;
    const lastCall = refreshCalls[refreshCalls.length - 1];
    expect(lastCall?.[0]).toBe('namespace-config');
    cleanup();
  });

  it('forces capability refresh when a resource refresh is invoked', async () => {
    const { cleanup } = renderWithProvider(
      <NamespaceResourcesProvider namespace="alpha" activeView="workloads">
        <RefreshTrigger />
      </NamespaceResourcesProvider>
    );

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(registerNamespaceCapabilityDefinitions).toHaveBeenCalledWith(
      'alpha',
      expect.any(Array),
      expect.objectContaining({ force: true })
    );

    cleanup();
  });
});

function renderWithProvider(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  act(() => {
    root.render(element);
  });

  const rerender = (next: React.ReactElement) => {
    act(() => {
      root.render(next);
    });
  };

  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };

  return { rerender, cleanup };
}

function initializeDomainStates() {
  Object.keys(domainStateMap).forEach((key) => {
    delete domainStateMap[key];
  });
  Object.keys(scopedDomainStateMap).forEach((key) => {
    delete scopedDomainStateMap[key];
  });

  const domains = [
    'namespace-workloads',
    'namespace-config',
    'namespace-network',
    'namespace-rbac',
    'namespace-storage',
    'namespace-autoscaling',
    'namespace-quotas',
    'namespace-custom',
    'namespace-helm',
    'namespace-events',
  ];

  domains.forEach((domain) => {
    domainStateMap[domain] = {
      status: 'idle',
      data: null,
      error: null,
      lastUpdated: undefined,
    };
  });

  scopedDomainStateMap.pods = {};
}

function getActiveResource(): string {
  const element = document.querySelector('[data-testid="active-resource"]');
  return element?.textContent ?? '';
}
