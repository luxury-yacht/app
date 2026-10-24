/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/useUtilizationData.ts
 *
 * Derives the Metrics tab's utilization bars from live metric domains (kept fresh by the panel's
 * metrics collector), falling back to the active detail DTO while those domains load.
 */

import type { daemonset, deployment, nodes, statefulset } from '@core/backend-api/models';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import {
  type DetailTypesWhere,
  type KindMetricsDomain,
  lookupKindFacets,
} from '@shared/kinds/kindFacets';
import { parseResourceQuantity } from '@shared/utils/resourceCalculations';
import { useMemo } from 'react';
import type { ObjectDetail, ObjectDetailType, ObjectDetailTypes } from '@/core/refresh/types';
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

// Detail DTOs carry formatted quantity strings; they are parsed once here.
interface StandardMetricSource {
  cpuUsage?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memUsage?: string;
  memRequest?: string;
  memLimit?: string;
}

type WorkloadDetails =
  | deployment.DeploymentDetails
  | daemonset.DaemonSetDetails
  | statefulset.StatefulSetDetails;

interface UseUtilizationDataParams {
  objectData: ObjectPanelRef | null | undefined;
  detail: ObjectDetail | null | undefined;
}

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

const deriveNodeUtilization = (detail: nodes.NodeDetails): UtilizationData | null => {
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

const workloadMetricSource = (detail: WorkloadDetails): StandardMetricSource => {
  const summary = detail.podMetricsSummary;
  const hasSummary = hasMetricValue([
    summary?.cpuUsage,
    summary?.memUsage,
    summary?.cpuRequest,
    summary?.memRequest,
  ]);
  return hasSummary && summary ? summary : detail;
};

const deriveWorkloadUtilization = (detail: WorkloadDetails): UtilizationData | null => {
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

type MetricsDetailType = DetailTypesWhere<{
  metricsDomain: Exclude<KindMetricsDomain, 'none'>;
}>;
type UtilizationOf<K extends ObjectDetailType> = (
  details: ObjectDetailTypes[K]
) => UtilizationData | null;

// Utilization from the active detail, by the DTO that carries it: node capacity, pod usage, or
// workload totals (podMetricsSummary when available, else averages on the detail itself). Every
// kind with a metrics facet must read its DTO here; TypeScript rejects a missing or stale entry.
const DETAIL_UTILIZATION: { [K in MetricsDetailType]: UtilizationOf<K> } = {
  node: deriveNodeUtilization,
  pod: standardMetricSections,
  deployment: deriveWorkloadUtilization,
  daemonset: deriveWorkloadUtilization,
  statefulset: deriveWorkloadUtilization,
};
const UTILIZATION_BY_DETAIL_TYPE: { [K in ObjectDetailType]?: UtilizationOf<K> } =
  DETAIL_UTILIZATION;

function detailUtilization<K extends ObjectDetailType>(
  detail: ObjectDetail<K>
): UtilizationData | null {
  const derive: UtilizationOf<K> | undefined = UTILIZATION_BY_DETAIL_TYPE[detail.detailType];
  return derive ? derive(detail.details) : null;
}

function deriveDetailUtilizationData(
  objectData: ObjectPanelRef | null | undefined,
  detail: ObjectDetail | null | undefined
): UtilizationData | null {
  if (!objectData) {
    return null;
  }
  if (detail) {
    return detailUtilization(detail);
  }
  if ((lookupKindFacets(objectData)?.metricsDomain ?? 'none') === 'none') {
    return null;
  }
  // Fallback to objectData fields (dynamic properties on the object reference).
  return standardMetricSections(objectData as unknown as StandardMetricSource);
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
