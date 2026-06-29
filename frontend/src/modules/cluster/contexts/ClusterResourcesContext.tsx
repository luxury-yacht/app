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
import type { SnapshotStats } from '@/core/refresh/client';
import {
  requestRefreshDomain,
  resetRefreshDomain,
  setRefreshDomainEnabled,
  useScopedRefreshDomainLifecycle,
} from '@/core/data-access';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { buildClusterScope } from '@/core/refresh/clusterScope';
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
} from '@/core/refresh/types';
import type { ClusterViewType } from '@/types/navigation/views';
import { useUserPermission } from '@/core/capabilities';
import type { PermissionStatus } from '@/core/capabilities';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useStableSelectedValue } from '@shared/hooks/useStableSelectedValue';
import {
  clusterResourceDescriptors,
  type ClusterResourceDescriptor,
} from './clusterResourceDescriptors';
import { createCatalogBackedCustomResourceHandle } from '@modules/browse/catalogBackedCustomResourceHandle';

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
  [CLUSTER_REFRESHERS.rbac]: 'cluster-rbac',
  [CLUSTER_REFRESHERS.storage]: 'cluster-storage',
  [CLUSTER_REFRESHERS.config]: 'cluster-config',
  [CLUSTER_REFRESHERS.crds]: 'cluster-crds',
  [CLUSTER_REFRESHERS.events]: 'cluster-events',
};

// Managed cluster domains derived from the mapping (exclude catalog to avoid touching browse)
const CLUSTER_DOMAIN_SET = new Set<RefreshDomain>(Object.values(CLUSTER_REFRESHER_TO_DOMAIN));

const QUERY_BACKED_CLUSTER_VIEWS = new Set<ClusterViewType>([
  'nodes',
  'rbac',
  'storage',
  'config',
  'crds',
  'events',
]);

// Domains that use 'cluster' as their domain scope suffix (events need special scope).
const CLUSTER_EVENTS_DOMAIN: RefreshDomain = 'cluster-events';
const noop = () => {};

const withSnapshotStatsMeta = (base: unknown, stats?: SnapshotStats | null): unknown => {
  if (!stats) {
    return base;
  }
  if (base && typeof base === 'object' && !Array.isArray(base)) {
    return { ...base, tableStats: stats };
  }
  return { tableStats: stats };
};

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
  extractFn: (payload: DomainPayloadMap[K] | null) => TResult | null,
  scope: string,
  metaExtractor?: (payload: DomainPayloadMap[K] | null) => unknown,
  isPaused: boolean = false,
  isManualRefreshActive: boolean = false
): ResourceDataReturn<TResult> {
  const load = useCallback(
    async (_showSpinner: boolean = true) => {
      // fetchScopedDomain handles streaming domains internally — it will use
      // refreshOnce for active streams or fall back to a snapshot fetch.
      await requestRefreshDomain({
        domain: domainName,
        scope,
        reason: 'user',
      });
    },
    [domainName, scope]
  );

  const refresh = useCallback(async () => {
    await requestRefreshDomain({
      domain: domainName,
      scope,
      reason: 'user',
    });
  }, [domainName, scope]);

  const reset = useCallback(() => {
    resetRefreshDomain(domainName, scope);
  }, [domainName, scope]);

  const selectedData = useMemo(() => extractFn(state.data ?? null), [extractFn, state.data]);
  const stableData = useStableSelectedValue(selectedData);
  const selectedMeta = useMemo(
    () =>
      withSnapshotStatsMeta(
        metaExtractor ? metaExtractor(state.data ?? null) : undefined,
        state.stats
      ),
    [metaExtractor, state.data, state.stats]
  );
  const stableMeta = useStableSelectedValue(selectedMeta);

  return useMemo(() => {
    const hasData = stableData !== null && stableData !== undefined;
    const hasLoaded = hasData || state.status === 'error';
    const loadingStatus =
      state.status === 'idle' || state.status === 'loading' || state.status === 'initialising';
    const passiveLoading = applyPassiveLoadingPolicy({
      loading: loadingStatus && !hasLoaded,
      hasLoaded,
      isPaused,
      isManualRefreshActive,
    });
    const refreshing = state.status === 'updating';
    const error = state.error ? new Error(state.error) : null;
    const lastFetchTime = state.lastUpdated ? new Date(state.lastUpdated) : null;

    return {
      data: stableData,
      loading: passiveLoading.loading,
      refreshing,
      error,
      load,
      refresh,
      reset,
      cancel: noop,
      lastFetchTime,
      hasLoaded: passiveLoading.hasLoaded,
      meta: stableMeta,
    };
  }, [isManualRefreshActive, isPaused, load, refresh, reset, stableData, stableMeta, state]);
}

