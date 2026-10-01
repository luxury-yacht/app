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

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

// Base payload rows arrive with live usage joined at serve; payload.metrics
// carries the poller freshness block for that joined usage.

describe('resource metric selectors', () => {
  it.each([
    ['group', 'example.io'],
    ['version', 'v2'],
    ['kind', 'OtherKind'],
    ['namespace', 'other-namespace'],
  ])('does not join metrics across different %s identity', (field, value) => {
    const pod = makePodSnapshotEntry();
    const workload = makeNamespaceWorkloadSummary();
    const node = makeClusterNodeSnapshotEntry();
    expect(
      selectPodMetrics(makePodSnapshotPayload({ rows: [pod] }), { ...pod.ref, [field]: value })
    ).toBeNull();
    expect(
      selectWorkloadMetrics(makeNamespaceWorkloadSnapshotPayload({ rows: [workload] }), {
        ...workload.ref,
        [field]: value,
      })
    ).toBeNull();
    expect(
      selectNodeMetrics(makeClusterNodeSnapshotPayload({ rows: [node] }), {
        ...node.ref,
        [field]: value,
      })
    ).toBeNull();
  });

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
          cpuUsageMilli: 999,
          cpuRequestMilli: 100,
          cpuLimitMilli: 1000,
          memoryUsageBytes: 999 * MIB,
          memoryRequestBytes: 100 * MIB,
          memoryLimitBytes: GIB,
        }),
        makePodSnapshotEntry({
          name: 'api',
          namespace: 'team-a',
          ownerName: 'api',
          cpuUsageMilli: 120,
          cpuRequestMilli: 50,
          cpuLimitMilli: 500,
          memoryUsageBytes: 128 * MIB,
          memoryRequestBytes: 64 * MIB,
          memoryLimitBytes: 256 * MIB,
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
      cpu: { usage: 120, request: 50, limit: 500 },
      memory: { usage: 128 * MIB, request: 64 * MIB, limit: 256 * MIB },
      freshness: { stale: false, collectedAt: 123 },
    });
  });

  it('returns null only when the referenced Pod row is absent', () => {
    const nullRowsPayload: PodSnapshotPayload = makePodSnapshotPayload({ rows: null });
    const emptyPayload: PodSnapshotPayload = makePodSnapshotPayload({
      rows: [],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    });
    // A served row without a usage sample is still the live source: its usage is
    // unknown, but its requests and limits are current.
    const unsampledPayload: PodSnapshotPayload = makePodSnapshotPayload({
      rows: [
        makePodSnapshotEntry({
          name: 'api',
          namespace: 'team-a',
          cpuUsageMilli: undefined,
          memoryUsageBytes: undefined,
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
    expect(selectPodMetrics(null, ref)).toBeNull();
    const unsampled = selectPodMetrics(unsampledPayload, ref);
    expect(unsampled?.cpu?.usage).toBeUndefined();
    expect(unsampled?.memory?.usage).toBeUndefined();
    expect(unsampled?.cpu?.request).toBe(10);
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
          cpuUsageMilli: 999,
          memoryUsageBytes: 999 * MIB,
        }),
        makeNamespaceWorkloadSummary({
          kind: 'Deployment',
          name: 'api',
          namespace: 'team-a',
          ready: '3/5',
          status: 'Available',
          restarts: 0,
          age: '2m',
          cpuUsageMilli: 300,
          cpuRequestMilli: 150,
          cpuLimitMilli: 750,
          memoryUsageBytes: 384 * MIB,
          memoryRequestBytes: 192 * MIB,
          memoryLimitBytes: 768 * MIB,
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
      cpu: { usage: 300, request: 150, limit: 750 },
      memory: { usage: 384 * MIB, request: 192 * MIB, limit: 768 * MIB },
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
          cpuUsageMilli: 999,
          memoryUsageBytes: 999 * GIB,
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
        usage: 1200,
        capacity: 8000,
        allocatable: 7600,
        request: 2000,
        limit: 4000,
      },
      memory: {
        usage: 5 * GIB,
        capacity: 32 * GIB,
        allocatable: 30 * GIB,
        request: 6 * GIB,
        limit: 12 * GIB,
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
