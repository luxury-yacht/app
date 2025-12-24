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

    // Deployment utilization (average per pod)
    if (deploymentDetails && objectKind === 'deployment') {
      const hasCpuData =
        deploymentDetails.cpuUsage || deploymentDetails.cpuRequest || deploymentDetails.cpuLimit;
      const hasMemData =
        deploymentDetails.memUsage || deploymentDetails.memRequest || deploymentDetails.memLimit;

      if (!hasCpuData && !hasMemData) return null;

      return {
        cpu: hasCpuData
          ? {
              usage: deploymentDetails.cpuUsage || '-',
              request: deploymentDetails.cpuRequest || '-',
              limit: deploymentDetails.cpuLimit || '-',
            }
          : undefined,
        memory: hasMemData
          ? {
              usage: deploymentDetails.memUsage || '-',
              request: deploymentDetails.memRequest || '-',
              limit: deploymentDetails.memLimit || '-',
            }
          : undefined,
        isAverage: true,
        podCount: deploymentDetails.pods?.length || 0,
      };
    }

    // DaemonSet utilization (average per pod)
    if (daemonSetDetails && objectKind === 'daemonset') {
      const hasCpuData =
        daemonSetDetails.cpuUsage || daemonSetDetails.cpuRequest || daemonSetDetails.cpuLimit;
      const hasMemData =
        daemonSetDetails.memUsage || daemonSetDetails.memRequest || daemonSetDetails.memLimit;

      if (!hasCpuData && !hasMemData) return null;

      return {
        cpu: hasCpuData
          ? {
              usage: daemonSetDetails.cpuUsage || '-',
              request: daemonSetDetails.cpuRequest || '-',
              limit: daemonSetDetails.cpuLimit || '-',
            }
          : undefined,
        memory: hasMemData
          ? {
              usage: daemonSetDetails.memUsage || '-',
              request: daemonSetDetails.memRequest || '-',
              limit: daemonSetDetails.memLimit || '-',
            }
          : undefined,
        isAverage: true,
        podCount: daemonSetDetails.pods?.length || 0,
      };
    }

    // StatefulSet utilization (average per pod)
    if (statefulSetDetails && objectKind === 'statefulset') {
      const hasCpuData =
        statefulSetDetails.cpuUsage || statefulSetDetails.cpuRequest || statefulSetDetails.cpuLimit;
      const hasMemData =
        statefulSetDetails.memUsage || statefulSetDetails.memRequest || statefulSetDetails.memLimit;

      if (!hasCpuData && !hasMemData) return null;

      return {
        cpu: hasCpuData
          ? {
              usage: statefulSetDetails.cpuUsage || '-',
              request: statefulSetDetails.cpuRequest || '-',
              limit: statefulSetDetails.cpuLimit || '-',
            }
          : undefined,
        memory: hasMemData
          ? {
              usage: statefulSetDetails.memUsage || '-',
              request: statefulSetDetails.memRequest || '-',
              limit: statefulSetDetails.memLimit || '-',
            }
          : undefined,
        isAverage: true,
        podCount: statefulSetDetails.pods?.length || 0,
      };
    }

    // ReplicaSet utilization (average per pod)
    if (replicaSetDetails && objectKind === 'replicaset') {
      if (replicaSetDetails.isActive === false) {
        return null;
      }

      const hasCpuData =
        replicaSetDetails.cpuUsage || replicaSetDetails.cpuRequest || replicaSetDetails.cpuLimit;
      const hasMemData =
        replicaSetDetails.memUsage || replicaSetDetails.memRequest || replicaSetDetails.memLimit;

      if (!hasCpuData && !hasMemData) return null;

      return {
        cpu: hasCpuData
          ? {
              usage: replicaSetDetails.cpuUsage || '-',
              request: replicaSetDetails.cpuRequest || '-',
              limit: replicaSetDetails.cpuLimit || '-',
            }
          : undefined,
        memory: hasMemData
          ? {
              usage: replicaSetDetails.memUsage || '-',
              request: replicaSetDetails.memRequest || '-',
              limit: replicaSetDetails.memLimit || '-',
            }
          : undefined,
        isAverage: true,
        podCount: replicaSetDetails.pods?.length || 0,
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
