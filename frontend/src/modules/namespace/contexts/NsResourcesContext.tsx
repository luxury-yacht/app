/**
 * frontend/src/modules/namespace/contexts/NsResourcesContext.tsx
 *
 * Context and provider for NsResourcesContext.
 * - Manages the state and operations related to namespace-specific resources.
 * - Provides functionality to load, refresh, and reset resources per namespace.
 * - Integrates with the refresh orchestrator and capability evaluation system.
 * - Exposes a custom hook `useNamespaceResources` for easy access to the context.
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
import type {
  NamespaceAutoscalingSnapshotPayload,
  NamespaceAutoscalingSummary,
  NamespaceCustomSnapshotPayload,
  NamespaceHelmSnapshotPayload,
  NamespaceHelmSummary,
  NamespaceCustomSummary,
} from '@/core/refresh/types';
import { queryNamespacePermissions } from '@/core/capabilities';
import {
  refreshOrchestrator,
  useRefreshScopedDomain,
  useRefreshScopedDomainStates,
} from '@/core/refresh';
import type { NamespaceRefresherKey } from '@/core/refresh/refresherTypes';
import type { RefreshDomain } from '@/core/refresh/types';
import type { NamespaceViewType } from '@/types/navigation/views';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { resetScopedDomainState } from '@/core/refresh/store';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';

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

const DOMAIN_BY_RESOURCE: Partial<Record<NamespaceViewType, RefreshDomain | null>> = {
  pods: null,
  workloads: 'namespace-workloads',
  config: 'namespace-config',
  network: 'namespace-network',
  rbac: 'namespace-rbac',
  storage: 'namespace-storage',
  autoscaling: 'namespace-autoscaling',
  quotas: 'namespace-quotas',
  custom: 'namespace-custom',
  helm: 'namespace-helm',
  events: 'namespace-events',
};

// Filter merged namespace payloads to the active cluster tab.
const filterByClusterId = <T extends { clusterId?: string | null }>(
  items: T[] | null | undefined,
  clusterId?: string | null
): T[] => {
  if (!items || items.length === 0) {
    return [];
  }
  if (!clusterId) {
    return items.filter((item) => !item.clusterId);
  }
  return items.filter((item) => item.clusterId === clusterId);
};

const parseAutoscalingTarget = (
  target?: string | null
): { kind: string; name: string } | undefined => {
  if (!target) {
    return undefined;
  }

  const [kindPart, ...nameParts] = target.split('/');
  if (!kindPart || nameParts.length === 0) {
    return undefined;
  }

  return {
    kind: kindPart,
    name: nameParts.join('/'),
  };
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

const useNamespacePodsResource = (
  enabled: boolean,
  namespace?: string | null,
  clusterId?: string | null
): PodsResourceDataReturn => {
  const scope = useMemo(
    () => normalizeNamespaceScope(namespace, clusterId),
    [clusterId, namespace]
  );

  const scopedStates = useRefreshScopedDomainStates('pods');
  const domainState = scope ? scopedStates[scope] : undefined;

  const baseLoad = useCallback(async () => {
    if (!enabled || !scope) {
      return;
    }
    await refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: true });
  }, [enabled, scope]);

  const refresh = useCallback(async () => {
    if (!enabled || !scope) {
      return;
    }
    await refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: true });
  }, [enabled, scope]);

  const reset = useCallback(() => {
    if (!scope) {
      return;
    }
    resetScopedDomainState('pods', scope);
  }, [scope]);

  const data = useMemo<PodSnapshotEntry[]>(() => {
    if (!domainState?.data?.pods) {
      return [];
    }
    return domainState.data.pods;
  }, [domainState?.data?.pods]);

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
  const metrics = domainState?.data?.metrics ?? null;

  return useMemo(
    () => ({
      data,
      loading,
      refreshing,
      error: domainState?.error ? new Error(domainState.error) : null,
      load: async (showSpinner = true) => {
        void showSpinner;
        await baseLoad();
      },
      refresh,
      reset,
      cancel: reset,
      lastFetchTime: domainState?.lastUpdated ? new Date(domainState.lastUpdated) : null,
      hasLoaded: Boolean(hasLoaded),
      metrics,
    }),
    [
      baseLoad,
      data,
      domainState?.error,
      domainState?.lastUpdated,
      hasLoaded,
      loading,
      metrics,
      refresh,
      refreshing,
      reset,
    ]
  );
};

function useRefreshBackedResource<T>(
  resourceKey: NamespaceRefresherKey,
  domain: RefreshDomain,
  selector: (payload: any) => T,
  fallback: T,
  enabled: boolean,
  namespace?: string | null,
  clusterId?: string | null
): ResourceDataReturn<T> {
  // Build the cluster-scoped namespace scope for this domain.
  const namespaceScope = useMemo(
    () => normalizeNamespaceScope(namespace, clusterId),
    [namespace, clusterId]
  );
  const domainState = useRefreshScopedDomain(domain, namespaceScope ?? '');
  const domainData = domainState.data;

  const load = useCallback(
    async (_showSpinner: boolean = true) => {
      if (!enabled || !namespaceScope) {
        return;
      }

      try {
        await refreshOrchestrator.fetchScopedDomain(domain, namespaceScope, { isManual: true });
      } catch (error) {
        errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
          source: `namespace-resource-load-${resourceKey}`,
        });
      }
    },
    [domain, enabled, namespaceScope, resourceKey]
  );

  const refresh = useCallback(async () => {
    if (!enabled || !namespaceScope) {
      return;
    }

    try {
      await refreshOrchestrator.fetchScopedDomain(domain, namespaceScope, { isManual: true });
    } catch (error) {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: `namespace-resource-refresh-${resourceKey}`,
      });
    }
  }, [domain, enabled, namespaceScope, resourceKey]);

  const reset = useCallback(() => {
    if (namespaceScope) {
      refreshOrchestrator.resetScopedDomain(domain, namespaceScope);
    }
  }, [domain, namespaceScope]);

  useEffect(() => {
    if (!enabled || !namespaceScope) {
      return;
    }
    if (domainState.status === 'idle' && !domainData) {
      void load(true);
    }
  }, [enabled, domainState.status, domainData, load, namespaceScope]);

  const data = useMemo(() => {
    if (!domainData) {
      return fallback;
    }
    const result = selector(domainData);
    return result ?? fallback;
  }, [domainData, selector, fallback]);

  const initialising =
    enabled &&
    Boolean(namespaceScope) &&
    (domainState.status === 'idle' || domainState.status === 'initialising') &&
    !domainData;
  const loadingStatus =
    initialising ||
    (enabled && Boolean(namespaceScope) && domainState.status === 'loading' && !domainData);

  return useMemo(
    () => ({
      data,
      loading: loadingStatus,
      refreshing: enabled && domainState.status === 'updating',
      error: domainState.error ? new Error(domainState.error) : null,
      load,
      refresh,
      reset,
      cancel: () => {
        if (namespaceScope) {
          refreshOrchestrator.resetScopedDomain(domain, namespaceScope);
        }
      },
      lastFetchTime: domainState.lastUpdated ? new Date(domainState.lastUpdated) : null,
      hasLoaded:
        domainState.status === 'ready' ||
        domainState.status === 'error' ||
        (domainState.status === 'updating' && Boolean(domainData)),
    }),
    [
      data,
      domainData,
      domainState.status,
      domainState.error,
      domainState.lastUpdated,
      load,
      refresh,
      reset,
      domain,
      enabled,
      loadingStatus,
      namespaceScope,
    ]
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
        | NamespaceViewType
        | null
        | ((prev: NamespaceViewType | null) => NamespaceViewType | null)
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

  const isResourceActive = (resourceKey: NamespaceRefresherKey) =>
    Boolean(currentNamespace) && isNamespaceView && activeNamespaceView === resourceKey;

  const workloads = useRefreshBackedResource<any[]>(
    'workloads',
    'namespace-workloads',
    (payload) => filterByClusterId(payload?.workloads, namespaceClusterId),
    [],
    isResourceActive('workloads'),
    currentNamespace,
    namespaceClusterId
  );

  const config = useRefreshBackedResource<any[]>(
    'config',
    'namespace-config',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    [],
    isResourceActive('config'),
    currentNamespace,
    namespaceClusterId
  );

  const network = useRefreshBackedResource<any[]>(
    'network',
    'namespace-network',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    [],
    isResourceActive('network'),
    currentNamespace,
    namespaceClusterId
  );

  const rbac = useRefreshBackedResource<any[]>(
    'rbac',
    'namespace-rbac',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    [],
    isResourceActive('rbac'),
    currentNamespace,
    namespaceClusterId
  );

  const storage = useRefreshBackedResource<any[]>(
    'storage',
    'namespace-storage',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    [],
    isResourceActive('storage'),
    currentNamespace,
    namespaceClusterId
  );

  const autoscaling = useRefreshBackedResource<any[]>(
    'autoscaling',
    'namespace-autoscaling',
    (payload?: NamespaceAutoscalingSnapshotPayload) =>
      filterByClusterId(payload?.resources, namespaceClusterId).map(
        (item: NamespaceAutoscalingSummary) => {
          const scaleTargetRef = parseAutoscalingTarget(item.target);
          return {
            kind: item.kind,
            kindAlias: item.kind,
            name: item.name,
            namespace: item.namespace,
            // Multi-cluster identity — required for stable row keys and panel actions.
            clusterId: item.clusterId,
            clusterName: item.clusterName,
            scaleTargetRef,
            target: item.target,
            min: item.min,
            max: item.max,
            current: item.current,
            minReplicas: item.min,
            maxReplicas: item.max,
            currentReplicas: item.current,
            age: item.age,
          };
        }
      ),
    [],
    isResourceActive('autoscaling'),
    currentNamespace,
    namespaceClusterId
  );

  const quotas = useRefreshBackedResource<any[]>(
    'quotas',
    'namespace-quotas',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    [],
    isResourceActive('quotas'),
    currentNamespace,
    namespaceClusterId
  );

  const events = useRefreshBackedResource<any[]>(
    'events',
    'namespace-events',
    (payload) => filterByClusterId(payload?.events, namespaceClusterId),
    [],
    isResourceActive('events'),
    currentNamespace,
    namespaceClusterId
  );

  const podsEnabled =
    Boolean(currentNamespace) && isNamespaceView && activeNamespaceView === 'pods';
  const pods = useNamespacePodsResource(podsEnabled, currentNamespace, namespaceClusterId);

  const custom = useRefreshBackedResource<any[]>(
    'custom',
    'namespace-custom',
    (payload?: NamespaceCustomSnapshotPayload) =>
      filterByClusterId(payload?.resources, namespaceClusterId).map(
        (item: NamespaceCustomSummary) => ({
          kind: item.kind,
          kindAlias: item.kind,
          name: item.name,
          namespace: item.namespace,
          apiGroup: item.apiGroup,
          age: item.age,
          // Multi-cluster identity — required for stable row keys and panel actions.
          clusterId: item.clusterId,
          clusterName: item.clusterName,
          // Preserve metadata for the custom view/object panel.
          labels: item.labels,
          annotations: item.annotations,
        })
      ),
    [],
    isResourceActive('custom'),
    currentNamespace,
    namespaceClusterId
  );

  const helm = useRefreshBackedResource<any[]>(
    'helm',
    'namespace-helm',
    (payload?: NamespaceHelmSnapshotPayload) =>
      filterByClusterId(payload?.releases, namespaceClusterId).map(
        (release: NamespaceHelmSummary) => ({
          kind: 'HelmRelease',
          name: release.name,
          namespace: release.namespace,
          // Multi-cluster identity — required for stable row keys and panel actions.
          clusterId: release.clusterId,
          clusterName: release.clusterName,
          chart: release.chart,
          appVersion: release.appVersion,
          status: release.status,
          revision: release.revision,
          updated: release.updated,
          description: release.description,
          notes: release.notes,
          age: release.age,
        })
      ),
    [],
    isResourceActive('helm'),
    currentNamespace,
    namespaceClusterId
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
    const namespaceScope = normalizeNamespaceScope(currentNamespace, namespaceClusterId);
    const entries = Object.entries(DOMAIN_BY_RESOURCE) as Array<
      [NamespaceViewType, RefreshDomain | null]
    >;

    entries.forEach(([resourceKey, domain]) => {
      if (!domain) {
        return;
      }

      const shouldEnable =
        Boolean(currentNamespace) && isNamespaceView && activeNamespaceView === resourceKey;
      const preserveEventsState =
        domain === 'namespace-events' ? { preserveState: true } : undefined;
      if (namespaceScope) {
        refreshOrchestrator.setScopedDomainEnabled(
          domain,
          namespaceScope,
          shouldEnable,
          preserveEventsState
        );
      }

      if (!shouldEnable && !currentNamespace) {
        refreshOrchestrator.resetDomain(domain);
      }
    });
    if (namespaceScope) {
      refreshOrchestrator.setScopedDomainEnabled('pods', namespaceScope, podsEnabled);
    }
  }, [
    activeNamespaceView,
    currentNamespace,
    isNamespaceView,
    podsEnabled,
    pods,
    namespaceClusterId,
  ]);

  useEffect(() => {
    const domains = Object.values(DOMAIN_BY_RESOURCE).filter(Boolean) as RefreshDomain[];
    // Capture scope for cleanup closure.
    const cleanupScope = normalizeNamespaceScope(currentNamespace, namespaceClusterId);

    return () => {
      if (cleanupScope) {
        domains.forEach((domain) => {
          refreshOrchestrator.setScopedDomainEnabled(
            domain,
            cleanupScope,
            false,
            domain === 'namespace-events' ? { preserveState: true } : undefined
          );
        });
        refreshOrchestrator.setScopedDomainEnabled('pods', cleanupScope, false);
      }
    };
  }, [currentNamespace, namespaceClusterId]);

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

      if (!isNamespaceView) {
        return;
      }

      // Load the active resource type
      if (activeResourceType) {
        // Small delay to ensure reset completes before loading
        setTimeout(() => {
          switch (activeResourceType) {
            case 'browse':
              // Catalog-backed browse view manages its own refresh cadence.
              break;
            case 'pods':
              pods.load(true);
              break;
            case 'workloads':
              workloads.load(true);
              break;
            case 'config':
              config.load(true);
              break;
            case 'network':
              network.load(true);
              break;
            case 'rbac':
              rbac.load(true);
              break;
            case 'storage':
              storage.load(true);
              break;
            case 'events':
              events.load(true);
              break;
            case 'quotas':
              quotas.load(true);
              break;
            case 'autoscaling':
              autoscaling.load(true);
              break;
            case 'custom':
              custom.load(true);
              break;
            case 'helm':
              helm.load(true);
              break;
          }
        }, 100);
      }
    }
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

    if (activeKey === 'pods') {
      if (!podsResource.hasLoaded && !podsResource.loading) {
        void podsResource.load?.(true);
      }
      return;
    }

    if (activeKey === 'browse') {
      return;
    }

    const domain = DOMAIN_BY_RESOURCE[activeKey];
    const resource = resourcesRef.current[activeKey];

    if (!domain || !resource) {
      return;
    }

    if (!resource.hasLoaded && !resource.loading) {
      void resource.load?.(true);
      return;
    }

    resource.refresh && void resource.refresh();
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

  // All Namespaces: collect distinct (clusterId, namespace) pairs from
  // loaded domain data and query permissions for each. queryNamespacePermissions
  // skips namespaces that already have fresh results within TTL, so this
  // effect can fire on every data update without causing redundant queries.
  // Only genuinely new namespaces trigger an actual QueryPermissions call.
  useEffect(() => {
    if (getCapabilityNamespace(currentNamespace) !== null) {
      return;
    }

    const allDomainData = [
      workloads.data,
      pods.data,
      config.data,
      network.data,
      rbac.data,
      storage.data,
      autoscaling.data,
      quotas.data,
      custom.data,
      events.data,
    ];

    const seen = new Set<string>();
    for (const domainList of allDomainData) {
      if (!Array.isArray(domainList)) continue;
      for (const obj of domainList) {
        const ns = obj?.namespace;
        const cid = obj?.clusterId ?? namespaceClusterId;
        if (ns && cid) {
          seen.add(`${cid}|${ns}`);
        }
      }
    }

    for (const key of seen) {
      const [cid, ns] = key.split('|');
      queryNamespacePermissions(ns, cid);
    }
  }, [
    currentNamespace,
    namespaceClusterId,
    workloads.data,
    pods.data,
    config.data,
    network.data,
    rbac.data,
    storage.data,
    autoscaling.data,
    quotas.data,
    custom.data,
    events.data,
  ]);

  return (
    <NamespaceResourcesContext.Provider value={contextValue}>
      {children}
    </NamespaceResourcesContext.Provider>
  );
};
