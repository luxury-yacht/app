/**
 * frontend/src/modules/namespace/contexts/NamespaceContext.tsx
 *
 * Context and provider for NamespaceContext.
 * - Manages the state and operations related to Kubernetes namespaces.
 * - Provides functionality to load, refresh, and select namespaces.
 * - Includes error handling and integration with the refresh orchestrator.
 * - Exposes a custom hook `useNamespace` for easy access to the context.
 */

import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import type { ClusterLifecycleState } from '@core/contexts/clusterLifecycleState';
import { namespaceAggregateUsageDisplay } from '@core/resource-metrics';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  ALL_NAMESPACES_DETAILS,
  ALL_NAMESPACES_DISPLAY_NAME,
  ALL_NAMESPACES_RESOURCE_VERSION,
  ALL_NAMESPACES_SCOPE,
  isAllNamespaces,
} from '@modules/namespace/constants';
import { useMetricsBannerInfo } from '@shared/hooks/useMetricsBannerInfo';
import { formatAge } from '@utils/ageFormatter';
import { errorHandler } from '@utils/errorHandler';
import type React from 'react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { queryNamespacePermissions } from '@/core/capabilities';
import { requestRefreshDomain, setRefreshDomainEnabled } from '@/core/data-access';
import { eventBus } from '@/core/events';
import {
  refreshOrchestrator,
  useRefreshScopedDomain,
  useRefreshScopedDomainStates,
} from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { useStreamSignalRefetch } from '@/core/refresh/hooks/useStreamSignalRefetch';
import type { NamespaceSignalState } from '@/core/refresh/types';
import { setActiveNamespaceContext } from '@/core/telemetry/sentry';
import { joinNamespaceMetrics, type NamespaceSummaryWithMetrics } from './namespaceMetrics';

export interface NamespaceListItem {
  name: string;
  scope: string;
  status: string;
  details: string;
  age: string;
  hasWorkloads: boolean;
  workloadsUnknown: boolean;
  unhealthyWorkloads: number;
  warningEvents: number;
  warningEventsState: 'available' | 'loading' | 'unavailable';
  cpuUsageMilli: number;
  memoryUsageBytes: number;
  utilizationState: 'available' | 'loading' | 'unavailable';
  quotaCount: number;
  quotaHighestUsedPercentage: number;
  quotaPressure: '' | 'warning' | 'critical';
  quotaPressureState: 'available' | 'loading' | 'unavailable';
  resourceVersion: string;
  scopeStatus?: 'not-found' | 'no-access';
  isSynthetic?: boolean;
}

interface NamespaceContextType {
  namespaces: NamespaceListItem[];
  namespaceSummaries: NamespaceSummaryWithMetrics[];
  namespaceMetricsState: NamespaceSignalState;
  namespaceError: string | null;
  selectedNamespace?: string;
  selectedNamespaceClusterId?: string;
  namespaceLoading: boolean;
  namespaceRefreshing: boolean;
  namespaceReady: boolean;
  // True when the backend refused the namespace list for lack of RBAC
  // permission (the namespaces domain is permission-gated and fails fast).
  // A designed, rendered state: the sidebar shows "You do not have permission
  // to list namespaces." — no toast, no fallback inference.
  namespacesPermissionDenied: boolean;
  setSelectedNamespace: (namespace: string, clusterId?: string) => void;
  loadNamespaces: (showSpinner?: boolean) => Promise<void>;
  refreshNamespaces: () => Promise<void>;
  // Lookup a specific cluster's selected namespace (for background refresh).
  getClusterNamespace: (clusterId: string) => string | undefined;
}

export const NamespaceContext = createContext<NamespaceContextType | undefined>(undefined);

export const useNamespace = () => {
  const context = useContext(NamespaceContext);
  if (!context) {
    throw new Error('useNamespace must be used within NamespaceProvider');
  }
  return context;
};

// Cross-cluster namespace consumers share NamespaceProvider's scope leases and
// signal-refetch wiring, then read the same scoped store entries through this
// module so data access and doorbell freshness stay one contract.
export const useNamespaceStatesByScope = () => useRefreshScopedDomainStates('namespaces');
export const useNamespaceMetricStatesByScope = () =>
  useRefreshScopedDomainStates('namespace-metrics');

