/**
 * frontend/src/modules/cluster/components/ClusterOverview.tsx
 *
 * Module source for ClusterOverview.
 * Displays an overview of the connected Kubernetes cluster, including resource usage,
 * node and workload summaries, and pod status with navigation links.
 */

import captainK8s from '@assets/captain-k8s-color.png';
import logo from '@assets/luxury-yacht-color-vert.png';
import ResourceBar from '@shared/components/ResourceBar';
import {
  USAGE_CRITICAL_THRESHOLD_PERCENT,
  USAGE_HIGH_THRESHOLD_PERCENT,
} from '@shared/components/resourceBarThresholds';
import Tooltip from '@shared/components/Tooltip';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { requestGridTableFilters } from '@shared/components/tables/hooks/useGridTableExternalFilters';
import {
  calculateResourceMetrics,
  formatCpuValue,
  formatMemoryValue,
} from '@shared/utils/resourceCalculations';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { setRefreshDomainEnabled } from '@/core/data-access';
import { eventBus } from '@/core/events';
import { useRefreshScopedDomain } from '@/core/refresh';
import {
  canActivateClusterOverviewRefresh,
  shouldSuppressClusterOverviewUnavailableError,
} from '@/core/refresh/clusterOverviewLifecycle';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useStreamSignalRefetch } from '@/core/refresh/hooks/useStreamSignalRefetch';
import type { ClusterOverviewPayload } from '@/core/refresh/types';
import './ClusterOverview.css';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import {
  objectPanelId,
  useObjectPanelState,
} from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { LiveAgeText } from '@shared/components/LiveAgeText';
import { useMetricsBannerInfo } from '@shared/hooks/useMetricsBannerInfo';
import {
  canResolveEventObjectReference,
  resolveEventObjectReference,
} from '@shared/utils/eventObjectIdentity';
import { buildConnectivityPresentation } from '@/core/connection/connectivityPresentation';
import { useActiveClusterAuthState } from '@/core/contexts/AuthErrorContext';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import type { RecentEventEntry } from '@/core/refresh/types';
import {
  clusterOverviewCpuValue,
  clusterOverviewMemoryValue,
  clusterOverviewResourceMetrics,
  clusterWorkloadUsageValue,
} from '@/core/resource-metrics';
import { useClusterHealthListener } from '@/hooks/useWailsRuntimeEvents';
import type { ClusterViewType } from '@/types/navigation/views';
import { CLUSTER_ATTENTION_FINDING_TYPES } from '../clusterAttentionFindingTypes';
import ClusterOverviewRestrictionNotice, {
  type OverviewRestriction,
} from './ClusterOverviewRestrictionNotice';

interface ClusterOverviewProps {
  clusterContext: string;
}

const EMPTY_OVERVIEW: ClusterOverviewPayload = {
  clusterType: '',
  clusterVersion: '',
  cpuUsage: '0',
  cpuRequests: '0',
  cpuLimits: '0',
  cpuAllocatable: '0',
  memoryUsage: '0',
  memoryRequests: '0',
  memoryLimits: '0',
  memoryAllocatable: '0',
  totalNodes: 0,
  fargateNodes: 0,
  regularNodes: 0,
  ec2Nodes: 0,
  virtualNodes: 0,
  vmNodes: 0,
  totalPods: 0,
  totalContainers: 0,
  totalInitContainers: 0,
  runningPods: 0,
  succeededPods: 0,
  pendingPods: 0,
  failedPods: 0,
  readyPods: 0,
  startingPods: 0,
  failingPods: 0,
  terminatingPods: 0,
  restartedPods: 0,
  notReadyPods: 0,
  totalNamespaces: 0,
  totalDeployments: 0,
  totalStatefulSets: 0,
  totalDaemonSets: 0,
  totalCronJobs: 0,
  workloadResourceUsage: {
    deployments: { cpuUsage: '0', memoryUsage: '0' },
    daemonSets: { cpuUsage: '0', memoryUsage: '0' },
    statefulSets: { cpuUsage: '0', memoryUsage: '0' },
    jobs: { cpuUsage: '0', memoryUsage: '0' },
  },
  readyNodes: 0,
  notReadyNodes: 0,
  cordonedNodes: 0,
  recentEvents: [],
};

type PodStatusFilter = 'none' | 'starting' | 'failing' | 'terminating' | 'restarts' | 'not-ready';

const POD_ATTENTION_FINDINGS: Record<Exclude<PodStatusFilter, 'none'>, string[]> = {
  starting: [CLUSTER_ATTENTION_FINDING_TYPES.podUnhealthy],
  failing: [CLUSTER_ATTENTION_FINDING_TYPES.errorPresentation],
  terminating: [CLUSTER_ATTENTION_FINDING_TYPES.podUnhealthy],
  restarts: [CLUSTER_ATTENTION_FINDING_TYPES.restarts],
  'not-ready': [CLUSTER_ATTENTION_FINDING_TYPES.podNotReady],
};

