/**
 * frontend/src/modules/cluster/components/ClusterOverview.tsx
 *
 * Module source for ClusterOverview.
 * Displays an overview of the connected Kubernetes cluster, including resource usage,
 * node and workload summaries, and pod status with navigation links.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ResourceBar from '@shared/components/ResourceBar';
import { readAppInfo, requestAppState } from '@/core/app-state-access';
import { requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { eventBus } from '@/core/events';
import type { ClusterOverviewPayload } from '@/core/refresh/types';
import logo from '@assets/luxury-yacht-logo.png';
import captainK8s from '@assets/captain-k8s-color.png';
import './ClusterOverview.css';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { emitPodsUnhealthySignal } from '@modules/namespace/components/podsFilterSignals';
import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { backend } from '@wailsjs/go/models';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useClusterHealthListener } from '@/hooks/useWailsRuntimeEvents';
import { useActiveClusterAuthState } from '@/core/contexts/AuthErrorContext';
import { buildConnectivityPresentation } from '@/core/connection/connectivityPresentation';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { formatAge } from '@/utils/ageFormatter';
import { parseApiVersion } from '@shared/constants/builtinGroupVersions';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import type { RecentEventEntry } from '@/core/refresh/types';

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
  restartedPods: 0,
  totalNamespaces: 0,
  totalDeployments: 0,
  totalStatefulSets: 0,
  totalDaemonSets: 0,
  totalCronJobs: 0,
  readyNodes: 0,
  notReadyNodes: 0,
  cordonedNodes: 0,
  recentEvents: [],
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
  const { getClusterState } = useClusterLifecycle();
  const { getActiveClusterHealth } = useClusterHealthListener(selectedClusterId);
  const authState = useActiveClusterAuthState(selectedClusterId);
  const { namespaceReady, setSelectedNamespace } = useNamespace();
  const { isPaused, suppressPassiveLoading } = useAutoRefreshLoadingState();
  const lifecycleState = selectedClusterId ? getClusterState(selectedClusterId) : '';

  // Cluster Overview is a foreground per-cluster page, so it must never
  // reuse a multi-cluster overview scope from other selected tabs.
  const overviewScope = useMemo(
    () => buildClusterScope(selectedClusterId ?? undefined, ''),
    [selectedClusterId]
  );
  const overviewDomain = useRefreshScopedDomain('cluster-overview', overviewScope);
  const health = getActiveClusterHealth();
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
  const [isHydrated, setIsHydrated] = useState(false);
  const [hydratedClusterId, setHydratedClusterId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
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
  const metricsBanner = useMemo(() => getMetricsBannerInfo(metricsInfo), [metricsInfo]);
  const { setActiveNamespaceTab, setSidebarSelection, navigateToNamespace } = useViewState();

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
      // Clear cached data when switching tabs so the new cluster shows loading shimmers.
      setOverviewData(EMPTY_OVERVIEW);
      setIsHydrated(false);
      setIsSwitching(true);
    }
  }, [hydratedClusterId, selectedClusterId, selectedOverview]);

  useEffect(() => {
    let isActive = true;
    requestAppState({
      resource: 'app-info',
      read: () => readAppInfo(),
    })
      .then((info) => {
        if (!isActive) {
          return;
        }
        const withUpdate = info as AppInfoWithUpdate;
        setUpdateInfo(withUpdate.update ?? null);
      })
      .catch(() => {
        // Silent fallback if update metadata cannot be fetched.
      });
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }
    const handleUpdate = (...args: unknown[]) => {
      const payload = args[0] as UpdateInfo | undefined;
      if (!payload) {
        return;
      }
      // Event payload is the latest update metadata from the backend.
      setUpdateInfo(payload);
    };
    runtime.EventsOn('app-update', handleUpdate);
    return () => {
      runtime.EventsOff?.('app-update', handleUpdate);
    };
  }, []);

  const isHydratedForCluster = isHydrated && hydratedClusterId === selectedClusterId;
  const displayOverview = isHydratedForCluster ? overviewData : EMPTY_OVERVIEW;
  const isLoading = overviewDomain.status === 'loading';
  const errorMessage =
    overviewDomain.status === 'error' && !isHydratedForCluster ? overviewDomain.error : null;
  const showSkeleton =
    !errorMessage &&
    !isHydratedForCluster &&
    !suppressPassiveLoading &&
    (isSwitching || isLoading || overviewDomain.status === 'idle');

  useEffect(() => {
    // Skip scoped calls when no clusters are connected (scope is empty).
    if (!overviewScope) {
      return;
    }

    const enableOverview = () => {
      refreshOrchestrator.setScopedDomainEnabled('cluster-overview', overviewScope, true);
      requestRefreshDomain({
        domain: 'cluster-overview',
        scope: overviewScope,
        reason: 'startup',
      }).catch(() => {
        setOverviewData(EMPTY_OVERVIEW);
        setIsHydrated(false);
        setIsSwitching(true);
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
        clearLocalState();
        unsubChanging();
        unsubChanged();
      };
    }

    return () => {
      clearLocalState();
    };
  }, [overviewScope]);

  const handlePodStatusNavigate = useCallback(
    (key: string, count: number) => {
      if (count <= 0) {
        return;
      }
      setSelectedNamespace(ALL_NAMESPACES_SCOPE);
      setActiveNamespaceTab('pods');
      setSidebarSelection({ type: 'namespace', value: ALL_NAMESPACES_SCOPE });
      navigateToNamespace();
      if (key !== 'healthy' && selectedClusterId) {
        emitPodsUnhealthySignal(selectedClusterId, ALL_NAMESPACES_SCOPE);
      }
    },
    [
      navigateToNamespace,
      selectedClusterId,
      setActiveNamespaceTab,
      setSelectedNamespace,
      setSidebarSelection,
    ]
  );

  const handlePodStatusKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, key: string, count: number) => {
      if (count <= 0) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handlePodStatusNavigate(key, count);
      }
    },
    [handlePodStatusNavigate]
  );

  // "Healthy" groups pods in the Running and Succeeded phases — CronJob-launched
  // pods end up Succeeded, so counting only Running would understate the count.
  const healthyPods = displayOverview.runningPods + displayOverview.succeededPods;
  const podPhaseItems = [
    { key: 'healthy', label: 'healthy', value: healthyPods, variant: 'healthy' },
    { key: 'pending', label: 'pending', value: displayOverview.pendingPods, variant: 'pending' },
    { key: 'failed', label: 'failing', value: displayOverview.failedPods, variant: 'failing' },
  ];
  const podRestartedItem = {
    key: 'restarted',
    label: 'restarted',
    value: displayOverview.restartedPods,
    variant: 'restarted',
  };

  const renderPodPhaseLegendItem = (item: {
    key: string;
    label: string;
    value: number;
    variant: string;
  }) => {
    const clickable = item.value > 0;
    const itemClass = `metric-legend__item${
      clickable ? ' metric-legend__item--clickable' : ''
    }`;
    return (
      <div
        key={item.key}
        className={itemClass}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => handlePodStatusNavigate(item.key, item.value) : undefined}
        onKeyDown={
          clickable ? (event) => handlePodStatusKeyDown(event, item.key, item.value) : undefined
        }
        aria-disabled={!clickable}
        data-testid={`cluster-pod-status-${item.key}`}
      >
        <span
          className={`metric-legend__dot metric-legend__dot--${item.variant}`}
          aria-hidden="true"
        />
        <span className={`metric-legend__count${skeletonTextClass}`}>{item.value}</span>
        <span className="metric-legend__label">{item.label}</span>
      </div>
    );
  };

  // Phase-only total for bar segment widths (restarted overlaps with running,
  // so including it would double-count).
  const phaseTotal = healthyPods + displayOverview.pendingPods + displayOverview.failedPods;
  const phasePct = (value: number) => (phaseTotal > 0 ? (value / phaseTotal) * 100 : 0);
  const phaseSegments = [
    { key: 'healthy', value: healthyPods },
    { key: 'pending', value: displayOverview.pendingPods },
    { key: 'failing', value: displayOverview.failedPods },
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
  const workloadPct = (value: number) => (workloadTotal > 0 ? (value / workloadTotal) * 100 : 0);

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

  const handleRecentEventOpen = useCallback(
    (event: RecentEventEntry) => {
      const { group, version } = parseApiVersion(event.objectApiVersion);
      openWithObject({
        clusterId: event.clusterId ?? selectedClusterId ?? undefined,
        clusterName: event.clusterName ?? selectedClusterName ?? undefined,
        kind: event.objectKind,
        name: event.objectName,
        namespace: event.objectNamespace || undefined,
        group: group ?? '',
        version: version ?? '',
      });
    },
    [openWithObject, selectedClusterId, selectedClusterName]
  );

  const renderNodeHealthLegendItem = (item: {
    key: string;
    label: string;
    value: number;
    variant: string;
  }) => (
    <div
      key={item.key}
      className="metric-legend__item"
      aria-disabled={item.value === 0}
      data-testid={`cluster-node-health-${item.key}`}
    >
      <span
        className={`metric-legend__dot metric-legend__dot--${item.variant}`}
        aria-hidden="true"
      />
      <span className={`metric-legend__count${skeletonTextClass}`}>{item.value}</span>
      <span className="metric-legend__label">{item.label}</span>
    </div>
  );

  const rootClassName = ['cluster-overview', showSkeleton ? 'is-skeleton' : '']
    .filter(Boolean)
    .join(' ');
  const skeletonBlockClass = showSkeleton ? ' skeleton-block' : '';
  const skeletonTextClass = showSkeleton ? ' skeleton-text' : '';
  const showUpdateBanner = Boolean(updateInfo?.isUpdateAvailable && updateInfo?.releaseUrl);
  const handleUpdateClick = useCallback(() => {
    if (!updateInfo?.releaseUrl) {
      return;
    }
    // Open the update release page when the notice is activated.
    BrowserOpenURL(updateInfo.releaseUrl);
  }, [updateInfo]);

  return (
    <div className={rootClassName}>
      <div className="overview-hero">
        <img src={captainK8s} alt="Captain K8s" className="captain-k8s-small" />
        <img src={logo} alt="Luxury Yacht" className="logo-small" />
      </div>

      {showUpdateBanner && (
        <div className="overview-update-banner-wrap">
          <button type="button" className="overview-update-banner" onClick={handleUpdateClick}>
            <div className="overview-update-text">
              <span className="overview-update-meta">
                {updateInfo?.latestVersion ? ` ${updateInfo.latestVersion}` : ''} update available!
                Click here to go to the downloads page.
              </span>
            </div>
          </button>
        </div>
      )}

      <div className="overview-section cluster-header">
        <div className="overview-header">
          <h1>Cluster Overview</h1>
          <div className="cluster-info">
            <span className="cluster-info-item">
              <span className="cluster-info-label">Type:</span>
              <span className={`cluster-info-value${skeletonTextClass}`}>
                {displayOverview.clusterType || 'Unknown'}
              </span>
            </span>
            <span className="cluster-info-separator">·</span>
            <span className="cluster-info-item">
              <span className="cluster-info-label">Version:</span>
              <span className={`cluster-info-value${skeletonTextClass}`}>
                {displayOverview.clusterVersion || 'Unknown'}
              </span>
            </span>
            <span className="cluster-info-separator">·</span>
            <span className="cluster-info-item">
              <span className="cluster-info-label">Context:</span>
              <span className="cluster-info-value">{contextLabel}</span>
            </span>
            {overviewStatus.summary && (
              <>
                <span className="cluster-info-separator">·</span>
                <span className="cluster-info-item">
                  <span className="cluster-info-label">Status:</span>
                  <span
                    className={`cluster-info-value cluster-info-value--${overviewStatus.status}`}
                  >
                    {overviewStatus.summary}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
        {errorMessage && (
          <div className="cluster-overview-loading-inline">
            <div className="cluster-overview-error">
              <span className="error-icon">⚠️</span>
              <div>Failed to load cluster overview</div>
              <div className="error-detail">{errorMessage}</div>
            </div>
          </div>
        )}
      </div>

      <div className="overview-grid">
        <div className="overview-section resource-usage">
          <h2>Resource Usage</h2>
          {metricsBanner && !errorMessage && (
            <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
              <span className="metrics-warning-banner__dot" />
              {metricsBanner.message}
            </div>
          )}

          <div className="resource-group">
            <div className="metric-header">
              <h3>CPU</h3>
              <div className="metric-legend__total">
                <span className={`metric-legend__total-value${skeletonTextClass}`}>
                  {displayOverview.cpuAllocatable || '0'}
                </span>
                <span className="metric-legend__total-label"> allocatable</span>
              </div>
            </div>
            <div className={`resource-bar-placeholder${skeletonBlockClass}`}>
              <ResourceBar
                usage={displayOverview.cpuUsage}
                request={displayOverview.cpuRequests}
                limit={displayOverview.cpuAllocatable}
                type="cpu"
                variant="default"
              />
            </div>
            <div className="metric-legend">
              <div className="metric-legend__items">
                <div className="metric-legend__item">
                  <span className={`metric-legend__count${skeletonTextClass}`}>
                    {displayOverview.cpuUsage || '0'}
                  </span>
                  <span className="metric-legend__label">usage</span>
                </div>
                <div className="metric-legend__item">
                  <span className={`metric-legend__count${skeletonTextClass}`}>
                    {displayOverview.cpuRequests || '0'}
                  </span>
                  <span className="metric-legend__label">requests</span>
                </div>
                <div className="metric-legend__item">
                  <span className={`metric-legend__count${skeletonTextClass}`}>
                    {displayOverview.cpuLimits || '0'}
                  </span>
                  <span className="metric-legend__label">limits</span>
                </div>
              </div>
            </div>
          </div>

          <div className="resource-group">
            <div className="metric-header">
              <h3>Memory</h3>
              <div className="metric-legend__total">
                <span className={`metric-legend__total-value${skeletonTextClass}`}>
                  {displayOverview.memoryAllocatable || '0'}
                </span>
                <span className="metric-legend__total-label"> allocatable</span>
              </div>
            </div>
            <div className={`resource-bar-placeholder${skeletonBlockClass}`}>
              <ResourceBar
                usage={displayOverview.memoryUsage}
                request={displayOverview.memoryRequests}
                limit={displayOverview.memoryAllocatable}
                type="memory"
                variant="default"
              />
            </div>
            <div className="metric-legend">
              <div className="metric-legend__items">
                <div className="metric-legend__item">
                  <span className={`metric-legend__count${skeletonTextClass}`}>
                    {displayOverview.memoryUsage || '0'}
                  </span>
                  <span className="metric-legend__label">usage</span>
                </div>
                <div className="metric-legend__item">
                  <span className={`metric-legend__count${skeletonTextClass}`}>
                    {displayOverview.memoryRequests || '0'}
                  </span>
                  <span className="metric-legend__label">requests</span>
                </div>
                <div className="metric-legend__item">
                  <span className={`metric-legend__count${skeletonTextClass}`}>
                    {displayOverview.memoryLimits || '0'}
                  </span>
                  <span className="metric-legend__label">limits</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="overview-section nodes-summary">
          <h2>Nodes</h2>
          <div className="metric-stats">
            <div className="metric-stat" data-testid="cluster-nodes-total">
              <span className={`metric-stat__count${skeletonTextClass}`}>
                {displayOverview.totalNodes}
              </span>
              <span className="metric-stat__label">total</span>
            </div>
            {displayOverview.clusterType === 'EKS' && (
              <>
                <div className="metric-stat" data-testid="cluster-nodes-ec2">
                  <span className={`metric-stat__count${skeletonTextClass}`}>
                    {displayOverview.ec2Nodes}
                  </span>
                  <span className="metric-stat__label">ec2</span>
                </div>
                <div className="metric-stat" data-testid="cluster-nodes-fargate">
                  <span className={`metric-stat__count${skeletonTextClass}`}>
                    {displayOverview.fargateNodes}
                  </span>
                  <span className="metric-stat__label">fargate</span>
                </div>
              </>
            )}
            {displayOverview.clusterType === 'AKS' && (
              <>
                <div className="metric-stat" data-testid="cluster-nodes-vm">
                  <span className={`metric-stat__count${skeletonTextClass}`}>
                    {displayOverview.vmNodes}
                  </span>
                  <span className="metric-stat__label">vm</span>
                </div>
                <div className="metric-stat" data-testid="cluster-nodes-virtual">
                  <span className={`metric-stat__count${skeletonTextClass}`}>
                    {displayOverview.virtualNodes}
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
                <span className={`metric-legend__total-value${skeletonTextClass}`}>
                  {displayOverview.totalNodes}
                </span>
                <span className="metric-legend__total-label"> total</span>
              </div>
            </div>
            <div
              className={`stacked-bar${skeletonBlockClass}`}
              role="presentation"
              aria-hidden="true"
            >
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
          <div className="metric-stats">
            <div className="metric-stat" data-testid="cluster-workloads-namespaces">
              <span className={`metric-stat__count${skeletonTextClass}`}>
                {displayOverview.totalNamespaces}
              </span>
              <span className="metric-stat__label">namespaces</span>
            </div>
            <div className="metric-stat" data-testid="cluster-workloads-pods">
              <span className={`metric-stat__count${skeletonTextClass}`}>
                {displayOverview.totalPods}
              </span>
              <span className="metric-stat__label">pods</span>
            </div>
            <div className="metric-stat" data-testid="cluster-workloads-containers">
              <span className={`metric-stat__count${skeletonTextClass}`}>
                {displayOverview.totalContainers}
              </span>
              <span className="metric-stat__label">containers</span>
            </div>
          </div>

          <div className="workload-breakdown">
            <div className="metric-header">
              <h3>By Type</h3>
              <div className="metric-legend__total">
                <span className={`metric-legend__total-value${skeletonTextClass}`}>
                  {workloadTotal}
                </span>
                <span className="metric-legend__total-label"> total</span>
              </div>
            </div>
            <div
              className={`stacked-bar${skeletonBlockClass}`}
              role="presentation"
              aria-hidden="true"
            >
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
                    <span className={`metric-legend__count${skeletonTextClass}`}>
                      {item.value}
                    </span>
                    <span className="metric-legend__label">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pod-status">
            <div className="metric-header">
              <h3>Pod Status</h3>
              <div className="metric-legend__total">
                <span className={`metric-legend__total-value${skeletonTextClass}`}>
                  {displayOverview.totalPods}
                </span>
                <span className="metric-legend__total-label"> total</span>
              </div>
            </div>
            <div
              className={`stacked-bar${skeletonBlockClass}`}
              role="presentation"
              aria-hidden="true"
            >
              {!showSkeleton &&
                phaseSegments.map((segment) => {
                  const width = phasePct(segment.value);
                  if (width <= 0) {
                    return null;
                  }
                  return (
                    <div
                      key={segment.key}
                      className={`stacked-bar__segment stacked-bar__segment--${segment.key}`}
                      style={{ width: `${width}%` }}
                    />
                  );
                })}
            </div>
            <div className="metric-legend">
              <div className="metric-legend__items">
                {podPhaseItems.map((item) => renderPodPhaseLegendItem(item))}
              </div>
              <div className="metric-legend__items metric-legend__items--restarted">
                {renderPodPhaseLegendItem(podRestartedItem)}
              </div>
            </div>
          </div>
        </div>

        <div className="overview-section recent-events">
          <h2>Latest Warning Events</h2>
          {recentEvents.length === 0 ? (
            <div className="recent-events__empty">
              {showSkeleton ? '' : 'No warning events in the last 24 hours.'}
            </div>
          ) : (
            <ul className="recent-events__list">
              {recentEvents.map((event) => {
                const clickable = Boolean(event.objectName && event.objectKind);
                const rowClass = `recent-events__row${
                  clickable ? ' recent-events__row--clickable' : ''
                }`;
                return (
                  <li key={`${event.objectUid}-${event.timestamp}-${event.reason}`}>
                    <div
                      className={rowClass}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => handleRecentEventOpen(event) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleRecentEventOpen(event);
                              }
                            }
                          : undefined
                      }
                      title={`${event.objectKind}/${event.objectName}${
                        event.objectNamespace ? ` · ${event.objectNamespace}` : ''
                      }`}
                    >
                      <span className="recent-events__age">{formatAge(event.timestamp)}</span>
                      <span className="recent-events__reason">{event.reason}</span>
                      <span className="recent-events__message">{event.message}</span>
                    </div>
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

type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName?: string;
  publishedAt?: string;
  checkedAt?: string;
  isUpdateAvailable: boolean;
  error?: string;
};

type AppInfoWithUpdate = backend.AppInfo & {
  update?: UpdateInfo | null;
};

export default ClusterOverview;