interface NamespaceProviderProps {
  children: ReactNode;
}

export const isNamespaceRefreshAvailable = (state: ClusterLifecycleState | undefined): boolean =>
  state === 'loading' || state === 'loading_slow' || state === 'degraded' || state === 'ready';

const buildNamespaceScopes = (clusterIds: string[]): string[] => {
  const seen = new Set<string>();
  const scopes: string[] = [];
  clusterIds.forEach((rawClusterId) => {
    const clusterId = rawClusterId.trim();
    const scope = clusterId ? buildClusterScope(clusterId, '') : '';
    if (!scope || seen.has(scope)) {
      return;
    }
    seen.add(scope);
    scopes.push(scope);
  });
  return scopes;
};

const namespaceWorkloadSummary = (namespace: NamespaceSummaryWithMetrics): string => {
  if (namespace.workloadsUnknown) {
    return 'Workloads: Unknown';
  }
  return namespace.hasWorkloads ? 'Workloads: Present' : 'Workloads: None';
};

const namespaceWarningEventSummary = (
  state: NamespaceListItem['warningEventsState'],
  count: number
): string => {
  if (state === 'available') {
    return String(count);
  }
  return state === 'loading' ? 'Loading' : 'Unavailable';
};

interface NamespaceUtilizationPresentation {
  state: NamespaceListItem['utilizationState'];
  bannerMessage?: string;
  errorMessage?: string;
}

const namespaceUtilizationSummary = (
  cpuUsageMilli: number,
  memoryUsageBytes: number,
  presentation: NamespaceUtilizationPresentation
): string => {
  if (presentation.state === 'available') {
    const usage = namespaceAggregateUsageDisplay(cpuUsageMilli, memoryUsageBytes);
    const banner = presentation.bannerMessage ? ` (${presentation.bannerMessage})` : '';
    return `${usage.cpu} CPU, ${usage.memory} memory${banner}`;
  }
  if (presentation.state === 'loading') {
    return presentation.bannerMessage ?? 'Collecting';
  }
  return presentation.errorMessage?.trim() || 'Unavailable';
};

const namespaceQuotaSummary = (
  state: NamespaceListItem['quotaPressureState'],
  count: number,
  highestUsedPercentage: number
): string => {
  if (state === 'available') {
    return count > 0 ? `${highestUsedPercentage}%` : 'No quotas';
  }
  return state === 'loading' ? 'Loading' : 'Unavailable';
};

const getNamespaceListValues = (namespace: NamespaceSummaryWithMetrics) => ({
  workloadsUnknown: Boolean(namespace.workloadsUnknown),
  unhealthyWorkloads: namespace.unhealthyWorkloads ?? 0,
  warningEvents: namespace.warningEvents ?? 0,
  warningEventsState: namespace.warningEventsState ?? 'unavailable',
  cpuUsageMilli: namespace.cpuUsageMilli ?? 0,
  memoryUsageBytes: namespace.memoryUsageBytes ?? 0,
  quotaCount: namespace.quotaCount ?? 0,
  quotaHighestUsedPercentage: namespace.quotaHighestUsedPercentage ?? 0,
  quotaPressure: namespace.quotaPressure ?? '',
  quotaPressureState: namespace.quotaPressureState ?? 'unavailable',
});

const projectNamespaceListItem = (
  namespace: NamespaceSummaryWithMetrics,
  utilization: NamespaceUtilizationPresentation
): NamespaceListItem => {
  const createdAtMs = (namespace.creationTimestamp || 0) * 1000;
  const values = getNamespaceListValues(namespace);
  const status = namespace.status || namespace.phase;
  const details = [
    `Status: ${status}`,
    namespaceWorkloadSummary(namespace),
    `Unhealthy workloads: ${values.unhealthyWorkloads}`,
    `Warning events: ${namespaceWarningEventSummary(values.warningEventsState, values.warningEvents)}`,
    `Utilization: ${namespaceUtilizationSummary(values.cpuUsageMilli, values.memoryUsageBytes, utilization)}`,
    `Quota pressure: ${namespaceQuotaSummary(values.quotaPressureState, values.quotaCount, values.quotaHighestUsedPercentage)}`,
  ].join(' • ');
  return {
    name: namespace.ref.name,
    scope: namespace.ref.name,
    status,
    details,
    age: formatAge(createdAtMs || Date.now()),
    hasWorkloads: namespace.hasWorkloads ?? false,
    workloadsUnknown: values.workloadsUnknown,
    unhealthyWorkloads: values.unhealthyWorkloads,
    warningEvents: values.warningEvents,
    warningEventsState: values.warningEventsState,
    cpuUsageMilli: values.cpuUsageMilli,
    memoryUsageBytes: values.memoryUsageBytes,
    utilizationState: utilization.state,
    quotaCount: values.quotaCount,
    quotaHighestUsedPercentage: values.quotaHighestUsedPercentage,
    quotaPressure: values.quotaPressure,
    quotaPressureState: values.quotaPressureState,
    resourceVersion: namespace.resourceVersion,
    scopeStatus: namespace.scopeStatus,
  };
};

