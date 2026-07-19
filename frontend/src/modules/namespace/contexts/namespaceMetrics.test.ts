import { describe, expect, it } from 'vitest';
import type { NamespaceMetric, NamespaceSummary } from '@/core/refresh/types';
import { joinNamespaceMetrics } from './namespaceMetrics';

const ref = (clusterId: string, name: string) => ({
  clusterId,
  group: '',
  version: 'v1',
  kind: 'Namespace',
  resource: 'namespaces',
  name,
});

describe('joinNamespaceMetrics', () => {
  it('joins utilization only when the complete namespace identity matches', () => {
    const namespaces = [
      {
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        ref: ref('cluster-a', 'payments'),
        name: 'payments',
        phase: 'Active',
        resourceVersion: '1',
        creationTimestamp: 1,
        hasWorkloads: true,
        warningEventsState: 'available',
        quotaPressureState: 'available',
      },
    ] satisfies NamespaceSummary[];
    const metrics = [
      { ref: ref('cluster-a', 'payments'), cpuUsageMilli: 125, memoryUsageBytes: 64 },
      { ref: ref('cluster-b', 'payments'), cpuUsageMilli: 999, memoryUsageBytes: 999 },
    ] satisfies NamespaceMetric[];

    expect(joinNamespaceMetrics(namespaces, metrics)).toEqual([
      expect.objectContaining({
        clusterId: 'cluster-a',
        name: 'payments',
        cpuUsageMilli: 125,
        memoryUsageBytes: 64,
      }),
    ]);
  });
});
