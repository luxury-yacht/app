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

  it('skips content refresh for clusters parked on the Custom tab (catalog-backed)', async () => {
    const fetchForCluster = vi
      .spyOn(refreshOrchestrator, 'fetchDomainForCluster')
      .mockResolvedValue(undefined);
    const navigationByCluster: Record<string, NavigationTabState> = {
      'cluster-b': {
        viewType: 'cluster',
        previousView: 'overview',
        activeNamespaceView: 'workloads',
        activeClusterView: 'custom',
      },
      'cluster-c': {
        viewType: 'namespace',
        previousView: 'overview',
        activeNamespaceView: 'custom',
        activeClusterView: 'nodes',
      },
    };

    const refresher = new BackgroundClusterRefresher(
      (clusterId) => navigationByCluster[clusterId],
      (clusterId) => (clusterId === 'cluster-c' ? 'default' : undefined)
    );
    refresher.updateClusters('cluster-a', ['cluster-a', 'cluster-b', 'cluster-c']);

    await (refresher as unknown as { tick: () => Promise<void> }).tick();

    // The Custom tabs are catalog-backed (their refreshers are nulled
    // upstream); the only refresh for the namespace cluster is the namespace
    // support data — no snapshot domain fetch fires for either Custom view.
    const domains = fetchForCluster.mock.calls.map(([domain]) => domain);
    expect(domains).toEqual(['namespaces']);
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

    expect(fetchForCluster).toHaveBeenCalledTimes(4);
    // Clusters tick concurrently, so GLOBAL call order is scheduler-dependent; the
    // contract is the full call set plus per-cluster ordering (namespaces before the
    // namespace view for the same cluster).
    expect(fetchForCluster).toHaveBeenCalledWith('namespaces', 'cluster-b');
    expect(fetchForCluster).toHaveBeenCalledWith(
      'namespace-network',
      'cluster-b',
      'namespace:default'
    );
    expect(fetchForCluster).toHaveBeenCalledWith('nodes', 'cluster-c', undefined);
    expect(fetchForCluster).toHaveBeenCalledWith('cluster-overview', 'cluster-d', undefined);
    const callIndex = (domain: string) =>
      fetchForCluster.mock.calls.findIndex(([calledDomain]) => calledDomain === domain);
    expect(callIndex('namespaces')).toBeLessThan(callIndex('namespace-network'));
    fetchForCluster.mock.calls.forEach(([, clusterId, scope]) => {
      expect(clusterId).not.toBe('cluster-a');
      expect(scope ?? '').not.toContain('clusters=');
      expect(scope ?? '').not.toContain('cluster-b,cluster-c');
    });
  });

  it('refreshes background clusters concurrently, not one awaited after another', async () => {
    let releaseFetches!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    const fetchForCluster = vi
      .spyOn(refreshOrchestrator, 'fetchDomainForCluster')
      .mockImplementation(() => gate);

    const navigationByCluster: Record<string, NavigationTabState> = {
      'cluster-b': {
        viewType: 'cluster',
        previousView: 'overview',
        activeNamespaceView: 'workloads',
        activeClusterView: 'nodes',
      },
      'cluster-c': {
        viewType: 'overview',
        previousView: 'cluster',
        activeNamespaceView: 'workloads',
        activeClusterView: 'nodes',
      },
    };

    const refresher = new BackgroundClusterRefresher(
      (clusterId) => navigationByCluster[clusterId],
      () => undefined
    );
    refresher.updateClusters('cluster-a', ['cluster-a', 'cluster-b', 'cluster-c']);

    const tickPromise = (refresher as unknown as { tick: () => Promise<void> }).tick();
    // Let every cluster's first fetch start; none has resolved yet. A serial tick
    // would still be awaiting cluster-b here and cluster-c's fetch would be absent —
    // one slow cluster must not stale every other background cluster's data.
    await Promise.resolve();
    await Promise.resolve();

    const clustersFetched = new Set(fetchForCluster.mock.calls.map(([, clusterId]) => clusterId));
    expect(clustersFetched).toEqual(new Set(['cluster-b', 'cluster-c']));

    releaseFetches();
    await tickPromise;
  });

  it('keeps background namespace pod views warm with namespace support data', async () => {
    const fetchForCluster = vi
      .spyOn(refreshOrchestrator, 'fetchDomainForCluster')
      .mockResolvedValue(undefined);
    const refresher = new BackgroundClusterRefresher(
      () => ({
        viewType: 'namespace',
        previousView: 'overview',
        activeNamespaceView: 'workloads',
        activeClusterView: 'nodes',
      }),
      () => 'team-a'
    );
    refresher.updateClusters('cluster-a', ['cluster-a', 'cluster-b']);

    await (refresher as unknown as { tick: () => Promise<void> }).tick();

    expect(fetchForCluster).toHaveBeenCalledWith('namespaces', 'cluster-b');
    expect(fetchForCluster).toHaveBeenCalledWith(
      'namespace-workloads',
      'cluster-b',
      'namespace:team-a'
    );
    expect(fetchForCluster).toHaveBeenCalledWith('pods', 'cluster-b', 'namespace:team-a');
  });

  it('does not refresh namespace content without a selected background namespace', async () => {
    const fetchForCluster = vi
      .spyOn(refreshOrchestrator, 'fetchDomainForCluster')
      .mockResolvedValue(undefined);
    const refresher = new BackgroundClusterRefresher(
      () => ({
        viewType: 'namespace',
        previousView: 'overview',
        activeNamespaceView: 'network',
        activeClusterView: 'nodes',
      }),
      () => undefined
    );
    refresher.updateClusters('cluster-a', ['cluster-a', 'cluster-b']);

    await (refresher as unknown as { tick: () => Promise<void> }).tick();

    expect(fetchForCluster).toHaveBeenCalledTimes(1);
    expect(fetchForCluster).toHaveBeenCalledWith('namespaces', 'cluster-b');
  });
});
