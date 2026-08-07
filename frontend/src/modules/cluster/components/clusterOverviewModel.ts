import type { ResourceCalculations } from '@shared/utils/resourceCalculations';
import {
  calculateResourceMetrics,
  formatCpuValue,
  formatMemoryValue,
} from '@shared/utils/resourceCalculations';
import type { ClusterLifecycleState } from '@/core/contexts/clusterLifecycleState';
import { shouldSuppressClusterOverviewUnavailableError } from '@/core/refresh/clusterOverviewLifecycle';
import type { DomainStatus } from '@/core/refresh/store';
import type { ClusterOverviewMetrics, ClusterOverviewPayload } from '@/core/refresh/types';
import { type ClusterWorkloadUsageKey, clusterWorkloadUsageValue } from '@/core/resource-metrics';
import type { OverviewRestriction } from './ClusterOverviewRestrictionNotice';

export const getClusterContextLabel = (clusterContext: string): string => {
  if (!clusterContext || clusterContext === 'Default') {
    return 'default';
  }
  const lastColonIndex = clusterContext.lastIndexOf(':');
  if (lastColonIndex === -1) {
    return clusterContext;
  }
  return clusterContext.substring(lastColonIndex + 1) || 'default';
};

export const selectClusterScopedValue = <T>({
  byCluster,
  legacyValue,
  payloadClusterId,
  selectedClusterId,
  hydratedClusterId,
}: {
  byCluster: Record<string, T> | undefined;
  legacyValue: T | null | undefined;
  payloadClusterId: string | undefined;
  selectedClusterId: string | null;
  hydratedClusterId: string | null;
}): T | null => {
  if (byCluster) {
    return selectedClusterId ? (byCluster[selectedClusterId] ?? null) : null;
  }
  if (!legacyValue) {
    return null;
  }

  const normalizedPayloadClusterId = payloadClusterId?.trim() || '';
  if (
    selectedClusterId &&
    normalizedPayloadClusterId &&
    normalizedPayloadClusterId !== selectedClusterId
  ) {
    return null;
  }
  if (!normalizedPayloadClusterId && hydratedClusterId && hydratedClusterId !== selectedClusterId) {
    return null;
  }
  return legacyValue;
};

interface OverviewDisplayStateInput {
  overviewData: ClusterOverviewPayload;
  emptyOverview: ClusterOverviewPayload;
  isHydrated: boolean;
  hydratedClusterId: string | null;
  selectedClusterId: string | null;
  isSwitching: boolean;
  domainStatus: DomainStatus;
  domainError: string | null | undefined;
  suppressPassiveLoading: boolean;
  lifecycleState: ClusterLifecycleState | undefined;
}

export interface OverviewDisplayState {
  displayOverview: ClusterOverviewPayload;
  isHydratedForCluster: boolean;
  errorMessage: string | null;
  showSkeleton: boolean;
}

const getUnavailableError = (
  domainStatus: DomainStatus,
  domainError: string | null | undefined,
  isHydratedForCluster: boolean,
  suppressUnavailableError: boolean
): string | null => {
  if (domainStatus !== 'error' || isHydratedForCluster || suppressUnavailableError) {
    return null;
  }
  return domainError ?? null;
};

const shouldShowOverviewSkeleton = ({
  errorMessage,
  isHydratedForCluster,
  suppressPassiveLoading,
  isSwitching,
  domainStatus,
  suppressUnavailableError,
  lifecycleState,
}: Omit<
  OverviewDisplayStateInput,
  | 'overviewData'
  | 'emptyOverview'
  | 'isHydrated'
  | 'hydratedClusterId'
  | 'selectedClusterId'
  | 'domainError'
> & {
  errorMessage: string | null;
  isHydratedForCluster: boolean;
  suppressUnavailableError: boolean;
}): boolean => {
  if (errorMessage || isHydratedForCluster || suppressPassiveLoading) {
    return false;
  }
  return (
    isSwitching ||
    domainStatus === 'loading' ||
    domainStatus === 'idle' ||
    suppressUnavailableError ||
    lifecycleState === undefined ||
    lifecycleState === 'connecting' ||
    lifecycleState === 'connected'
  );
};

export const buildOverviewDisplayState = ({
  overviewData,
  emptyOverview,
  isHydrated,
  hydratedClusterId,
  selectedClusterId,
  isSwitching,
  domainStatus,
  domainError,
  suppressPassiveLoading,
  lifecycleState,
}: OverviewDisplayStateInput): OverviewDisplayState => {
  const isHydratedForCluster = isHydrated && hydratedClusterId === selectedClusterId;
  const suppressUnavailableError =
    domainStatus === 'error' &&
    !isHydratedForCluster &&
    shouldSuppressClusterOverviewUnavailableError(lifecycleState, domainError);
  const errorMessage = getUnavailableError(
    domainStatus,
    domainError,
    isHydratedForCluster,
    suppressUnavailableError
  );

  return {
    displayOverview: isHydratedForCluster ? overviewData : emptyOverview,
    isHydratedForCluster,
    errorMessage,
    showSkeleton: shouldShowOverviewSkeleton({
      errorMessage,
      isHydratedForCluster,
      suppressPassiveLoading,
      isSwitching,
      domainStatus,
      suppressUnavailableError,
      lifecycleState,
    }),
  };
};

const metricsRestriction = (
  metricsInfo: ClusterOverviewMetrics | null
): OverviewRestriction | null => {
  if (!metricsInfo?.disabled) {
    return null;
  }
  const reason = metricsInfo.lastError?.trim();
  return {
    key: 'metrics',
    headline: 'Metrics unavailable',
    detail: reason
      ? `Live CPU and memory usage cannot be shown. ${reason}`
      : 'Live CPU and memory usage cannot be shown.',
    testId: 'utilization-metrics-permission-note',
  };
};

