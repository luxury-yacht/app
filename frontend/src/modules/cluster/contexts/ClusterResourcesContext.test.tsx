/**
 * frontend/src/modules/cluster/contexts/ClusterResourcesContext.test.tsx
 *
 * Test suite for ClusterResourcesContext: active cluster-tab tracking and
 * kubeconfig-switch domain resets. The context deliberately holds NO domain
 * leases and fetches NO data — the query-backed cluster tables own their rows
 * (pinned below).
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClusterResourcesProvider, useClusterResources } from './ClusterResourcesContext';
import { eventBus } from '@/core/events';

const { dataAccessMocks, orchestrator, contextRef } = vi.hoisted(() => ({
  dataAccessMocks: {
    requestRefreshDomain: vi.fn().mockResolvedValue(undefined),
  },
  orchestrator: {
    resetDomain: vi.fn(),
    resetScopedDomain: vi.fn(),
    setScopedDomainEnabled: vi.fn(),
    acquireScopedDomainLease: vi.fn(),
    releaseScopedDomainLease: vi.fn(),
  },
  contextRef: {
    current: null as ReturnType<typeof useClusterResources> | null,
  },
}));

vi.mock('@/core/data-access', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requestRefreshDomain: (...args: unknown[]) => dataAccessMocks.requestRefreshDomain(...args),
  };
});

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: orchestrator,
}));

const TestConsumer: React.FC = () => {
  contextRef.current = useClusterResources();
  return null;
};

describe('ClusterResourcesProvider', () => {
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
    dataAccessMocks.requestRefreshDomain.mockClear();
    Object.values(orchestrator).forEach((value) => value.mockClear());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const render = async (
    activeView: React.ComponentProps<typeof ClusterResourcesProvider>['activeView'] = 'config'
  ) => {
    await act(async () => {
      root.render(
        <ClusterResourcesProvider activeView={activeView}>
          <TestConsumer />
        </ClusterResourcesProvider>
      );
      await Promise.resolve();
    });
  };

  it('throws when useClusterResources is called outside the provider', () => {
    const OutsideConsumer = () => {
      useClusterResources();
      return null;
    };

    expect(() => {
      act(() => {
        root.render(<OutsideConsumer />);
      });
    }).toThrowError('useClusterResources must be used within ClusterResourcesProvider');
  });

  it('exposes only tab tracking — no resource handles, no leases, no fetches', async () => {
    // Mirror of the NsResourcesContext cut: the six per-domain handles fed
    // rows rendered NOWHERE (the manager read only .error; every cluster tab
    // is query-backed and owns its rows), while the context's doorbell
    // refetches re-downloaded each base scope every metric tick (the
    // observed second nodes call). The context is tab tracking only.
    await render('nodes');

    expect(contextRef.current).toBeTruthy();
    expect(contextRef.current && 'nodes' in (contextRef.current as object)).toBe(false);
    expect(contextRef.current && 'rbac' in (contextRef.current as object)).toBe(false);
    expect(contextRef.current?.activeResourceType).toBe('nodes');

    expect(dataAccessMocks.requestRefreshDomain).not.toHaveBeenCalled();
    expect(orchestrator.acquireScopedDomainLease).not.toHaveBeenCalled();
    expect(orchestrator.setScopedDomainEnabled).not.toHaveBeenCalled();
  });

  it('tracks the active resource type and exposes the setter', async () => {
    await render('storage');
    expect(contextRef.current?.activeResourceType).toBe('storage');

    await act(async () => {
      contextRef.current?.setActiveResourceType('crds');
      await Promise.resolve();
    });
    expect(contextRef.current?.activeResourceType).toBe('crds');
  });

  it('resets every managed cluster domain when the kubeconfig starts changing', async () => {
    await render('nodes');

    await act(async () => {
      eventBus.emit('kubeconfig:changing', undefined as never);
      await Promise.resolve();
    });

    const resetDomains = orchestrator.resetDomain.mock.calls.map((call) => call[0]).sort();
    expect(resetDomains).toEqual([
      'cluster-config',
      'cluster-crds',
      'cluster-events',
      'cluster-rbac',
      'cluster-storage',
      'nodes',
    ]);
  });

  it('clears the active tab when the kubeconfig has changed', async () => {
    await render('nodes');

    await act(async () => {
      eventBus.emit('kubeconfig:changed', undefined as never);
      await Promise.resolve();
    });

    expect(contextRef.current?.activeResourceType).toBeNull();
  });
});
