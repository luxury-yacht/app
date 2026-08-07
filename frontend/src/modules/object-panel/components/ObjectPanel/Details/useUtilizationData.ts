/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts
 *
 * Derives the Utilization section's CPU/memory/pods data from live metric domains,
 * falling back to the active detail DTO while those domains load.
 */

import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { useMemo } from 'react';
import { useResourceMetrics } from '@/core/resource-metrics';
import type { UtilizationData } from './detailsTabTypes';

const UTILIZATION_KINDS = new Set([
  'pod',
  'deployment',
  'daemonset',
  'statefulset',
  'replicaset',
  'node',
]);

const WORKLOAD_UTILIZATION_KINDS = new Set([
  'deployment',
  'daemonset',
  'statefulset',
  'replicaset',
]);

// Structural view of the utilization-bearing fields across the relevant detail DTOs.
interface UtilizationDetail {
  cpuUsage?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memUsage?: string;
  memRequest?: string;
  memLimit?: string;
  cpuCapacity?: string;
  cpuAllocatable?: string;
  cpuRequests?: string;
  cpuLimits?: string;
  memoryUsage?: string;
  memoryCapacity?: string;
  memoryAllocatable?: string;
  memRequests?: string;
  memLimits?: string;
  podsCount?: number;
  podsCapacity?: string;
  podsAllocatable?: string;
  isActive?: boolean;
  pods?: unknown[];
  podMetricsSummary?: {
    cpuUsage?: string;
    cpuRequest?: string;
    cpuLimit?: string;
    memUsage?: string;
    memRequest?: string;
    memLimit?: string;
    pods?: number;
    readyPods?: number;
  };
}

interface UseUtilizationDataParams {
  objectData: ObjectPanelRef | null | undefined;
  detail: unknown;
}

type StandardMetricSource = Pick<
  UtilizationDetail,
  'cpuUsage' | 'cpuRequest' | 'cpuLimit' | 'memUsage' | 'memRequest' | 'memLimit'
>;

const hasMetricValue = (values: Array<string | undefined>): boolean => values.some(Boolean);

const metricOrPlaceholder = (value: string | undefined): string => value || '-';

const standardMetricSections = (
  source: StandardMetricSource
): Pick<UtilizationData, 'cpu' | 'memory'> | null => {
  const hasCpuData = Boolean(source.cpuUsage || source.cpuRequest || source.cpuLimit);
  const hasMemoryData = Boolean(source.memUsage || source.memRequest || source.memLimit);
  if (!hasCpuData && !hasMemoryData) {
    return null;
  }
  return {
    cpu: hasCpuData
      ? {
          usage: source.cpuUsage || '-',
          request: source.cpuRequest || '-',
          limit: source.cpuLimit || '-',
        }
      : undefined,
    memory: hasMemoryData
      ? {
          usage: source.memUsage || '-',
          request: source.memRequest || '-',
          limit: source.memLimit || '-',
        }
      : undefined,
  };
};

const deriveNodeUtilization = (detail: UtilizationDetail): UtilizationData | null => {
  const hasCpuData = hasMetricValue([
    detail.cpuCapacity,
    detail.cpuAllocatable,
    detail.cpuRequests,
    detail.cpuLimits,
    detail.cpuUsage,
  ]);
  const hasMemoryData = hasMetricValue([
    detail.memoryCapacity,
    detail.memoryAllocatable,
    detail.memRequests,
    detail.memLimits,
    detail.memoryUsage,
  ]);
  if (!hasCpuData && !hasMemoryData) {
    return null;
  }
  return {
    cpu: hasCpuData
      ? {
          usage: metricOrPlaceholder(detail.cpuUsage),
          capacity: metricOrPlaceholder(detail.cpuCapacity),
          allocatable: metricOrPlaceholder(detail.cpuAllocatable),
          request: metricOrPlaceholder(detail.cpuRequests),
          limit: metricOrPlaceholder(detail.cpuLimits),
        }
      : undefined,
    memory: hasMemoryData
      ? {
          usage: metricOrPlaceholder(detail.memoryUsage),
          capacity: metricOrPlaceholder(detail.memoryCapacity),
          allocatable: metricOrPlaceholder(detail.memoryAllocatable),
          request: metricOrPlaceholder(detail.memRequests),
          limit: metricOrPlaceholder(detail.memLimits),
        }
      : undefined,
    pods: {
      count: String(detail.podsCount || 0),
      capacity: metricOrPlaceholder(detail.podsCapacity),
      allocatable: metricOrPlaceholder(detail.podsAllocatable),
    },
    mode: 'nodeMetrics',
  };
};

const workloadMetricSource = (detail: UtilizationDetail): StandardMetricSource => {
  const summary = detail.podMetricsSummary;
  const hasSummary = hasMetricValue([
    summary?.cpuUsage,
    summary?.memUsage,
    summary?.cpuRequest,
    summary?.memRequest,
  ]);
  return hasSummary && summary ? summary : detail;
};

const deriveWorkloadUtilization = (
  detail: UtilizationDetail,
  objectKind: string
): UtilizationData | null => {
  if (objectKind === 'replicaset' && detail.isActive === false) {
    return null;
  }
  const metrics = standardMetricSections(workloadMetricSource(detail));
  if (!metrics) {
    return null;
  }
  return {
    ...metrics,
    podCount: detail.podMetricsSummary?.pods ?? detail.pods?.length ?? 0,
    readyPodCount: detail.podMetricsSummary?.readyPods,
  };
};

function deriveDetailUtilizationData(
  objectData: ObjectPanelRef | null | undefined,
  detail: unknown
): UtilizationData | null {
  if (!objectData) {
    return null;
  }
  const objectKind = objectData.kind.toLowerCase();
  const d = (detail ?? undefined) as UtilizationDetail | undefined;

  // Node utilization
  if (d && objectKind === 'node') {
    return deriveNodeUtilization(d);
  }

  if (!UTILIZATION_KINDS.has(objectKind)) {
    return null;
  }

  // Pod utilization
  if (d && objectKind === 'pod') {
    return standardMetricSections(d);
  }

  // Workload utilization (deployment/daemonset/statefulset/replicaset): aggregated totals from
  // podMetricsSummary when available, falling back to averages on the detail itself.
  if (d && WORKLOAD_UTILIZATION_KINDS.has(objectKind)) {
    return deriveWorkloadUtilization(d, objectKind);
  }

  // Fallback to objectData fields (dynamic properties on the object reference).
  return standardMetricSections(objectData as unknown as UtilizationDetail);
}

export function useUtilizationData(params: UseUtilizationDataParams): UtilizationData | null {
  const { objectData, detail } = params;
  const objectKind = objectData?.kind?.toLowerCase();
  const liveMetrics = useResourceMetrics(objectData);
  const detailMetrics = useMemo(
    () => deriveDetailUtilizationData(objectData, detail),
    [objectData, detail]
  );

  return useMemo(() => {
    if (objectKind !== 'replicaset' && liveMetrics.metrics) {
      return liveMetrics.metrics;
    }
    return detailMetrics;
  }, [detailMetrics, liveMetrics.metrics, objectKind]);
}

export function useHasUtilization(objectData: ObjectPanelRef | null | undefined): boolean {
  return useMemo(() => {
    const kind = objectData?.kind?.toLowerCase();
    return kind ? UTILIZATION_KINDS.has(kind) : false;
  }, [objectData]);
}
