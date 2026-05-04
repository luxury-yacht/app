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
import { requestRefreshDomain } from '@/core/data-access';
import type {
  NamespaceAutoscalingSnapshotPayload,
  NamespaceAutoscalingSummary,
  NamespaceCustomSnapshotPayload,
  NamespaceHelmSnapshotPayload,
  NamespaceHelmSummary,
  NamespaceCustomSummary,
} from '@/core/refresh/types';
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
import {
  refreshOrchestrator,
  useRefreshScopedDomain,
  useRefreshScopedDomainStates,
} from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { NamespaceRefresherKey } from '@/core/refresh/refresherTypes';
import type { RefreshDomain } from '@/core/refresh/types';
import type { NamespaceViewType } from '@/types/navigation/views';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { resetScopedDomainState } from '@/core/refresh/store';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useStableKeyedArray, useStableSelectedValue } from '@shared/hooks/useStableSelectedValue';

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
  target?: string | null,
  apiVersion?: string | null
): { kind: string; name: string; apiVersion?: string } | undefined => {
  if (!target) {
    return undefined;
  }

  const [kindPart, ...nameParts] = target.split('/');
  if (!kindPart || nameParts.length === 0) {
    return undefined;
  }

  // apiVersion is the wire-form "group/version" sourced from the
  // backend's HPA snapshot (NamespaceAutoscalingSummary.targetApiVersion).
  // Threaded so the object panel can open CRD scale targets with a
  // fully-qualified GVK.
  return {
    kind: kindPart,
    name: nameParts.join('/'),
    apiVersion: apiVersion ?? undefined,
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
  clusterId?: string | null,
  isPaused: boolean = false,
  isManualRefreshActive: boolean = false
): PodsResourceDataReturn => {
  const scope = useMemo(
    () => normalizeNamespaceScope(namespace, clusterId),
    [clusterId, namespace]
  );

  const scopedStates = useRefreshScopedDomainStates('pods');
  const domainState = scope ? scopedStates[scope] : undefined;

  const refresh = useCallback(async () => {
    if (!enabled || !scope) {
      return;
    }
    await requestRefreshDomain({
      domain: 'pods',
      scope,
      reason: 'user',
    });
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
        await requestRefreshDomain({
          domain: 'pods',
          scope,
          reason: showSpinner ? 'user' : 'startup',
        });
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
  const domainState = useRefreshScopedDomain(domain, namespaceScope ?? '');
  const domainData = domainState.data;

  const load = useCallback(
    async (_showSpinner: boolean = true) => {
      if (!enabled || !namespaceScope) {
        return;
      }

      try {
        await requestRefreshDomain({
          domain,
          scope: namespaceScope,
          reason: _showSpinner ? 'user' : 'startup',
        });
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
      await requestRefreshDomain({
        domain,
        scope: namespaceScope,
        reason: 'user',
      });
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
      return undefined;
    }
    return metaSelector(domainData);
  }, [domainData, metaSelector]);
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
      cancel: () => {
        if (namespaceScope) {
          refreshOrchestrator.resetScopedDomain(domain, namespaceScope);
        }
      },
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
      domain,
      enabled,
      meta,
      namespaceScope,
      passiveLoading.hasLoaded,
      passiveLoading.loading,
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
    (payload?: { kinds?: string[] }) => ({ kinds: payload?.kinds ?? [] }),
    [],
    isResourceActive('workloads'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive,
    (item) =>
      `${item.clusterId ?? namespaceClusterId ?? ''}::${item.namespace}::${item.kind}::${item.name}`
  );

  const config = useRefreshBackedResource<any[]>(
    'config',
    'namespace-config',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    (payload?: { kinds?: string[] }) => ({ kinds: payload?.kinds ?? [] }),
    [],
    isResourceActive('config'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const network = useRefreshBackedResource<any[]>(
    'network',
    'namespace-network',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    (payload?: { kinds?: string[] }) => ({ kinds: payload?.kinds ?? [] }),
    [],
    isResourceActive('network'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const rbac = useRefreshBackedResource<any[]>(
    'rbac',
    'namespace-rbac',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    (payload?: { kinds?: string[] }) => ({ kinds: payload?.kinds ?? [] }),
    [],
    isResourceActive('rbac'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const storage = useRefreshBackedResource<any[]>(
    'storage',
    'namespace-storage',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    undefined,
    [],
    isResourceActive('storage'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const autoscaling = useRefreshBackedResource<any[]>(
    'autoscaling',
    'namespace-autoscaling',
    (payload?: NamespaceAutoscalingSnapshotPayload) =>
      filterByClusterId(payload?.resources, namespaceClusterId).map(
        (item: NamespaceAutoscalingSummary) => {
          const scaleTargetRef = parseAutoscalingTarget(item.target, item.targetApiVersion);
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
    (payload?: NamespaceAutoscalingSnapshotPayload) => ({ kinds: payload?.kinds ?? [] }),
    [],
    isResourceActive('autoscaling'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive,
    (item: NamespaceAutoscalingSummary) =>
      `${item.clusterId ?? namespaceClusterId ?? ''}::${item.namespace}::${item.kind}::${item.name}`
  );

  const quotas = useRefreshBackedResource<any[]>(
    'quotas',
    'namespace-quotas',
    (payload) => filterByClusterId(payload?.resources, namespaceClusterId),
    (payload?: { kinds?: string[] }) => ({ kinds: payload?.kinds ?? [] }),
    [],
    isResourceActive('quotas'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

  const events = useRefreshBackedResource<any[]>(
    'events',
    'namespace-events',
    (payload) => filterByClusterId(payload?.events, namespaceClusterId),
    undefined,
    [],
    isResourceActive('events'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive,
    (item) =>
      `${item.clusterId ?? namespaceClusterId ?? ''}::${item.objectNamespace ?? item.namespace ?? ''}::${item.uid || item.name || `${item.object ?? ''}:${item.source ?? ''}:${item.reason ?? ''}:${item.type ?? ''}`}`
  );

  const podsEnabled =
    Boolean(currentNamespace) && isNamespaceView && activeNamespaceView === 'pods';
  const pods = useNamespacePodsResource(
    podsEnabled,
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive
  );

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
          apiVersion: item.apiVersion,
          // CRD name (e.g. "dbinstances.rds.services.k8s.aws") for the
          // CRD column's clickable cell. See NsViewCustom.
          crdName: item.crdName,
          age: item.age,
          // Multi-cluster identity — required for stable row keys and panel actions.
          clusterId: item.clusterId,
          clusterName: item.clusterName,
          // Preserve metadata for the custom view/object panel.
          labels: item.labels,
          annotations: item.annotations,
        })
      ),
    (payload?: NamespaceCustomSnapshotPayload) => ({ kinds: payload?.kinds ?? [] }),
    [],
    isResourceActive('custom'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive,
    (item) =>
      `${item.clusterId ?? namespaceClusterId ?? ''}::${item.namespace}::${item.apiGroup ?? ''}::${item.apiVersion ?? ''}::${item.kind}::${item.name}`
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
    undefined,
    [],
    isResourceActive('helm'),
    currentNamespace,
    namespaceClusterId,
    isPaused,
    isManualRefreshActive,
    (release: NamespaceHelmSummary) =>
      `${release.clusterId ?? namespaceClusterId ?? ''}::${release.namespace}::${release.name}`
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
              res.custom.load(false);
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

    if (activeKey === 'pods') {
      if (!podsResource.hasLoaded && !podsResource.loading) {
        void podsResource.load?.(false);
      }
      return;
    }

    if (activeKey === 'browse' || activeKey === 'map') {
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

    const activeDomainData =
      activeKey === 'browse'
        ? [
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
          ]
        : [
            {
              pods: pods.data,
              workloads: workloads.data,
              config: config.data,
              network: network.data,
              rbac: rbac.data,
              storage: storage.data,
              autoscaling: autoscaling.data,
              quotas: quotas.data,
              custom: custom.data,
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
    workloads.data,
    pods.data,
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
