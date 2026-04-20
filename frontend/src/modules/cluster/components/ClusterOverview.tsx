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
    const itemClass = `pod-phase-legend__item${
      clickable ? ' pod-phase-legend__item--clickable' : ''
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
          className={`pod-phase-legend__dot pod-phase-legend__dot--${item.variant}`}
          aria-hidden="true"
        />
        <span className={`pod-phase-legend__count${skeletonTextClass}`}>{item.value}</span>
        <span className="pod-phase-legend__label">{item.label}</span>
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
            <h3>CPU</h3>
            <div className="resource-item">
              <div className={`resource-bar-placeholder${skeletonBlockClass}`}>
                <ResourceBar
                  usage={displayOverview.cpuUsage}
                  request={displayOverview.cpuRequests}
                  limit={displayOverview.cpuAllocatable}
                  type="cpu"
                  variant="default"
                />
              </div>
              <div className="resource-details">
                <div className="detail-row">
                  <span className="utilization-detail-label">Usage</span>
                  <span className={`utilization-detail-value${skeletonTextClass}`}>
                    {displayOverview.cpuUsage || '0'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="utilization-detail-label">Allocatable</span>
                  <span className={`utilization-detail-value${skeletonTextClass}`}>
                    {displayOverview.cpuAllocatable || '0'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="utilization-detail-label">Requests</span>
                  <span className={`utilization-detail-value${skeletonTextClass}`}>
                    {displayOverview.cpuRequests || '0'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="utilization-detail-label">Limits</span>
                  <span className={`utilization-detail-value${skeletonTextClass}`}>
                    {displayOverview.cpuLimits || '0'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="resource-group">
            <h3>Memory</h3>
            <div className="resource-item">
              <div className={`resource-bar-placeholder${skeletonBlockClass}`}>
                <ResourceBar
                  usage={displayOverview.memoryUsage}
                  request={displayOverview.memoryRequests}
                  limit={displayOverview.memoryAllocatable}
                  type="memory"
                  variant="default"
                />
              </div>
              <div className="resource-details">
                <div className="detail-row">
                  <span className="utilization-detail-label">Usage</span>
                  <span className={`utilization-detail-value${skeletonTextClass}`}>
                    {displayOverview.memoryUsage || '0'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="utilization-detail-label">Allocatable</span>
                  <span className={`utilization-detail-value${skeletonTextClass}`}>
                    {displayOverview.memoryAllocatable || '0'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="utilization-detail-label">Requests</span>
                  <span className={`utilization-detail-value${skeletonTextClass}`}>
                    {displayOverview.memoryRequests || '0'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="utilization-detail-label">Limits</span>
                  <span className={`utilization-detail-value${skeletonTextClass}`}>
                    {displayOverview.memoryLimits || '0'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="overview-section nodes-summary">
          <h2>Nodes</h2>
          <div className="stats-grid">
            <div className={`stat-card${skeletonBlockClass}`}>
              <div className={`stat-value${skeletonTextClass}`}>{displayOverview.totalNodes}</div>
              <div className="stat-label">Total</div>
            </div>
            {/* EKS clusters: show EC2 and Fargate breakdown */}
            {displayOverview.clusterType === 'EKS' && (
              <>
                <div className={`stat-card${skeletonBlockClass}`}>
                  <div className={`stat-value${skeletonTextClass}`}>{displayOverview.ec2Nodes}</div>
                  <div className="stat-label">EC2</div>
                </div>
                <div className={`stat-card${skeletonBlockClass}`}>
                  <div className={`stat-value${skeletonTextClass}`}>
                    {displayOverview.fargateNodes}
                  </div>
                  <div className="stat-label">Fargate</div>
                </div>
              </>
            )}
            {/* AKS clusters: show VM and Virtual (ACI) breakdown */}
            {displayOverview.clusterType === 'AKS' && (
              <>
                <div className={`stat-card${skeletonBlockClass}`}>
                  <div className={`stat-value${skeletonTextClass}`}>{displayOverview.vmNodes}</div>
                  <div className="stat-label">VM</div>
                </div>
                <div className={`stat-card${skeletonBlockClass}`}>
                  <div className={`stat-value${skeletonTextClass}`}>
                    {displayOverview.virtualNodes}
                  </div>
                  <div className="stat-label">Virtual</div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="overview-section workloads-summary">
          <h2>Workloads</h2>
          <div className="stats-grid">
            <div className={`stat-card${skeletonBlockClass}`}>
              <div className={`stat-value${skeletonTextClass}`}>
                {displayOverview.totalNamespaces}
              </div>
              <div className="stat-label">Namespaces</div>
            </div>
            <div className={`stat-card${skeletonBlockClass}`}>
              <div className={`stat-value${skeletonTextClass}`}>{displayOverview.totalPods}</div>
              <div className="stat-label">Pods</div>
            </div>
            <div className={`stat-card${skeletonBlockClass}`}>
              <div className={`stat-value${skeletonTextClass}`}>
                {displayOverview.totalContainers}
              </div>
              <div className="stat-label">Containers</div>
            </div>
          </div>

          <div className="pod-status">
            <div className="pod-status__header">
              <h3>Pod Status</h3>
              <div className="pod-phase-legend__total">
                <span className={`pod-phase-legend__total-value${skeletonTextClass}`}>
                  {displayOverview.totalPods}
                </span>
                <span className="pod-phase-legend__total-label"> total</span>
              </div>
            </div>
            <div
              className={`pod-phase-bar${skeletonBlockClass}`}
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
                      className={`pod-phase-bar__segment pod-phase-bar__segment--${segment.key}`}
                      style={{ width: `${width}%` }}
                    />
                  );
                })}
            </div>
            <div className="pod-phase-legend">
              <div className="pod-phase-legend__items">
                {podPhaseItems.map((item) => renderPodPhaseLegendItem(item))}
              </div>
              <div className="pod-phase-legend__items pod-phase-legend__items--restarted">
                {renderPodPhaseLegendItem(podRestartedItem)}
              </div>
            </div>
          </div>
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
