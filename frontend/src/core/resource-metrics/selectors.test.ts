import { describe, expect, it } from 'vitest';

import type {
  ClusterNodeSnapshotEntry,
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodSnapshotEntry,
  PodSnapshotPayload,
} from '@/core/refresh/types';
import { selectNodeMetrics, selectPodMetrics, selectWorkloadMetrics } from './selectors';

// Base payload rows arrive with live usage joined at serve; payload.metrics
// carries the poller freshness block for that joined usage.

const podRow = (overrides: Partial<PodSnapshotEntry>): PodSnapshotEntry => ({
  clusterId: 'cluster-a',
  name: 'api',
  namespace: 'team-a',
  node: 'node-a',
  status: 'Running',
  ready: '1/1',
  restarts: 0,
  age: '1m',
  ownerKind: 'Deployment',
  ownerName: 'api',
  cpuUsage: '120m',
  cpuRequest: '50m',
  cpuLimit: '500m',
  memUsage: '128Mi',
  memRequest: '64Mi',
  memLimit: '256Mi',
  ...overrides,
});

const nodeRow = (overrides: Partial<ClusterNodeSnapshotEntry>): ClusterNodeSnapshotEntry => ({
  clusterId: 'cluster-a',
  name: 'node-a',
  status: 'Ready',
  roles: 'worker',
  age: '1d',
  version: 'v1.31.0',
  cpuCapacity: '8',
  cpuAllocatable: '7600m',
  cpuRequests: '2',
  cpuLimits: '4',
  cpuUsage: '1200m',
  memoryCapacity: '32Gi',
  memoryAllocatable: '30Gi',
  memRequests: '6Gi',
  memLimits: '12Gi',
  memoryUsage: '5Gi',
  pods: '18',
  podsCapacity: '110',
  podsAllocatable: '100',
  restarts: 0,
  kind: 'Node',
  cpu: '1200m',
  memory: '5Gi',
  unschedulable: false,
  ...overrides,
});

describe('resource metric selectors', () => {
  it('selects a Pod row by full cluster/namespace/name identity', () => {
    const payload: PodSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [
        // Same namespace/name in another cluster must not be picked up.
        podRow({
          clusterId: 'cluster-b',
          node: 'node-b',
          cpuUsage: '999m',
          cpuRequest: '100m',
          cpuLimit: '1',
          memUsage: '999Mi',
          memRequest: '100Mi',
          memLimit: '1Gi',
        }),
        podRow({}),
      ],
      metrics: { stale: false, successCount: 2, failureCount: 0, collectedAt: 123 },
    };

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
    const emptyPayload: PodSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    };
    const noDataPayload: PodSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [
        podRow({
          cpuUsage: '',
          cpuRequest: '',
          cpuLimit: '',
          memUsage: '',
          memRequest: '',
          memLimit: '',
        }),
      ],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    };
    const ref = {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api',
    };

    expect(selectPodMetrics(emptyPayload, ref)).toBeNull();
    expect(selectPodMetrics(noDataPayload, ref)).toBeNull();
    expect(selectPodMetrics(null, ref)).toBeNull();
  });

  it('selects workload metrics and parses ready pod counts from namespace-workloads rows', () => {
    const payload: NamespaceWorkloadSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [
        // Same name/namespace under another kind must not be picked up.
        {
          clusterId: 'cluster-a',
          kind: 'StatefulSet',
          name: 'api',
          namespace: 'team-a',
          ready: '1/1',
          status: 'Available',
          restarts: 0,
          age: '2m',
          cpuUsage: '999m',
          memUsage: '999Mi',
        },
        {
          clusterId: 'cluster-a',
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
        },
      ],
      metrics: { stale: true, lastError: 'metrics unavailable', successCount: 1, failureCount: 1 },
    };

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
    const payload: NamespaceWorkloadSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    };

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
    const payload: ClusterNodeSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [
        // Same node name in another cluster must not be picked up.
        nodeRow({ clusterId: 'cluster-b', cpuUsage: '999m', memoryUsage: '999Gi' }),
        nodeRow({}),
      ],
      metrics: { stale: false, successCount: 4, failureCount: 0, collectedAt: 456 },
    };

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
    const payload: ClusterNodeSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [nodeRow({ name: 'node-b' })],
      metrics: { stale: true, successCount: 1, failureCount: 0 },
    };

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
