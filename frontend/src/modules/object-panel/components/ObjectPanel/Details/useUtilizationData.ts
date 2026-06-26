/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts
 *
 * Derives the Utilization section's CPU/memory/pods data from live metric domains,
 * falling back to the active detail DTO while those domains load.
 */

import { useMemo } from 'react';
import { useResourceMetrics } from '@/core/resource-metrics';
import type { UtilizationData } from './detailsTabTypes';
import type { KubernetesObjectReference } from '@/types/view-state';

const UTILIZATION_KINDS = new Set([
  'pod',
  'deployment',
  'daemonset',
  'statefulset',
  'replicaset',
  'node',
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
  objectData: KubernetesObjectReference | null | undefined;
  detail: unknown;
}

function deriveDetailUtilizationData(
  objectData: KubernetesObjectReference | null | undefined,
  detail: unknown
): UtilizationData | null {
  const objectKind = objectData?.kind?.toLowerCase();
  const hasUtilization = objectKind ? UTILIZATION_KINDS.has(objectKind) : false;

  if (!objectData) return null;
  const d = (detail ?? undefined) as UtilizationDetail | undefined;

  // Node utilization
  if (d && objectKind === 'node') {
    const hasCpuData =
      d.cpuCapacity || d.cpuAllocatable || d.cpuRequests || d.cpuLimits || d.cpuUsage;
    const hasMemData =
      d.memoryCapacity || d.memoryAllocatable || d.memRequests || d.memLimits || d.memoryUsage;

    if (!hasCpuData && !hasMemData) return null;

    return {
      cpu: hasCpuData
        ? {
            usage: d.cpuUsage || '-',
            capacity: d.cpuCapacity || '-',
            allocatable: d.cpuAllocatable || '-',
            request: d.cpuRequests || '-',
            limit: d.cpuLimits || '-',
          }
        : undefined,
      memory: hasMemData
        ? {
            usage: d.memoryUsage || '-',
            capacity: d.memoryCapacity || '-',
            allocatable: d.memoryAllocatable || '-',
            request: d.memRequests || '-',
            limit: d.memLimits || '-',
          }
        : undefined,
      pods: {
        count: String(d.podsCount || 0),
        capacity: d.podsCapacity || '-',
        allocatable: d.podsAllocatable || '-',
      },
      mode: 'nodeMetrics' as const,
    };
  }

  if (!hasUtilization) return null;

  // Pod utilization
  if (d && objectKind === 'pod') {
    const hasCpuData = d.cpuUsage || d.cpuRequest || d.cpuLimit;
    const hasMemData = d.memUsage || d.memRequest || d.memLimit;
    if (!hasCpuData && !hasMemData) return null;
    return {
      cpu: hasCpuData
        ? { usage: d.cpuUsage || '-', request: d.cpuRequest || '-', limit: d.cpuLimit || '-' }
        : undefined,
      memory: hasMemData
        ? { usage: d.memUsage || '-', request: d.memRequest || '-', limit: d.memLimit || '-' }
        : undefined,
    };
  }

  // Workload utilization (deployment/daemonset/statefulset/replicaset): aggregated totals from
  // podMetricsSummary when available, falling back to averages on the detail itself.
  if (
    d &&
    (objectKind === 'deployment' ||
      objectKind === 'daemonset' ||
      objectKind === 'statefulset' ||
      objectKind === 'replicaset')
  ) {
    if (objectKind === 'replicaset' && d.isActive === false) {
      return null;
    }
    const summary = d.podMetricsSummary;
    const hasSummary =
      summary && (summary.cpuUsage || summary.memUsage || summary.cpuRequest || summary.memRequest);
    const source = hasSummary ? summary : d;
    const hasCpuData = source.cpuUsage || source.cpuRequest || source.cpuLimit;
    const hasMemData = source.memUsage || source.memRequest || source.memLimit;
    if (!hasCpuData && !hasMemData) return null;
    return {
      cpu: hasCpuData
        ? {
            usage: source.cpuUsage || '-',
            request: source.cpuRequest || '-',
            limit: source.cpuLimit || '-',
          }
        : undefined,
      memory: hasMemData
        ? {
            usage: source.memUsage || '-',
            request: source.memRequest || '-',
            limit: source.memLimit || '-',
          }
        : undefined,
      podCount: summary?.pods ?? d.pods?.length ?? 0,
      readyPodCount: summary?.readyPods,
    };
  }

  // Fallback to objectData fields (dynamic properties on the object reference).
  const od = objectData as unknown as UtilizationDetail;
  const hasCpuData = od.cpuUsage || od.cpuRequest || od.cpuLimit;
  const hasMemData = od.memUsage || od.memRequest || od.memLimit;
  if (!hasCpuData && !hasMemData) return null;
  return {
    cpu: hasCpuData
      ? { usage: od.cpuUsage || '-', request: od.cpuRequest || '-', limit: od.cpuLimit || '-' }
      : undefined,
    memory: hasMemData
      ? { usage: od.memUsage || '-', request: od.memRequest || '-', limit: od.memLimit || '-' }
      : undefined,
  };
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

export function useHasUtilization(
  objectData: KubernetesObjectReference | null | undefined
): boolean {
  return useMemo(() => {
    const kind = objectData?.kind?.toLowerCase();
    return kind ? UTILIZATION_KINDS.has(kind) : false;
  }, [objectData]);
}
