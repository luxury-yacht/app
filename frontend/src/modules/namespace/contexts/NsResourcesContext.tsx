/**
 * frontend/src/modules/namespace/contexts/NsResourcesContext.tsx
 *
 * Provides namespace-scoped resource data to namespace views. It binds each
 * namespace resource family to its refresh domain, exposes refresh/reset/load
 * handles, and keeps rows filtered to the active cluster.
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
import { errorHandler } from '@/utils/errorHandler';
import { type ResourceDataReturn } from '@hooks/resources';
import type { SnapshotStats } from '@/core/refresh/client';
import { useRefreshDomainHandle } from '@/core/data-access';
import {
  ALL_NAMESPACE_PERMISSIONS,
  AUTOSCALING_PERMISSIONS,
  CONFIG_PERMISSIONS,
  EVENT_PERMISSIONS,
  NETWORK_PERMISSIONS,
  POD_PERMISSIONS,
  QUOTA_PERMISSIONS,
  RBAC_PERMISSIONS,
  STORAGE_PERMISSIONS,
  WORKLOAD_PERMISSIONS,
  queryNamespacePermissions,
  queryNamespacesPermissions,
  type PermissionSpecList,
} from '@/core/capabilities';
import { refreshOrchestrator } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { NamespaceRefresherKey } from '@/core/refresh/refresherTypes';
import type { RefreshDomain } from '@/core/refresh/types';
import type { NamespaceViewType } from '@/types/navigation/views';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useStableKeyedArray, useStableSelectedValue } from '@shared/hooks/useStableSelectedValue';
import {
  namespaceResourceDescriptors,
  type NamespaceResourceDescriptor,
} from './namespaceResourceDescriptors';
import { createCatalogBackedCustomResourceHandle } from '@modules/browse/catalogBackedCustomResourceHandle';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';

export interface PodsResourceDataReturn extends ResourceDataReturn<PodSnapshotEntry[]> {
  metrics: PodMetricsInfo | null;
}

interface NamespaceResourcesContextType {
  pods: PodsResourceDataReturn;
  workloads: ResourceDataReturn<any[]>;
  config: ResourceDataReturn<any[]>;
  network: ResourceDataReturn<any[]>;
  rbac: ResourceDataReturn<any[]>;
  storage: ResourceDataReturn<any[]>;
  autoscaling: ResourceDataReturn<any[]>;
  quotas: ResourceDataReturn<any[]>;
  custom: ResourceDataReturn<any[]>;
  helm: ResourceDataReturn<any[]>;
  events: ResourceDataReturn<any[]>;

  currentNamespace: string | null;
  setCurrentNamespace: (namespace: string | null) => void;

  activeResourceType: NamespaceViewType | null;
  setActiveResourceType: React.Dispatch<React.SetStateAction<NamespaceViewType | null>>;
}

const NamespaceResourcesContext = createContext<NamespaceResourcesContextType | undefined>(
  undefined
);

const DEFAULT_NAMESPACE_VIEW: NamespaceViewType = 'workloads';

const QUERY_BACKED_ALL_NAMESPACE_VIEWS = new Set<NamespaceViewType>([
  'pods',
  'workloads',
  'config',
  'network',
  'rbac',
  'storage',
  'autoscaling',
  'quotas',
  'helm',
  'events',
]);

const DOMAIN_BY_RESOURCE: Partial<Record<NamespaceViewType, RefreshDomain | null>> = {
  pods: null,
  workloads: 'namespace-workloads',
  config: 'namespace-config',
  network: 'namespace-network',
  rbac: 'namespace-rbac',
  storage: 'namespace-storage',
  autoscaling: 'namespace-autoscaling',
  quotas: 'namespace-quotas',
  custom: null,
  helm: 'namespace-helm',
  events: 'namespace-events',
};

const PERMISSIONS_BY_RESOURCE: Partial<Record<NamespaceViewType, PermissionSpecList[]>> = {
  browse: ALL_NAMESPACE_PERMISSIONS,
  pods: [POD_PERMISSIONS],
  workloads: [WORKLOAD_PERMISSIONS],
  config: [CONFIG_PERMISSIONS],
  network: [NETWORK_PERMISSIONS],
  rbac: [RBAC_PERMISSIONS],
  storage: [STORAGE_PERMISSIONS],
  autoscaling: [AUTOSCALING_PERMISSIONS],
  quotas: [QUOTA_PERMISSIONS],
  events: [EVENT_PERMISSIONS],
};

const normalizeNamespaceScope = (
  value?: string | null,
  clusterId?: string | null
): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const namespaceScope = trimmed.startsWith('namespace:') ? trimmed : `namespace:${trimmed}`;
  return buildClusterScope(clusterId ?? undefined, namespaceScope);
};

const getCapabilityNamespace = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('namespace:')) {
    const actual = trimmed.slice('namespace:'.length);
    return actual && actual !== 'all' ? actual : null;
  }
  return trimmed === 'all' ? null : trimmed;
};

const withSnapshotStatsMeta = (base: unknown, stats?: SnapshotStats | null): unknown => {
  if (!stats) {
    return base;
  }
  if (base && typeof base === 'object' && !Array.isArray(base)) {
    return { ...base, tableStats: stats };
  }
  return { tableStats: stats };
};

const useNamespacePodsResource = (
  enabled: boolean,
  namespace?: string | null,
  clusterId?: string | null,
  isPaused: boolean = false,
  isManualRefreshActive: boolean = false
): PodsResourceDataReturn => {
  const scope = useMemo(
    () => normalizeNamespaceScope(namespace, clusterId),
    [clusterId, namespace]
  );

  const {
    state: podDomainState,
    refresh: refreshPodsDomain,
    reset: resetPodsDomain,
  } = useRefreshDomainHandle({
    domain: 'pods',
    scope,
    enabled,
    preserveState: true,
  });
  const domainState = scope ? podDomainState : undefined;

  const refresh = useCallback(async () => {
    if (!enabled || !scope) {
      return;
    }
    await refreshPodsDomain('user');
  }, [enabled, refreshPodsDomain, scope]);

  const reset = useCallback(() => {
    if (!scope) {
      return;
    }
    resetPodsDomain();
  }, [resetPodsDomain, scope]);

  const data = useMemo<PodSnapshotEntry[]>(() => {
    if (!domainState?.data?.rows) {
      return [];
    }
    return domainState.data.rows;
  }, [domainState?.data?.rows]);
  const stableData = useStableKeyedArray(
    data,
    (pod) => `${pod.clusterId ?? clusterId ?? ''}::${pod.namespace}::${pod.name}`
  );
  const stableMetrics = useStableSelectedValue(domainState?.data?.metrics ?? null);

  const initialising =
    enabled &&
    Boolean(scope) &&
    (domainState?.status === 'idle' ||
      domainState?.status === 'initialising' ||
      domainState?.status === 'loading') &&
    !domainState?.data;
  const loading =
    initialising ||
    (enabled && Boolean(scope) && domainState?.status === 'loading' && !domainState?.data);
  const refreshing = enabled && domainState?.status === 'updating' && Boolean(scope);
  const hasLoaded =
    domainState?.status === 'ready' ||
    domainState?.status === 'error' ||
    (domainState?.status === 'updating' && Boolean(domainState?.data));
  const passiveLoading = applyPassiveLoadingPolicy({
    loading,
    hasLoaded: Boolean(hasLoaded),
    isPaused,
    isManualRefreshActive,
  });
  const metrics = stableMetrics;

  return useMemo(
    () => ({
      data: stableData,
      loading: passiveLoading.loading,
      refreshing,
      error: domainState?.error ? new Error(domainState.error) : null,
      load: async (showSpinner = true) => {
        if (!enabled || !scope) {
          return;
        }
        await refreshPodsDomain(showSpinner ? 'user' : 'startup');
      },
      refresh,
      reset,
      cancel: reset,
      lastFetchTime: domainState?.lastUpdated ? new Date(domainState.lastUpdated) : null,
      hasLoaded: passiveLoading.hasLoaded,
      metrics,
    }),
    [
      domainState?.error,
      domainState?.lastUpdated,
      enabled,
      metrics,
      passiveLoading.hasLoaded,
      passiveLoading.loading,
      refresh,
      refreshPodsDomain,
      refreshing,
      reset,
      scope,
      stableData,
    ]
  );
};

function useRefreshBackedResource<T>(
  resourceKey: NamespaceRefresherKey,
  domain: RefreshDomain,
  selector: (payload: any) => T,
  metaSelector: ((payload: any) => unknown) | undefined,
  fallback: T,
  enabled: boolean,
  namespace?: string | null,
  clusterId?: string | null,
  isPaused: boolean = false,
  isManualRefreshActive: boolean = false,
  keyedRowIdentity?: ((item: any) => string) | undefined
): ResourceDataReturn<T> {
  // Build the cluster-scoped namespace scope for this domain.
  const namespaceScope = useMemo(
    () => normalizeNamespaceScope(namespace, clusterId),
    [namespace, clusterId]
  );
  const {
    state: domainState,
    refresh: refreshDomain,
    reset: resetDomain,
  } = useRefreshDomainHandle({
    domain,
    scope: namespaceScope,
    enabled,
    preserveState: true,
  });
  const domainData = domainState.data;

  const load = useCallback(
    async (_showSpinner: boolean = true) => {
      if (!enabled || !namespaceScope) {
        return;
      }

      try {
        await refreshDomain(_showSpinner ? 'user' : 'startup');
      } catch (error) {
        errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
          source: `namespace-resource-load-${resourceKey}`,
        });
      }
    },
    [enabled, namespaceScope, refreshDomain, resourceKey]
  );

  const refresh = useCallback(async () => {
    if (!enabled || !namespaceScope) {
      return;
    }

    try {
      await refreshDomain('user');
    } catch (error) {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: `namespace-resource-refresh-${resourceKey}`,
      });
    }
  }, [enabled, namespaceScope, refreshDomain, resourceKey]);

  const reset = useCallback(() => {
    resetDomain();
  }, [resetDomain]);

  useEffect(() => {
    if (!enabled || !namespaceScope) {
      return;
    }
    if (domainState.status === 'idle' && !domainData) {
      void load(false);
    }
  }, [enabled, domainState.status, domainData, load, namespaceScope]);

  const selectedData = useMemo(
    () => (!domainData ? fallback : (selector(domainData) ?? fallback)),
    [domainData, selector, fallback]
  );
  const shallowStableData = useStableSelectedValue(selectedData);
  const stableKeyedRows = useStableKeyedArray(
    Array.isArray(selectedData) ? selectedData : [],
    keyedRowIdentity ?? (() => '')
  );
  const data =
    Array.isArray(selectedData) && keyedRowIdentity ? (stableKeyedRows as T) : shallowStableData;

  const selectedMeta = useMemo(() => {
    if (!domainData || !metaSelector) {
      return withSnapshotStatsMeta(undefined, domainState.stats);
    }
    return withSnapshotStatsMeta(metaSelector(domainData), domainState.stats);
  }, [domainData, domainState.stats, metaSelector]);
  const meta = useStableSelectedValue(selectedMeta);

  const initialising =
    enabled &&
    Boolean(namespaceScope) &&
    (domainState.status === 'idle' || domainState.status === 'initialising') &&
    !domainData;
  const loadingStatus =
    initialising ||
    (enabled && Boolean(namespaceScope) && domainState.status === 'loading' && !domainData);
  const hasLoaded =
    domainState.status === 'ready' ||
    domainState.status === 'error' ||
    (domainState.status === 'updating' && Boolean(domainData));
  const passiveLoading = applyPassiveLoadingPolicy({
    loading: loadingStatus,
    hasLoaded,
    isPaused,
    isManualRefreshActive,
  });

  return useMemo(
    () => ({
      data,
      loading: passiveLoading.loading,
      refreshing: enabled && domainState.status === 'updating',
      error: domainState.error ? new Error(domainState.error) : null,
      load,
      refresh,
      reset,
      cancel: reset,
      lastFetchTime: domainState.lastUpdated ? new Date(domainState.lastUpdated) : null,
      hasLoaded: passiveLoading.hasLoaded,
      meta,
    }),
    [
      data,
      domainState.status,
      domainState.error,
      domainState.lastUpdated,
      load,
      refresh,
      reset,
      enabled,
      meta,
      passiveLoading.hasLoaded,
      passiveLoading.loading,
    ]
  );
}

function useDescriptorBackedResource<T>(
  descriptor: NamespaceResourceDescriptor<T>,
  enabled: boolean,
  namespace?: string | null,
  clusterId?: string | null,
  isPaused: boolean = false,
  isManualRefreshActive: boolean = false
): ResourceDataReturn<T> {
  return useRefreshBackedResource<T>(
    descriptor.resourceKey,
    descriptor.domain,
    (payload) => descriptor.select(payload, clusterId),
    descriptor.meta,
    descriptor.fallback,
    enabled,
    namespace,
    clusterId,
    isPaused,
    isManualRefreshActive,
    descriptor.rowIdentity ? (item) => descriptor.rowIdentity!(item, clusterId) : undefined
  );
}

export const useNamespaceResources = () => {
  const context = useContext(NamespaceResourcesContext);
  if (!context) {
    throw new Error('useNamespaceResources must be used within NamespaceResourcesProvider');
  }
  return context;
};

// Custom hook for individual resource types
export const useNamespaceResource = (
  resourceKind: keyof Omit<
    NamespaceResourcesContextType,
    'currentNamespace' | 'setCurrentNamespace' | 'activeResourceType' | 'setActiveResourceType'
  >
) => {
  const context = useNamespaceResources();
  return context[resourceKind];
};

interface NamespaceResourcesProviderProps {
  children: ReactNode;
  namespace?: string;
  activeView?: NamespaceViewType | null;
}

export const NamespaceResourcesProvider: React.FC<NamespaceResourcesProviderProps> = ({
  children,
  namespace: propNamespace,
  activeView,
}) => {
  const { viewType } = useViewState();
  const { selectedClusterId } = useKubeconfig();
  const { selectedNamespaceClusterId } = useNamespace();
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  // Prefer the cluster tied to the namespace selection; fall back to the kubeconfig selection.
  const namespaceClusterId = selectedNamespaceClusterId ?? selectedClusterId;
  const isNamespaceView = viewType === 'namespace';
  const [currentNamespace, setCurrentNamespace] = useState<string | null>(propNamespace || null);
  // Default to 'workloads' since that's the default view in NamespaceViews
  const [activeResourceType, setActiveResourceTypeState] = useState<NamespaceViewType | null>(
    activeView ?? DEFAULT_NAMESPACE_VIEW
  );
  const setActiveResourceType = useCallback(
    (
      next:
        NamespaceViewType | null | ((prev: NamespaceViewType | null) => NamespaceViewType | null)
    ) => {
      setActiveResourceTypeState((prev) =>
        typeof next === 'function'
          ? ((next as (prev: NamespaceViewType | null) => NamespaceViewType | null)(prev) ?? null)
          : (next ?? null)
      );
    },
    []
  );

  useEffect(() => {
    if (activeView !== undefined) {
      setActiveResourceTypeState(activeView ?? DEFAULT_NAMESPACE_VIEW);
    }
  }, [activeView]);

  const activeNamespaceView = activeResourceType ?? DEFAULT_NAMESPACE_VIEW;

  const isAllNamespacesQueryBackedView =
    currentNamespace === ALL_NAMESPACES_SCOPE &&
    QUERY_BACKED_ALL_NAMESPACE_VIEWS.has(activeNamespaceView);

  const isResourceActive = (resourceKey: NamespaceRefresherKey) =>
    Boolean(currentNamespace) &&
    isNamespaceView &&
    activeNamespaceView === resourceKey &&
    !isAllNamespacesQueryBackedView;

  const workloads = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.workloads,
    isResourceActive('workloads'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const config = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.config,
    isResourceActive('config'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const network = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.network,
    isResourceActive('network'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const rbac = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.rbac,
    isResourceActive('rbac'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const storage = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.storage,
    isResourceActive('storage'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const autoscaling = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.autoscaling,
    isResourceActive('autoscaling'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const quotas = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.quotas,
    isResourceActive('quotas'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const events = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.events,
    isResourceActive('events'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const podsEnabled =
    Boolean(currentNamespace) &&
    currentNamespace !== ALL_NAMESPACES_SCOPE &&
    isNamespaceView &&
    activeNamespaceView === 'pods';
  const pods = useNamespacePodsResource(
    podsEnabled,
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const custom = useMemo(() => createCatalogBackedCustomResourceHandle<any>(), []);

  const helm = useDescriptorBackedResource<any[]>(
    namespaceResourceDescriptors.helm,
    isResourceActive('helm'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  useEffect(() => {
    if (!isNamespaceView) {
      refreshOrchestrator.updateContext({
        selectedNamespace: undefined,
        selectedNamespaceClusterId: undefined,
      });
      return;
    }
    refreshOrchestrator.updateContext({
      selectedNamespace: currentNamespace ?? undefined,
      selectedNamespaceClusterId: currentNamespace ? (namespaceClusterId ?? undefined) : undefined,
    });
  }, [currentNamespace, isNamespaceView, namespaceClusterId]);

  useEffect(() => {
    const nextNamespace = propNamespace ?? null;

    if (nextNamespace === currentNamespace) {
      return;
    }

    setCurrentNamespace(nextNamespace);
  }, [propNamespace, currentNamespace]);

  // Create refresh watchers for each resource type
  // Each watcher only refreshes when its view is active

  // Store resources in refs to avoid stale closures
  const resourcesRef = useRef({
    pods,
    workloads,
    config,
    network,
    rbac,
    storage,
    events,
    quotas,
    autoscaling,
    custom,
    helm,
  });
  resourcesRef.current = {
    pods,
    workloads,
    config,
    network,
    rbac,
    storage,
    events,
    quotas,
    autoscaling,
    custom,
    helm,
  };

  // Track previous namespace to detect changes
  const prevNamespaceRef = useRef<string | null>(null);

  // Reset all resources when namespace actually changes
  useEffect(() => {
    // Check if namespace actually changed
    if (prevNamespaceRef.current === currentNamespace) return;

    // Don't reset on initial mount when there's no previous namespace
    if (prevNamespaceRef.current === null && !currentNamespace) return;

    // Update the previous namespace
    prevNamespaceRef.current = currentNamespace;

    let timerId: ReturnType<typeof setTimeout> | undefined;

    // If we have a namespace, reset and reload
    if (currentNamespace) {
      // Reset all resources immediately when namespace changes
      pods.reset();
      workloads.reset();
      config.reset();
      network.reset();
      rbac.reset();
      storage.reset();
      events.reset();
      quotas.reset();
      autoscaling.reset();
      custom.reset();
      helm.reset();

      if (isNamespaceView && activeResourceType) {
        // Small delay to ensure reset completes before loading.
        // Read from resourcesRef so the callback uses the latest handles.
        timerId = setTimeout(() => {
          const res = resourcesRef.current;
          switch (activeResourceType) {
            case 'browse':
              // Catalog-backed browse view manages its own refresh cadence.
              break;
            case 'map':
              // Object-map view owns its scoped snapshot lifecycle.
              break;
            case 'pods':
              res.pods.load(false);
              break;
            case 'workloads':
              res.workloads.load(false);
              break;
            case 'config':
              res.config.load(false);
              break;
            case 'network':
              res.network.load(false);
              break;
            case 'rbac':
              res.rbac.load(false);
              break;
            case 'storage':
              res.storage.load(false);
              break;
            case 'events':
              res.events.load(false);
              break;
            case 'quotas':
              res.quotas.load(false);
              break;
            case 'autoscaling':
              res.autoscaling.load(false);
              break;
            case 'custom':
              // Custom resource rows are catalog-backed; do not start the
              // namespace-custom fanout domain for the Custom table.
              break;
            case 'helm':
              res.helm.load(false);
              break;
          }
        }, 100);
      }
    }

    return () => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    };
  }, [
    currentNamespace,
    activeResourceType,
    pods,
    workloads,
    config,
    network,
    rbac,
    storage,
    events,
    quotas,
    autoscaling,
    custom,
    helm,
    isNamespaceView,
  ]); // Include all resources to ensure we use latest instances

  // Ensure active resource loads when switching views within a namespace
  useEffect(() => {
    if (!isNamespaceView || !currentNamespace) {
      return;
    }

    const activeKey = activeResourceType ?? DEFAULT_NAMESPACE_VIEW;
    const podsResource = resourcesRef.current.pods;

    if (
      currentNamespace === ALL_NAMESPACES_SCOPE &&
      QUERY_BACKED_ALL_NAMESPACE_VIEWS.has(activeKey)
    ) {
      return;
    }

    if (activeKey === 'pods') {
      if (!podsResource.hasLoaded && !podsResource.loading) {
        void podsResource.load?.(false);
      }
      return;
    }

    if (activeKey === 'browse' || activeKey === 'map') {
      return;
    }

    if (activeKey === 'custom') {
      return;
    }

    const domain = DOMAIN_BY_RESOURCE[activeKey];
    const resource = resourcesRef.current[activeKey];

    if (!domain || !resource) {
      return;
    }

    if (!resource.hasLoaded && !resource.loading) {
      void resource.load?.(false);
      return;
    }

    void resource.load?.(false);
  }, [activeResourceType, currentNamespace, isNamespaceView]);

  // Subscribe to view changes to know which resource to auto-refresh
  // Memoize the context value
  const contextValue = useMemo(
    () => ({
      pods,
      workloads,
      config,
      network,
      rbac,
      storage,
      quotas,
      autoscaling,
      custom,
      helm,
      events,
      currentNamespace,
      setCurrentNamespace,
      activeResourceType,
      setActiveResourceType,
    }),
    [
      pods,
      workloads,
      config,
      network,
      rbac,
      storage,
      quotas,
      autoscaling,
      custom,
      helm,
      events,
      currentNamespace,
      setCurrentNamespace,
      activeResourceType,
      setActiveResourceType,
    ]
  );

  // Single-namespace permission query.
  useEffect(() => {
    const capabilityNamespace = getCapabilityNamespace(currentNamespace);
    if (!capabilityNamespace) {
      return;
    }
    queryNamespacePermissions(capabilityNamespace, namespaceClusterId ?? null);
  }, [currentNamespace, namespaceClusterId]);

  // All Namespaces: collect distinct (clusterId, namespace) pairs from the
  // active tab and query that tab's permission specs in one store call.
  // Browse spans resource types, so it intentionally falls back to all loaded
  // domain data and the full namespace permission set.
  useEffect(() => {
    if (getCapabilityNamespace(currentNamespace) !== null) {
      return;
    }

    const activeKey = activeResourceType ?? DEFAULT_NAMESPACE_VIEW;
    const specLists = PERMISSIONS_BY_RESOURCE[activeKey] ?? [];
    if (specLists.length === 0) {
      return;
    }
    if (activeKey === 'map') {
      return;
    }

    // Notify-only domains carry no live rows (their baseline is dropped), so they
    // contribute nothing to the permission pre-fetch and are excluded here: pods,
    // namespace-workloads, and the namespace config/rbac/network/storage/autoscaling/
    // quotas tables. Visible pods get fresh permission pre-checks from NsViewPods's
    // per-view query-row scan; the rest fall back to on-demand permission checks.
    // Row-bearing domains (helm, events) still seed namespace targets.
    const activeDomainData =
      activeKey === 'browse'
        ? [events.data]
        : [
            {
              pods: [],
              workloads: [],
              config: [],
              network: [],
              rbac: [],
              storage: [],
              autoscaling: [],
              quotas: [],
              custom: [],
              helm: helm.data,
              events: events.data,
            }[activeKey],
          ];

    const seen = new Set<string>();
    const targets: Array<{ namespace: string; clusterId: string }> = [];
    for (const domainList of activeDomainData) {
      if (!Array.isArray(domainList)) continue;
      for (const obj of domainList) {
        const ns = obj?.namespace;
        const cid = obj?.clusterId ?? namespaceClusterId;
        if (ns && cid) {
          const key = `${cid}|${ns.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            targets.push({ namespace: ns, clusterId: cid });
          }
        }
      }
    }

    if (targets.length > 0) {
      void queryNamespacesPermissions(targets, { specLists });
    }
  }, [
    activeResourceType,
    currentNamespace,
    namespaceClusterId,
    config.data,
    network.data,
    rbac.data,
    storage.data,
    autoscaling.data,
    quotas.data,
    custom.data,
    helm.data,
    events.data,
  ]);

  return (
    <NamespaceResourcesContext.Provider value={contextValue}>
      {children}
    </NamespaceResourcesContext.Provider>
  );
};
