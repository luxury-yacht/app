import type {
  ClusterNodeSnapshotEntry,
  ClusterOverviewPayload,
  NamespaceWorkloadSummary,
  PodSnapshotEntry,
  WorkloadResourceUsage,
} from '@/core/refresh/types';
import type {
  ResourceMetricValues,
  ResourceMetricsData,
  ResourceMetricsFreshness,
  ResourceMetricsFreshnessInput,
  ResourceMetricsSource,
  ResourcePodsMetricValues,
} from './types';

export interface WorkloadMetricRow {
  kind?: string | null;
  name?: string | null;
  namespace?: string | null;
  clusterId?: string | null;
  ready?: string | null;
  cpuUsage?: string | number | null;
  cpuRequest?: string | number | null;
  cpuLimit?: string | number | null;
  memUsage?: string | number | null;
  memRequest?: string | number | null;
  memLimit?: string | number | null;
}

export type ResourceMetricField = 'usage' | 'request' | 'limit' | 'capacity' | 'allocatable';

const metricString = (value: string | number | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
};

const hasValues = (values: Array<string | number | null | undefined>): boolean =>
  values.some((value) => metricString(value) !== undefined);

const resourceValues = (
  usage?: string | number | null,
  request?: string | number | null,
  limit?: string | number | null,
  capacity?: string | number | null,
  allocatable?: string | number | null
): ResourceMetricValues | undefined => {
  if (!hasValues([usage, request, limit, capacity, allocatable])) {
    return undefined;
  }
  return {
    usage: metricString(usage),
    request: metricString(request),
    limit: metricString(limit),
    capacity: metricString(capacity),
    allocatable: metricString(allocatable),
  };
};

const metricFreshnessFromInfo = (
  metrics: ResourceMetricsFreshnessInput
): ResourceMetricsFreshness | undefined => {
  if (!metrics) {
    return undefined;
  }
  return {
    collectedAt: metrics.collectedAt,
    stale: Boolean(metrics.stale),
    lastError: metrics.lastError,
    consecutiveFailures: metrics.consecutiveFailures,
    successCount: metrics.successCount,
    failureCount: metrics.failureCount,
  };
};

const parseReadyPodCounts = (
  ready: string | null | undefined
): { readyPodCount: number; podCount: number } | undefined => {
  const match = (ready ?? '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    return undefined;
  }
  return {
    readyPodCount: Number(match[1]),
    podCount: Number(match[2]),
  };
};

export const hasResourceMetricData = (data: ResourceMetricsData): boolean =>
  Boolean(data.cpu || data.memory || data.pods);

export const podRowResourceMetrics = (
  row: PodSnapshotEntry,
  freshness?: ResourceMetricsFreshnessInput
): ResourceMetricsData => ({
  source: 'pods',
  cpu: resourceValues(row.cpuUsage, row.cpuRequest, row.cpuLimit),
  memory: resourceValues(row.memUsage, row.memRequest, row.memLimit),
  freshness: metricFreshnessFromInfo(freshness),
});

export const podRowCpuValue = (
  row: PodSnapshotEntry,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit'>
): string | undefined => {
  switch (field) {
    case 'usage':
      return metricString(row.cpuUsage);
    case 'request':
      return metricString(row.cpuRequest);
    case 'limit':
      return metricString(row.cpuLimit);
  }
};

export const podRowMemoryValue = (
  row: PodSnapshotEntry,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit'>
): string | undefined => {
  switch (field) {
    case 'usage':
      return metricString(row.memUsage);
    case 'request':
      return metricString(row.memRequest);
    case 'limit':
      return metricString(row.memLimit);
  }
};

export const workloadRowResourceMetrics = (
  row: NamespaceWorkloadSummary | WorkloadMetricRow,
  freshness?: ResourceMetricsFreshnessInput
): ResourceMetricsData => {
  const podCounts = parseReadyPodCounts(row.ready);
  return {
    source: 'namespace-workloads',
    cpu: resourceValues(row.cpuUsage, row.cpuRequest, row.cpuLimit),
    memory: resourceValues(row.memUsage, row.memRequest, row.memLimit),
    podCount: podCounts?.podCount,
    readyPodCount: podCounts?.readyPodCount,
    freshness: metricFreshnessFromInfo(freshness),
  };
};

export const workloadRowCpuValue = (
  row: NamespaceWorkloadSummary | WorkloadMetricRow,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit'>
): string | undefined => {
  switch (field) {
    case 'usage':
      return metricString(row.cpuUsage);
    case 'request':
      return metricString(row.cpuRequest);
    case 'limit':
      return metricString(row.cpuLimit);
  }
};

