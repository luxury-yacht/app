/**
 * frontend/src/core/refresh/backgroundClusterRefresher.test.ts
 *
 * Guardrails for background cluster refresh fanout.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NavigationTabState } from '@/core/contexts/ViewStateContext';
import { BackgroundClusterRefresher } from './backgroundClusterRefresher';
import { refreshOrchestrator } from './orchestrator';

describe('BackgroundClusterRefresher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes background clusters as separate single-cluster requests', async () => {
    const fetchForCluster = vi
      .spyOn(refreshOrchestrator, 'fetchDomainForCluster')
      .mockResolvedValue(undefined);
    const navigationByCluster: Record<string, NavigationTabState> = {
      'cluster-b': {
        viewType: 'namespace',
        previousView: 'overview',
        activeNamespaceView: 'network',
        activeClusterView: 'nodes',
      },
      'cluster-c': {
        viewType: 'cluster',
        previousView: 'overview',
        activeNamespaceView: 'workloads',
        activeClusterView: 'nodes',
      },
      'cluster-d': {
        viewType: 'overview',
        previousView: 'cluster',
        activeNamespaceView: 'workloads',
        activeClusterView: 'nodes',
      },
    };
    const namespaceByCluster: Record<string, string> = {
      'cluster-b': 'default',
    };

    const refresher = new BackgroundClusterRefresher(
      (clusterId) => navigationByCluster[clusterId],
      (clusterId) => namespaceByCluster[clusterId]
    );
    refresher.updateClusters('cluster-a', ['cluster-a', 'cluster-b', 'cluster-c', 'cluster-d']);

    await (refresher as unknown as { tick: () => Promise<void> }).tick();

    expect(fetchForCluster).toHaveBeenCalledTimes(3);
    expect(fetchForCluster).toHaveBeenNthCalledWith(
      1,
      'namespace-network',
      'cluster-b',
      'namespace:default'
    );
    expect(fetchForCluster).toHaveBeenNthCalledWith(2, 'nodes', 'cluster-c', undefined);
    expect(fetchForCluster).toHaveBeenNthCalledWith(3, 'cluster-overview', 'cluster-d', undefined);
    fetchForCluster.mock.calls.forEach(([, clusterId, scope]) => {
      expect(clusterId).not.toBe('cluster-a');
      expect(scope ?? '').not.toContain('clusters=');
      expect(scope ?? '').not.toContain('cluster-b,cluster-c');
    });
  });
});
