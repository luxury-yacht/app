/**
 * frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx
 *
 * Context provider for cluster resources data and state management.
 * - Handles loading, refreshing, and permission checks for cluster resources.
 * - Utilizes the refresh orchestrator to manage data fetching and state updates.
 * - Exposes hooks for components to consume cluster resource data and state.
 * - Manages the active resource type for view switching and refresh scheduling.
 * - Cleans up and resets state on kubeconfig changes.
 * - Ensures proper permission handling for each resource domain.
 */

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import type { ResourceDataReturn } from '@hooks/resources';
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
import { eventBus } from '@/core/events';
import {
  CLUSTER_REFRESHERS,
  type ClusterRefresherName,
  clusterViewToRefresher,
} from '@/core/refresh/refresherTypes';
import type { DomainSnapshotState } from '@/core/refresh/store';
import type {
  ClusterNodeRow,
  ClusterRBACEntry,
  ClusterStorageEntry,
  ClusterConfigEntry,
  ClusterCRDEntry,
  ClusterCustomEntry,
  ClusterEventEntry,
  DomainPayloadMap,
  RefreshDomain,
  NodePodMetric,
} from '@/core/refresh/types';
import type { ClusterViewType } from '@/types/navigation/views';
import { useUserPermission } from '@/core/capabilities';
import type { PermissionStatus } from '@/core/capabilities';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

export type { ClusterNodeRow } from '@/core/refresh/types';

interface ClusterResourcesContextType {
  nodes: ResourceDataReturn<ClusterNodeRow[]>;
  rbac: ResourceDataReturn<ClusterRBACEntry[]>;
  storage: ResourceDataReturn<ClusterStorageEntry[]>;
  config: ResourceDataReturn<ClusterConfigEntry[]>;
  crds: ResourceDataReturn<ClusterCRDEntry[]>;
  custom: ResourceDataReturn<ClusterCustomEntry[]>;
  events: ResourceDataReturn<ClusterEventEntry[]>;
  activeResourceType: ClusterViewType | null;
  setActiveResourceType: React.Dispatch<React.SetStateAction<ClusterViewType | null>>;
}

const ClusterResourcesContext = createContext<ClusterResourcesContextType | undefined>(undefined);

// Map cluster resource refreshers to their domains.
const CLUSTER_REFRESHER_TO_DOMAIN: Partial<Record<ClusterRefresherName, RefreshDomain>> = {
  [CLUSTER_REFRESHERS.nodes]: 'nodes',
  [CLUSTER_REFRESHERS.nodeMaintenance]: 'node-maintenance',
  [CLUSTER_REFRESHERS.rbac]: 'cluster-rbac',
  [CLUSTER_REFRESHERS.storage]: 'cluster-storage',
  [CLUSTER_REFRESHERS.config]: 'cluster-config',
  [CLUSTER_REFRESHERS.crds]: 'cluster-crds',
  [CLUSTER_REFRESHERS.custom]: 'cluster-custom',
  [CLUSTER_REFRESHERS.events]: 'cluster-events',
};

// Managed cluster domains derived from the mapping (exclude catalog to avoid touching browse)
const CLUSTER_DOMAIN_SET = new Set<RefreshDomain>(Object.values(CLUSTER_REFRESHER_TO_DOMAIN));

const noop = () => {};

// Keep merged multi-cluster payloads scoped to the active tab.
const filterByClusterId = <T extends { clusterId?: string | null }>(
  items: T[] | null | undefined,
  clusterId: string | null | undefined
): T[] | null => {
  if (!items) {
    return null;
  }
  if (!clusterId) {
    return items.filter((item) => !item.clusterId);
  }
  return items.filter((item) => item.clusterId === clusterId);
};

