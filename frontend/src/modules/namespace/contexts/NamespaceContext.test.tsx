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
    namespaces: Array<{
      name: string;
      phase: string;
      resourceVersion: string;
      creationTimestamp: number;
      clusterId: string;
      clusterName: string;
    }>;
  } | null;
  error: null;
}

const { mockRefreshOrchestrator, namespaceDomainRef, namespaceDomainsByScopeRef } = vi.hoisted(
  () => {
    return {
      mockRefreshOrchestrator: {
        setDomainEnabled: vi.fn(),
        resetDomain: vi.fn(),
        fetchScopedDomain: vi.fn(() => Promise.resolve()),
        setScopedDomainEnabled: vi.fn(),
        updateContext: vi.fn(),
      },
      namespaceDomainRef: { current: createNamespaceDomain('ready', ['alpha', 'beta']) },
      namespaceDomainsByScopeRef: { current: {} as Record<string, unknown> },
    };
  }
);

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
    if (domain !== 'namespaces') {
      throw new Error(`Unexpected scoped domain requested in test: ${domain}`);
    }
    return namespaceDomainsByScopeRef.current[scope] ?? namespaceDomainRef.current;
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
    namespaceDomainsByScopeRef.current = {};
    mockClusterId = 'cluster-a';
    mockClusterIds = ['cluster-a', 'cluster-b'];
    mockClusterLifecycleStates = new Map([
      ['cluster-a', 'loading'],
      ['cluster-b', 'loading'],
    ]);
    namespaceRef.current = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
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
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    // Switching the ACTIVE tab must not disable any still-open cluster's scope
    // — both leases stay live so both stay warm (no disable/re-enable churn).
    const disables = mockRefreshOrchestrator.setScopedDomainEnabled.mock.calls.filter(
      (call) => call[2] === false
    );
    expect(disables).toEqual([]);

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
