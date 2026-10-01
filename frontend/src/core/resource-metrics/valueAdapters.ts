import { formatCpuValue, formatMemoryValue } from '@shared/utils/resourceCalculations';
import type {
  ClusterNodeSnapshotEntry,
  ClusterOverviewPayload,
  NamespaceWorkloadSummary,
  PodSnapshotEntry,
  WorkloadResourceUsage,
} from '@/core/refresh/types';
import type {
  ResourceMetricsData,
  ResourceMetricsFreshness,
  ResourceMetricsFreshnessInput,
  ResourceMetricValues,
  ResourcePodsMetricValues,
} from './types';

export const namespaceAggregateUsageDisplay = (
  cpuUsageMilli: number,
  memoryUsageBytes: number
): { cpu: string; memory: string } => ({
  cpu: formatCpuValue(cpuUsageMilli),
  memory: formatMemoryValue(memoryUsageBytes),
});

/** CPU fields are millicores and memory fields are bytes. */
export interface WorkloadMetricRow {
  kind?: string | null;
  name?: string | null;
  namespace?: string | null;
  clusterId?: string | null;
  ready?: string | null;
  cpuUsageMilli?: number | null;
  cpuRequestMilli?: number | null;
  cpuLimitMilli?: number | null;
  memoryUsageBytes?: number | null;
  memoryRequestBytes?: number | null;
  memoryLimitBytes?: number | null;
}

export type ResourceMetricField = 'usage' | 'request' | 'limit' | 'capacity' | 'allocatable';

const metricString = (value: string | number | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
};

const metricAmount = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const resourceValues = (
  usage?: number | null,
  request?: number | null,
  limit?: number | null,
  capacity?: number | null,
  allocatable?: number | null
): ResourceMetricValues => ({
  usage: metricAmount(usage),
  request: metricAmount(request),
  limit: metricAmount(limit),
  capacity: metricAmount(capacity),
  allocatable: metricAmount(allocatable),
});

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
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec((ready ?? '').trim());
  if (!match) {
    return undefined;
  }
  return {
    readyPodCount: Number(match[1]),
    podCount: Number(match[2]),
  };
};

export const podRowResourceMetrics = (
  row: PodSnapshotEntry,
  freshness?: ResourceMetricsFreshnessInput
): ResourceMetricsData => ({
  source: 'pods',
  cpu: resourceValues(row.cpuUsageMilli, row.cpuRequestMilli, row.cpuLimitMilli),
  memory: resourceValues(row.memoryUsageBytes, row.memoryRequestBytes, row.memoryLimitBytes),
  freshness: metricFreshnessFromInfo(freshness),
});

export const workloadRowResourceMetrics = (
  row: NamespaceWorkloadSummary | WorkloadMetricRow,
  freshness?: ResourceMetricsFreshnessInput
): ResourceMetricsData => {
  const podCounts = parseReadyPodCounts(row.ready);
  return {
    source: 'namespace-workloads',
    cpu: resourceValues(row.cpuUsageMilli, row.cpuRequestMilli, row.cpuLimitMilli),
    memory: resourceValues(row.memoryUsageBytes, row.memoryRequestBytes, row.memoryLimitBytes),
    podCount: podCounts?.podCount,
    readyPodCount: podCounts?.readyPodCount,
    freshness: metricFreshnessFromInfo(freshness),
  };
};

export const workloadRowCpuValue = (
  row: NamespaceWorkloadSummary | WorkloadMetricRow,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit'>
): number | undefined => {
  switch (field) {
    case 'usage':
      return metricAmount(row.cpuUsageMilli);
    case 'request':
      return metricAmount(row.cpuRequestMilli);
    case 'limit':
      return metricAmount(row.cpuLimitMilli);
  }
};

export const workloadRowMemoryValue = (
  row: NamespaceWorkloadSummary | WorkloadMetricRow,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit'>
): number | undefined => {
  switch (field) {
    case 'usage':
      return metricAmount(row.memoryUsageBytes);
    case 'request':
      return metricAmount(row.memoryRequestBytes);
    case 'limit':
      return metricAmount(row.memoryLimitBytes);
  }
};

