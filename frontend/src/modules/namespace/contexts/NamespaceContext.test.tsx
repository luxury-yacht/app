/**
 * frontend/src/modules/namespace/contexts/NamespaceContext.test.tsx
 *
 * Test suite for NamespaceContext.
 * Covers key behaviors and edge cases for NamespaceContext.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NamespaceProvider, useNamespace } from './NamespaceContext';
import { ALL_NAMESPACES_DISPLAY_NAME } from '@modules/namespace/constants';

let mockClusterId = 'cluster-a';
let mockClusterIds = ['cluster-a'];

const { mockRefreshOrchestrator, namespaceDomainRef } = vi.hoisted(() => {
  return {
    mockRefreshOrchestrator: {
      setDomainEnabled: vi.fn(),
      resetDomain: vi.fn(),
      triggerManualRefresh: vi.fn(() => Promise.resolve()),
      updateContext: vi.fn(),
    },
    namespaceDomainRef: { current: createNamespaceDomain('ready', ['alpha', 'beta']) },
  };
});

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: 'test',
    selectedClusterId: mockClusterId,
    selectedClusterIds: mockClusterIds,
  }),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mockRefreshOrchestrator,
  useRefreshDomain: (domain: string) => {
    if (domain !== 'namespaces') {
      throw new Error(`Unexpected domain requested in test: ${domain}`);
    }
    return namespaceDomainRef.current;
  },
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
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    namespaceDomainRef.current = createNamespaceDomain('ready', ['alpha', 'beta']);
    mockClusterId = 'cluster-a';
    mockClusterIds = ['cluster-a', 'cluster-b'];
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
});

function getSelected(): string {
  const element = document.querySelector('[data-testid="selected"]');
  return element?.textContent ?? '';
}

function getSelectedCluster(): string {
  const element = document.querySelector('[data-testid="selected-cluster"]');
  return element?.textContent ?? '';
}

function createNamespaceDomain(status: 'ready' | 'loading' | 'idle', names: string[]) {
  return createNamespaceDomainWithCluster(status, names, 'cluster-a', 'alpha');
}

function createNamespaceDomainWithCluster(
  status: 'ready' | 'loading' | 'idle',
  names: string[],
  clusterId: string,
  clusterName: string
) {
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
) {
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