export const NamespaceProvider: React.FC<NamespaceProviderProps> = ({ children }) => {
  const { selectedKubeconfig, selectedClusterId, selectedClusterIds } = useKubeconfig();
  const { getClusterState } = useClusterLifecycle();
  const activeClusterId = selectedClusterId?.trim() || '';
  const activeClusterRefreshAvailable = activeClusterId
    ? isNamespaceRefreshAvailable(getClusterState(activeClusterId))
    : false;
  const refreshAvailableClusterIds = useMemo(
    () =>
      selectedClusterIds
        .map((clusterId) => clusterId.trim())
        .filter(
          (clusterId) =>
            clusterId.length > 0 && isNamespaceRefreshAvailable(getClusterState(clusterId))
        ),
    [getClusterState, selectedClusterIds]
  );

  // Namespace refresh state is per cluster. Cross-cluster namespace views should
  // derive from per-cluster scoped entries rather than one aggregate domain.
  const namespacesScope = useMemo(
    () => (activeClusterId ? buildClusterScope(activeClusterId, '') : ''),
    [activeClusterId]
  );
  const namespacesRefreshScope = activeClusterRefreshAvailable ? namespacesScope : '';
  const retainedNamespaceScopes = useMemo(
    () => buildNamespaceScopes(selectedClusterIds),
    [selectedClusterIds]
  );
  const namespaceScopes = useMemo(
    () => buildNamespaceScopes(refreshAvailableClusterIds),
    [refreshAvailableClusterIds]
  );

  const namespaceDomain = useRefreshScopedDomain('namespaces', namespacesScope);
  const namespaceMetricsDomain = useRefreshScopedDomain('namespace-metrics', namespacesScope);
  const namespaceMetricsBanner = useMetricsBannerInfo(namespaceMetricsDomain.data?.metrics ?? null);
  // Doorbell refetch: the namespaces stream signal only bumps the scoped
  // sourceVersion — the snapshot itself must be refetched. The shared hook
  // covers every leased cluster scope so background cluster tabs stay fresh.
  const namespaceSignalScopes = namespaceScopes;
  useStreamSignalRefetch('namespaces', namespaceSignalScopes);
  useStreamSignalRefetch(
    'namespace-metrics',
    namespacesRefreshScope ? [namespacesRefreshScope] : []
  );
  const { suppressPassiveLoading } = useAutoRefreshLoadingState();
  // Track namespace selection per cluster tab to avoid cross-tab selection bleed.
  const [namespaceSelections, setNamespaceSelections] = useState<
    Record<string, string | undefined>
  >({});
  const clusterKey = selectedClusterId || '__default__';
  const selectedNamespace = namespaceSelections[clusterKey];
  const selectedNamespaceClusterId =
    selectedNamespace && selectedClusterId ? selectedClusterId : undefined;

  useEffect(() => {
    setActiveNamespaceContext(selectedNamespace);
  }, [selectedNamespace]);

  const lastErrorByScopeRef = useRef<Map<string, string>>(new Map());
  const namespaceScopesRef = useRef<string[]>([]);
  const lastEvaluatedNamespaceRef = useRef<string | null>(null);
  const requestedNamespaceScopesRef = useRef<Set<string>>(new Set());
  const previousForegroundNamespacesScopeRef = useRef(namespacesRefreshScope);
  const namespaceMetricsScopeRef = useRef('');

  // Keep a ref to the latest namespace selections map for stable callback access.
  const namespaceSelectionsRef = useRef(namespaceSelections);
  namespaceSelectionsRef.current = namespaceSelections;

  // Lookup a specific cluster's selected namespace (for background refresh).
  const getClusterNamespace = useCallback((clusterId: string): string | undefined => {
    return namespaceSelectionsRef.current[clusterId];
  }, []);

  const [namespaces, setNamespaces] = useState<NamespaceListItem[]>([]);
  const namespacesRef = useRef<NamespaceListItem[]>([]);
  const allNamespaceItem = useMemo<NamespaceListItem>(
    () => ({
      name: ALL_NAMESPACES_DISPLAY_NAME,
      scope: ALL_NAMESPACES_SCOPE,
      status: 'All namespaces',
      details: ALL_NAMESPACES_DETAILS,
      age: '—',
      hasWorkloads: true,
      workloadsUnknown: false,
      unhealthyWorkloads: 0,
      warningEvents: 0,
      warningEventsState: 'unavailable',
      cpuUsageMilli: 0,
      memoryUsageBytes: 0,
      utilizationState: 'unavailable',
      quotaCount: 0,
      quotaHighestUsedPercentage: 0,
      quotaPressure: '',
      quotaPressureState: 'unavailable',
      resourceVersion: ALL_NAMESPACES_RESOURCE_VERSION,
      isSynthetic: true,
    }),
    []
  );

  const updateNamespaces = useCallback((nextNamespaces: NamespaceListItem[]) => {
    namespacesRef.current = nextNamespaces;
    setNamespaces(nextNamespaces);
  }, []);

  const scopedNamespaces = useMemo(() => {
    if (!namespaceDomain.data || !activeClusterId) {
      return [];
    }
    const objectRows = (namespaceDomain.data.namespaces ?? []).filter(
      (ns) => ns.ref.clusterId === activeClusterId
    );
    return joinNamespaceMetrics(objectRows, namespaceMetricsDomain.data?.namespaces);
  }, [activeClusterId, namespaceDomain.data, namespaceMetricsDomain.data?.namespaces]);

  useEffect(() => {
    if (!namespaceDomain.data) {
      if (namespaceDomain.status === 'idle') {
        updateNamespaces([]);
      }
      return;
    }

    if (!activeClusterId) {
      updateNamespaces([]);
      return;
    }
    if (scopedNamespaces.length === 0) {
      updateNamespaces([]);
      return;
    }
    const utilization = {
      state: namespaceMetricsDomain.data?.metricsState ?? 'unavailable',
      bannerMessage: namespaceMetricsBanner?.message,
      errorMessage: namespaceMetricsDomain.data?.metrics?.lastError,
    } satisfies NamespaceUtilizationPresentation;
    const mappedNamespaces = scopedNamespaces.map((namespace) =>
      projectNamespaceListItem(namespace, utilization)
    );

    updateNamespaces([allNamespaceItem, ...mappedNamespaces]);
  }, [
    activeClusterId,
    allNamespaceItem,
    namespaceDomain.status,
    namespaceDomain.data,
    namespaceMetricsDomain.data,
    namespaceMetricsBanner,
    scopedNamespaces,
    updateNamespaces,
  ]);

  const hasActiveClusterNamespaces = scopedNamespaces.length > 0;
  const namespaceLoading =
    Boolean(activeClusterId) &&
    !hasActiveClusterNamespaces &&
    namespaceDomain.status !== 'error' &&
    !suppressPassiveLoading;
  const namespaceRefreshing = hasActiveClusterNamespaces && namespaceDomain.status === 'updating';
  // The active cluster is usable for namespace-driven UI once we have at least
  // one real namespace row for it. Consumers use this to avoid showing "Ready"
  // before the namespace tree can render.
  const namespaceReady = hasActiveClusterNamespaces;

  const loadNamespaces = useCallback(
    async (_showSpinner: boolean = true) => {
      const scopes = namespaceScopes;
      if (scopes.length === 0) {
        return;
      }
      await Promise.all(
        scopes.map((scope) =>
          requestRefreshDomain({
            domain: 'namespaces',
            scope,
            reason: 'user',
          })
        )
      );
    },
    [namespaceScopes]
  );

  const refreshNamespaces = useCallback(async () => {
    await loadNamespaces(false);
  }, [loadNamespaces]);

  const applySelection = useCallback(
    (namespace?: string | null, targetKey?: string) => {
      const nextNamespace = (namespace ?? '').trim();
      const normalizedNamespace = nextNamespace.length > 0 ? nextNamespace : undefined;
      const key = targetKey ?? clusterKey;

      setNamespaceSelections((prev) => {
        if (prev[key] === normalizedNamespace) {
          return prev;
        }
        return {
          ...prev,
          [key]: normalizedNamespace,
        };
      });
    },
    [clusterKey]
  );

  const handleSetSelectedNamespace = useCallback(
    (namespace: string, clusterId?: string) => {
      // Explicit cluster targets come from cross-cluster navigation and must not
      // be rewritten to the currently active tab.
      const targetKey = clusterId || selectedClusterId || '__default__';
      applySelection(namespace, targetKey);
    },
    [applySelection, selectedClusterId]
  );

  const clearSelection = useCallback(() => {
    applySelection(undefined, clusterKey);
  }, [applySelection, clusterKey]);

  useEffect(() => {
    const enabled = Boolean(selectedKubeconfig);

    // Diff-based reconciliation — NEVER a blanket disable/re-enable. This
    // effect re-runs whenever the scope-set identity changes (any tab
    // open/close, any cluster lifecycle event), and a disable->enable cycle on
    // an unchanged scope resets its store: the active cluster's list blanked
    // (spinner) and its Diagnostics row churned whenever ANY OTHER cluster's
    // tab or lifecycle moved. One cluster's state must never disturb another's.
    const activeScopeSet = new Set(namespaceScopes);
    const retainedScopeSet = new Set(retainedNamespaceScopes);
    requestedNamespaceScopesRef.current.forEach((scope) => {
      if (!activeScopeSet.has(scope)) {
        setRefreshDomainEnabled({
          domain: 'namespaces',
          scope,
          enabled: false,
          preserveState: retainedScopeSet.has(scope),
        });
        lastErrorByScopeRef.current.delete(scope);
        requestedNamespaceScopesRef.current.delete(scope);
      }
    });

    // Idempotent for already-enabled scopes (the orchestrator early-returns on
    // an unchanged flag); preserveState keeps any genuine re-enable a quiet
    // repaint instead of a blank-and-spin.
    namespaceScopes.forEach((scope) => {
      setRefreshDomainEnabled({ domain: 'namespaces', scope, enabled, preserveState: true });
    });
    namespaceScopesRef.current = namespaceScopes;

    if (!enabled) {
      clearSelection();
      refreshOrchestrator.resetDomain('namespaces');
      updateNamespaces([]);
      lastEvaluatedNamespaceRef.current = null;
      lastErrorByScopeRef.current.clear();
      requestedNamespaceScopesRef.current.clear();
      return;
    }

    namespaceScopes.forEach((scope) => {
      if (requestedNamespaceScopesRef.current.has(scope)) {
        return;
      }
      requestedNamespaceScopesRef.current.add(scope);
      void requestRefreshDomain({
        domain: 'namespaces',
        scope,
        reason: 'startup',
      });
    });
  }, [
    clearSelection,
    namespaceScopes,
    retainedNamespaceScopes,
    selectedKubeconfig,
    updateNamespaces,
  ]);

  useEffect(() => {
    const previousScope = previousForegroundNamespacesScopeRef.current;
    previousForegroundNamespacesScopeRef.current = namespacesRefreshScope;
    if (!previousScope || !namespacesRefreshScope || previousScope === namespacesRefreshScope) {
      return;
    }

    // Every open cluster keeps its namespace lease and retained snapshot. A
    // foreground switch repaints that snapshot first, then refreshes only the
    // newly visible cluster instead of fanning out across every open tab.
    void requestRefreshDomain({
      domain: 'namespaces',
      scope: namespacesRefreshScope,
      reason: 'foreground',
    });
  }, [namespacesRefreshScope]);

  useEffect(() => {
    const previousScope = namespaceMetricsScopeRef.current;
    if (previousScope && previousScope !== namespacesRefreshScope) {
      setRefreshDomainEnabled({
        domain: 'namespace-metrics',
        scope: previousScope,
        enabled: false,
        preserveState: true,
      });
    }

    namespaceMetricsScopeRef.current = namespacesRefreshScope;
    if (!namespacesRefreshScope) {
      return;
    }

    setRefreshDomainEnabled({
      domain: 'namespace-metrics',
      scope: namespacesRefreshScope,
      enabled: true,
      preserveState: true,
    });
    void requestRefreshDomain({
      domain: 'namespace-metrics',
      scope: namespacesRefreshScope,
      reason: previousScope ? 'foreground' : 'startup',
    });
  }, [namespacesRefreshScope]);

  // Unmount-only teardown: release whatever scopes are currently held. Kept
  // separate from the reconciliation effect above so re-runs never release
  // still-active scopes.
  const releaseNamespaceScopes = useEffectEvent(() => () => {
    namespaceScopesRef.current.forEach((scope) => {
      setRefreshDomainEnabled({
        domain: 'namespaces',
        scope,
        enabled: false,
        preserveState: true,
      });
    });
    if (namespaceMetricsScopeRef.current) {
      setRefreshDomainEnabled({
        domain: 'namespace-metrics',
        scope: namespaceMetricsScopeRef.current,
        enabled: false,
        preserveState: true,
      });
    }
  });
  useEffect(() => releaseNamespaceScopes(), []);

  useEffect(() => {
    const activeNamespaces = namespacesRef.current.length > 0 ? namespacesRef.current : namespaces;
    if (!activeNamespaces.length) {
      if (namespaceDomain.status === 'ready') {
        clearSelection();
      }
      lastEvaluatedNamespaceRef.current = null;
      return;
    }

    const current = selectedNamespace;
    if (current && activeNamespaces.some((item) => item.scope === current)) {
      applySelection(current, clusterKey);
      return;
    }
    if (current) {
      // Avoid auto-selecting; clear stale selections and wait for explicit user choice.
      clearSelection();
    }
  }, [
    applySelection,
    clusterKey,
    clearSelection,
    namespaces,
    namespaceDomain.status,
    selectedNamespace,
  ]);

  useEffect(() => {
    const namespaceToEvaluate = selectedNamespace?.trim();
    if (!namespaceToEvaluate) {
      return;
    }

    if (isAllNamespaces(namespaceToEvaluate)) {
      return;
    }

    const normalized = namespaceToEvaluate.toLowerCase();
    const evaluationKey = `${selectedClusterId || 'none'}|${normalized}`;
    if (lastEvaluatedNamespaceRef.current === evaluationKey) {
      return;
    }
    lastEvaluatedNamespaceRef.current = evaluationKey;
    // Scope namespace permission checks to the active cluster.
    const clusterId = selectedNamespaceClusterId ?? selectedClusterId;
    queryNamespacePermissions(namespaceToEvaluate, clusterId ?? null);
  }, [selectedNamespace, selectedClusterId, selectedNamespaceClusterId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const timeout = window.setTimeout(() => {
      const normalized =
        selectedNamespace && selectedNamespace.trim().length > 0 ? selectedNamespace : undefined;
      const clusterId =
        normalized && selectedNamespaceClusterId ? selectedNamespaceClusterId : undefined;
      refreshOrchestrator.updateContext({
        selectedNamespace: normalized,
        selectedNamespaceClusterId: clusterId,
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [selectedNamespace, selectedNamespaceClusterId]);

  useEffect(() => {
    setNamespaceSelections((prev) => {
      if (selectedClusterIds.length === 0) {
        return prev.__default__ ? { __default__: prev.__default__ } : {};
      }
      const allowed = new Set(selectedClusterIds);
      const next: Record<string, string | undefined> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (key === '__default__' || allowed.has(key)) {
          next[key] = value;
        }
      });
      return next;
    });
  }, [selectedClusterIds]);

  useEffect(() => {
    const handleResetViews = () => {
      refreshOrchestrator.resetDomain('namespaces');
      clearSelection();
      updateNamespaces([]);
      lastErrorByScopeRef.current.clear();
    };

    const handleKubeconfigChanging = () => {
      namespaceScopes.forEach((scope) => {
        setRefreshDomainEnabled({ domain: 'namespaces', scope, enabled: false });
      });
      requestedNamespaceScopesRef.current.clear();
      refreshOrchestrator.resetDomain('namespaces');
      clearSelection();
      updateNamespaces([]);
      lastErrorByScopeRef.current.clear();
    };

    const handleKubeconfigChanged = () => {
      namespaceScopes.forEach((scope) => {
        setRefreshDomainEnabled({ domain: 'namespaces', scope, enabled: true });
        requestedNamespaceScopesRef.current.add(scope);
        void requestRefreshDomain({
          domain: 'namespaces',
          scope,
          reason: 'startup',
        });
      });
    };

    // A namespace-scope rebuild finished: the aggregate route has already been
    // updated before this event is emitted. Derive the scope from the event's
    // clusterId and reconcile once without creating a ManualQueue job.
    const handleClusterScopeChanged = (payload: { clusterId: string }) => {
      if (!payload.clusterId.trim()) {
        return;
      }
      const scope = buildClusterScope(payload.clusterId, '');
      if (!scope) {
        return;
      }
      setRefreshDomainEnabled({ domain: 'namespaces', scope, enabled: true });
      requestedNamespaceScopesRef.current.add(scope);
      void requestRefreshDomain({ domain: 'namespaces', scope, reason: 'foreground' });
    };

    const unsubReset = eventBus.on('view:reset', handleResetViews);
    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);
    const unsubPermissionsChanged = eventBus.on(
      'cluster:permissions-changed',
      handleClusterScopeChanged
    );
    const unsubScopeChanged = eventBus.on('cluster:scope-changed', handleClusterScopeChanged);

    return () => {
      unsubReset();
      unsubChanging();
      unsubChanged();
      unsubScopeChanged();
      unsubPermissionsChanged();
    };
  }, [clearSelection, namespaceScopes, updateNamespaces]);

  // Structural flag stamped by the orchestrator from the typed 403 (checked
  // once per session; the scope is settled and background retries stop).
  const namespacesPermissionDenied = namespaceDomain.permissionDenied === true;

  useEffect(() => {
    if (!namespacesScope) {
      return;
    }
    if (namespaceDomain.status === 'error' && namespaceDomain.error) {
      // Permission denial is a designed, rendered state (the sidebar shows the
      // message) — not an error to toast.
      if (namespacesPermissionDenied) {
        lastErrorByScopeRef.current.set(namespacesScope, namespaceDomain.error);
        return;
      }
      if (namespaceDomain.error !== lastErrorByScopeRef.current.get(namespacesScope)) {
        lastErrorByScopeRef.current.set(namespacesScope, namespaceDomain.error);
        errorHandler.handle(
          new Error(namespaceDomain.error),
          {
            context: 'loadNamespaces',
            kubeconfig: selectedKubeconfig,
          },
          'Failed to load namespaces'
        );
      }
    } else {
      lastErrorByScopeRef.current.delete(namespacesScope);
    }
  }, [
    namespaceDomain.status,
    namespaceDomain.error,
    namespacesPermissionDenied,
    namespacesScope,
    selectedKubeconfig,
  ]);

  const contextValue = useMemo(
    () => ({
      namespaces,
      namespaceSummaries: scopedNamespaces,
      namespaceMetricsState: namespaceMetricsDomain.data?.metricsState ?? 'unavailable',
      namespaceError: namespaceDomain.error ?? null,
      selectedNamespace,
      selectedNamespaceClusterId,
      namespaceLoading,
      namespaceRefreshing,
      namespaceReady,
      namespacesPermissionDenied,
      setSelectedNamespace: handleSetSelectedNamespace,
      loadNamespaces,
      refreshNamespaces,
      getClusterNamespace,
    }),
    [
      namespaces,
      scopedNamespaces,
      namespaceMetricsDomain.data?.metricsState,
      namespaceDomain.error,
      selectedNamespace,
      selectedNamespaceClusterId,
      namespaceLoading,
      namespaceRefreshing,
      namespaceReady,
      namespacesPermissionDenied,
      handleSetSelectedNamespace,
      loadNamespaces,
      refreshNamespaces,
      getClusterNamespace,
    ]
  );

  return <NamespaceContext.Provider value={contextValue}>{children}</NamespaceContext.Provider>;
};
