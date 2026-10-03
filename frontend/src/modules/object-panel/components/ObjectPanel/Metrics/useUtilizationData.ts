/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/useUtilizationData.ts
 *
 * Derives the Metrics tab's utilization bars from live metric domains (kept fresh by the panel's
 * metrics collector), falling back to the active detail DTO while those domains load.
 */

import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { parseResourceQuantity } from '@shared/utils/resourceCalculations';
import { useMemo } from 'react';
import { type ResourceMetricValues, useResourceMetrics } from '@/core/resource-metrics';

export interface UtilizationData {
  cpu?: ResourceMetricValues;
  memory?: ResourceMetricValues;
  pods?: {
    count?: string;
    capacity?: string;
    allocatable?: string;
  };
  mode?: 'nodeMetrics';
  podCount?: number;
  readyPodCount?: number;
}

const UTILIZATION_KINDS = new Set(['pod', 'deployment', 'daemonset', 'statefulset', 'node']);

const WORKLOAD_UTILIZATION_KINDS = new Set(['deployment', 'daemonset', 'statefulset']);

// Structural view of the utilization-bearing fields across the relevant detail DTOs.
// Detail DTOs carry formatted quantity strings; they are parsed once here.
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

const cpuAmount = (value: string | undefined) => parseResourceQuantity(value, 'cpu');
const memoryAmount = (value: string | undefined) => parseResourceQuantity(value, 'memory');

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
          usage: cpuAmount(source.cpuUsage),
          request: cpuAmount(source.cpuRequest),
          limit: cpuAmount(source.cpuLimit),
        }
      : undefined,
    memory: hasMemoryData
      ? {
          usage: memoryAmount(source.memUsage),
          request: memoryAmount(source.memRequest),
          limit: memoryAmount(source.memLimit),
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
          usage: cpuAmount(detail.cpuUsage),
          capacity: cpuAmount(detail.cpuCapacity),
          allocatable: cpuAmount(detail.cpuAllocatable),
          request: cpuAmount(detail.cpuRequests),
          limit: cpuAmount(detail.cpuLimits),
        }
      : undefined,
    memory: hasMemoryData
      ? {
          usage: memoryAmount(detail.memoryUsage),
          capacity: memoryAmount(detail.memoryCapacity),
          allocatable: memoryAmount(detail.memoryAllocatable),
          request: memoryAmount(detail.memRequests),
          limit: memoryAmount(detail.memLimits),
        }
      : undefined,
    pods: {
      count: String(detail.podsCount || 0),
      capacity: detail.podsCapacity || '-',
      allocatable: detail.podsAllocatable || '-',
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

const deriveWorkloadUtilization = (detail: UtilizationDetail): UtilizationData | null => {
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

  // Workload utilization (deployment/daemonset/statefulset): aggregated totals from
  // podMetricsSummary when available, falling back to averages on the detail itself.
  if (d && WORKLOAD_UTILIZATION_KINDS.has(objectKind)) {
    return deriveWorkloadUtilization(d);
  }

  // Fallback to objectData fields (dynamic properties on the object reference).
  return standardMetricSections(objectData as unknown as UtilizationDetail);
}

export function useUtilizationData(params: UseUtilizationDataParams): UtilizationData | null {
  const { objectData, detail } = params;
  // Reads the store only: the panel's collector holds the metrics lease and signal refetch.
  const liveMetrics = useResourceMetrics(objectData, false);
  const detailMetrics = useMemo(
    () => deriveDetailUtilizationData(objectData, detail),
    [objectData, detail]
  );

  return liveMetrics.metrics ?? detailMetrics;
}