export interface OverviewRestrictions {
  utilization: OverviewRestriction[];
  nodes: OverviewRestriction[];
  workloads: OverviewRestriction[];
}

export const buildOverviewRestrictions = ({
  showSkeleton,
  nodesUnavailable,
  podsUnavailable,
  namespacesUnavailable,
  metricsInfo,
}: {
  showSkeleton: boolean;
  nodesUnavailable: boolean;
  podsUnavailable: boolean;
  namespacesUnavailable: boolean;
  metricsInfo: ClusterOverviewMetrics | null;
}): OverviewRestrictions => {
  const restrictions: OverviewRestrictions = { utilization: [], nodes: [], workloads: [] };
  if (showSkeleton) {
    return restrictions;
  }
  if (nodesUnavailable) {
    restrictions.utilization.push({
      key: 'capacity',
      headline: 'Capacity unavailable',
      detail:
        'Cluster capacity is unavailable, so utilization is measured against requests and limits. Requires Node permissions: list, watch.',
      testId: 'utilization-capacity-permission-chip',
    });
    restrictions.nodes.push({
      key: 'nodes',
      headline: 'Node details unavailable',
      detail:
        'Your account has insufficient access to node data. Requires Node permissions: list, watch.',
      testId: 'cluster-nodes-permission-note',
    });
  }
  if (podsUnavailable) {
    restrictions.utilization.push({
      key: 'requests-limits',
      headline: 'Requests and limits unavailable',
      detail: 'Only current usage is shown. Requires Pod permissions: list, watch.',
      testId: 'utilization-requests-permission-chip',
    });
    restrictions.workloads.push({
      key: 'pods',
      headline: 'Pod and container counts unavailable',
      detail:
        'Your account has insufficient access to pod data. Requires Pod permissions: list, watch.',
      testId: 'workloads-pods-permission-note',
    });
  }
  if (namespacesUnavailable) {
    restrictions.workloads.push({
      key: 'namespaces',
      headline: 'Namespace count unavailable',
      detail:
        'Your account has insufficient access to namespaces. Requires Namespace permission: list.',
      testId: 'workloads-namespaces-permission-note',
    });
  }

  const metrics = metricsRestriction(metricsInfo);
  if (metrics) {
    restrictions.utilization.push(metrics);
  }
  return restrictions;
};

export const buildResourceUsageSummaries = ({
  cpuMetrics,
  memoryMetrics,
  nodesUnavailable,
}: {
  cpuMetrics: ResourceCalculations;
  memoryMetrics: ResourceCalculations;
  nodesUnavailable: boolean;
}): { cpu: string; memory: string } => ({
  cpu: nodesUnavailable
    ? `${formatCpuValue(cpuMetrics.usage)} used`
    : `${formatCpuValue(cpuMetrics.usage)} of ${formatCpuValue(cpuMetrics.allocatable)} cores`,
  memory: nodesUnavailable
    ? `${formatMemoryValue(memoryMetrics.usage)} used`
    : `${formatMemoryValue(memoryMetrics.usage)} of ${formatMemoryValue(
        memoryMetrics.allocatable
      )}`,
});

interface WorkloadUsageSource {
  key: string;
  label: string;
  variant: string;
  cpuUsage: string;
  memoryUsage: string;
}

const workloadUsageOrZero = (
  usage: ClusterOverviewPayload['workloadResourceUsage'],
  key: ClusterWorkloadUsageKey,
  type: 'cpu' | 'memory'
): string => clusterWorkloadUsageValue(usage, key, type) ?? '0';

const buildWorkloadUsageSource = (
  usage: ClusterOverviewPayload['workloadResourceUsage'],
  key: string,
  label: string,
  variant: string,
  workloadKey: ClusterWorkloadUsageKey
): WorkloadUsageSource => ({
  key,
  label,
  variant,
  cpuUsage: workloadUsageOrZero(usage, workloadKey, 'cpu'),
  memoryUsage: workloadUsageOrZero(usage, workloadKey, 'memory'),
});

const sumWorkloadUsage = (items: Array<{ value: number }>): number =>
  items.reduce((sum, item) => sum + item.value, 0);

export const buildWorkloadUsagePresentation = (
  overview: ClusterOverviewPayload,
  emptyOverview: ClusterOverviewPayload
) => {
  const usage = overview.workloadResourceUsage ?? emptyOverview.workloadResourceUsage;
  const sources = [
    buildWorkloadUsageSource(usage, 'deployment', 'deployments', 'deployment', 'deployments'),
    buildWorkloadUsageSource(usage, 'statefulset', 'statefulsets', 'statefulset', 'statefulSets'),
    buildWorkloadUsageSource(usage, 'daemonset', 'daemonsets', 'daemonset', 'daemonSets'),
    buildWorkloadUsageSource(usage, 'job', 'jobs', 'job', 'jobs'),
  ];
  const cpuItems = sources.map((item) => ({
    ...item,
    usage: item.cpuUsage,
    value: calculateResourceMetrics({ usage: item.cpuUsage }, 'cpu').usage,
  }));
  const memoryItems = sources.map((item) => ({
    ...item,
    usage: item.memoryUsage,
    value: calculateResourceMetrics({ usage: item.memoryUsage }, 'memory').usage,
  }));

  return {
    cpuItems,
    memoryItems,
    cpuTotal: sumWorkloadUsage(cpuItems),
    memoryTotal: sumWorkloadUsage(memoryItems),
  };
};
