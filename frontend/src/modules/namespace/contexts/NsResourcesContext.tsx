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
import {
  DEFAULT_CAPABILITY_TTL_MS,
  evaluateNamespacePermissions,
  registerNamespaceCapabilityDefinitions,
} from '@/core/capabilities';
import {
  refreshOrchestrator,
  useRefreshDomain,
  useRefreshScopedDomainStates,
} from '@/core/refresh';
import type { NamespaceRefresherKey } from '@/core/refresh/refresherTypes';
import type { RefreshDomain } from '@/core/refresh/types';
import type { NamespaceViewType } from '@/types/navigation/views';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { CapabilityDefinition } from '@/core/capabilities/catalog';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { resetScopedDomainState } from '@/core/refresh/store';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

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

type NamespaceCapabilitySpec = {
  id: string;
  resourceKind: string;
  verbs: string[];
  feature: string;
  subresource?: string;
};

const NAMESPACE_CAPABILITY_SPECS: Partial<
  Record<NamespaceRefresherKey, NamespaceCapabilitySpec[]>
> = {
  workloads: [
    {
      id: 'namespace:workloads',
      resourceKind: 'Deployment',
      verbs: ['list', 'patch', 'update', 'delete'],
      feature: 'Namespace workloads',
    },
    {
      id: 'namespace:statefulsets',
      resourceKind: 'StatefulSet',
      verbs: ['list', 'patch', 'update', 'delete'],
      feature: 'Namespace workloads',
    },
    {
      id: 'namespace:daemonsets',
      resourceKind: 'DaemonSet',
      verbs: ['list', 'patch', 'update', 'delete'],
      feature: 'Namespace workloads',
    },
    {
      id: 'namespace:jobs',
      resourceKind: 'Job',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace workloads',
    },
    {
      id: 'namespace:cronjobs',
      resourceKind: 'CronJob',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace workloads',
    },
    {
      id: 'namespace:pods',
      resourceKind: 'Pod',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace workloads',
    },
    {
      id: 'namespace:pods:log',
      resourceKind: 'Pod',
      verbs: ['get'],
      subresource: 'log',
      feature: 'Namespace workloads',
    },
  ],
  config: [
    {
      id: 'namespace:configmaps',
      resourceKind: 'ConfigMap',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace config',
    },
    {
      id: 'namespace:secrets',
      resourceKind: 'Secret',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace config',
    },
    {
      id: 'namespace:services',
      resourceKind: 'Service',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace config',
    },
  ],
  network: [
    {
      id: 'namespace:ingresses',
      resourceKind: 'Ingress',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace network',
    },
    {
      id: 'namespace:networkpolicies',
      resourceKind: 'NetworkPolicy',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace network',
    },
  ],
  rbac: [
    {
      id: 'namespace:role',
      resourceKind: 'Role',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace RBAC',
    },
    {
      id: 'namespace:rolebinding',
      resourceKind: 'RoleBinding',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace RBAC',
    },
  ],
  storage: [
    {
      id: 'namespace:persistentvolumeclaims',
      resourceKind: 'PersistentVolumeClaim',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace storage',
    },
  ],
  autoscaling: [
    {
      id: 'namespace:horizontalpodautoscalers',
      resourceKind: 'HorizontalPodAutoscaler',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace autoscaling',
    },
  ],
  quotas: [
    {
      id: 'namespace:resourcequotas',
      resourceKind: 'ResourceQuota',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace quotas',
    },
    {
      id: 'namespace:limitranges',
      resourceKind: 'LimitRange',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace quotas',
    },
    {
      // Include PDBs so the quotas view can surface disruption policies.
      id: 'namespace:poddisruptionbudgets',
      resourceKind: 'PodDisruptionBudget',
      verbs: ['list', 'update', 'delete'],
      feature: 'Namespace quotas',
    },
  ],
  events: [
    {
      id: 'namespace:events',
      resourceKind: 'Event',
      verbs: ['list'],
      feature: 'Namespace events',
    },
  ],
};

