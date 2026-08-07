/**
 * frontend/src/modules/cluster/components/ClusterOverview.tsx
 *
 * Module source for ClusterOverview.
 * Displays an overview of the connected Kubernetes cluster, including resource usage,
 * node and workload summaries, and pod status with navigation links.
 */

import { calculateResourceMetrics } from '@shared/utils/resourceCalculations';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { setRefreshDomainEnabled } from '@/core/data-access';
import { eventBus } from '@/core/events';
import { useRefreshScopedDomain } from '@/core/refresh';
import { canActivateClusterOverviewRefresh } from '@/core/refresh/clusterOverviewLifecycle';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useStreamSignalRefetch } from '@/core/refresh/hooks/useStreamSignalRefetch';
import type { ClusterOverviewPayload } from '@/core/refresh/types';
import './ClusterOverview.css';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useMetricsBannerInfo } from '@shared/hooks/useMetricsBannerInfo';
import { buildConnectivityPresentation } from '@/core/connection/connectivityPresentation';
import { useActiveClusterAuthState } from '@/core/contexts/AuthErrorContext';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { clusterOverviewResourceMetrics } from '@/core/resource-metrics';
import { useClusterHealthListener } from '@/hooks/useWailsRuntimeEvents';
import { ClusterOverviewView, type OverviewPodStatusItem } from './ClusterOverviewView';
import {
  buildOverviewDisplayState,
  buildOverviewRestrictions,
  buildResourceUsageSummaries,
  buildWorkloadUsagePresentation,
  getClusterContextLabel,
  selectClusterScopedValue,
} from './clusterOverviewModel';
import { useClusterOverviewNavigation } from './useClusterOverviewNavigation';
import { useRecentClusterOverviewEvents } from './useRecentClusterOverviewEvents';

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

const ClusterOverview: React.FC<ClusterOverviewProps> = ({ clusterContext }) => {
  const contextLabel = useMemo(() => getClusterContextLabel(clusterContext), [clusterContext]);

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
  const metricsInfo = useMemo(
    () =>
      selectClusterScopedValue({
        byCluster: overviewDomain.data?.metricsByCluster,
        legacyValue: overviewDomain.data?.metrics,
        payloadClusterId: overviewDomain.data?.clusterId,
        selectedClusterId,
        hydratedClusterId,
      }),
    [
      hydratedClusterId,
      overviewDomain.data?.clusterId,
      overviewDomain.data?.metrics,
      overviewDomain.data?.metricsByCluster,
      selectedClusterId,
    ]
  );
  const metricsBanner = useMetricsBannerInfo(metricsInfo);
  const navigation = useViewState();

  const selectedOverview = useMemo(
    () =>
      selectClusterScopedValue({
        byCluster: overviewDomain.data?.overviewByCluster,
        legacyValue: overviewDomain.data?.overview,
        payloadClusterId: overviewDomain.data?.clusterId,
        selectedClusterId,
        hydratedClusterId,
      }),
    [
      hydratedClusterId,
      overviewDomain.data?.clusterId,
      overviewDomain.data?.overview,
      overviewDomain.data?.overviewByCluster,
      selectedClusterId,
    ]
  );

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

  const { displayOverview, errorMessage, showSkeleton } = buildOverviewDisplayState({
    overviewData,
    emptyOverview: EMPTY_OVERVIEW,
    isHydrated,
    hydratedClusterId,
    selectedClusterId,
    isSwitching,
    domainStatus: overviewDomain.status,
    domainError: overviewDomain.error,
    suppressPassiveLoading,
    lifecycleState,
  });

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

  const { handlePodStatusNavigate, handleClusterViewNavigate } = useClusterOverviewNavigation({
    selectedClusterId,
    setSelectedNamespace,
    navigation,
  });

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
  const {
    cpuItems: cpuWorkloadUsageItems,
    memoryItems: memoryWorkloadUsageItems,
    cpuTotal: cpuWorkloadUsageTotal,
    memoryTotal: memoryWorkloadUsageTotal,
  } = buildWorkloadUsagePresentation(displayOverview, EMPTY_OVERVIEW);
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

  const {
    utilization: utilizationRestrictions,
    nodes: nodesRestrictions,
    workloads: workloadsRestrictions,
  } = buildOverviewRestrictions({
    showSkeleton,
    nodesUnavailable,
    podsUnavailable,
    namespacesUnavailable,
    metricsInfo,
  });

  const overviewResourceMetrics = clusterOverviewResourceMetrics(displayOverview, metricsInfo);
  const memoryResourceMetrics = calculateResourceMetrics(
    overviewResourceMetrics.memory ?? {},
    'memory'
  );
  const cpuResourceMetrics = calculateResourceMetrics(overviewResourceMetrics.cpu ?? {}, 'cpu');
  // Without node access the cluster's allocatable capacity is unknown, so the
  // summaries drop the "of <allocatable>" denominator and the utilization
  // percentages dash out below (calculateResourceMetrics would otherwise
  // silently rescale them against limits).
  const { cpu: cpuUsageSummary, memory: memoryUsageSummary } = buildResourceUsageSummaries({
    cpuMetrics: cpuResourceMetrics,
    memoryMetrics: memoryResourceMetrics,
    nodesUnavailable,
  });

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

  const recentEvents = displayOverview.recentEvents ?? [];

  const { canOpen: canOpenRecentEventObject, onOpen: handleRecentEventOpen } =
    useRecentClusterOverviewEvents({
      selectedClusterId,
      selectedClusterName,
      openWithObject,
      hydrateClusterMeta,
      setObjectPanelActiveTab,
    });

  return (
    <ClusterOverviewView
      contextLabel={contextLabel}
      overview={displayOverview}
      overviewStatus={overviewStatus}
      showSkeleton={showSkeleton}
      errorMessage={errorMessage ?? null}
      resources={{
        metricsBanner,
        metricsDisabled,
        restrictions: utilizationRestrictions,
        nodesUnavailable,
        cpuMetrics: cpuResourceMetrics,
        memoryMetrics: memoryResourceMetrics,
        cpuUsageSummary,
        memoryUsageSummary,
        cpuWorkloadUsageItems,
        memoryWorkloadUsageItems,
        cpuWorkloadUsageTotal,
        memoryWorkloadUsageTotal,
        legendExpanded,
        onToggleLegend: () => setLegendExpanded((expanded) => !expanded),
      }}
      nodes={{
        unavailable: nodesUnavailable,
        restrictions: nodesRestrictions,
        healthItems: nodeHealthPhaseItems,
        cordonedItem: nodeCordonedItem,
        healthTotal: nodeHealthTotal,
        onNavigate: () => handleClusterViewNavigate('nodes'),
      }}
      workloads={{
        namespacesUnavailable,
        podsUnavailable,
        restrictions: workloadsRestrictions,
        workloadItems,
        workloadTotal,
        podStatusItems,
        podSignalItems,
        onPodStatusNavigate: (item: OverviewPodStatusItem) =>
          handlePodStatusNavigate(item.filter, item.value),
      }}
      recentEvents={{
        events: recentEvents,
        canOpen: canOpenRecentEventObject,
        onOpen: (event) => {
          void handleRecentEventOpen(event);
        },
      }}
    />
  );
};

export default ClusterOverview;
