/**
 * frontend/src/core/refresh/streamQueryCoexistence.test.ts
 *
 * Proves the stream-and-domain coexistence invariant from the large-data
 * contract: a metrics or resource-stream update delivered for one scope of a
 * metrics-coupled domain (pods, namespace-workloads, nodes) must never
 * overwrite, clear, or race the active backend query result held under a
 * *different* scope of the same domain.
 *
 * The realistic case is that the same domain simultaneously backs a query-backed
 * all-namespaces (or cluster) table AND a single-namespace local/stream window.
 * Those live under distinct scope keys, so a stale single-namespace update must
 * leave the query-backed scope byte identical (same `data` object reference),
 * and vice versa. Existing tests cover the cross-cluster fetch path and the
 * catalog scope guard (browseCatalogData "rejects stale pinned-namespace
 * snapshots"); this covers the same-cluster, same-domain, different-scope case
 * that Phase 4 only reasoned about by inference.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyMetricsSnapshot } from './metricsSnapshotApplicator';
import { getScopedDomainState, resetAllScopedDomainStates, setScopedDomainState } from './store';
import type {
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodSnapshotPayload,
  RefreshDomain,
} from './types';

const seedScope = (domain: RefreshDomain, scope: string, data: unknown) => {
  setScopedDomainState(domain, scope, () => ({
    status: 'ready',
    data: data as never,
    stats: null,
    error: null,
    droppedAutoRefreshes: 0,
    scope,
  }));
};

const steadyMetrics = { stale: false, successCount: 1, failureCount: 0 } as const;

describe('stream/query coexistence (scope isolation)', () => {
  afterEach(() => {
    resetAllScopedDomainStates('pods');
    resetAllScopedDomainStates('namespace-workloads');
    resetAllScopedDomainStates('nodes');
  });

  it('keeps the query-backed pods scope untouched when a single-namespace metrics update lands', () => {
    const queryScope = 'cluster-a|namespace:all?limit=50&sort=name';
    const localScope = 'cluster-a|namespace:default';
    const queryPod = {
      clusterId: 'cluster-a',
      namespace: 'team-a',
      name: 'pod-query',
      cpuUsage: '1m',
      memUsage: '1Mi',
    };
    const localPod = {
      clusterId: 'cluster-a',
      namespace: 'default',
      name: 'pod-local',
      cpuUsage: '1m',
      memUsage: '1Mi',
    };

    seedScope('pods', queryScope, {
      clusterId: 'cluster-a',
      rows: [queryPod],
      metrics: steadyMetrics,
    } as unknown as PodSnapshotPayload);
    seedScope('pods', localScope, {
      clusterId: 'cluster-a',
      rows: [localPod],
      metrics: steadyMetrics,
    } as unknown as PodSnapshotPayload);

    const queryDataBefore = getScopedDomainState('pods', queryScope).data;

    const applied = applyMetricsSnapshot({
      domain: 'pods',
      snapshot: {
        domain: 'pods',
        scope: localScope,
        version: 2,
        checksum: 'etag-local',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [{ ...localPod, cpuUsage: '99m', memUsage: '99Mi' }],
          metrics: { stale: false, successCount: 2, failureCount: 0 },
        } as unknown as PodSnapshotPayload,
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-local',
      isManual: false,
      scope: localScope,
      clearRefreshError: vi.fn(),
    });

    expect(applied).toBe(true);
    // The query-backed scope must be byte identical — the stale single-namespace
    // update cannot reach across scopes to overwrite the active query page.
    expect(getScopedDomainState('pods', queryScope).data).toBe(queryDataBefore);
    expect(getScopedDomainState('pods', queryScope).data?.rows?.[0]).toBe(queryPod);
    // The targeted scope did receive the update.
    expect(getScopedDomainState('pods', localScope).data?.rows?.[0]?.cpuUsage).toBe('99m');
  });

  it('keeps the single-namespace pods scope untouched when a query-scope metrics update lands', () => {
    const queryScope = 'cluster-a|namespace:all?limit=50&sort=name';
    const localScope = 'cluster-a|namespace:default';
    const queryPod = {
      clusterId: 'cluster-a',
      namespace: 'team-a',
      name: 'pod-query',
      cpuUsage: '1m',
      memUsage: '1Mi',
    };
    const localPod = {
      clusterId: 'cluster-a',
      namespace: 'default',
      name: 'pod-local',
      cpuUsage: '1m',
      memUsage: '1Mi',
    };

    seedScope('pods', queryScope, {
      clusterId: 'cluster-a',
      rows: [queryPod],
      metrics: steadyMetrics,
    } as unknown as PodSnapshotPayload);
    seedScope('pods', localScope, {
      clusterId: 'cluster-a',
      rows: [localPod],
      metrics: steadyMetrics,
    } as unknown as PodSnapshotPayload);

    const localDataBefore = getScopedDomainState('pods', localScope).data;

    applyMetricsSnapshot({
      domain: 'pods',
      snapshot: {
        domain: 'pods',
        scope: queryScope,
        version: 2,
        checksum: 'etag-query',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [{ ...queryPod, cpuUsage: '88m', memUsage: '88Mi' }],
          metrics: { stale: false, successCount: 2, failureCount: 0 },
        } as unknown as PodSnapshotPayload,
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-query',
      isManual: false,
      scope: queryScope,
      clearRefreshError: vi.fn(),
    });

    expect(getScopedDomainState('pods', localScope).data).toBe(localDataBefore);
    expect(getScopedDomainState('pods', queryScope).data?.rows?.[0]?.cpuUsage).toBe('88m');
  });

  it('keeps the query-backed workloads scope untouched when a single-namespace metrics update lands', () => {
    const queryScope = 'cluster-a|namespace:all?limit=50&sort=name';
    const localScope = 'cluster-a|namespace:default';
    const queryWorkload = {
      clusterId: 'cluster-a',
      namespace: 'team-a',
      kind: 'Deployment',
      name: 'web-query',
      cpuUsage: '1m',
      memUsage: '1Mi',
    };
    const localWorkload = {
      clusterId: 'cluster-a',
      namespace: 'default',
      kind: 'Deployment',
      name: 'web-local',
      cpuUsage: '1m',
      memUsage: '1Mi',
    };

    seedScope('namespace-workloads', queryScope, {
      clusterId: 'cluster-a',
      rows: [queryWorkload],
      metrics: steadyMetrics,
    } as unknown as NamespaceWorkloadSnapshotPayload);
    seedScope('namespace-workloads', localScope, {
      clusterId: 'cluster-a',
      rows: [localWorkload],
      metrics: steadyMetrics,
    } as unknown as NamespaceWorkloadSnapshotPayload);

    const queryDataBefore = getScopedDomainState('namespace-workloads', queryScope).data;

    const applied = applyMetricsSnapshot({
      domain: 'namespace-workloads',
      snapshot: {
        domain: 'namespace-workloads',
        scope: localScope,
        version: 2,
        checksum: 'etag-local',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [{ ...localWorkload, cpuUsage: '77m', memUsage: '77Mi' }],
          metrics: { stale: false, successCount: 2, failureCount: 0 },
        } as unknown as NamespaceWorkloadSnapshotPayload,
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-local',
      isManual: false,
      scope: localScope,
      clearRefreshError: vi.fn(),
    });

    expect(applied).toBe(true);
    expect(getScopedDomainState('namespace-workloads', queryScope).data).toBe(queryDataBefore);
    expect(getScopedDomainState('namespace-workloads', queryScope).data?.rows?.[0]).toBe(
      queryWorkload
    );
  });

  it('keeps a query-backed nodes scope untouched when another nodes scope metrics update lands', () => {
    const queryScope = 'cluster-a|?limit=50&sort=name';
    const otherScope = 'cluster-a|';
    const queryNode = {
      clusterId: 'cluster-a',
      name: 'node-query',
      cpuUsage: '1m',
      memoryUsage: '1Mi',
    };
    const otherNode = {
      clusterId: 'cluster-a',
      name: 'node-other',
      cpuUsage: '1m',
      memoryUsage: '1Mi',
    };

    seedScope('nodes', queryScope, {
      clusterId: 'cluster-a',
      rows: [queryNode],
      metrics: steadyMetrics,
    } as unknown as ClusterNodeSnapshotPayload);
    seedScope('nodes', otherScope, {
      clusterId: 'cluster-a',
      rows: [otherNode],
      metrics: steadyMetrics,
    } as unknown as ClusterNodeSnapshotPayload);

    const queryDataBefore = getScopedDomainState('nodes', queryScope).data;

    const applied = applyMetricsSnapshot({
      domain: 'nodes',
      snapshot: {
        domain: 'nodes',
        scope: otherScope,
        version: 2,
        checksum: 'etag-other',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [{ ...otherNode, cpuUsage: '66m', memoryUsage: '66Mi' }],
          metrics: { stale: false, successCount: 2, failureCount: 0 },
        } as unknown as ClusterNodeSnapshotPayload,
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-other',
      isManual: false,
      scope: otherScope,
      clearRefreshError: vi.fn(),
    });

    expect(applied).toBe(true);
    expect(getScopedDomainState('nodes', queryScope).data).toBe(queryDataBefore);
    expect(getScopedDomainState('nodes', queryScope).data?.rows?.[0]).toBe(queryNode);
  });
});
