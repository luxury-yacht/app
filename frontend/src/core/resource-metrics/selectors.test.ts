import { describe, expect, it } from 'vitest';

import type {
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodSnapshotPayload,
} from '@/core/refresh/types';
import { selectNodeMetrics, selectPodMetrics, selectWorkloadMetrics } from './selectors';

const baseEnvelope = {
  limit: 1000,
  offset: 0,
  total: 0,
  filteredTotal: 0,
  query: '',
  sort: 'name',
  sortDirection: 'asc' as const,
};

describe('resource metric selectors', () => {
  it('selects a Pod row by full cluster/namespace/name identity', () => {
    const payload: PodSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [
        {
          clusterId: 'cluster-b',
          name: 'api',
          namespace: 'team-a',
          node: 'node-b',
          status: 'Running',
          ready: '1/1',
          restarts: 0,
          age: '1m',
          ownerKind: 'Deployment',
          ownerName: 'api',
          cpuUsage: '900m',
          cpuRequest: '100m',
          cpuLimit: '1',
          memUsage: '900Mi',
          memRequest: '100Mi',
          memLimit: '1Gi',
        },
        {
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
        },
      ],
      metrics: { stale: false, successCount: 2, failureCount: 0, collectedAt: 123 },
      ...baseEnvelope,
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

  it('selects workload metrics and parses ready pod counts from namespace-workloads rows', () => {
    const payload: NamespaceWorkloadSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [
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
      ...baseEnvelope,
    };

    expect(
      selectWorkloadMetrics(
        payload,
        {
          clusterId: 'cluster-a',
          group: 'apps',
          version: 'v1',
          kind: 'Deployment',
          namespace: 'team-a',
          name: 'api',
        },
        { stale: true, lastError: 'metrics unavailable', successCount: 1, failureCount: 1 }
      )
    ).toMatchObject({
      source: 'namespace-workloads',
      cpu: { usage: '300m', request: '150m', limit: '750m' },
      memory: { usage: '384Mi', request: '192Mi', limit: '768Mi' },
      podCount: 5,
      readyPodCount: 3,
      freshness: { stale: true, lastError: 'metrics unavailable' },
    });
  });

  it('selects Node metrics by cluster/name identity', () => {
    const payload: ClusterNodeSnapshotPayload = {
      clusterId: 'cluster-a',
      rows: [
        {
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
        },
      ],
      metrics: { stale: false, successCount: 4, failureCount: 0, collectedAt: 456 },
      ...baseEnvelope,
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
});