const PODS_CAPABILITY_SPECS: NamespaceCapabilitySpec[] = [
  {
    id: 'namespace:pods',
    resourceKind: 'Pod',
    verbs: ['list', 'update', 'delete'],
    feature: 'Namespace workloads',
  },
  {
    id: 'namespace:pods:log',
    resourceKind: 'Pod',
    verbs: ['get'],
    subresource: 'log',
    feature: 'Namespace workloads',
  },
];

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

const buildCapabilityDefinitionsForNamespace = (
  namespace: string,
  specs: NamespaceCapabilitySpec[]
): CapabilityDefinition[] =>
  specs.flatMap((spec) =>
    spec.verbs.map((verb) => {
      const descriptorId = `${spec.id}:${verb}:${namespace}`;
      return {
        id: descriptorId,
        scope: 'namespace' as const,
        feature: spec.feature,
        descriptor: {
          id: descriptorId,
          verb,
          resourceKind: spec.resourceKind,
          namespace,
          subresource: spec.subresource,
        },
      } satisfies CapabilityDefinition;
    })
  );

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
  const capabilityNamespace = useMemo(() => getCapabilityNamespace(namespace), [namespace]);

  const scopedStates = useRefreshScopedDomainStates('pods');
  const domainState = scope ? scopedStates[scope] : undefined;

  const baseLoad = useCallback(async () => {
    if (!enabled || !scope) {
      return;
    }
    if (capabilityNamespace) {
      const definitions = buildCapabilityDefinitionsForNamespace(
        capabilityNamespace,
        PODS_CAPABILITY_SPECS
      );
      registerNamespaceCapabilityDefinitions(capabilityNamespace, definitions, {
        force: false,
        ttlMs: DEFAULT_CAPABILITY_TTL_MS,
        clusterId,
      });
      evaluateNamespacePermissions(capabilityNamespace, { clusterId });
    }
    await refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: true });
  }, [capabilityNamespace, clusterId, enabled, scope]);

  const refresh = useCallback(async () => {
    if (!enabled || !scope) {
      return;
    }
    if (capabilityNamespace) {
      const definitions = buildCapabilityDefinitionsForNamespace(
        capabilityNamespace,
        PODS_CAPABILITY_SPECS
      );
      registerNamespaceCapabilityDefinitions(capabilityNamespace, definitions, {
        force: true,
        ttlMs: DEFAULT_CAPABILITY_TTL_MS,
        clusterId,
      });
    }
    await refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: true });
  }, [capabilityNamespace, clusterId, enabled, scope]);

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
  const domainState = useRefreshDomain(domain);
  const domainData = domainState.data;
  const isStreaming = refreshOrchestrator.isStreamingDomain(domain);
  const capabilitySpecs = useMemo(
    () => NAMESPACE_CAPABILITY_SPECS[resourceKey] ?? [],
    [resourceKey]
  );
  const capabilityNamespace = useMemo(() => getCapabilityNamespace(namespace), [namespace]);

  const load = useCallback(
    async (showSpinner: boolean = true) => {
      if (isStreaming || !enabled) {
        return;
      }

      if (capabilityNamespace && capabilitySpecs.length > 0) {
        const definitions = buildCapabilityDefinitionsForNamespace(
          capabilityNamespace,
          capabilitySpecs
        );
        registerNamespaceCapabilityDefinitions(capabilityNamespace, definitions, {
          force: false,
          ttlMs: DEFAULT_CAPABILITY_TTL_MS,
          clusterId,
        });
        evaluateNamespacePermissions(capabilityNamespace, { clusterId });
      }

      try {
        await refreshOrchestrator.triggerManualRefresh(domain, {
          suppressSpinner: !showSpinner,
        });
      } catch (error) {
        errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
          source: `namespace-resource-load-${resourceKey}`,
        });
      }
    },
    [capabilityNamespace, capabilitySpecs, clusterId, domain, enabled, isStreaming, resourceKey]
  );

  const refresh = useCallback(async () => {
    if (isStreaming || !enabled) {
      return;
    }

    if (capabilityNamespace && capabilitySpecs.length > 0) {
      const definitions = buildCapabilityDefinitionsForNamespace(
        capabilityNamespace,
        capabilitySpecs
      );
      registerNamespaceCapabilityDefinitions(capabilityNamespace, definitions, {
        force: true,
        ttlMs: DEFAULT_CAPABILITY_TTL_MS,
        clusterId,
      });
    }

    try {
      await refreshOrchestrator.triggerManualRefresh(domain, { suppressSpinner: true });
    } catch (error) {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: `namespace-resource-refresh-${resourceKey}`,
      });
    }
  }, [capabilityNamespace, capabilitySpecs, clusterId, domain, enabled, isStreaming, resourceKey]);

  const reset = useCallback(() => {
    refreshOrchestrator.resetDomain(domain);
  }, [domain]);

  useEffect(() => {
    if (isStreaming) {
      return;
    }
    if (!enabled) {
      return;
    }
    if (domainState.status === 'idle' && !domainData) {
      void load(true);
    }
  }, [isStreaming, enabled, domainState.status, domainData, load]);

  const data = useMemo(() => {
    if (!domainData) {
      return fallback;
    }
    const result = selector(domainData);
    return result ?? fallback;
  }, [domainData, selector, fallback]);

  const initialising =
    enabled &&
    (domainState.status === 'idle' || domainState.status === 'initialising') &&
    !domainData;
  const loadingStatus =
    initialising || (enabled && domainState.status === 'loading' && !domainData);

  return useMemo(
    () => ({
      data,
      loading: loadingStatus,
      refreshing: enabled && domainState.status === 'updating',
      error: domainState.error ? new Error(domainState.error) : null,
      load,
      refresh,
      reset,
      cancel: () => refreshOrchestrator.resetDomain(domain),
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
    (payload) => payload?.workloads ?? [],
    [],
    isResourceActive('workloads'),
    currentNamespace,
    selectedClusterId
  );

  const config = useRefreshBackedResource<any[]>(
    'config',
    'namespace-config',
    (payload) => payload?.resources ?? [],
    [],
    isResourceActive('config'),
    currentNamespace,
    selectedClusterId
  );

  const network = useRefreshBackedResource<any[]>(
    'network',
    'namespace-network',
    (payload) => payload?.resources ?? [],
    [],
    isResourceActive('network'),
    currentNamespace,
    selectedClusterId
  );

  const rbac = useRefreshBackedResource<any[]>(
    'rbac',
    'namespace-rbac',
    (payload) => payload?.resources ?? [],
    [],
    isResourceActive('rbac'),
    currentNamespace,
    selectedClusterId
  );

  const storage = useRefreshBackedResource<any[]>(
    'storage',
    'namespace-storage',
    (payload) => payload?.resources ?? [],
    [],
    isResourceActive('storage'),
    currentNamespace,
    selectedClusterId
  );

  const autoscaling = useRefreshBackedResource<any[]>(
    'autoscaling',
    'namespace-autoscaling',
    (payload?: NamespaceAutoscalingSnapshotPayload) =>
      (payload?.resources ?? []).map((item: NamespaceAutoscalingSummary) => {
        const scaleTargetRef = parseAutoscalingTarget(item.target);
        return {
          kind: item.kind,
          kindAlias: item.kind,
          name: item.name,
          namespace: item.namespace,
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
      }),
    [],
    isResourceActive('autoscaling'),
    currentNamespace,
    selectedClusterId
  );

  const quotas = useRefreshBackedResource<any[]>(
    'quotas',
    'namespace-quotas',
    (payload) => payload?.resources ?? [],
    [],
    isResourceActive('quotas'),
    currentNamespace,
    selectedClusterId
  );

  const events = useRefreshBackedResource<any[]>(
    'events',
    'namespace-events',
    (payload) => payload?.events ?? [],
    [],
    isResourceActive('events'),
    currentNamespace,
    selectedClusterId
  );

  const podsEnabled =
    Boolean(currentNamespace) && isNamespaceView && activeNamespaceView === 'pods';
  const pods = useNamespacePodsResource(podsEnabled, currentNamespace, selectedClusterId);

  const custom = useRefreshBackedResource<any[]>(
    'custom',
    'namespace-custom',
    (payload?: NamespaceCustomSnapshotPayload) =>
      (payload?.resources ?? []).map((item: NamespaceCustomSummary) => ({
        kind: item.kind,
        kindAlias: item.kind,
        name: item.name,
        namespace: item.namespace,
        apiGroup: item.apiGroup,
        age: item.age,
        // Preserve metadata for the custom view/object panel.
        labels: item.labels,
        annotations: item.annotations,
      })),
    [],
    isResourceActive('custom'),
    currentNamespace,
    selectedClusterId
  );

  const helm = useRefreshBackedResource<any[]>(
    'helm',
    'namespace-helm',
    (payload?: NamespaceHelmSnapshotPayload) =>
      (payload?.releases ?? []).map((release: NamespaceHelmSummary) => ({
        kind: 'HelmRelease',
        name: release.name,
        namespace: release.namespace,
        chart: release.chart,
        appVersion: release.appVersion,
        status: release.status,
        revision: release.revision,
        updated: release.updated,
        description: release.description,
        notes: release.notes,
        age: release.age,
      })),
    [],
    isResourceActive('helm'),
    currentNamespace,
    selectedClusterId
  );

  useEffect(() => {
    if (!isNamespaceView) {
      refreshOrchestrator.updateContext({ selectedNamespace: undefined });
      return;
    }
    refreshOrchestrator.updateContext({
      selectedNamespace: currentNamespace ?? undefined,
    });
  }, [currentNamespace, isNamespaceView]);

  useEffect(() => {
    const entries = Object.entries(DOMAIN_BY_RESOURCE) as Array<
      [NamespaceViewType, RefreshDomain | null]
    >;

    entries.forEach(([resourceKey, domain]) => {
      if (!domain) {
        return;
      }

      const shouldEnable =
        Boolean(currentNamespace) && isNamespaceView && activeNamespaceView === resourceKey;
      refreshOrchestrator.setDomainEnabled(domain, shouldEnable);

      if (!shouldEnable && !currentNamespace) {
        refreshOrchestrator.resetDomain(domain);
      }
    });
    const scope = normalizeNamespaceScope(currentNamespace, selectedClusterId);
    if (scope) {
      refreshOrchestrator.setScopedDomainEnabled('pods', scope, podsEnabled);
    }
  }, [
    activeNamespaceView,
    currentNamespace,
    isNamespaceView,
    podsEnabled,
    pods,
    selectedClusterId,
  ]);

  useEffect(() => {
    const domains = Object.values(DOMAIN_BY_RESOURCE).filter(Boolean) as RefreshDomain[];

    return () => {
      domains.forEach((domain) => {
        refreshOrchestrator.setDomainEnabled(domain, false);
      });
      const scope = normalizeNamespaceScope(currentNamespace, selectedClusterId);
      if (scope) {
        refreshOrchestrator.setScopedDomainEnabled('pods', scope, false);
      }
    };
  }, [currentNamespace, selectedClusterId]);

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
            case 'objects':
              // Catalog-backed objects view manages its own refresh cadence.
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
              if (!refreshOrchestrator.isStreamingDomain('namespace-events')) {
                events.load(true);
              }
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

    if (activeKey === 'objects') {
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

  useEffect(() => {
    const capabilityNamespace = getCapabilityNamespace(currentNamespace);
    if (!capabilityNamespace) {
      return;
    }
    // Evaluate namespace permissions against the active cluster context.
    evaluateNamespacePermissions(capabilityNamespace, { clusterId: selectedClusterId });
  }, [currentNamespace, selectedClusterId]);

  return (
    <NamespaceResourcesContext.Provider value={contextValue}>
      {children}
    </NamespaceResourcesContext.Provider>
  );
};