export const nodeRowResourceMetrics = (
  row: ClusterNodeSnapshotEntry,
  freshness?: ResourceMetricsFreshnessInput
): ResourceMetricsData => {
  const podValues = [row.pods, row.podsCapacity, row.podsAllocatable];
  const pods: ResourcePodsMetricValues | undefined = podValues.some(
    (value) => metricString(value) !== undefined
  )
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
      row.cpuUsageMilli,
      row.cpuRequestsMilli,
      row.cpuLimitsMilli,
      row.cpuCapacityMilli,
      row.cpuAllocatableMilli
    ),
    memory: resourceValues(
      row.memoryUsageBytes,
      row.memoryRequestsBytes,
      row.memoryLimitsBytes,
      row.memoryCapacityBytes,
      row.memoryAllocatableBytes
    ),
    pods,
    freshness: metricFreshnessFromInfo(freshness),
  };
};

export const nodeRowCpuValue = (
  row: ClusterNodeSnapshotEntry,
  field: ResourceMetricField
): number | undefined => {
  switch (field) {
    case 'usage':
      return metricAmount(row.cpuUsageMilli);
    case 'request':
      return metricAmount(row.cpuRequestsMilli);
    case 'limit':
      return metricAmount(row.cpuLimitsMilli);
    case 'capacity':
      return metricAmount(row.cpuCapacityMilli);
    case 'allocatable':
      return metricAmount(row.cpuAllocatableMilli);
  }
};

export const nodeRowMemoryValue = (
  row: ClusterNodeSnapshotEntry,
  field: ResourceMetricField
): number | undefined => {
  switch (field) {
    case 'usage':
      return metricAmount(row.memoryUsageBytes);
    case 'request':
      return metricAmount(row.memoryRequestsBytes);
    case 'limit':
      return metricAmount(row.memoryLimitsBytes);
    case 'capacity':
      return metricAmount(row.memoryCapacityBytes);
    case 'allocatable':
      return metricAmount(row.memoryAllocatableBytes);
  }
};

export const clusterOverviewResourceMetrics = (
  overview: ClusterOverviewPayload,
  freshness?: ResourceMetricsFreshnessInput
): ResourceMetricsData => ({
  source: 'cluster-overview',
  cpu: resourceValues(
    overview.cpuUsageMilli,
    overview.cpuRequestsMilli,
    overview.cpuLimitsMilli,
    undefined,
    overview.cpuAllocatableMilli
  ),
  memory: resourceValues(
    overview.memoryUsageBytes,
    overview.memoryRequestsBytes,
    overview.memoryLimitsBytes,
    undefined,
    overview.memoryAllocatableBytes
  ),
  freshness: metricFreshnessFromInfo(freshness),
});

export const clusterOverviewCpuValue = (
  overview: ClusterOverviewPayload,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit' | 'allocatable'>
): number | undefined => {
  switch (field) {
    case 'usage':
      return metricAmount(overview.cpuUsageMilli);
    case 'request':
      return metricAmount(overview.cpuRequestsMilli);
    case 'limit':
      return metricAmount(overview.cpuLimitsMilli);
    case 'allocatable':
      return metricAmount(overview.cpuAllocatableMilli);
  }
};

export const clusterOverviewMemoryValue = (
  overview: ClusterOverviewPayload,
  field: Extract<ResourceMetricField, 'usage' | 'request' | 'limit' | 'allocatable'>
): number | undefined => {
  switch (field) {
    case 'usage':
      return metricAmount(overview.memoryUsageBytes);
    case 'request':
      return metricAmount(overview.memoryRequestsBytes);
    case 'limit':
      return metricAmount(overview.memoryLimitsBytes);
    case 'allocatable':
      return metricAmount(overview.memoryAllocatableBytes);
  }
};

export type ClusterWorkloadUsageKey = keyof WorkloadResourceUsage;

export const clusterWorkloadUsageValue = (
  usage: WorkloadResourceUsage,
  key: ClusterWorkloadUsageKey,
  type: 'cpu' | 'memory'
): number | undefined => {
  const item = usage[key];
  return type === 'cpu' ? metricAmount(item?.cpuUsageMilli) : metricAmount(item?.memoryUsageBytes);
};
