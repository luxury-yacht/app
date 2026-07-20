/**
 * frontend/src/modules/namespace/contexts/NamespaceContext.test.tsx
 *
 * Test suite for NamespaceContext.
 * Covers key behaviors and edge cases for NamespaceContext.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock('@/utils/errorHandler', () => ({ errorHandler: errorHandlerMock }));

import { ALL_NAMESPACES_DISPLAY_NAME } from '@modules/namespace/constants';
import { eventBus } from '@/core/events';
import { resetAllScopedDomainStates, setScopedDomainState } from '@/core/refresh/store';
import { NamespaceProvider, useNamespace } from './NamespaceContext';

let mockClusterId = 'cluster-a';
let mockClusterIds = ['cluster-a'];
let mockClusterLifecycleStates = new Map([
  ['cluster-a', 'loading'],
  ['cluster-b', 'loading'],
]);

interface TestNamespaceDomain {
  status: 'ready' | 'loading' | 'idle';
  data: {
    metrics?: {
      collectedAt?: number;
      stale: boolean;
      staleAfterSeconds?: number;
      successCount: number;
      failureCount: number;
    };
    metricsState?: 'available' | 'loading' | 'unavailable';
    namespaces: Array<{
      name: string;
      ref?: {
        clusterId: string;
        group: string;
        version: string;
        kind: string;
        resource: string;
        name: string;
      };
      phase: string;
      resourceVersion: string;
      creationTimestamp: number;
      clusterId: string;
      clusterName: string;
      unhealthyWorkloads?: number;
      warningEvents?: number;
      warningEventsState?: 'available' | 'loading' | 'unavailable';
      cpuUsageMilli?: number;
      memoryUsageBytes?: number;
      quotaCount?: number;
      quotaHighestUsedPercentage?: number;
      quotaPressure?: '' | 'warning' | 'critical';
      quotaPressureState?: 'available' | 'loading' | 'unavailable';
    }>;
  } | null;
  error: null;
}

interface TestNamespaceMetricsDomain {
  status: 'ready' | 'loading' | 'idle';
  data: {
    metrics: {
      collectedAt?: number;
      stale: boolean;
      staleAfterSeconds?: number;
      successCount: number;
      failureCount: number;
    };
    metricsState: 'available' | 'loading' | 'unavailable';
    namespaces: Array<{
      ref: {
        clusterId: string;
        group: string;
        version: string;
        kind: string;
        resource: string;
        name: string;
      };
      cpuUsageMilli?: number;
      memoryUsageBytes?: number;
    }>;
  } | null;
  error: null;
}

const {
  mockRefreshOrchestrator,
  namespaceDomainRef,
  namespaceMetricsDomainRef,
  namespaceDomainsByScopeRef,
} = vi.hoisted(() => {
  return {
    mockRefreshOrchestrator: {
      setDomainEnabled: vi.fn(),
      resetDomain: vi.fn(),
      fetchScopedDomain: vi.fn(() => Promise.resolve()),
      setScopedDomainEnabled: vi.fn(),
      updateContext: vi.fn(),
    },
    namespaceDomainRef: { current: createNamespaceDomain('ready', ['alpha', 'beta']) },
    namespaceMetricsDomainRef: {
      current: {
        status: 'idle',
        data: null,
        error: null,
      } as TestNamespaceMetricsDomain,
    },
    namespaceDomainsByScopeRef: { current: {} as Record<string, unknown> },
  };
});

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: 'test',
    selectedClusterId: mockClusterId,
    selectedClusterIds: mockClusterIds,
  }),
}));

vi.mock('@core/contexts/ClusterLifecycleContext', () => ({
  useClusterLifecycle: () => ({
    getClusterState: (clusterId: string) => mockClusterLifecycleStates.get(clusterId),
    isClusterReady: (clusterId: string) => mockClusterLifecycleStates.get(clusterId) === 'ready',
  }),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mockRefreshOrchestrator,
  useRefreshScopedDomain: (domain: string, scope: string) => {
    if (domain === 'namespace-metrics') {
      return namespaceMetricsDomainRef.current;
    }
    if (domain === 'namespaces') {
      return namespaceDomainsByScopeRef.current[scope] ?? namespaceDomainRef.current;
    }
    throw new Error(`Unexpected scoped domain requested in test: ${domain}`);
  },
  useRefreshScopedDomainStates: (domain: string) => {
    if (domain !== 'namespaces') {
      throw new Error(`Unexpected scoped domain states requested in test: ${domain}`);
    }
    return namespaceDomainsByScopeRef.current;
  },
}));

vi.mock('@/core/capabilities', () => ({
  queryNamespacePermissions: vi.fn(),
}));

const SelectedNamespace: React.FC = () => {
  const { selectedNamespace, selectedNamespaceClusterId } = useNamespace();
  return (
    <>
      <span data-testid="selected">{selectedNamespace ?? 'none'}</span>
      <span data-testid="selected-cluster">{selectedNamespaceClusterId ?? 'none'}</span>
    </>
  );
};

const namespaceRef: { current: ReturnType<typeof useNamespace> | null } = { current: null };

const Harness: React.FC = () => {
  namespaceRef.current = useNamespace();
  return null;
};

describe('NamespaceProvider selection behaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    namespaceDomainRef.current = createNamespaceDomain('ready', ['alpha', 'beta']);
    namespaceMetricsDomainRef.current = { status: 'idle', data: null, error: null };
    namespaceDomainsByScopeRef.current = {};
    mockClusterId = 'cluster-a';
    mockClusterIds = ['cluster-a', 'cluster-b'];
    mockClusterLifecycleStates = new Map([
      ['cluster-a', 'loading'],
      ['cluster-b', 'loading'],
    ]);
    namespaceRef.current = null;
    resetAllScopedDomainStates('namespaces');
    resetAllScopedDomainStates('namespace-metrics');
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetAllScopedDomainStates('namespaces');
    resetAllScopedDomainStates('namespace-metrics');
    vi.useRealTimers();
  });

  const renderWithProvider = () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    act(() => {
      root.render(
        <NamespaceProvider>
          <Harness />
          <SelectedNamespace />
        </NamespaceProvider>
      );
    });

    const rerender = () => {
      act(() => {
        root.render(
          <NamespaceProvider>
            <Harness />
            <SelectedNamespace />
          </NamespaceProvider>
        );
      });
    };

    const cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };

    return { container, rerender, cleanup };
  };

  it('keeps the selected namespace while refresh is in progress', () => {
    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      namespaceRef.current?.setSelectedNamespace('alpha');
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('alpha');
    expect(getSelectedCluster()).toBe('cluster-a');

    namespaceDomainRef.current = {
      ...namespaceDomainRef.current,
      status: 'loading',
    };
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('alpha');
    expect(getSelectedCluster()).toBe('cluster-a');

    namespaceDomainRef.current = createNamespaceDomain('ready', ['alpha', 'beta']);
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('alpha');
    expect(getSelectedCluster()).toBe('cluster-a');
    cleanup();
  });

  it('clears selection when refreshed list removes the previous namespace', () => {
    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      namespaceRef.current?.setSelectedNamespace('alpha');
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(getSelected()).toBe('alpha');
    expect(getSelectedCluster()).toBe('cluster-a');

    namespaceDomainRef.current = createNamespaceDomain('ready', ['bravo']);
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('none');
    expect(getSelectedCluster()).toBe('none');
    cleanup();
  });

  it('filters namespaces to the active cluster', () => {
    namespaceDomainRef.current = {
      status: 'ready',
      data: {
        namespaces: [
          {
            name: 'alpha',
            phase: 'Active',
            resourceVersion: '1',
            creationTimestamp: Math.floor(Date.now() / 1000),
            clusterId: 'cluster-a',
            clusterName: 'alpha',
          },
          {
            name: 'beta',
            phase: 'Active',
            resourceVersion: '2',
            creationTimestamp: Math.floor(Date.now() / 1000),
            clusterId: 'cluster-b',
            clusterName: 'beta',
          },
        ],
      },
      error: null,
    };

    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    const visibleNames = namespaceRef.current?.namespaces.map((item) => item.name) ?? [];
    expect(visibleNames).toEqual([ALL_NAMESPACES_DISPLAY_NAME, 'alpha']);
    expect(namespaceRef.current?.namespaceReady).toBe(true);
    cleanup();
  });

  it('maps backend workload and warning-event rollups into namespace display data', () => {
    namespaceDomainRef.current = {
      status: 'ready',
      data: {
        namespaces: [
          {
            name: 'alpha',
            ref: {
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Namespace',
              resource: 'namespaces',
              name: 'alpha',
            },
            phase: 'Active',
            resourceVersion: '1',
            creationTimestamp: Math.floor(Date.now() / 1000),
            clusterId: 'cluster-a',
            clusterName: 'alpha',
            unhealthyWorkloads: 3,
            warningEvents: 2,
            warningEventsState: 'available',
            quotaCount: 2,
            quotaHighestUsedPercentage: 92,
            quotaPressure: 'warning',
            quotaPressureState: 'available',
          },
        ],
      },
      error: null,
    };
    namespaceMetricsDomainRef.current = {
      status: 'ready',
      data: {
        metrics: {
          collectedAt: 1_700_000_000,
          stale: false,
          successCount: 1,
          failureCount: 0,
        },
        metricsState: 'available',
        namespaces: [
          {
            ref: {
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Namespace',
              resource: 'namespaces',
              name: 'alpha',
            },
            cpuUsageMilli: 200,
            memoryUsageBytes: 96 * 1024 * 1024,
          },
        ],
      },
      error: null,
    };

    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    const alpha = namespaceRef.current?.namespaces.find((item) => item.name === 'alpha');
    expect(alpha?.unhealthyWorkloads).toBe(3);
    expect(alpha?.warningEvents).toBe(2);
    expect(alpha?.warningEventsState).toBe('available');
    expect(alpha?.cpuUsageMilli).toBe(200);
    expect(alpha?.memoryUsageBytes).toBe(96 * 1024 * 1024);
    expect(alpha?.utilizationState).toBe('available');
    expect(alpha?.quotaHighestUsedPercentage).toBe(92);
    expect(alpha?.quotaPressure).toBe('warning');
    expect(alpha?.quotaPressureState).toBe('available');
    expect(alpha?.details).toContain('Unhealthy workloads: 3');
    expect(alpha?.details).toContain('Warning events: 2');
    expect(alpha?.details).toContain('Utilization: 200m CPU, 96Mi memory');
    expect(alpha?.details).toContain('Quota pressure: 92%');
    cleanup();
  });

  it('normalizes a nullable namespace wire list', () => {
    namespaceDomainRef.current = {
      status: 'ready',
      data: { namespaces: null },
      error: null,
    } as unknown as typeof namespaceDomainRef.current;

    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    expect(namespaceRef.current?.namespaces).toEqual([]);
    cleanup();
  });

  it('marks namespace utilization stale at the client-side freshness boundary', () => {
    const collectedAt = Math.floor(Date.now() / 1000);
    namespaceDomainRef.current = {
      status: 'ready',
      data: {
        namespaces: [
          {
            name: 'alpha',
            ref: {
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Namespace',
              resource: 'namespaces',
              name: 'alpha',
            },
            phase: 'Active',
            resourceVersion: '1',
            creationTimestamp: collectedAt,
            clusterId: 'cluster-a',
            clusterName: 'alpha',
            quotaPressureState: 'available',
          },
        ],
      },
      error: null,
    };
    namespaceMetricsDomainRef.current = {
      status: 'ready',
      data: {
        metrics: {
          collectedAt,
          stale: false,
          staleAfterSeconds: 30,
          successCount: 1,
          failureCount: 0,
        },
        metricsState: 'available',
        namespaces: [
          {
            ref: {
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Namespace',
              resource: 'namespaces',
              name: 'alpha',
            },
            cpuUsageMilli: 200,
            memoryUsageBytes: 96 * 1024 * 1024,
          },
        ],
      },
      error: null,
    };

    const { cleanup } = renderWithProvider();
    expect(namespaceRef.current?.namespaces[1]?.details).not.toContain('Awaiting metrics data');

    act(() => {
      vi.advanceTimersByTime(30_500);
    });
    expect(namespaceRef.current?.namespaces[1]?.details).toContain('Awaiting metrics data');
    cleanup();
  });

  it('enables and starts namespace refresh separately for every open cluster', () => {
    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      true,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      true,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      { isManual: false, streamSignal: false }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      { isManual: false, streamSignal: false }
    );

    cleanup();
  });

  it('does not request namespace refresh until backend lifecycle reaches refresh availability', () => {
    mockClusterLifecycleStates = new Map([
      ['cluster-a', 'loading'],
      ['cluster-b', 'connected'],
    ]);
    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      true,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      { isManual: false, streamSignal: false }
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).not.toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      true,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      { isManual: false, streamSignal: false }
    );

    mockClusterLifecycleStates = new Map([
      ['cluster-a', 'loading'],
      ['cluster-b', 'loading'],
    ]);
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      true,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      { isManual: false, streamSignal: false }
    );

    cleanup();
  });

  it('stops every temporarily unavailable open scope without clearing retained snapshots', () => {
    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();

    mockClusterLifecycleStates = new Map([
      ['cluster-a', 'connected'],
      ['cluster-b', 'connected'],
    ]);
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      false,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      false,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    expect(namespaceRef.current?.namespaces.map((item) => item.name)).toEqual([
      ALL_NAMESPACES_DISPLAY_NAME,
      'alpha',
      'beta',
    ]);

    cleanup();
  });

  it('keeps namespace selection scoped to the active cluster tab', () => {
    namespaceDomainRef.current = createNamespaceDomainMulti('ready', [
      {
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        names: ['alpha', 'beta'],
      },
      {
        clusterId: 'cluster-b',
        clusterName: 'beta',
        names: ['gamma', 'delta'],
      },
    ]);
    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      namespaceRef.current?.setSelectedNamespace('beta');
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(getSelected()).toBe('beta');

    mockClusterId = 'cluster-b';
    rerender();
    act(() => {
      vi.runAllTimers();
    });
    expect(getSelected()).toBe('none');

    act(() => {
      namespaceRef.current?.setSelectedNamespace('delta');
    });

    mockClusterId = 'cluster-a';
    rerender();
    act(() => {
      vi.runAllTimers();
    });
    expect(getSelected()).toBe('beta');
    cleanup();
  });

  it('renders warmed namespace data immediately when switching open cluster tabs', () => {
    namespaceDomainsByScopeRef.current = {
      'cluster-a|': createNamespaceDomainWithCluster('ready', ['alpha'], 'cluster-a', 'alpha'),
      'cluster-b|': createNamespaceDomainWithCluster('ready', ['gamma'], 'cluster-b', 'beta'),
    };

    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    expect(namespaceRef.current?.namespaces.map((item) => item.name)).toEqual([
      ALL_NAMESPACES_DISPLAY_NAME,
      'alpha',
    ]);
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespace-metrics',
      'cluster-a|',
      true,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).not.toHaveBeenCalledWith(
      'namespace-metrics',
      'cluster-b|',
      true,
      expect.anything()
    );

    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();

    mockClusterId = 'cluster-b';
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(namespaceRef.current?.namespaces.map((item) => item.name)).toEqual([
      ALL_NAMESPACES_DISPLAY_NAME,
      'gamma',
    ]);
    expect(namespaceRef.current?.namespaceLoading).toBe(false);
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      { isManual: false, streamSignal: false }
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespace-metrics',
      'cluster-a|',
      false,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespace-metrics',
      'cluster-b|',
      true,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespace-metrics',
      'cluster-b|',
      { isManual: false, streamSignal: false }
    );
    // Switching the ACTIVE tab must not disable any still-open cluster's scope
    // — both leases stay live so both stay warm (no disable/re-enable churn).
    const disables = mockRefreshOrchestrator.setScopedDomainEnabled.mock.calls.filter(
      (call) => call[0] === 'namespaces' && call[2] === false
    );
    expect(disables).toEqual([]);

    cleanup();
  });

  it('paints retained namespaces before a stale lifecycle gate allows refresh', () => {
    namespaceDomainsByScopeRef.current = {
      'cluster-a|': createNamespaceDomainWithCluster('ready', ['alpha'], 'cluster-a', 'alpha'),
      'cluster-b|': createNamespaceDomainWithCluster('ready', ['gamma'], 'cluster-b', 'beta'),
    };
    mockClusterLifecycleStates = new Map([
      ['cluster-a', 'loading'],
      ['cluster-b', 'loading'],
    ]);

    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();

    // A late/stale lifecycle edge makes an open cluster temporarily ineligible
    // for refresh. Its lease must stop without erasing its retained snapshot.
    mockClusterLifecycleStates = new Map([
      ['cluster-a', 'loading'],
      ['cluster-b', 'connected'],
    ]);
    rerender();
    act(() => {
      vi.runAllTimers();
    });
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      false,
      { preserveState: true }
    );
    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();

    // The backend activation boundary has not converged yet, but retained data
    // belongs to the selected cluster and must paint during this render.
    mockClusterId = 'cluster-b';
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(namespaceRef.current?.namespaces.map((item) => item.name)).toEqual([
      ALL_NAMESPACES_DISPLAY_NAME,
      'gamma',
    ]);
    expect(namespaceRef.current?.namespaceLoading).toBe(false);
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).not.toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      true,
      expect.anything()
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      expect.anything()
    );

    // Once lifecycle catches up, the same retained scope becomes eligible for
    // its ordinary non-manual reconciliation.
    mockClusterLifecycleStates = new Map([
      ['cluster-a', 'loading'],
      ['cluster-b', 'loading'],
    ]);
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      true,
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      { isManual: false, streamSignal: false }
    );

    cleanup();
  });

  it('honors explicit cluster IDs when setting namespace selection', () => {
    namespaceDomainRef.current = createNamespaceDomainMulti('ready', [
      {
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        names: ['alpha', 'beta'],
      },
      {
        clusterId: 'cluster-b',
        clusterName: 'beta',
        names: ['gamma', 'delta'],
      },
    ]);
    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      namespaceRef.current?.setSelectedNamespace('delta', 'cluster-b');
    });

    expect(getSelected()).toBe('none');
    expect(namespaceRef.current?.getClusterNamespace('cluster-b')).toBe('delta');
    expect(namespaceRef.current?.getClusterNamespace('cluster-a')).toBeUndefined();
    cleanup();
  });

  it('drops namespace selections for closed cluster tabs', () => {
    namespaceDomainRef.current = createNamespaceDomainMulti('ready', [
      {
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        names: ['alpha', 'beta'],
      },
      {
        clusterId: 'cluster-b',
        clusterName: 'beta',
        names: ['gamma', 'delta'],
      },
    ]);
    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    mockClusterId = 'cluster-b';
    rerender();
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      namespaceRef.current?.setSelectedNamespace('delta');
    });

    mockClusterIds = ['cluster-a'];
    mockClusterId = 'cluster-a';
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    mockClusterIds = ['cluster-a', 'cluster-b'];
    mockClusterId = 'cluster-b';
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('none');
    cleanup();
  });

  it('keeps namespaces empty while the active cluster has no data', () => {
    namespaceDomainRef.current = createNamespaceDomainMulti('ready', [
      {
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        names: ['alpha'],
      },
    ]);
    mockClusterId = 'cluster-b';

    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    expect(namespaceRef.current?.namespaces).toEqual([]);
    expect(namespaceRef.current?.namespaceLoading).toBe(true);
    expect(namespaceRef.current?.namespaceReady).toBe(false);
    cleanup();
  });

  it('triggers manual refresh with spinner control', async () => {
    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    await act(async () => {
      await namespaceRef.current?.loadNamespaces(false);
    });

    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      { isManual: true, streamSignal: false }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      { isManual: true, streamSignal: false }
    );
    cleanup();
  });

  it('reconciles a rebuilt namespace scope without creating manual refresh jobs', () => {
    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();

    act(() => {
      eventBus.emit('cluster:scope-changed', { clusterId: 'cluster-a' });
      vi.runAllTimers();
    });

    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      { isManual: false, streamSignal: false }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('refetches a scope when its doorbell signal advances the sourceVersion, exactly once per signal', () => {
    // The stream-signal hook reads the REAL scoped store. Initial state carries
    // the initial fetch's validator (applySnapshot always sets sourceVersion
    // after a 200) — the hook consumes it without fetching.
    setScopedDomainState('namespaces', 'cluster-a|', (previous) => ({
      ...previous,
      status: 'ready',
      data: { clusterId: 'cluster-a', namespaces: [] } as never,
      sourceVersion: 'validator-1',
      scope: 'cluster-a|',
    }));

    const { cleanup, rerender } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();

    // Doorbell: the stream signal advances the scoped signal clock
    // (signalVersions is written only by the stream manager's doorbell path).
    act(() => {
      setScopedDomainState('namespaces', 'cluster-a|', (previous) => ({
        ...previous,
        sourceVersion: 'ns-1',
        signalVersions: { object: 'ns-1' },
      }));
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      { isManual: false, streamSignal: true }
    );

    // The same signal version must not refetch again.
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();
    rerender();
    act(() => {
      vi.runAllTimers();
    });
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    cleanup();
    resetAllScopedDomainStates('namespaces');
  });

  it('leaves existing clusters untouched when another cluster tab opens', () => {
    // Multi-cluster invariant: one cluster's tab lifecycle must never disturb
    // another cluster's scoped refresh state. The old effect disabled and
    // re-enabled EVERY scope on each scope-set change; the disable->enable
    // cycle reset the active scope's store (blank list + spinner + diagnostics
    // row churn) whenever ANY tab opened/closed or ANY lifecycle event fired.
    mockClusterIds = ['cluster-a'];
    const { cleanup, rerender } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockRefreshOrchestrator.resetDomain.mockClear();

    // Open a second cluster tab.
    mockClusterIds = ['cluster-a', 'cluster-b'];
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    // The new cluster's scope is enabled...
    const clusterBEnables = mockRefreshOrchestrator.setScopedDomainEnabled.mock.calls.filter(
      (call) => call[0] === 'namespaces' && call[1] === 'cluster-b|' && call[2] === true
    );
    expect(clusterBEnables.length).toBeGreaterThan(0);
    // ...and cluster-a's scope is never disabled or reset by the change.
    const clusterADisables = mockRefreshOrchestrator.setScopedDomainEnabled.mock.calls.filter(
      (call) => call[1] === 'cluster-a|' && call[2] === false
    );
    expect(clusterADisables).toEqual([]);
    expect(mockRefreshOrchestrator.resetDomain).not.toHaveBeenCalled();

    // Closing the second tab disables ONLY cluster-b's scope.
    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockClusterIds = ['cluster-a'];
    rerender();
    act(() => {
      vi.runAllTimers();
    });
    const clusterADisablesAfterClose =
      mockRefreshOrchestrator.setScopedDomainEnabled.mock.calls.filter(
        (call) => call[1] === 'cluster-a|' && call[2] === false
      );
    expect(clusterADisablesAfterClose).toEqual([]);
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespaces',
      'cluster-b|',
      false
    );
    cleanup();
  });

  it('uses a startup request for the initial namespace load', () => {
    namespaceDomainRef.current = {
      status: 'idle',
      data: null,
      error: null,
    };

    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'namespaces',
      'cluster-a|',
      { isManual: false, streamSignal: false }
    );
    cleanup();
  });

  it('exposes namespacesPermissionDenied for a permission-denied namespaces domain — and does not toast', () => {
    namespaceDomainRef.current = {
      status: 'error',
      data: null,
      error: 'permission denied for domain namespaces (core/namespaces)',
      permissionDenied: true,
    } as unknown as typeof namespaceDomainRef.current;
    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    expect(namespaceRef.current?.namespacesPermissionDenied).toBe(true);
    // A designed, rendered state — not a toast (the sidebar shows the message).
    expect(errorHandlerMock.handle).not.toHaveBeenCalled();
    cleanup();
  });

  it('keeps namespacesPermissionDenied false for transient errors (which still toast)', () => {
    namespaceDomainRef.current = {
      status: 'error',
      data: null,
      error: 'apiserver timeout',
    } as unknown as typeof namespaceDomainRef.current;
    const { cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    expect(namespaceRef.current?.namespacesPermissionDenied).toBe(false);
    expect(errorHandlerMock.handle).toHaveBeenCalled();
    cleanup();
  });

  it('does not replay a retained namespace error when switching away and back', () => {
    namespaceDomainsByScopeRef.current = {
      'cluster-a|': {
        ...createNamespaceDomainWithCluster('ready', ['alpha'], 'cluster-a', 'alpha'),
        status: 'error',
        error: 'Manual refresh timed out after 60 seconds for namespaces',
      },
      'cluster-b|': createNamespaceDomainWithCluster('ready', ['beta'], 'cluster-b', 'beta'),
    };

    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);

    mockClusterId = 'cluster-b';
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    mockClusterId = 'cluster-a';
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

function getSelected(): string {
  const element = document.querySelector('[data-testid="selected"]');
  return element?.textContent ?? '';
}

function getSelectedCluster(): string {
  const element = document.querySelector('[data-testid="selected-cluster"]');
  return element?.textContent ?? '';
}

function createNamespaceDomain(
  status: 'ready' | 'loading' | 'idle',
  names: string[]
): TestNamespaceDomain {
  return createNamespaceDomainWithCluster(status, names, 'cluster-a', 'alpha');
}

function createNamespaceDomainWithCluster(
  status: 'ready' | 'loading' | 'idle',
  names: string[],
  clusterId: string,
  clusterName: string
): TestNamespaceDomain {
  return {
    status,
    data: {
      namespaces: names.map((name, index) => ({
        name,
        phase: 'Active',
        resourceVersion: String(index + 1),
        creationTimestamp: Math.floor(Date.now() / 1000),
        clusterId,
        clusterName,
      })),
    },
    error: null,
  };
}

type ClusterNamespaceGroup = {
  clusterId: string;
  clusterName: string;
  names: string[];
};

function createNamespaceDomainMulti(
  status: 'ready' | 'loading' | 'idle',
  clusters: ClusterNamespaceGroup[]
): TestNamespaceDomain {
  const namespaces = clusters.flatMap((cluster) =>
    cluster.names.map((name, index) => ({
      name,
      phase: 'Active',
      resourceVersion: `${cluster.clusterId}-${index + 1}`,
      creationTimestamp: Math.floor(Date.now() / 1000),
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
    }))
  );

  return {
    status,
    data: {
      namespaces,
    },
    error: null,
  };
}