const ClusterOverview: React.FC<ClusterOverviewProps> = ({ clusterContext }) => {
  const contextLabel = useMemo(() => {
    if (!clusterContext || clusterContext === 'Default') {
      return 'default';
    }
    const lastColonIndex = clusterContext.lastIndexOf(':');
    if (lastColonIndex === -1) {
      return clusterContext;
    }
    return clusterContext.substring(lastColonIndex + 1) || 'default';
  }, [clusterContext]);

  const { selectedClusterId, selectedClusterName } = useKubeconfig();
  const { openWithObject } = useObjectPanel();
  const { setObjectPanelActiveTab, hydrateClusterMeta } = useObjectPanelState();
  const { getClusterState } = useClusterLifecycle();
  const { getActiveClusterHealth } = useClusterHealthListener(selectedClusterId);
  const authState = useActiveClusterAuthState(selectedClusterId);
  const { namespaceReady, setSelectedNamespace } = useNamespace();
  const { isPaused, suppressPassiveLoading } = useAutoRefreshLoadingState();
  const lifecycleState = selectedClusterId ? getClusterState(selectedClusterId) : undefined;

  // Cluster Overview is a foreground per-cluster page, so it must never
  // reuse a multi-cluster overview scope from other selected tabs.
  const overviewScope = useMemo(
    () => buildClusterScope(selectedClusterId ?? undefined, ''),
    [selectedClusterId]
  );
  const overviewDomain = useRefreshScopedDomain('cluster-overview', overviewScope);
  const health = getActiveClusterHealth();
  const canActivateOverviewRefresh = canActivateClusterOverviewRefresh(lifecycleState);
  // Metric doorbell: each successful collection refetches the overview so
  // live usage appears within one collection instead of a full poll cycle
  // (resolves the "Collecting metrics…" card promptly). Polls stay on for
  // this domain — the doorbell never rings on metrics-less clusters.
  const overviewSignalScopes = useMemo(
    () => (overviewScope && canActivateOverviewRefresh ? [overviewScope] : []),
    [overviewScope, canActivateOverviewRefresh]
  );
  useStreamSignalRefetch('cluster-overview', overviewSignalScopes);
  const overviewStatus = useMemo(
    () =>
      buildConnectivityPresentation({
        clusterId: selectedClusterId,
        clusterName: selectedClusterName,
        lifecycleState,
        namespaceReady,
        health,
        isPaused,
        isRefreshing: overviewDomain.status === 'updating',
        authState,
      }),
    [
      authState,
      health,
      isPaused,
      lifecycleState,
      namespaceReady,
      overviewDomain.status,
      selectedClusterId,
      selectedClusterName,
    ]
  );
  const [overviewData, setOverviewData] = useState<ClusterOverviewPayload>(EMPTY_OVERVIEW);
  // Disclosure for the Resource Utilization legend; collapsed by default so
  // the card stays compact.
  const [legendExpanded, setLegendExpanded] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [hydratedClusterId, setHydratedClusterId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const metricsInfo = useMemo(() => {
    const metricsByCluster = overviewDomain.data?.metricsByCluster;
    if (metricsByCluster) {
      return selectedClusterId ? (metricsByCluster[selectedClusterId] ?? null) : null;
    }
    if (!overviewDomain.data?.metrics) {
      return null;
    }
    const payloadClusterId = overviewDomain.data.clusterId?.trim() || '';
    if (selectedClusterId && payloadClusterId && payloadClusterId !== selectedClusterId) {
      return null;
    }
    if (!payloadClusterId && hydratedClusterId && hydratedClusterId !== selectedClusterId) {
      return null;
    }
    return overviewDomain.data.metrics;
  }, [
    hydratedClusterId,
    overviewDomain.data?.clusterId,
    overviewDomain.data?.metrics,
    overviewDomain.data?.metricsByCluster,
    selectedClusterId,
  ]);
  const metricsBanner = useMetricsBannerInfo(metricsInfo);
  const {
    setActiveNamespaceTab,
    setActiveClusterView,
    setSidebarSelection,
    navigateToClusterView,
    navigateToNamespace,
  } = useViewState();

  const selectedOverview = useMemo(() => {
    const overviewByCluster = overviewDomain.data?.overviewByCluster;
    if (overviewByCluster) {
      return selectedClusterId ? (overviewByCluster[selectedClusterId] ?? null) : null;
    }
    if (!overviewDomain.data?.overview) {
      return null;
    }
    const payloadClusterId = overviewDomain.data.clusterId?.trim() || '';
    if (selectedClusterId && payloadClusterId && payloadClusterId !== selectedClusterId) {
      return null;
    }
    if (!payloadClusterId && hydratedClusterId && hydratedClusterId !== selectedClusterId) {
      return null;
    }
    return overviewDomain.data.overview;
  }, [
    hydratedClusterId,
    overviewDomain.data?.clusterId,
    overviewDomain.data?.overview,
    overviewDomain.data?.overviewByCluster,
    selectedClusterId,
  ]);

  useEffect(() => {
    if (selectedOverview) {
      setOverviewData(selectedOverview);
      setIsHydrated(true);
      setHydratedClusterId(selectedClusterId ?? null);
      setIsSwitching(false);
      return;
    }

    if (overviewDomain.status === 'idle') {
      setOverviewData(EMPTY_OVERVIEW);
      setIsHydrated(false);
      setHydratedClusterId(null);
      return;
    }

    if (overviewDomain.status === 'error' && !isHydrated) {
      setOverviewData(EMPTY_OVERVIEW);
      setIsSwitching(false);
    }
  }, [selectedClusterId, selectedOverview, overviewDomain.status, isHydrated]);

  useEffect(() => {
    if (!selectedClusterId) {
      setOverviewData(EMPTY_OVERVIEW);
      setIsHydrated(false);
      setHydratedClusterId(null);
      setIsSwitching(false);
      return;
    }
    if (hydratedClusterId && hydratedClusterId !== selectedClusterId && !selectedOverview) {
      // Clear cached data when switching tabs so the new cluster shows loading placeholders.
      setOverviewData(EMPTY_OVERVIEW);
      setIsHydrated(false);
      setIsSwitching(true);
    }
  }, [hydratedClusterId, selectedClusterId, selectedOverview]);

  const isHydratedForCluster = isHydrated && hydratedClusterId === selectedClusterId;
  const displayOverview = isHydratedForCluster ? overviewData : EMPTY_OVERVIEW;
  const isLoading = overviewDomain.status === 'loading';
  const suppressUnavailableError =
    overviewDomain.status === 'error' &&
    !isHydratedForCluster &&
    shouldSuppressClusterOverviewUnavailableError(lifecycleState, overviewDomain.error);
  const errorMessage =
    overviewDomain.status === 'error' && !isHydratedForCluster && !suppressUnavailableError
      ? overviewDomain.error
      : null;
  const showSkeleton =
    !errorMessage &&
    !isHydratedForCluster &&
    !suppressPassiveLoading &&
    (isSwitching ||
      isLoading ||
      overviewDomain.status === 'idle' ||
      suppressUnavailableError ||
      lifecycleState === undefined ||
      lifecycleState === 'connecting' ||
      lifecycleState === 'connected');

  useEffect(() => {
    // Skip scoped calls when no clusters are connected (scope is empty).
    if (!overviewScope) {
      return;
    }

    const enableOverview = () => {
      // preserveState is load-bearing for a STREAMING-registered domain: the
      // orchestrator's streaming enable path RESETS the scoped state when it
      // is absent, which blanked the overview on every cluster tab switch.
      setRefreshDomainEnabled({
        domain: 'cluster-overview',
        scope: overviewScope,
        enabled: canActivateOverviewRefresh,
        preserveState: true,
      });
    };

    // Clear local component state without touching the domain lifecycle.
    // The domain is kept running by useClusterMetricsAvailability so it
    // remains active across view switches.
    const clearLocalState = () => {
      setOverviewData(EMPTY_OVERVIEW);
      setIsHydrated(false);
      setIsSwitching(true);
    };

    enableOverview();

    if (typeof window !== 'undefined') {
      const handleKubeconfigChanging = () => {
        setIsSwitching(true);
        clearLocalState();
      };
      const handleKubeconfigChanged = () => {
        setIsSwitching(true);
        enableOverview();
      };

      const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
      const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);

      return () => {
        unsubChanging();
        unsubChanged();
      };
    }
  }, [canActivateOverviewRefresh, overviewScope]);

  const handlePodStatusNavigate = useCallback(
    (filter: PodStatusFilter, count: number) => {
      if (count <= 0) {
        return;
      }
      if (filter !== 'none') {
        if (selectedClusterId) {
          requestGridTableFilters({
            clusterId: selectedClusterId,
            destinationViewId: 'cluster-attention',
            filters: {
              ...DEFAULT_GRID_TABLE_FILTER_STATE,
              kinds: { mode: 'some', values: ['Pod'] },
              queryFacets: {
                findings: { mode: 'some', values: POD_ATTENTION_FINDINGS[filter] },
              },
            },
          });
        }
        setActiveClusterView('attention');
        navigateToClusterView('cluster');
        setSidebarSelection({ type: 'cluster', value: 'cluster' });
        return;
      }
      setSelectedNamespace(ALL_NAMESPACES_SCOPE);
      setActiveNamespaceTab('workloads');
      setSidebarSelection({ type: 'namespace', value: ALL_NAMESPACES_SCOPE });
      navigateToNamespace();
    },
    [
      navigateToClusterView,
      navigateToNamespace,
      selectedClusterId,
      setActiveClusterView,
      setActiveNamespaceTab,
      setSelectedNamespace,
      setSidebarSelection,
    ]
  );

  const handleClusterViewNavigate = useCallback(
    (view: ClusterViewType) => {
      setActiveClusterView(view);
      navigateToClusterView('cluster');
      setSidebarSelection({ type: 'cluster', value: 'cluster' });
    },
    [navigateToClusterView, setActiveClusterView, setSidebarSelection]
  );

  const podStatusItems = [
    {
      key: 'ready',
      label: 'ready',
      value: displayOverview.readyPods,
      variant: 'ready',
      filter: 'none' as const,
    },
    {
      key: 'starting',
      label: 'starting',
      value: displayOverview.startingPods,
      variant: 'starting',
      filter: 'starting' as const,
    },
    {
      key: 'failing',
      label: 'failing',
      value: displayOverview.failingPods,
      variant: 'failing',
      filter: 'failing' as const,
    },
    {
      key: 'terminating',
      label: 'terminating',
      value: displayOverview.terminatingPods,
      variant: 'terminating',
      filter: 'terminating' as const,
    },
  ];
  const podSignalItems = [
    {
      key: 'restarted',
      label: 'restarts',
      value: displayOverview.restartedPods,
      variant: 'restarted',
      filter: 'restarts' as const,
    },
    {
      key: 'not-ready',
      label: 'not ready',
      value: displayOverview.notReadyPods,
      variant: 'not-ready',
      filter: 'not-ready' as const,
    },
  ];
  const renderPodStatusCard = (item: {
    key: string;
    label: string;
    value: number;
    variant: string;
    filter: PodStatusFilter;
    clickable?: boolean;
  }) => {
    const clickable = item.clickable !== false && item.value > 0;
    const itemClass = `pod-status-card pod-status-card--${item.variant}${clickable ? ' pod-status-card--clickable' : ''}`;
    const content = (
      <>
        <span className="pod-status-card__count">
          {showSkeleton || podsUnavailable ? DASH : item.value}
        </span>
        <span className="pod-status-card__label" title={item.label}>
          {item.label}
        </span>
      </>
    );
    return clickable ? (
      <button
        type="button"
        key={item.key}
        className={itemClass}
        onClick={() => handlePodStatusNavigate(item.filter, item.value)}
        data-testid={`cluster-pod-status-${item.key}`}
      >
        {content}
      </button>
    ) : (
      <div key={item.key} className={itemClass} data-testid={`cluster-pod-status-${item.key}`}>
        {content}
      </div>
    );
  };

  const workloadItems = [
    {
      key: 'deployment',
      label: 'deployments',
      value: displayOverview.totalDeployments,
      variant: 'deployment',
    },
    {
      key: 'statefulset',
      label: 'statefulsets',
      value: displayOverview.totalStatefulSets,
      variant: 'statefulset',
    },
    {
      key: 'daemonset',
      label: 'daemonsets',
      value: displayOverview.totalDaemonSets,
      variant: 'daemonset',
    },
    {
      key: 'cronjob',
      label: 'cronjobs',
      value: displayOverview.totalCronJobs,
      variant: 'cronjob',
    },
  ];
  const workloadTotal = workloadItems.reduce((sum, item) => sum + item.value, 0);
  const workloadPct = (value: number) => (workloadTotal > 0 ? (value / workloadTotal) * 100 : 0);
  const workloadResourceUsage =
    displayOverview.workloadResourceUsage ?? EMPTY_OVERVIEW.workloadResourceUsage;
  const workloadUsageSources = [
    {
      key: 'deployment',
      label: 'deployments',
      variant: 'deployment',
      cpuUsage: clusterWorkloadUsageValue(workloadResourceUsage, 'deployments', 'cpu') ?? '0',
      memoryUsage: clusterWorkloadUsageValue(workloadResourceUsage, 'deployments', 'memory') ?? '0',
    },
    {
      key: 'statefulset',
      label: 'statefulsets',
      variant: 'statefulset',
      cpuUsage: clusterWorkloadUsageValue(workloadResourceUsage, 'statefulSets', 'cpu') ?? '0',
      memoryUsage:
        clusterWorkloadUsageValue(workloadResourceUsage, 'statefulSets', 'memory') ?? '0',
    },
    {
      key: 'daemonset',
      label: 'daemonsets',
      variant: 'daemonset',
      cpuUsage: clusterWorkloadUsageValue(workloadResourceUsage, 'daemonSets', 'cpu') ?? '0',
      memoryUsage: clusterWorkloadUsageValue(workloadResourceUsage, 'daemonSets', 'memory') ?? '0',
    },
    {
      key: 'job',
      label: 'jobs',
      variant: 'job',
      cpuUsage: clusterWorkloadUsageValue(workloadResourceUsage, 'jobs', 'cpu') ?? '0',
      memoryUsage: clusterWorkloadUsageValue(workloadResourceUsage, 'jobs', 'memory') ?? '0',
    },
  ];
  const cpuWorkloadUsageItems = workloadUsageSources.map((item) => ({
    ...item,
    usage: item.cpuUsage,
    value: calculateResourceMetrics({ usage: item.cpuUsage }, 'cpu').usage,
  }));
  const memoryWorkloadUsageItems = workloadUsageSources.map((item) => ({
    ...item,
    usage: item.memoryUsage,
    value: calculateResourceMetrics({ usage: item.memoryUsage }, 'memory').usage,
  }));
  const cpuWorkloadUsageTotal = cpuWorkloadUsageItems.reduce((sum, item) => sum + item.value, 0);
  const memoryWorkloadUsageTotal = memoryWorkloadUsageItems.reduce(
    (sum, item) => sum + item.value,
    0
  );
  // Sources the backend could not read for this identity (issue #244): each
  // affected card explains its own gap in place instead of rendering zeros.
  const unavailableResources = displayOverview.unavailableResources ?? [];
  const nodesUnavailable = unavailableResources.includes('core/nodes');
  const podsUnavailable = unavailableResources.includes('core/pods');
  const namespacesUnavailable = unavailableResources.includes('core/namespaces');

  // Metrics are permanently unavailable (metrics API forbidden, or metrics-server
  // absent) rather than merely still collecting. This is a restriction, so it
  // renders as an in-card notice below and suppresses the transient metrics pill.
  const metricsDisabled = !!metricsInfo?.disabled;

  // Standardized access-restriction notices: each affected card renders the
  // same callout (ClusterOverviewRestrictionNotice) so the reasons read
  // consistently and never truncate. Gated on !showSkeleton so restrictions
  // never flash while the first snapshot is still loading.
  const utilizationRestrictions: OverviewRestriction[] = [];
  const nodesRestrictions: OverviewRestriction[] = [];
  const workloadsRestrictions: OverviewRestriction[] = [];
  if (!showSkeleton) {
    if (nodesUnavailable) {
      utilizationRestrictions.push({
        key: 'capacity',
        headline: 'Capacity unavailable',
        detail:
          'Cluster capacity is unavailable, so utilization is measured against requests and limits. Requires Node permissions: list, watch.',
        testId: 'utilization-capacity-permission-chip',
      });
      nodesRestrictions.push({
        key: 'nodes',
        headline: 'Node details unavailable',
        detail:
          'Your account has insufficient access to node data. Requires Node permissions: list, watch.',
        testId: 'cluster-nodes-permission-note',
      });
    }
    if (podsUnavailable) {
      utilizationRestrictions.push({
        key: 'requests-limits',
        headline: 'Requests and limits unavailable',
        detail: 'Only current usage is shown. Requires Pod permissions: list, watch.',
        testId: 'utilization-requests-permission-chip',
      });
      workloadsRestrictions.push({
        key: 'pods',
        headline: 'Pod and container counts unavailable',
        detail:
          'Your account has insufficient access to pod data. Requires Pod permissions: list, watch.',
        testId: 'workloads-pods-permission-note',
      });
    }
    if (namespacesUnavailable) {
      workloadsRestrictions.push({
        key: 'namespaces',
        headline: 'Namespace count unavailable',
        detail:
          'Your account has insufficient access to namespaces. Requires Namespace permission: list.',
        testId: 'workloads-namespaces-permission-note',
      });
    }
    if (metricsDisabled) {
      const metricsReason = metricsInfo?.lastError?.trim();
      utilizationRestrictions.push({
        key: 'metrics',
        headline: 'Metrics unavailable',
        detail: metricsReason
          ? `Live CPU and memory usage cannot be shown. ${metricsReason}`
          : 'Live CPU and memory usage cannot be shown.',
        testId: 'utilization-metrics-permission-note',
      });
    }
  }

  const overviewResourceMetrics = clusterOverviewResourceMetrics(displayOverview, metricsInfo);
  const memoryResourceMetrics = calculateResourceMetrics(
    overviewResourceMetrics.memory ?? {},
    'memory'
  );
  const cpuResourceMetrics = calculateResourceMetrics(overviewResourceMetrics.cpu ?? {}, 'cpu');
  const formatPercent = (value: number) => `${value.toFixed(1)}%`;
  const percentClassName = (baseClass: string, value: number) =>
    value > 100 ? `${baseClass} ${baseClass}--warning` : baseClass;
  const formatCpuTooltipValue = (millicores: number) => {
    const cores = millicores / 1000;
    if (cores === 0) {
      return '0';
    }
    return cores.toFixed(2).replace(/\.?0+$/, '');
  };
  const formatResourceTooltipValue = (value: number, type: 'cpu' | 'memory') =>
    type === 'cpu' ? formatCpuTooltipValue(value) : formatMemoryValue(value);
  // Without node access the cluster's allocatable capacity is unknown, so the
  // summaries drop the "of <allocatable>" denominator and the utilization
  // percentages dash out below (calculateResourceMetrics would otherwise
  // silently rescale them against limits).
  const cpuUsageSummary = nodesUnavailable
    ? `${formatCpuValue(cpuResourceMetrics.usage)} used`
    : `${formatCpuValue(cpuResourceMetrics.usage)} of ${formatCpuValue(
        cpuResourceMetrics.allocatable
      )} cores`;
  const memoryUsageSummary = nodesUnavailable
    ? `${formatMemoryValue(memoryResourceMetrics.usage)} used`
    : `${formatMemoryValue(memoryResourceMetrics.usage)} of ${formatMemoryValue(
        memoryResourceMetrics.allocatable
      )}`;

  const renderResourceUtilizationTooltip = (
    type: 'cpu' | 'memory',
    metrics: ReturnType<typeof calculateResourceMetrics>
  ) => (
    <div
      className="resource-utilization-tooltip"
      data-testid={`resource-utilization-tooltip-${type}`}
    >
      {[
        {
          label: 'Utilization',
          value: metrics.usage,
          percent: metrics.usagePercent,
        },
        {
          label: 'Requests',
          value: metrics.request,
          percent: metrics.requestPercent,
        },
        {
          label: 'Limits',
          value: metrics.limit,
          percent: metrics.limitPercent,
        },
      ].map((row) => (
        <React.Fragment key={row.label}>
          <span className="resource-utilization-tooltip__label">{row.label}</span>
          <span className="resource-utilization-tooltip__value">
            {formatResourceTooltipValue(row.value, type)}
          </span>
          <span className={percentClassName('resource-utilization-tooltip__percent', row.percent)}>
            {nodesUnavailable ? DASH : formatPercent(row.percent)}
          </span>
        </React.Fragment>
      ))}
    </div>
  );

  const renderWorkloadUsageBreakdown = (
    testKey: string,
    total: number,
    items: Array<{
      key: string;
      label: string;
      variant: string;
      usage: string;
      value: number;
    }>
  ) => (
    <div className="resource-group workload-usage-breakdown">
      <div
        className="stacked-bar stacked-bar--workload-usage"
        role="presentation"
        aria-hidden="true"
      >
        {!showSkeleton &&
          items.map((item) => {
            const width = total > 0 ? (item.value / total) * 100 : 0;
            if (width <= 0) {
              return null;
            }
            return (
              <div
                key={item.key}
                className={`stacked-bar__segment stacked-bar__segment--${item.variant}`}
                style={{ width: `${width}%` }}
              />
            );
          })}
      </div>
      <div className="metric-legend">
        <div className="metric-legend__items">
          {items.map((item) => (
            <div
              key={item.key}
              className="metric-legend__item"
              aria-disabled={item.value === 0}
              data-testid={`cluster-workload-usage-${testKey}-${item.key}`}
            >
              <span
                className={`metric-legend__dot metric-legend__dot--${item.variant}`}
                aria-hidden="true"
              />
              <span className="metric-legend__count">{showSkeleton ? DASH : item.usage}</span>
              <span className="metric-legend__label">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const nodeHealthPhaseItems = [
    {
      key: 'ready',
      label: 'ready',
      value: displayOverview.readyNodes,
      variant: 'healthy',
    },
    {
      key: 'notReady',
      label: 'not ready',
      value: displayOverview.notReadyNodes,
      variant: 'failing',
    },
  ];
  const nodeCordonedItem = {
    key: 'cordoned',
    label: 'cordoned',
    value: displayOverview.cordonedNodes,
    variant: 'pending',
  };
  const nodeHealthTotal = displayOverview.readyNodes + displayOverview.notReadyNodes;
  const nodeHealthPct = (value: number) =>
    nodeHealthTotal > 0 ? (value / nodeHealthTotal) * 100 : 0;

  const recentEvents = displayOverview.recentEvents ?? [];

  const getRecentEventObjectRefInput = useCallback(
    (event: RecentEventEntry) => ({
      object:
        event.objectKind && event.objectName
          ? `${event.objectKind}/${event.objectName}`
          : undefined,
      objectUid: event.objectUid,
      objectApiVersion: event.objectApiVersion,
      objectNamespace: event.objectNamespace || undefined,
      clusterId: event.clusterId ?? selectedClusterId ?? undefined,
      clusterName: event.clusterName ?? selectedClusterName ?? undefined,
    }),
    [selectedClusterId, selectedClusterName]
  );

  const canOpenRecentEventObject = useCallback(
    (event: RecentEventEntry) =>
      canResolveEventObjectReference(getRecentEventObjectRefInput(event)),
    [getRecentEventObjectRefInput]
  );

  const handleRecentEventOpen = useCallback(
    async (event: RecentEventEntry) => {
      const ref = await resolveEventObjectReference(getRecentEventObjectRefInput(event));
      if (!ref) {
        return;
      }
      openWithObject(ref);
      // Clicking an event should land on the Events tab for the involved object.
      // The panel id is deterministic from the hydrated ref, so we can compute it
      // and set the active tab for the panel openWithObject just created.
      const panelId = objectPanelId(hydrateClusterMeta(ref));
      setObjectPanelActiveTab(panelId, 'events');
    },
    [getRecentEventObjectRefInput, hydrateClusterMeta, openWithObject, setObjectPanelActiveTab]
  );

  const renderNodeHealthLegendItem = (item: {
    key: string;
    label: string;
    value: number;
    variant: string;
  }) => {
    const clickable = item.key !== 'ready' && item.value > 0 && !showSkeleton && !nodesUnavailable;
    const content = (
      <>
        <span
          className={`metric-legend__dot metric-legend__dot--${item.variant}`}
          aria-hidden="true"
        />
        <span className="metric-legend__count">
          {showSkeleton || nodesUnavailable ? DASH : item.value}
        </span>
        <span className="metric-legend__label">{item.label}</span>
      </>
    );
    return clickable ? (
      <button
        type="button"
        key={item.key}
        className="metric-legend__item metric-legend__item--clickable cluster-overview__node-link"
        onClick={() => handleClusterViewNavigate('nodes')}
        data-testid={`cluster-node-health-${item.key}`}
      >
        {content}
      </button>
    ) : (
      <div
        key={item.key}
        className="metric-legend__item"
        aria-disabled={item.value === 0}
        data-testid={`cluster-node-health-${item.key}`}
      >
        {content}
      </div>
    );
  };

  // Before the initial snapshot arrives we don't have real values yet —
  // render a dash placeholder instead of zeros so the UI reads as "loading"
  // without surfacing misleading "0" values.
  const DASH = '—';

  return (
    <div className="cluster-overview selectable">
      <div className="overview-top">
        <div className="overview-top__info">
          <h1 className="overview-top__title">{contextLabel}</h1>
          <div className="cluster-info">
            <span className="cluster-info-item">
              <span className="cluster-info-label">Cluster Type</span>
              <span className="cluster-info-value">
                {showSkeleton ? '—' : displayOverview.clusterType || 'Unknown'}
              </span>
            </span>
            <span className="cluster-info-item">
              <span className="cluster-info-label">Version</span>
              <span className="cluster-info-value">
                {showSkeleton ? '—' : displayOverview.clusterVersion || 'Unknown'}
              </span>
            </span>
            {!!overviewStatus.summary && (
              <span className="cluster-info-item">
                <span className="cluster-info-label">Status</span>
                <span className={`cluster-info-value cluster-info-value--${overviewStatus.status}`}>
                  {overviewStatus.summary}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="overview-top__hero">
          <img
            src={captainK8s}
            alt="Captain K8s"
            className="captain-k8s-small"
            width={1024}
            height={1024}
          />
          <img src={logo} alt="Luxury Yacht" className="logo-small" width={827} height={500} />
        </div>
      </div>

      {!!errorMessage && (
        <div className="cluster-overview-loading-inline">
          <ClusterOverviewRestrictionNotice
            restrictions={[
              {
                key: 'load-error',
                headline: 'Failed to load Cluster Overview data',
                detail: errorMessage,
              },
            ]}
          />
        </div>
      )}

      <div className="overview-grid">
        <div className="overview-section resource-usage">
          {/* Header row: the transient metrics-collection indicator sits in the
              card's upper right so its presence never shifts the utilization
              content below. Access restrictions render in the standardized
              notice beneath the header instead. */}
          <div className="overview-section-header">
            <h2>Resource Utilization</h2>
            {metricsBanner && !errorMessage && !metricsDisabled && (
              <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
                <span className="metrics-warning-banner__dot" />
                <span className="metrics-warning-banner__text">{metricsBanner.message}</span>
              </div>
            )}
          </div>

          <ClusterOverviewRestrictionNotice restrictions={utilizationRestrictions} />

          <div className="resource-group">
            <div className="metric-header metric-header--usage">
              <div className="metric-header__title-group">
                <h3>CPU</h3>
                <span className="metric-header__usage">
                  {showSkeleton ? DASH : (cpuUsageSummary ?? '')}
                </span>
              </div>
              <div
                className={percentClassName(
                  'metric-header__percent',
                  cpuResourceMetrics.usagePercent
                )}
              >
                {showSkeleton || nodesUnavailable
                  ? DASH
                  : formatPercent(cpuResourceMetrics.usagePercent)}
              </div>
            </div>
            <Tooltip
              content={renderResourceUtilizationTooltip('cpu', cpuResourceMetrics)}
              placement="top"
              minWidth={220}
              inline={false}
              disabled={showSkeleton}
            >
              <div className="resource-bar-placeholder">
                <ResourceBar
                  usage={clusterOverviewCpuValue(displayOverview, 'usage')}
                  request={clusterOverviewCpuValue(displayOverview, 'request')}
                  limit={clusterOverviewCpuValue(displayOverview, 'limit')}
                  allocatable={clusterOverviewCpuValue(displayOverview, 'allocatable')}
                  type="cpu"
                  variant="default"
                />
              </div>
            </Tooltip>
          </div>

          {renderWorkloadUsageBreakdown('cpu', cpuWorkloadUsageTotal, cpuWorkloadUsageItems)}

          <div className="resource-utilization-divider" />

          <div className="resource-group">
            <div className="metric-header metric-header--usage">
              <div className="metric-header__title-group">
                <h3>Memory</h3>
                <span className="metric-header__usage">
                  {showSkeleton ? DASH : (memoryUsageSummary ?? '')}
                </span>
              </div>
              <div
                className={percentClassName(
                  'metric-header__percent',
                  memoryResourceMetrics.usagePercent
                )}
              >
                {showSkeleton || nodesUnavailable
                  ? DASH
                  : formatPercent(memoryResourceMetrics.usagePercent)}
              </div>
            </div>
            <Tooltip
              content={renderResourceUtilizationTooltip('memory', memoryResourceMetrics)}
              placement="top"
              minWidth={220}
              inline={false}
              disabled={showSkeleton}
            >
              <div className="resource-bar-placeholder">
                <ResourceBar
                  usage={clusterOverviewMemoryValue(displayOverview, 'usage')}
                  request={clusterOverviewMemoryValue(displayOverview, 'request')}
                  limit={clusterOverviewMemoryValue(displayOverview, 'limit')}
                  allocatable={clusterOverviewMemoryValue(displayOverview, 'allocatable')}
                  type="memory"
                  variant="default"
                />
              </div>
            </Tooltip>
          </div>

          {renderWorkloadUsageBreakdown(
            'memory',
            memoryWorkloadUsageTotal,
            memoryWorkloadUsageItems
          )}

          <div className="utilization-legend">
            <button
              type="button"
              className="utilization-legend__toggle"
              aria-expanded={legendExpanded}
              onClick={() => setLegendExpanded((expanded) => !expanded)}
              data-testid="utilization-legend-toggle"
            >
              <span
                className={`utilization-legend__chevron${
                  legendExpanded ? ' utilization-legend__chevron--open' : ''
                }`}
                aria-hidden="true"
              />
              Legend
            </button>
            {!!legendExpanded && (
              <div className="utilization-legend__items" data-testid="utilization-legend">
                <div className="utilization-legend__item">
                  <span className="utilization-legend__swatch utilization-legend__swatch--usage-normal" />
                  <span>Usage below {USAGE_HIGH_THRESHOLD_PERCENT}%</span>
                </div>
                <div className="utilization-legend__item">
                  <span className="utilization-legend__swatch utilization-legend__swatch--usage-high" />
                  <span>
                    Usage at {USAGE_HIGH_THRESHOLD_PERCENT}–{USAGE_CRITICAL_THRESHOLD_PERCENT}%
                  </span>
                </div>
                <div className="utilization-legend__item">
                  <span className="utilization-legend__swatch utilization-legend__swatch--usage-critical" />
                  <span>Usage above {USAGE_CRITICAL_THRESHOLD_PERCENT}%</span>
                </div>
                <div className="utilization-legend__footnote">
                  Thresholds derived from requests/limits when node capacity is unavailable.
                </div>
                <div className="utilization-legend__item">
                  <span className="utilization-legend__swatch utilization-legend__swatch--reserved" />
                  <span>Requested but currently unused</span>
                </div>
                <div className="utilization-legend__item">
                  <span className="utilization-legend__swatch utilization-legend__swatch--overlimit" />
                  <span>Usage above total limits</span>
                </div>
                <div className="utilization-legend__item">
                  <span className="utilization-legend__swatch utilization-legend__swatch--request-marker" />
                  <span>Total requests marker</span>
                </div>
                <div className="utilization-legend__item">
                  <span className="utilization-legend__swatch utilization-legend__swatch--limit-marker" />
                  <span>Total limits marker</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="overview-section nodes-summary">
          <h2>Nodes</h2>
          <ClusterOverviewRestrictionNotice restrictions={nodesRestrictions} />
          <div className="metric-stats">
            <div className="metric-stat" data-testid="cluster-nodes-total">
              <span className="metric-stat__count">
                {showSkeleton || nodesUnavailable ? DASH : displayOverview.totalNodes}
              </span>
              <span className="metric-stat__label">total</span>
            </div>
            {displayOverview.clusterType === 'EKS' && (
              <>
                <div className="metric-stat" data-testid="cluster-nodes-ec2">
                  <span className="metric-stat__count">
                    {showSkeleton || nodesUnavailable ? DASH : displayOverview.ec2Nodes}
                  </span>
                  <span className="metric-stat__label">ec2</span>
                </div>
                <div className="metric-stat" data-testid="cluster-nodes-fargate">
                  <span className="metric-stat__count">
                    {showSkeleton || nodesUnavailable ? DASH : displayOverview.fargateNodes}
                  </span>
                  <span className="metric-stat__label">fargate</span>
                </div>
              </>
            )}
            {displayOverview.clusterType === 'AKS' && (
              <>
                <div className="metric-stat" data-testid="cluster-nodes-vm">
                  <span className="metric-stat__count">
                    {showSkeleton || nodesUnavailable ? DASH : displayOverview.vmNodes}
                  </span>
                  <span className="metric-stat__label">vm</span>
                </div>
                <div className="metric-stat" data-testid="cluster-nodes-virtual">
                  <span className="metric-stat__count">
                    {showSkeleton || nodesUnavailable ? DASH : displayOverview.virtualNodes}
                  </span>
                  <span className="metric-stat__label">virtual</span>
                </div>
              </>
            )}
          </div>

          <div className="node-health">
            <div className="metric-header">
              <h3>Node Health</h3>
              <div className="metric-legend__total">
                <span className="metric-legend__total-value">
                  {showSkeleton || nodesUnavailable ? DASH : displayOverview.totalNodes}
                </span>
                <span className="metric-legend__total-label"> total</span>
              </div>
            </div>
            <div className="stacked-bar" role="presentation" aria-hidden="true">
              {!showSkeleton &&
                nodeHealthPhaseItems.map((item) => {
                  const width = nodeHealthPct(item.value);
                  if (width <= 0) {
                    return null;
                  }
                  return (
                    <div
                      key={item.key}
                      className={`stacked-bar__segment stacked-bar__segment--${item.variant}`}
                      style={{ width: `${width}%` }}
                    />
                  );
                })}
            </div>
            <div className="metric-legend">
              <div className="metric-legend__items">
                {nodeHealthPhaseItems.map((item) => renderNodeHealthLegendItem(item))}
              </div>
              <div className="metric-legend__items metric-legend__items--restarted">
                {renderNodeHealthLegendItem(nodeCordonedItem)}
              </div>
            </div>
          </div>
        </div>

        <div className="overview-section workloads-summary">
          <h2>Workloads</h2>
          <ClusterOverviewRestrictionNotice restrictions={workloadsRestrictions} />
          <div className="metric-stats">
            <div className="metric-stat" data-testid="cluster-workloads-namespaces">
              <span className="metric-stat__count">
                {showSkeleton || namespacesUnavailable ? DASH : displayOverview.totalNamespaces}
              </span>
              <span className="metric-stat__label">namespaces</span>
            </div>
            <div className="metric-stat" data-testid="cluster-workloads-pods">
              <span className="metric-stat__count">
                {showSkeleton || podsUnavailable ? DASH : displayOverview.totalPods}
              </span>
              <span className="metric-stat__label">pods</span>
            </div>
            <div className="metric-stat" data-testid="cluster-workloads-containers">
              <span className="metric-stat__count">
                {showSkeleton || podsUnavailable ? DASH : displayOverview.totalContainers}
              </span>
              <span className="metric-stat__label">containers</span>
            </div>
          </div>

          <div className="workload-breakdown">
            <div className="metric-header">
              <h3>By Type</h3>
              <div className="metric-legend__total">
                <span className="metric-legend__total-value">
                  {showSkeleton ? DASH : String(workloadTotal)}
                </span>
                <span className="metric-legend__total-label"> total</span>
              </div>
            </div>
            <div className="stacked-bar" role="presentation" aria-hidden="true">
              {!showSkeleton &&
                workloadItems.map((item) => {
                  const width = workloadPct(item.value);
                  if (width <= 0) {
                    return null;
                  }
                  return (
                    <div
                      key={item.key}
                      className={`stacked-bar__segment stacked-bar__segment--${item.variant}`}
                      style={{ width: `${width}%` }}
                    />
                  );
                })}
            </div>
            <div className="metric-legend">
              <div className="metric-legend__items">
                {workloadItems.map((item) => (
                  <div
                    key={item.key}
                    className="metric-legend__item"
                    aria-disabled={item.value === 0}
                    data-testid={`cluster-workload-${item.key}`}
                  >
                    <span
                      className={`metric-legend__dot metric-legend__dot--${item.variant}`}
                      aria-hidden="true"
                    />
                    <span className="metric-legend__count">{showSkeleton ? DASH : item.value}</span>
                    <span className="metric-legend__label">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pod-status">
            <div className="pod-status-groups">
              <div className="pod-status-group">
                <div className="metric-header">
                  <h3>Pod Status</h3>
                  <div className="metric-legend__total">
                    <span className="metric-legend__total-value">
                      {showSkeleton || podsUnavailable ? DASH : displayOverview.totalPods}
                    </span>
                    <span className="metric-legend__total-label"> total</span>
                  </div>
                </div>
                <div className="pod-status-cards">
                  {podStatusItems.map((item) => renderPodStatusCard(item))}
                </div>
              </div>
              <div className="pod-status-group">
                <div className="metric-header">
                  <h3>Pod Signals</h3>
                </div>
                <div className="pod-status-cards pod-status-cards--signals">
                  {podSignalItems.map((item) => renderPodStatusCard(item))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="overview-section recent-events">
          <div className="section-header">
            <h2>Latest Warning Events</h2>
            <span className="section-header__count">
              {recentEvents.length} {recentEvents.length === 1 ? 'event' : 'events'}
            </span>
          </div>
          {recentEvents.length === 0 ? (
            <div className="recent-events__empty">
              {showSkeleton ? '' : 'No warning events in the last 24 hours.'}
            </div>
          ) : (
            <ul className="recent-events__list">
              {recentEvents.map((event) => {
                const clickable = canOpenRecentEventObject(event);
                const rowClass = `recent-events__row${
                  clickable ? ' recent-events__row--clickable' : ''
                }`;
                const content = (
                  <>
                    <LiveAgeText timestamp={event.timestamp} className="recent-events__age" />
                    <span className="recent-events__reason">{event.reason}</span>
                    <span className="recent-events__message">{event.message}</span>
                  </>
                );
                return (
                  <li key={event.eventUid}>
                    {clickable ? (
                      <button
                        type="button"
                        className={rowClass}
                        onClick={() => void handleRecentEventOpen(event)}
                        title={`${event.objectKind}/${event.objectName}${
                          event.objectNamespace ? ` · ${event.objectNamespace}` : ''
                        }`}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className={rowClass}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClusterOverview;