function useClusterDomainResource<K extends RefreshDomain, TResult>(
  domainName: K,
  state: DomainSnapshotState<DomainPayloadMap[K]>,
  extractFn: (payload: DomainPayloadMap[K] | null) => TResult | null
): ResourceDataReturn<TResult> {
  const isStreaming = refreshOrchestrator.isStreamingDomain(domainName);
  const load = useCallback(
    async (showSpinner: boolean = true) => {
      if (isStreaming) {
        return;
      }
      await refreshOrchestrator.triggerManualRefresh(domainName, {
        suppressSpinner: !showSpinner,
      });
    },
    [domainName, isStreaming]
  );

  const refresh = useCallback(async () => {
    if (isStreaming) {
      return;
    }
    await refreshOrchestrator.triggerManualRefresh(domainName, { suppressSpinner: true });
  }, [domainName, isStreaming]);

  const reset = useCallback(() => {
    if (isStreaming) {
      refreshOrchestrator.resetDomain(domainName);
      return;
    }
    refreshOrchestrator.resetDomain(domainName);
  }, [domainName, isStreaming]);

  return useMemo(() => {
    const payload = state.data ?? null;
    const data = extractFn(payload);
    const hasData = data !== null && data !== undefined;
    const hasLoaded = hasData || state.status === 'error';
    const loadingStatus = state.status === 'loading' || state.status === 'initialising';
    const loading = loadingStatus && !hasLoaded;
    const refreshing = state.status === 'updating';
    const error = state.error ? new Error(state.error) : null;
    const lastFetchTime = state.lastUpdated ? new Date(state.lastUpdated) : null;

    return {
      data,
      loading,
      refreshing,
      error,
      load,
      refresh,
      reset,
      cancel: noop,
      lastFetchTime,
      hasLoaded,
    };
  }, [extractFn, load, refresh, reset, state]);
}

export const useClusterResources = () => {
  const context = useContext(ClusterResourcesContext);
  if (!context) {
    throw new Error('useClusterResources must be used within ClusterResourcesProvider');
  }
  return context;
};

interface ClusterResourcesProviderProps {
  children: ReactNode;
  activeView?: ClusterViewType | null;
}

