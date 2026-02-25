/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts
 *
 * React hook for useUtilizationData.
 * Encapsulates state and side effects for the object panel feature.
 */

import { useMemo } from 'react';
import type { types } from '@wailsjs/go/models';
import type { UtilizationData } from './detailsTabTypes';
import type { KubernetesObjectReference } from '@/types/view-state';

interface UseUtilizationDataParams {
  objectData: KubernetesObjectReference | null | undefined;
  podDetails: types.PodDetailInfo | null;
  deploymentDetails: types.DeploymentDetails | null;
  daemonSetDetails: types.DaemonSetDetails | null;
  statefulSetDetails: types.StatefulSetDetails | null;
  replicaSetDetails: types.ReplicaSetDetails | null;
  nodeDetails: types.NodeDetails | null;
}

export function useUtilizationData(params: UseUtilizationDataParams): UtilizationData | null {
  const {
    objectData,
    podDetails,
    deploymentDetails,
    daemonSetDetails,
    statefulSetDetails,
    replicaSetDetails,
    nodeDetails,
  } = params;

  const hasUtilization = (() => {
    const kind = objectData?.kind?.toLowerCase();
    return (
      kind === 'pod' ||
      kind === 'deployment' ||
      kind === 'daemonset' ||
      kind === 'statefulset' ||
      kind === 'replicaset' ||
      kind === 'node'
    );
  })();

  return useMemo(() => {
    if (!objectData) return null;

    const objectKind = objectData.kind?.toLowerCase();

    // Node utilization
    if (nodeDetails && objectKind === 'node') {
      const hasCpuData =
        nodeDetails.cpuCapacity ||
        nodeDetails.cpuAllocatable ||
        nodeDetails.cpuRequests ||
        nodeDetails.cpuLimits ||
        nodeDetails.cpuUsage;
      const hasMemData =
        nodeDetails.memoryCapacity ||
        nodeDetails.memoryAllocatable ||
        nodeDetails.memRequests ||
        nodeDetails.memLimits ||
        nodeDetails.memoryUsage;

      if (!hasCpuData && !hasMemData) return null;

      return {
        cpu: hasCpuData
          ? {
              usage: nodeDetails.cpuUsage || '-',
              capacity: nodeDetails.cpuCapacity || '-',
              allocatable: nodeDetails.cpuAllocatable || '-',
              request: nodeDetails.cpuRequests || '-',
              limit: nodeDetails.cpuLimits || '-',
            }
          : undefined,
        memory: hasMemData
          ? {
              usage: nodeDetails.memoryUsage || '-',
              capacity: nodeDetails.memoryCapacity || '-',
              allocatable: nodeDetails.memoryAllocatable || '-',
              request: nodeDetails.memRequests || '-',
              limit: nodeDetails.memLimits || '-',
            }
          : undefined,
        pods: {
          count: String(nodeDetails.podsCount || 0),
          capacity: nodeDetails.podsCapacity || '-',
          allocatable: nodeDetails.podsAllocatable || '-',
        },
        mode: 'nodeMetrics' as const,
      };
    }

    if (!hasUtilization) return null;

    // Pod utilization
    if (podDetails && objectKind === 'pod') {
      const hasCpuData = podDetails.cpuUsage || podDetails.cpuRequest || podDetails.cpuLimit;
      const hasMemData = podDetails.memUsage || podDetails.memRequest || podDetails.memLimit;

      if (!hasCpuData && !hasMemData) return null;

      return {
        cpu: hasCpuData
          ? {
              usage: podDetails.cpuUsage || '-',
              request: podDetails.cpuRequest || '-',
              limit: podDetails.cpuLimit || '-',
            }
          : undefined,
        memory: hasMemData
          ? {
              usage: podDetails.memUsage || '-',
              request: podDetails.memRequest || '-',
              limit: podDetails.memLimit || '-',
            }
          : undefined,
      };
    }

    // Deployment utilization (aggregated totals from podMetricsSummary)
    if (deploymentDetails && objectKind === 'deployment') {
      const summary = deploymentDetails.podMetricsSummary;
      const hasSummary =
        summary && (summary.cpuUsage || summary.memUsage || summary.cpuRequest || summary.memRequest);
      // Use totals from podMetricsSummary when available, fall back to averages.
      const source = hasSummary ? summary : deploymentDetails;
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
        podCount: summary?.pods ?? deploymentDetails.pods?.length ?? 0,
        readyPodCount: summary?.readyPods,
      };
    }

    // DaemonSet utilization (aggregated totals from podMetricsSummary)
    if (daemonSetDetails && objectKind === 'daemonset') {
      const summary = daemonSetDetails.podMetricsSummary;
      const hasSummary =
        summary && (summary.cpuUsage || summary.memUsage || summary.cpuRequest || summary.memRequest);
      const source = hasSummary ? summary : daemonSetDetails;
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
        podCount: summary?.pods ?? daemonSetDetails.pods?.length ?? 0,
        readyPodCount: summary?.readyPods,
      };
    }

    // StatefulSet utilization (aggregated totals from podMetricsSummary)
    if (statefulSetDetails && objectKind === 'statefulset') {
      const summary = statefulSetDetails.podMetricsSummary;
      const hasSummary =
        summary && (summary.cpuUsage || summary.memUsage || summary.cpuRequest || summary.memRequest);
      const source = hasSummary ? summary : statefulSetDetails;
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
        podCount: summary?.pods ?? statefulSetDetails.pods?.length ?? 0,
        readyPodCount: summary?.readyPods,
      };
    }

    // ReplicaSet utilization (aggregated totals from podMetricsSummary)
    if (replicaSetDetails && objectKind === 'replicaset') {
      if (replicaSetDetails.isActive === false) {
        return null;
      }

      const summary = replicaSetDetails.podMetricsSummary;
      const hasSummary =
        summary && (summary.cpuUsage || summary.memUsage || summary.cpuRequest || summary.memRequest);
      const source = hasSummary ? summary : replicaSetDetails;
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
        podCount: summary?.pods ?? replicaSetDetails.pods?.length ?? 0,
        readyPodCount: summary?.readyPods,
      };
    }

    // Fallback to objectData fields (cast to string since these come from dynamic properties)
    const cpuUsage = objectData.cpuUsage as string | undefined;
    const cpuRequest = objectData.cpuRequest as string | undefined;
    const cpuLimit = objectData.cpuLimit as string | undefined;
    const memUsage = objectData.memUsage as string | undefined;
    const memRequest = objectData.memRequest as string | undefined;
    const memLimit = objectData.memLimit as string | undefined;

    const hasCpuData = cpuUsage || cpuRequest || cpuLimit;
    const hasMemData = memUsage || memRequest || memLimit;

    if (!hasCpuData && !hasMemData) return null;

    return {
      cpu: hasCpuData
        ? {
            usage: cpuUsage || '-',
            request: cpuRequest || '-',
            limit: cpuLimit || '-',
          }
        : undefined,
      memory: hasMemData
        ? {
            usage: memUsage || '-',
            request: memRequest || '-',
            limit: memLimit || '-',
          }
        : undefined,
    };
  }, [
    objectData,
    hasUtilization,
    podDetails,
    deploymentDetails,
    daemonSetDetails,
    statefulSetDetails,
    replicaSetDetails,
    nodeDetails,
  ]);
}

export function useHasUtilization(
  objectData: KubernetesObjectReference | null | undefined
): boolean {
  return useMemo(() => {
    const kind = objectData?.kind?.toLowerCase();
    return (
      kind === 'pod' ||
      kind === 'deployment' ||
      kind === 'daemonset' ||
      kind === 'statefulset' ||
      kind === 'replicaset' ||
      kind === 'node'
    );
  }, [objectData]);
}