export const workloadRowMemoryValue = (
  row: NamespaceWorkloadSummary | WorkloadMetricRow,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit'>
): string | undefined => {
  switch (field) {
    case 'usage':
      return metricString(row.memUsage);
    case 'request':
      return metricString(row.memRequest);
    case 'limit':
      return metricString(row.memLimit);
  }
};

export const nodeRowResourceMetrics = (
  row: ClusterNodeSnapshotEntry,
  freshness?: ResourceMetricsFreshnessInput
): ResourceMetricsData => {
  const pods: ResourcePodsMetricValues | undefined = hasValues([
    row.pods,
    row.podsCapacity,
    row.podsAllocatable,
  ])
    ? {
        count: metricString(row.pods),
        capacity: metricString(row.podsCapacity),
        allocatable: metricString(row.podsAllocatable),
      }
    : undefined;

  return {
    source: 'nodes',
    mode: 'nodeMetrics',
    cpu: resourceValues(
      row.cpuUsage,
      row.cpuRequests,
      row.cpuLimits,
      row.cpuCapacity,
      row.cpuAllocatable
    ),
    memory: resourceValues(
      row.memoryUsage,
      row.memRequests,
      row.memLimits,
      row.memoryCapacity,
      row.memoryAllocatable
    ),
    pods,
    freshness: metricFreshnessFromInfo(freshness),
  };
};

export const nodeRowCpuValue = (
  row: ClusterNodeSnapshotEntry,
  field: ResourceMetricField
): string | undefined => {
  switch (field) {
    case 'usage':
      return metricString(row.cpuUsage);
    case 'request':
      return metricString(row.cpuRequests);
    case 'limit':
      return metricString(row.cpuLimits);
    case 'capacity':
      return metricString(row.cpuCapacity);
    case 'allocatable':
      return metricString(row.cpuAllocatable);
  }
};

export const nodeRowMemoryValue = (
  row: ClusterNodeSnapshotEntry,
  field: ResourceMetricField
): string | undefined => {
  switch (field) {
    case 'usage':
      return metricString(row.memoryUsage);
    case 'request':
      return metricString(row.memRequests);
    case 'limit':
      return metricString(row.memLimits);
    case 'capacity':
      return metricString(row.memoryCapacity);
    case 'allocatable':
      return metricString(row.memoryAllocatable);
  }
};

export const clusterOverviewResourceMetrics = (
  overview: ClusterOverviewPayload,
  freshness?: ResourceMetricsFreshnessInput
): ResourceMetricsData => ({
  source: 'cluster-overview',
  cpu: resourceValues(
    overview.cpuUsage,
    overview.cpuRequests,
    overview.cpuLimits,
    undefined,
    overview.cpuAllocatable
  ),
  memory: resourceValues(
    overview.memoryUsage,
    overview.memoryRequests,
    overview.memoryLimits,
    undefined,
    overview.memoryAllocatable
  ),
  freshness: metricFreshnessFromInfo(freshness),
});

export const clusterOverviewCpuValue = (
  overview: ClusterOverviewPayload,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit' | 'allocatable'>
): string | undefined => {
  switch (field) {
    case 'usage':
      return metricString(overview.cpuUsage);
    case 'request':
      return metricString(overview.cpuRequests);
    case 'limit':
      return metricString(overview.cpuLimits);
    case 'allocatable':
      return metricString(overview.cpuAllocatable);
  }
};

export const clusterOverviewMemoryValue = (
  overview: ClusterOverviewPayload,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit' | 'allocatable'>
): string | undefined => {
  switch (field) {
    case 'usage':
      return metricString(overview.memoryUsage);
    case 'request':
      return metricString(overview.memoryRequests);
    case 'limit':
      return metricString(overview.memoryLimits);
    case 'allocatable':
      return metricString(overview.memoryAllocatable);
  }
};

export type ClusterWorkloadUsageKey = keyof WorkloadResourceUsage;

export const clusterWorkloadUsageValue = (
  usage: WorkloadResourceUsage,
  key: ClusterWorkloadUsageKey,
  type: 'cpu' | 'memory'
): string | undefined => {
  const item = usage[key];
  return type === 'cpu' ? metricString(item?.cpuUsage) : metricString(item?.memoryUsage);
};

export const resourceMetricsSourceFromKind = (
  kind: string | null | undefined
): ResourceMetricsSource | null => {
  switch ((kind ?? '').trim().toLowerCase()) {
    case 'pod':
      return 'pods';
    case 'deployment':
    case 'daemonset':
    case 'statefulset':
      return 'namespace-workloads';
    case 'replicaset':
      return 'detail-replicaset';
    case 'node':
      return 'nodes';
    default:
      return null;
  }
};