function useDescriptorBackedClusterResource<T>(
  descriptor: ClusterResourceDescriptor<any, T>,
  state: DomainSnapshotState<any>,
  scope: string,
  clusterId: string | null | undefined,
  isPaused: boolean = false,
  isManualRefreshActive: boolean = false
): ResourceDataReturn<T> {
  const select = useCallback(
    (payload: any | null) => descriptor.select(payload, clusterId),
    [clusterId, descriptor]
  );
  const selectMeta = useCallback(
    (payload: any | null) => (descriptor.meta ? descriptor.meta(payload) : undefined),
    [descriptor]
  );

  return useClusterDomainResource(
    descriptor.domain,
    state,
    select,
    scope,
    descriptor.meta ? selectMeta : undefined,
    isPaused,
    isManualRefreshActive
  );
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

  const { selectedClusterId } = useKubeconfig();
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();

  // Build scoped keys for cluster-isolated state storage.
  const clusterScope = useMemo(
    () => buildClusterScope(selectedClusterId ?? undefined, ''),
    [selectedClusterId]
  );
  const clusterEventsScope = useMemo(
    () => buildClusterScope(selectedClusterId ?? undefined, 'cluster'),
    [selectedClusterId]
  );

  // Single source of truth for every managed cluster domain → its scoped key.
  // The events domain uses the `:cluster` scope suffix; every other managed
  // domain uses the bare cluster scope. The domain subscriptions, resource
  // handles, node callbacks, active-domain lifecycle hook, startup fetches, and
  // the cleanup-all teardown all resolve scope through getScopeForDomain, so
  // this rule lives in exactly one place and the acquire/teardown paths cannot
  // drift apart.
  const clusterDomainScopes = useMemo(() => {
    const scopes: Partial<Record<RefreshDomain, string>> = {};
    for (const domain of CLUSTER_DOMAIN_SET) {
      scopes[domain] = domain === CLUSTER_EVENTS_DOMAIN ? clusterEventsScope : clusterScope;
    }
    return scopes;
  }, [clusterScope, clusterEventsScope]);

  const getScopeForDomain = useCallback(
    (domain: RefreshDomain) => clusterDomainScopes[domain] ?? clusterScope,
    [clusterDomainScopes, clusterScope]
  );

  const nodeDomain = useRefreshScopedDomain('nodes', getScopeForDomain('nodes'));
  const rbacDomain = useRefreshScopedDomain('cluster-rbac', getScopeForDomain('cluster-rbac'));
  const storageDomain = useRefreshScopedDomain(
    'cluster-storage',
    getScopeForDomain('cluster-storage')
  );
  const configDomain = useRefreshScopedDomain(
    'cluster-config',
    getScopeForDomain('cluster-config')
  );
  const crdDomain = useRefreshScopedDomain('cluster-crds', getScopeForDomain('cluster-crds'));
  const eventsDomain = useRefreshScopedDomain(
    'cluster-events',
    getScopeForDomain('cluster-events')
  );
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
  const configGatewayClassPermission = useUserPermission(
    'GatewayClass',
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

  // Only treat a permission as denied when the backend has given a definitive
  // "not allowed" answer (status === 'ready').  Errors (e.g. "cluster not
  // active" during initial activation) must NOT be treated as denials — they
  // mean "we don't know yet", and the view should proceed to load data.
  const isPermissionDenied = useCallback(
    (permission?: PermissionStatus | null): boolean =>
      Boolean(permission && permission.entry?.status === 'ready' && !permission.allowed),
    []
  );
  const areAllPermissionsDenied = useCallback(
    (...permissions: Array<PermissionStatus | null | undefined>): boolean =>
      permissions.length > 0 && permissions.every((permission) => isPermissionDenied(permission)),
    [isPermissionDenied]
  );

  const domainPermissionDenied = useMemo(() => {
    const configDenied = areAllPermissionsDenied(
      configStorageClassPermission,
      configIngressClassPermission,
      configGatewayClassPermission,
      configMutatingWebhookPermission,
      configValidatingWebhookPermission
    );

    return {
      nodes: isPermissionDenied(nodeListPermission),
      'cluster-storage': isPermissionDenied(storageListPermission),
      'cluster-rbac': areAllPermissionsDenied(
        rbacClusterRolePermission,
        rbacClusterRoleBindingPermission
      ),
      'cluster-config': configDenied,
      'cluster-crds': isPermissionDenied(crdListPermission),
      'cluster-events': isPermissionDenied(eventListPermission),
    } as Partial<Record<RefreshDomain, boolean>>;
  }, [
    configIngressClassPermission,
    configGatewayClassPermission,
    configMutatingWebhookPermission,
    configStorageClassPermission,
    configValidatingWebhookPermission,
    crdListPermission,
    eventListPermission,
    areAllPermissionsDenied,
    isPermissionDenied,
    nodeListPermission,
    rbacClusterRoleBindingPermission,
    rbacClusterRolePermission,
    storageListPermission,
  ]);

  const nodeSnapshot = nodeDomain.data;
  const nodeStatus = nodeDomain.status;
  const nodeError = nodeDomain.error;
  const nodeLastUpdated = nodeDomain.lastUpdated;

  const loadNodes = useCallback(
    async (showSpinner: boolean = true) => {
      void showSpinner;
      await requestRefreshDomain({
        domain: 'nodes',
        scope: getScopeForDomain('nodes'),
        reason: 'user',
      });
    },
    [getScopeForDomain]
  );

  const refreshNodes = useCallback(async () => {
    await requestRefreshDomain({
      domain: 'nodes',
      scope: getScopeForDomain('nodes'),
      reason: 'user',
    });
  }, [getScopeForDomain]);

  const resetNodes = useCallback(() => {
    resetRefreshDomain('nodes', getScopeForDomain('nodes'));
  }, [getScopeForDomain]);

  const cancelNodes = useCallback(() => {
    // No explicit cancellation required; orchestrator tracks request lifecycles internally.
  }, []);

  const nodes: ResourceDataReturn<ClusterNodeRow[]> = useMemo(() => {
    const data = nodeSnapshot ? filterByClusterId(nodeSnapshot.rows, selectedClusterId) : null;
    const lastUpdated = nodeLastUpdated ? new Date(nodeLastUpdated) : null;
    const effectiveError = nodeStatus === 'error' && nodeError ? nodeError : null;
    const loading = nodeStatus === 'loading' && !nodeSnapshot;
    const refreshing = nodeStatus === 'updating';
    const error = effectiveError ? new Error(effectiveError) : null;
    const isInitialising =
      nodeStatus === 'idle' || nodeStatus === 'initialising' || nodeStatus === 'loading';
    const passiveLoading = applyPassiveLoadingPolicy({
      loading: (isInitialising && !nodeSnapshot) || loading,
      hasLoaded: !!nodeSnapshot && nodeStatus !== 'loading' && nodeStatus !== 'initialising',
      isPaused,
      isManualRefreshActive,
    });

    return {
      data,
      loading: passiveLoading.loading,
      refreshing,
      error,
      load: loadNodes,
      refresh: refreshNodes,
      reset: resetNodes,
      cancel: cancelNodes,
      lastFetchTime: lastUpdated,
      hasLoaded: passiveLoading.hasLoaded,
    };
  }, [
    cancelNodes,
    loadNodes,
    nodeError,
    nodeLastUpdated,
    nodeSnapshot,
    nodeStatus,
    isManualRefreshActive,
    isPaused,
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
    'cluster-events': eventsDomain,
  });

  useEffect(() => {
    domainStateRef.current = {
      nodes: nodeDomain,
      'cluster-rbac': rbacDomain,
      'cluster-storage': storageDomain,
      'cluster-config': configDomain,
      'cluster-crds': crdDomain,
      'cluster-events': eventsDomain,
    };
  }, [configDomain, crdDomain, eventsDomain, nodeDomain, rbacDomain, storageDomain]);

  const activeClusterDomain = useMemo(() => {
    if (activeResourceType && QUERY_BACKED_CLUSTER_VIEWS.has(activeResourceType)) {
      return null;
    }
    const refresher = activeResourceType ? clusterViewToRefresher[activeResourceType] : null;
    return refresher ? (CLUSTER_REFRESHER_TO_DOMAIN[refresher] ?? null) : null;
  }, [activeResourceType]);
  const activeClusterScope = activeClusterDomain ? getScopeForDomain(activeClusterDomain) : null;
  const activeClusterDomainEnabled = Boolean(
    activeClusterDomain && !domainPermissionDenied[activeClusterDomain]
  );

  useScopedRefreshDomainLifecycle({
    domain: activeClusterDomain,
    scope: activeClusterScope,
    enabled: activeClusterDomainEnabled,
    preserveState: true,
  });

  useEffect(() => {
    if (!activeClusterDomain || !activeClusterScope || !activeClusterDomainEnabled) {
      return;
    }
    const state = domainStateRef.current[activeClusterDomain];
    if (state && !state.data && state.status === 'idle') {
      // fetchScopedDomain handles streaming domains internally — it will
      // start a stream if appropriate, or fall back to a snapshot fetch.
      void requestRefreshDomain({
        domain: activeClusterDomain,
        scope: activeClusterScope,
        reason: 'startup',
      });
    }
  }, [activeClusterDomain, activeClusterDomainEnabled, activeClusterScope]);

  useEffect(() => {
    // Capture the scope resolver so the teardown disables each domain at the
    // scope that was active when the effect ran (avoids stale-closure drift) and
    // at the same per-domain scope the subscriptions/handles acquired.
    const resolveScope = getScopeForDomain;
    return () => {
      CLUSTER_DOMAIN_SET.forEach((domain) => {
        setRefreshDomainEnabled({
          domain,
          scope: resolveScope(domain),
          enabled: false,
          preserveState: true,
        });
      });
    };
  }, [getScopeForDomain]);

  useEffect(() => {
    const handleKubeconfigChanging = () => {
      CLUSTER_DOMAIN_SET.forEach((domain) => {
        // resetDomain already delegates to resetAllScopedDomainStates for scoped domains.
        refreshOrchestrator.resetDomain(domain);
      });
    };

    const handleKubeconfigChanged = () => {
      setActiveResourceTypeWithCallback(null);
    };

    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);

    return () => {
      unsubChanging();
      unsubChanged();
    };
  }, [setActiveResourceTypeWithCallback]);

  const rbac = useDescriptorBackedClusterResource<any[]>(
    clusterResourceDescriptors.rbac,
    rbacDomain,
    getScopeForDomain('cluster-rbac'),
    selectedClusterId,
    isPaused,
    isManualRefreshActive
  );
  const storage = useDescriptorBackedClusterResource<any[]>(
    clusterResourceDescriptors.storage,
    storageDomain,
    getScopeForDomain('cluster-storage'),
    selectedClusterId,
    isPaused,
    isManualRefreshActive
  );
  const config = useDescriptorBackedClusterResource<any[]>(
    clusterResourceDescriptors.config,
    configDomain,
    getScopeForDomain('cluster-config'),
    selectedClusterId,
    isPaused,
    isManualRefreshActive
  );
  const crds = useDescriptorBackedClusterResource<any[]>(
    clusterResourceDescriptors.crds,
    crdDomain,
    getScopeForDomain('cluster-crds'),
    selectedClusterId,
    isPaused,
    isManualRefreshActive
  );
  const custom = useMemo(() => createCatalogBackedCustomResourceHandle<ClusterCustomEntry>(), []);
  const events = useDescriptorBackedClusterResource<any[]>(
    clusterResourceDescriptors.events,
    eventsDomain,
    getScopeForDomain('cluster-events'),
    selectedClusterId,
    isPaused,
    isManualRefreshActive
  );

  useEffect(() => {
    if (!activeResourceType) {
      return;
    }
    if (QUERY_BACKED_CLUSTER_VIEWS.has(activeResourceType)) {
      return;
    }

    const shouldSkip = (() => {
      switch (activeResourceType) {
        case 'nodes':
          return nodes.data !== null
            ? true
            : nodes.loading || !!nodes.error || domainPermissionDenied['nodes'];
        case 'rbac':
          return rbac.data !== null
            ? true
            : rbac.loading || !!rbac.error || domainPermissionDenied['cluster-rbac'];
        case 'storage':
          return storage.data !== null
            ? true
            : storage.loading || !!storage.error || domainPermissionDenied['cluster-storage'];
        case 'config':
          return config.data !== null
            ? true
            : config.loading || !!config.error || domainPermissionDenied['cluster-config'];
        case 'crds':
          return crds.data !== null
            ? true
            : crds.loading || !!crds.error || domainPermissionDenied['cluster-crds'];
        case 'custom':
          return true;
        case 'events':
          return events.data !== null
            ? true
            : events.loading || !!events.error || domainPermissionDenied['cluster-events'];
        default:
          return true;
      }
    })();

    if (shouldSkip) {
      return;
    }

    const refresher = clusterViewToRefresher[activeResourceType];
    const domain = refresher ? CLUSTER_REFRESHER_TO_DOMAIN[refresher] : undefined;
    if (!domain) {
      return;
    }

    void requestRefreshDomain({
      domain,
      scope: getScopeForDomain(domain),
      reason: 'startup',
    });
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
    getScopeForDomain,
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
