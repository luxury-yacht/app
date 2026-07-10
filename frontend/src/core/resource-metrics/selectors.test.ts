import { describe, expect, it } from 'vitest';
import {
  makeClusterNodeSnapshotEntry,
  makeClusterNodeSnapshotPayload,
  makeNamespaceWorkloadSnapshotPayload,
  makeNamespaceWorkloadSummary,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import type {
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodSnapshotPayload,
} from '@/core/refresh/types';
import { selectNodeMetrics, selectPodMetrics, selectWorkloadMetrics } from './selectors';

// Base payload rows arrive with live usage joined at serve; payload.metrics
// carries the poller freshness block for that joined usage.

describe('resource metric selectors', () => {
  it('selects a Pod row by full cluster/namespace/name identity', () => {
    const payload: PodSnapshotPayload = makePodSnapshotPayload({
      rows: [
        // Same namespace/name in another cluster must not be picked up.
        makePodSnapshotEntry({
          name: 'api',
          namespace: 'team-a',
          ownerName: 'api',
          clusterId: 'cluster-b',
          node: 'node-b',
          cpuUsage: '999m',
          cpuRequest: '100m',
          cpuLimit: '1',
          memUsage: '999Mi',
          memRequest: '100Mi',
          memLimit: '1Gi',
        }),
        makePodSnapshotEntry({
          name: 'api',
          namespace: 'team-a',
          ownerName: 'api',
          cpuUsage: '120m',
          cpuRequest: '50m',
          cpuLimit: '500m',
          memUsage: '128Mi',
          memRequest: '64Mi',
          memLimit: '256Mi',
        }),
      ],
      metrics: { stale: false, successCount: 2, failureCount: 0, collectedAt: 123 },
    });

    expect(
      selectPodMetrics(payload, {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'team-a',
        name: 'api',
      })
    ).toMatchObject({
      source: 'pods',
      cpu: { usage: '120m', request: '50m', limit: '500m' },
      memory: { usage: '128Mi', request: '64Mi', limit: '256Mi' },
      freshness: { stale: false, collectedAt: 123 },
    });
  });

  it('returns null when the referenced Pod row is absent or carries no metric data', () => {
    const nullRowsPayload: PodSnapshotPayload = makePodSnapshotPayload({ rows: null });
    const emptyPayload: PodSnapshotPayload = makePodSnapshotPayload({
      rows: [],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    });
    const noDataPayload: PodSnapshotPayload = makePodSnapshotPayload({
      rows: [
        makePodSnapshotEntry({
          name: 'api',
          namespace: 'team-a',
          cpuUsage: '',
          cpuRequest: '',
          cpuLimit: '',
          memUsage: '',
          memRequest: '',
          memLimit: '',
        }),
      ],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    });
    const ref = {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api',
    };

    expect(selectPodMetrics(nullRowsPayload, ref)).toBeNull();
    expect(selectPodMetrics(emptyPayload, ref)).toBeNull();
    expect(selectPodMetrics(noDataPayload, ref)).toBeNull();
    expect(selectPodMetrics(null, ref)).toBeNull();
  });

  it('selects workload metrics and parses ready pod counts from namespace-workloads rows', () => {
    const payload: NamespaceWorkloadSnapshotPayload = makeNamespaceWorkloadSnapshotPayload({
      rows: [
        // Same name/namespace under another kind must not be picked up.
        makeNamespaceWorkloadSummary({
          kind: 'StatefulSet',
          name: 'api',
          namespace: 'team-a',
          ready: '1/1',
          status: 'Available',
          restarts: 0,
          age: '2m',
          cpuUsage: '999m',
          memUsage: '999Mi',
        }),
        makeNamespaceWorkloadSummary({
          kind: 'Deployment',
          name: 'api',
          namespace: 'team-a',
          ready: '3/5',
          status: 'Available',
          restarts: 0,
          age: '2m',
          cpuUsage: '300m',
          cpuRequest: '150m',
          cpuLimit: '750m',
          memUsage: '384Mi',
          memRequest: '192Mi',
          memLimit: '768Mi',
        }),
      ],
      metrics: { stale: true, lastError: 'metrics unavailable', successCount: 1, failureCount: 1 },
    });

    expect(
      selectWorkloadMetrics(payload, {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'team-a',
        name: 'api',
      })
    ).toMatchObject({
      source: 'namespace-workloads',
      cpu: { usage: '300m', request: '150m', limit: '750m' },
      memory: { usage: '384Mi', request: '192Mi', limit: '768Mi' },
      podCount: 5,
      readyPodCount: 3,
      freshness: { stale: true, lastError: 'metrics unavailable' },
    });
  });

  it('returns null when the referenced workload row is absent', () => {
    const payload: NamespaceWorkloadSnapshotPayload = makeNamespaceWorkloadSnapshotPayload({
      rows: [],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    });

    expect(
      selectWorkloadMetrics(payload, {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'team-a',
        name: 'api',
      })
    ).toBeNull();
  });

  it('selects Node metrics by cluster/name identity', () => {
    const payload: ClusterNodeSnapshotPayload = makeClusterNodeSnapshotPayload({
      rows: [
        // Same node name in another cluster must not be picked up.
        makeClusterNodeSnapshotEntry({
          clusterId: 'cluster-b',
          cpuUsage: '999m',
          memoryUsage: '999Gi',
        }),
        makeClusterNodeSnapshotEntry(),
      ],
      metrics: { stale: false, successCount: 4, failureCount: 0, collectedAt: 456 },
    });

    expect(
      selectNodeMetrics(payload, {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Node',
        name: 'node-a',
      })
    ).toMatchObject({
      source: 'nodes',
      mode: 'nodeMetrics',
      cpu: {
        usage: '1200m',
        capacity: '8',
        allocatable: '7600m',
        request: '2',
        limit: '4',
      },
      memory: {
        usage: '5Gi',
        capacity: '32Gi',
        allocatable: '30Gi',
        request: '6Gi',
        limit: '12Gi',
      },
      pods: { count: '18', capacity: '110', allocatable: '100' },
      freshness: { stale: false, collectedAt: 456 },
    });
  });

  it('returns null when the referenced Node row is absent', () => {
    const payload: ClusterNodeSnapshotPayload = makeClusterNodeSnapshotPayload({
      rows: [makeClusterNodeSnapshotEntry({ name: 'node-b' })],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    });

    expect(
      selectNodeMetrics(payload, {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Node',
        name: 'node-a',
      })
    ).toBeNull();
  });
});