export const ClusterResourcesProvider: React.FC<ClusterResourcesProviderProps> = ({
  children,
  activeView,
}) => {
  const [activeResourceType, setActiveResourceType] = useState<ClusterViewType | null>(
    activeView ?? null
  );

  useEffect(() => {
    if (activeView !== undefined) {
      setActiveResourceType(activeView ?? null);
    }
  }, [activeView]);

  const setActiveResourceTypeWithCallback = useCallback(
    (view: ClusterViewType | null | ((prev: ClusterViewType | null) => ClusterViewType | null)) => {
      setActiveResourceType((prev) =>
        typeof view === 'function'
          ? (view as (prev: ClusterViewType | null) => ClusterViewType | null)(prev)
          : view
      );
    },
    []
  );

  const defaultRefresher = activeView ? clusterViewToRefresher[activeView] : undefined;
  const activeClusterRefresherRef = useRef<ClusterRefresherName | null>(defaultRefresher ?? null);

  const nodeDomain = useRefreshDomain('nodes');
  const rbacDomain = useRefreshDomain('cluster-rbac');
  const storageDomain = useRefreshDomain('cluster-storage');
  const configDomain = useRefreshDomain('cluster-config');
  const crdDomain = useRefreshDomain('cluster-crds');
  const customDomain = useRefreshDomain('cluster-custom');
  const eventsDomain = useRefreshDomain('cluster-events');

  const { selectedClusterId } = useKubeconfig();
  // Ensure permission state is tracked per-cluster to prevent cross-cluster leakage.
  const permissionClusterId = selectedClusterId || null;

  const nodeListPermission = useUserPermission('Node', 'list', null, null, permissionClusterId);
  const storageListPermission = useUserPermission(
    'PersistentVolume',
    'list',
    null,
    null,
    permissionClusterId
  );
  const rbacClusterRolePermission = useUserPermission(
    'ClusterRole',
    'list',
    null,
    null,
    permissionClusterId
  );
  const rbacClusterRoleBindingPermission = useUserPermission(
    'ClusterRoleBinding',
    'list',
    null,
    null,
    permissionClusterId
  );
  const crdListPermission = useUserPermission(
    'CustomResourceDefinition',
    'list',
    null,
    null,
    permissionClusterId
  );
  const eventListPermission = useUserPermission('Event', 'list', null, null, permissionClusterId);
  const configStorageClassPermission = useUserPermission(
    'StorageClass',
    'list',
    null,
    null,
    permissionClusterId
  );
  const configIngressClassPermission = useUserPermission(
    'IngressClass',
    'list',
    null,
    null,
    permissionClusterId
  );
  const configMutatingWebhookPermission = useUserPermission(
    'MutatingWebhookConfiguration',
    'list',
    null,
    null,
    permissionClusterId
  );
  const configValidatingWebhookPermission = useUserPermission(
    'ValidatingWebhookConfiguration',
    'list',
    null,
    null,
    permissionClusterId
  );

  const isPermissionDenied = useCallback(
    (permission?: PermissionStatus | null): boolean =>
      Boolean(permission && !permission.pending && !permission.allowed),
    []
  );

  const domainPermissionDenied = useMemo(() => {
    const configDenied =
      isPermissionDenied(configStorageClassPermission) ||
      isPermissionDenied(configIngressClassPermission) ||
      isPermissionDenied(configMutatingWebhookPermission) ||
      isPermissionDenied(configValidatingWebhookPermission);

    return {
      nodes: isPermissionDenied(nodeListPermission),
      'cluster-storage': isPermissionDenied(storageListPermission),
      'cluster-rbac':
        isPermissionDenied(rbacClusterRolePermission) ||
        isPermissionDenied(rbacClusterRoleBindingPermission),
      'cluster-config': configDenied,
      'cluster-crds': isPermissionDenied(crdListPermission),
      'cluster-custom': isPermissionDenied(crdListPermission),
      'cluster-events': isPermissionDenied(eventListPermission),
    } as Partial<Record<RefreshDomain, boolean>>;
  }, [
    configIngressClassPermission,
    configMutatingWebhookPermission,
    configStorageClassPermission,
    configValidatingWebhookPermission,
    crdListPermission,
    eventListPermission,
    isPermissionDenied,
    nodeListPermission,
    rbacClusterRoleBindingPermission,
    rbacClusterRolePermission,
    storageListPermission,
  ]);

  const nodeSnapshot = nodeDomain.data;
  const nodeMetricsInfo = useMemo(() => {
    if (!nodeSnapshot) {
      return undefined;
    }
    const metricsByCluster = nodeSnapshot.metricsByCluster;
    if (metricsByCluster && selectedClusterId) {
      return metricsByCluster[selectedClusterId] ?? nodeSnapshot.metrics;
    }
    return nodeSnapshot.metrics;
  }, [nodeSnapshot, selectedClusterId]);
  const nodeStatus = nodeDomain.status;
  const nodeError = nodeDomain.error;
  const nodeLastUpdated = nodeDomain.lastUpdated;

  const loadNodes = useCallback(async (showSpinner: boolean = true) => {
    await refreshOrchestrator.triggerManualRefresh('nodes', {
      suppressSpinner: !showSpinner,
    });
  }, []);

  const refreshNodes = useCallback(async () => {
    await refreshOrchestrator.triggerManualRefresh('nodes', { suppressSpinner: true });
  }, []);

  const resetNodes = useCallback(() => {
    refreshOrchestrator.resetDomain('nodes');
  }, []);

  const cancelNodes = useCallback(() => {
    // No explicit cancellation required; orchestrator tracks request lifecycles internally.
  }, []);

  const nodes: ResourceDataReturn<ClusterNodeRow[]> = useMemo(() => {
    const data = nodeSnapshot ? filterByClusterId(nodeSnapshot.nodes, selectedClusterId) : null;
    const lastUpdated = nodeMetricsInfo?.collectedAt
      ? new Date(nodeMetricsInfo.collectedAt * 1000)
      : nodeLastUpdated
        ? new Date(nodeLastUpdated)
        : null;
    const stale = Boolean(nodeMetricsInfo?.stale);
    const effectiveError =
      nodeStatus === 'error' && nodeError ? nodeError : nodeMetricsInfo?.lastError || null;
    const loading = nodeStatus === 'loading' && !nodeSnapshot;
    const refreshing = nodeStatus === 'updating';
    const error = effectiveError ? new Error(effectiveError) : null;
    const podMetricsByNode: Record<string, Record<string, NodePodMetric>> = {};
    const podMetricsByPod: Record<string, NodePodMetric> = {};
    data?.forEach((node) => {
      if (!node.podMetrics || node.podMetrics.length === 0) {
        return;
      }
      podMetricsByNode[node.name] = node.podMetrics.reduce<Record<string, NodePodMetric>>(
        (acc, metric) => {
          const key = `${metric.namespace}/${metric.name}`;
          acc[key] = metric;
          podMetricsByPod[key] = metric;
          return acc;
        },
        {}
      );
    });

    const isInitialising =
      nodeStatus === 'idle' || nodeStatus === 'initialising' || nodeStatus === 'loading';

    return {
      data,
      loading: (isInitialising && !nodeSnapshot) || loading,
      refreshing,
      error,
      load: loadNodes,
      refresh: refreshNodes,
      reset: resetNodes,
      cancel: cancelNodes,
      lastFetchTime: lastUpdated,
      hasLoaded: !!nodeSnapshot && nodeStatus !== 'loading' && nodeStatus !== 'initialising',
      meta: {
        metricsStale: stale,
        metricsLastUpdated: lastUpdated || undefined,
        metricsError: nodeMetricsInfo?.lastError || undefined,
        metricsConsecutiveFailures: nodeMetricsInfo?.consecutiveFailures || 0,
        metricsSuccessCount: nodeMetricsInfo?.successCount ?? 0,
        metricsFailureCount: nodeMetricsInfo?.failureCount ?? 0,
        podMetricsByNode,
        podMetricsByPod,
      },
    };
  }, [
    cancelNodes,
    loadNodes,
    nodeError,
    nodeLastUpdated,
    nodeSnapshot,
    nodeStatus,
    nodeMetricsInfo?.collectedAt,
    nodeMetricsInfo?.stale,
    nodeMetricsInfo?.lastError,
    nodeMetricsInfo?.consecutiveFailures,
    nodeMetricsInfo?.successCount,
    nodeMetricsInfo?.failureCount,
    refreshNodes,
    resetNodes,
    selectedClusterId,
  ]);

  const domainStateRef = useRef<Partial<Record<RefreshDomain, DomainSnapshotState<any>>>>({
    nodes: nodeDomain,
    'cluster-rbac': rbacDomain,
    'cluster-storage': storageDomain,
    'cluster-config': configDomain,
    'cluster-crds': crdDomain,
    'cluster-custom': customDomain,
    'cluster-events': eventsDomain,
  });

  useEffect(() => {
    domainStateRef.current = {
      nodes: nodeDomain,
      'cluster-rbac': rbacDomain,
      'cluster-storage': storageDomain,
      'cluster-config': configDomain,
      'cluster-crds': crdDomain,
      'cluster-custom': customDomain,
      'cluster-events': eventsDomain,
    };
  }, [configDomain, crdDomain, customDomain, eventsDomain, nodeDomain, rbacDomain, storageDomain]);

  useEffect(() => {
    const nextRefresher = activeResourceType ? clusterViewToRefresher[activeResourceType] : null;
    const previousRefresher = activeClusterRefresherRef.current;

    if (previousRefresher && previousRefresher !== nextRefresher) {
      const previousDomain = CLUSTER_REFRESHER_TO_DOMAIN[previousRefresher];
      if (previousDomain) {
        refreshOrchestrator.setDomainEnabled(previousDomain, false);
      }
    }

    if (nextRefresher) {
      const nextDomain = CLUSTER_REFRESHER_TO_DOMAIN[nextRefresher];
      if (!nextDomain) {
        activeClusterRefresherRef.current = null;
        return;
      }
      if (nextDomain !== 'nodes' && domainPermissionDenied[nextDomain]) {
        refreshOrchestrator.setDomainEnabled(nextDomain, false);
        activeClusterRefresherRef.current = null;
        return;
      }
      // Allow fetches even while permissions are pending to avoid delaying the view.

      refreshOrchestrator.setDomainEnabled(nextDomain, true);
      const state = domainStateRef.current[nextDomain];
      if (
        state &&
        !state.data &&
        state.status === 'idle' &&
        !refreshOrchestrator.isStreamingDomain(nextDomain)
      ) {
        void refreshOrchestrator.triggerManualRefresh(nextDomain);
      }
    }

    activeClusterRefresherRef.current = nextRefresher ?? null;
  }, [activeResourceType, domainPermissionDenied]);

  useEffect(() => {
    return () => {
      CLUSTER_DOMAIN_SET.forEach((domain) => {
        refreshOrchestrator.setDomainEnabled(domain, false);
      });
    };
  }, []);

  useEffect(() => {
    const handleKubeconfigChanging = () => {
      CLUSTER_DOMAIN_SET.forEach((domain) => {
        refreshOrchestrator.setDomainEnabled(domain, false);
        refreshOrchestrator.resetDomain(domain);
      });
    };

    const handleKubeconfigChanged = () => {
      activeClusterRefresherRef.current = null;
      setActiveResourceTypeWithCallback(null);
    };

    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);

    return () => {
      unsubChanging();
      unsubChanged();
    };
  }, [setActiveResourceTypeWithCallback]);

  const rbacExtractor = useCallback(
    (payload: DomainPayloadMap['cluster-rbac'] | null) =>
      filterByClusterId(payload?.resources ?? null, selectedClusterId),
    [selectedClusterId]
  );
  const storageExtractor = useCallback(
    (payload: DomainPayloadMap['cluster-storage'] | null) =>
      filterByClusterId(payload?.volumes ?? null, selectedClusterId),
    [selectedClusterId]
  );
  const configExtractor = useCallback(
    (payload: DomainPayloadMap['cluster-config'] | null) =>
      filterByClusterId(payload?.resources ?? null, selectedClusterId),
    [selectedClusterId]
  );
  const crdExtractor = useCallback(
    (payload: DomainPayloadMap['cluster-crds'] | null) =>
      filterByClusterId(payload?.definitions ?? null, selectedClusterId),
    [selectedClusterId]
  );
  const customExtractor = useCallback(
    (payload: DomainPayloadMap['cluster-custom'] | null) =>
      filterByClusterId(payload?.resources ?? null, selectedClusterId),
    [selectedClusterId]
  );
  const eventsExtractor = useCallback(
    (payload: DomainPayloadMap['cluster-events'] | null) =>
      filterByClusterId(payload?.events ?? null, selectedClusterId),
    [selectedClusterId]
  );

  const rbac = useClusterDomainResource('cluster-rbac', rbacDomain, rbacExtractor);
  const storage = useClusterDomainResource('cluster-storage', storageDomain, storageExtractor);
  const config = useClusterDomainResource('cluster-config', configDomain, configExtractor);
  const crds = useClusterDomainResource('cluster-crds', crdDomain, crdExtractor);
  const custom = useClusterDomainResource('cluster-custom', customDomain, customExtractor);
  const events = useClusterDomainResource('cluster-events', eventsDomain, eventsExtractor);

  const manualLoaders = useMemo<Record<ClusterViewType, () => Promise<void>>>(() => {
    const wrap = (load?: (showSpinner?: boolean) => Promise<void>) => {
      if (!load) {
        return async () => {};
      }

      return async () => {
        await load(true);
      };
    };

    return {
      nodes: wrap(nodes.load),
      rbac: wrap(rbac.load),
      storage: wrap(storage.load),
      config: wrap(config.load),
      crds: wrap(crds.load),
      custom: wrap(custom.load),
      events: wrap(events.load),
      browse: async () => {},
    };
  }, [config.load, crds.load, custom.load, events.load, nodes.load, rbac.load, storage.load]);

  useEffect(() => {
    if (!activeResourceType) {
      return;
    }

    const tabToEnsure = activeResourceType;

    const shouldSkip = (() => {
      switch (tabToEnsure) {
        case 'nodes':
          return nodes.data !== null
            ? true
            : nodes.loading ||
                !!nodes.error ||
                domainPermissionDenied['nodes'];
        case 'rbac':
          return rbac.data !== null
            ? true
            : rbac.loading ||
                !!rbac.error ||
                domainPermissionDenied['cluster-rbac'];
        case 'storage':
          return storage.data !== null
            ? true
            : storage.loading ||
                !!storage.error ||
                domainPermissionDenied['cluster-storage'];
        case 'config':
          return config.data !== null
            ? true
            : config.loading ||
                !!config.error ||
                domainPermissionDenied['cluster-config'];
        case 'crds':
          return crds.data !== null
            ? true
            : crds.loading ||
                !!crds.error ||
                domainPermissionDenied['cluster-crds'];
        case 'custom':
          return custom.data !== null
            ? true
            : custom.loading ||
                !!custom.error ||
                domainPermissionDenied['cluster-custom'];
        case 'events':
          return events.data !== null
            ? true
            : events.loading ||
                !!events.error ||
                domainPermissionDenied['cluster-events'];
        default:
          return true;
      }
    })();

    if (shouldSkip) {
      return;
    }

    void manualLoaders[tabToEnsure]();
  }, [
    activeResourceType,
    config.data,
    config.error,
    config.loading,
    crds.data,
    crds.error,
    crds.loading,
    custom.data,
    custom.error,
    custom.loading,
    events.data,
    events.error,
    events.loading,
    manualLoaders,
    nodes.data,
    nodes.error,
    nodes.loading,
    rbac.data,
    rbac.error,
    rbac.loading,
    storage.data,
    storage.error,
    storage.loading,
    domainPermissionDenied,
  ]);

  const contextValue = useMemo(
    () => ({
      nodes,
      rbac,
      storage,
      config,
      crds,
      custom,
      events,
      activeResourceType,
      setActiveResourceType: setActiveResourceTypeWithCallback,
    }),
    [
      nodes,
      rbac,
      storage,
      config,
      crds,
      custom,
      events,
      activeResourceType,
      setActiveResourceTypeWithCallback,
    ]
  );

  return (
    <ClusterResourcesContext.Provider value={contextValue}>
      {children}
    </ClusterResourcesContext.Provider>
  );
};
