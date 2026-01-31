/**
 * frontend/src/modules/cluster/components/ClusterOverview.tsx
 *
 * Module source for ClusterOverview.
 * Displays an overview of the connected Kubernetes cluster, including resource usage,
 * node and workload summaries, and pod status with navigation links.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ResourceBar from '@shared/components/ResourceBar';
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
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
import { GetAppInfo } from '@wailsjs/go/backend/App';
import { backend } from '@wailsjs/go/models';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

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
  totalPods: 0,
  totalContainers: 0,
  totalInitContainers: 0,
  runningPods: 0,
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

  const overviewDomain = useRefreshDomain('cluster-overview');
  const { selectedClusterId } = useKubeconfig();
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
  const { setSelectedNamespace } = useNamespace();
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
    GetAppInfo()
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
    (isSwitching || isLoading || overviewDomain.status === 'idle');

  useEffect(() => {
    const enableOverview = () => {
      refreshOrchestrator.setDomainEnabled('cluster-overview', true);
      refreshOrchestrator.triggerManualRefresh('cluster-overview').catch(() => {
        setOverviewData(EMPTY_OVERVIEW);
        setIsHydrated(false);
        setIsSwitching(true);
      });
    };

    const disableOverview = () => {
      refreshOrchestrator.setDomainEnabled('cluster-overview', false);
      refreshOrchestrator.resetDomain('cluster-overview');
      setOverviewData(EMPTY_OVERVIEW);
      setIsHydrated(false);
      setIsSwitching(true);
    };

    enableOverview();

    if (typeof window !== 'undefined') {
      const handleKubeconfigChanging = () => {
        setIsSwitching(true);
        disableOverview();
      };
      const handleKubeconfigChanged = () => {
        setIsSwitching(true);
        enableOverview();
      };

      const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
      const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);

      return () => {
        disableOverview();
        unsubChanging();
        unsubChanged();
      };
    }

    return () => {
      disableOverview();
    };
  }, []);

  const handlePodStatusNavigate = useCallback(
    (key: string, count: number) => {
      if (count <= 0) {
        return;
      }
      setSelectedNamespace(ALL_NAMESPACES_SCOPE);
      setActiveNamespaceTab('pods');
      setSidebarSelection({ type: 'namespace', value: ALL_NAMESPACES_SCOPE });
      navigateToNamespace();
      if (key !== 'running' && selectedClusterId) {
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

  const podStatusCards = [
    { key: 'running', label: 'Running', value: displayOverview.runningPods, className: 'running' },
    { key: 'pending', label: 'Pending', value: displayOverview.pendingPods, className: 'pending' },
    { key: 'failed', label: 'Failing', value: displayOverview.failedPods, className: 'failed' },
    {
      key: 'restarted',
      label: 'Restarted',
      value: displayOverview.restartedPods,
      className: 'restarted',
    },
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
                Click here to go to the release page.
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
            <div className={`stat-card${skeletonBlockClass}`}>
              <div className={`stat-value${skeletonTextClass}`}>
                {displayOverview.clusterType === 'EKS'
                  ? displayOverview.ec2Nodes
                  : displayOverview.regularNodes}
              </div>
              <div className="stat-label">
                {displayOverview.clusterType === 'EKS' ? 'EC2' : 'Standard'}
              </div>
            </div>
            <div className={`stat-card${skeletonBlockClass}`}>
              <div className={`stat-value${skeletonTextClass}`}>{displayOverview.fargateNodes}</div>
              <div className="stat-label">Fargate</div>
            </div>
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
            <h3>Pod Status</h3>
            <div className="stats-grid">
              {podStatusCards.map((card) => {
                const clickable = card.value > 0;
                const cardClass = `stat-card${skeletonBlockClass}${
                  clickable ? ' stat-card--clickable' : ''
                }`;
                const valueClass = `stat-value ${card.className}${skeletonTextClass}`;
                return (
                  <div
                    key={card.key}
                    className={cardClass}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={
                      clickable ? () => handlePodStatusNavigate(card.key, card.value) : undefined
                    }
                    onKeyDown={
                      clickable
                        ? (event) => handlePodStatusKeyDown(event, card.key, card.value)
                        : undefined
                    }
                    aria-disabled={!clickable}
                    data-testid={`cluster-pod-status-${card.key}`}
                  >
                    <div className={valueClass}>{card.value}</div>
                    <div className="stat-label">{card.label}</div>
                  </div>
                );
              })}
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
