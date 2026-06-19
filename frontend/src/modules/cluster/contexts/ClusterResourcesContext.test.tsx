/**
 * frontend/src/modules/cluster/contexts/ClusterResourcesContext.test.tsx
 *
 * Test suite for ClusterResourcesContext.
 * Covers startup readiness behavior for cluster-scoped resource views.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClusterResourcesProvider, useClusterResources } from './ClusterResourcesContext';

const testClusterId = 'cluster-a';
const testClusterScope = `${testClusterId}|`;

const {
  dataAccessMocks,
  orchestrator,
  scopedStates,
  contextRef,
  autoRefreshLoadingState,
  permissionStates,
  createDomainState,
} = vi.hoisted(() => {
  const scopedStateBag: Record<string, any> = {};
  const permissionStateBag: Record<string, any> = {};
  const contextHolder: { current: ReturnType<typeof useClusterResources> | null } = {
    current: null,
  };
  const autoRefreshState = {
    isPaused: false,
    isManualRefreshActive: false,
    suppressPassiveLoading: false,
  };
  const createState = (overrides: Record<string, unknown> = {}) => ({
    status: 'idle',
    data: null,
    stats: null,
    error: null,
    droppedAutoRefreshes: 0,
    scope: undefined,
    ...overrides,
  });

  return {
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
    scopedStates: scopedStateBag,
    permissionStates: permissionStateBag,
    contextRef: contextHolder,
    autoRefreshLoadingState: autoRefreshState,
    createDomainState: createState,
  };
});

vi.mock('@/core/data-access', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requestRefreshDomain: (...args: unknown[]) => dataAccessMocks.requestRefreshDomain(...args),
  };
});

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: orchestrator,
  useRefreshScopedDomain: (domain: string, scope: string) =>
    scopedStates[`${domain}:${scope}`] ?? createDomainState({ scope }),
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => autoRefreshLoadingState,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: testClusterId }),
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermission: (kind: string) =>
    permissionStates[kind] ?? { allowed: true, pending: false, entry: { status: 'ready' } },
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

    Object.keys(scopedStates).forEach((key) => delete scopedStates[key]);
    Object.keys(permissionStates).forEach((key) => delete permissionStates[key]);
    contextRef.current = null;
    dataAccessMocks.requestRefreshDomain.mockClear();
    Object.values(orchestrator).forEach((value) => value.mockClear());
    autoRefreshLoadingState.isPaused = false;
    autoRefreshLoadingState.isManualRefreshActive = false;
    autoRefreshLoadingState.suppressPassiveLoading = false;
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

  it('does not provider-start query-backed cluster table domains', async () => {
    scopedStates[`cluster-config:${testClusterScope}`] = createDomainState({
      scope: testClusterScope,
    });

    await render();

    expect(contextRef.current?.config.hasLoaded).toBe(false);
    expect(orchestrator.acquireScopedDomainLease).not.toHaveBeenCalledWith(
      'cluster-config',
      testClusterScope,
      expect.anything()
    );
    expect(dataAccessMocks.requestRefreshDomain).not.toHaveBeenCalledWith({
      domain: 'cluster-config',
      scope: testClusterScope,
      reason: 'startup',
    });
  });

  it('populates the selected cluster view when the startup snapshot arrives', async () => {
    scopedStates[`cluster-config:${testClusterScope}`] = createDomainState({
      scope: testClusterScope,
    });

    await render();

    scopedStates[`cluster-config:${testClusterScope}`] = createDomainState({
      status: 'ready',
      scope: testClusterScope,
      data: {
        rows: [
          {
            clusterId: testClusterId,
            kind: 'StorageClass',
            name: 'fast',
          },
        ],
        kinds: ['StorageClass'],
      },
    });

    await render();

    expect(contextRef.current?.config.loading).toBe(false);
    expect(contextRef.current?.config.hasLoaded).toBe(true);
    expect(contextRef.current?.config.data).toEqual([
      {
        clusterId: testClusterId,
        kind: 'StorageClass',
        name: 'fast',
      },
    ]);
    expect(contextRef.current?.config.meta).toEqual({ kinds: ['StorageClass'] });
  });

  it('preserves scoped cluster resource state when the cluster tab is backgrounded', async () => {
    await render();

    orchestrator.setScopedDomainEnabled.mockClear();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    expect(orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'cluster-config',
      testClusterScope,
      false,
      { preserveState: true }
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  it('disables each managed cluster domain at its own scope on unmount', async () => {
    // Single-source scope contract: the cleanup-all teardown must disable
    // cluster-events at the events scope (<clusterId>|cluster) and every other
    // managed domain at the bare cluster scope (<clusterId>|) — the same
    // per-domain scope the subscriptions and handles use. Guards against the
    // events/cluster scope rule drifting between the subscription and the
    // teardown paths.
    const testEventsScope = `${testClusterId}|cluster`;

    await render();

    orchestrator.setScopedDomainEnabled.mockClear();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    const disabledScopeByDomain = new Map<string, string>();
    for (const call of orchestrator.setScopedDomainEnabled.mock.calls) {
      const [domain, scope, enabled] = call as [string, string, boolean, unknown];
      if (enabled === false) {
        disabledScopeByDomain.set(domain, scope);
      }
    }

    expect(disabledScopeByDomain.get('cluster-events')).toBe(testEventsScope);
    for (const domain of [
      'nodes',
      'cluster-rbac',
      'cluster-storage',
      'cluster-config',
      'cluster-crds',
    ]) {
      expect(disabledScopeByDomain.get(domain)).toBe(testClusterScope);
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  it('leaves query-backed cluster view live lifecycles to the table adapter', async () => {
    await render();

    orchestrator.setScopedDomainEnabled.mockClear();

    await act(async () => {
      root.render(
        <ClusterResourcesProvider activeView="nodes">
          <TestConsumer />
        </ClusterResourcesProvider>
      );
      await Promise.resolve();
    });

    expect(orchestrator.acquireScopedDomainLease).not.toHaveBeenCalledWith(
      'cluster-config',
      testClusterScope,
      expect.anything()
    );
    expect(orchestrator.acquireScopedDomainLease).not.toHaveBeenCalledWith(
      'nodes',
      testClusterScope,
      expect.anything()
    );
  });

  it('does not provider-start query-backed cluster domains when permissions allow them', async () => {
    permissionStates.StorageClass = {
      allowed: true,
      pending: false,
      entry: { status: 'ready' },
    };
    permissionStates.IngressClass = {
      allowed: false,
      pending: false,
      entry: { status: 'ready' },
    };
    permissionStates.GatewayClass = {
      allowed: false,
      pending: false,
      entry: { status: 'ready' },
    };
    permissionStates.MutatingWebhookConfiguration = {
      allowed: false,
      pending: false,
      entry: { status: 'ready' },
    };
    permissionStates.ValidatingWebhookConfiguration = {
      allowed: false,
      pending: false,
      entry: { status: 'ready' },
    };
    scopedStates[`cluster-config:${testClusterScope}`] = createDomainState({
      scope: testClusterScope,
    });

    await render();

    expect(orchestrator.acquireScopedDomainLease).not.toHaveBeenCalledWith(
      'cluster-config',
      testClusterScope,
      expect.anything()
    );
    expect(dataAccessMocks.requestRefreshDomain).not.toHaveBeenCalledWith({
      domain: 'cluster-config',
      scope: testClusterScope,
      reason: 'startup',
    });
  });

  it('leaves query-backed cluster domains disabled when every resource permission is denied', async () => {
    for (const kind of [
      'StorageClass',
      'IngressClass',
      'GatewayClass',
      'MutatingWebhookConfiguration',
      'ValidatingWebhookConfiguration',
    ]) {
      permissionStates[kind] = {
        allowed: false,
        pending: false,
        entry: { status: 'ready' },
      };
    }
    scopedStates[`cluster-config:${testClusterScope}`] = createDomainState({
      scope: testClusterScope,
    });

    await render();

    expect(orchestrator.acquireScopedDomainLease).not.toHaveBeenCalledWith(
      'cluster-config',
      testClusterScope,
      expect.anything()
    );
    expect(dataAccessMocks.requestRefreshDomain).not.toHaveBeenCalled();
  });

  it('does not enable or fetch the cluster-custom fanout for the catalog-backed custom view', async () => {
    scopedStates[`cluster-custom:${testClusterScope}`] = createDomainState({
      status: 'ready',
      scope: testClusterScope,
      data: {
        resources: [{ clusterId: testClusterId, kind: 'Widget', name: 'legacy-row' }],
        kinds: ['Widget'],
      },
    });

    await render('custom');

    expect(contextRef.current?.custom.data).toEqual([]);
    expect(contextRef.current?.custom.hasLoaded).toBe(false);
    expect(orchestrator.acquireScopedDomainLease).not.toHaveBeenCalledWith(
      'cluster-custom',
      testClusterScope,
      expect.anything()
    );
    expect(dataAccessMocks.requestRefreshDomain).not.toHaveBeenCalledWith({
      domain: 'cluster-custom',
      scope: testClusterScope,
      reason: 'startup',
    });
  });
});
