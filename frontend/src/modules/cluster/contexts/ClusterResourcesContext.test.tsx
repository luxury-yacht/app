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
  createDomainState,
} = vi.hoisted(() => {
  const scopedStateBag: Record<string, any> = {};
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
    },
    scopedStates: scopedStateBag,
    contextRef: contextHolder,
    autoRefreshLoadingState: autoRefreshState,
    createDomainState: createState,
  };
});

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: (...args: unknown[]) => dataAccessMocks.requestRefreshDomain(...args),
}));

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
  useUserPermission: () => ({ allowed: true, pending: false, entry: { status: 'ready' } }),
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

  const render = async () => {
    await act(async () => {
      root.render(
        <ClusterResourcesProvider activeView="config">
          <TestConsumer />
        </ClusterResourcesProvider>
      );
      await Promise.resolve();
    });
  };

  it('reports an idle selected cluster view as loading while requesting startup data', async () => {
    scopedStates[`cluster-config:${testClusterScope}`] = createDomainState({
      scope: testClusterScope,
    });

    await render();

    expect(contextRef.current?.config.loading).toBe(true);
    expect(contextRef.current?.config.hasLoaded).toBe(false);
    expect(orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'cluster-config',
      testClusterScope,
      true,
      { preserveState: true }
    );
    expect(dataAccessMocks.requestRefreshDomain).toHaveBeenCalledWith({
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
        resources: [
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

  it('preserves the previous cluster view snapshot when switching active cluster views', async () => {
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

    expect(orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'cluster-config',
      testClusterScope,
      false,
      { preserveState: true }
    );
  });
});
