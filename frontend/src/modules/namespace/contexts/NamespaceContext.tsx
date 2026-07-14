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
import type { NamespaceSignalState, NamespaceSummary } from '@/core/refresh/types';

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
  // Multi-cluster identity — required for stable row keys and scoped operations.
  clusterId?: string;
  clusterName?: string;
}

interface NamespaceContextType {
  namespaces: NamespaceListItem[];
  namespaceSummaries: NamespaceSummary[];
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

interface NamespaceProviderProps {
  children: ReactNode;
}

export const isNamespaceRefreshAvailable = (state: ClusterLifecycleState | undefined): boolean =>
  state === 'loading' || state === 'loading_slow' || state === 'ready';

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
    () => (activeClusterRefreshAvailable ? buildClusterScope(activeClusterId, '') : ''),
    [activeClusterId, activeClusterRefreshAvailable]
  );
  const namespaceScopes = useMemo(() => {
    const seen = new Set<string>();
    const scopes: string[] = [];
    refreshAvailableClusterIds.forEach((clusterId) => {
      const scope = buildClusterScope(clusterId, '');
      if (!scope || seen.has(scope)) {
        return;
      }
      seen.add(scope);
      scopes.push(scope);
    });
    return scopes;
  }, [refreshAvailableClusterIds]);

  const namespaceDomain = useRefreshScopedDomain('namespaces', namespacesScope);
  const namespaceMetricsBanner = useMetricsBannerInfo(namespaceDomain.data?.metrics ?? null);
  // Doorbell refetch: the namespaces stream signal only bumps the scoped
  // sourceVersion — the snapshot itself must be refetched. The shared hook
  // covers every leased cluster scope so background cluster tabs stay fresh.
  const namespaceSignalScopes = useMemo(
    () => (namespaceScopes.length > 0 ? namespaceScopes : namespacesScope ? [namespacesScope] : []),
    [namespaceScopes, namespacesScope]
  );
  useStreamSignalRefetch('namespaces', namespaceSignalScopes);
  const { suppressPassiveLoading } = useAutoRefreshLoadingState();
  // Track namespace selection per cluster tab to avoid cross-tab selection bleed.
  const [namespaceSelections, setNamespaceSelections] = useState<
    Record<string, string | undefined>
  >({});
  const clusterKey = selectedClusterId || '__default__';
  const selectedNamespace = namespaceSelections[clusterKey];
  const selectedNamespaceClusterId =
    selectedNamespace && selectedClusterId ? selectedClusterId : undefined;
  const lastErrorRef = useRef<string | null>(null);
  const namespaceScopesRef = useRef<string[]>([]);
  const lastEvaluatedNamespaceRef = useRef<string | null>(null);
  const requestedNamespaceScopesRef = useRef<Set<string>>(new Set());

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
    if (!namespaceDomain.data || !activeClusterId || !activeClusterRefreshAvailable) {
      return [];
    }
    return (namespaceDomain.data.namespaces ?? []).filter((ns) => ns.clusterId === activeClusterId);
  }, [activeClusterId, activeClusterRefreshAvailable, namespaceDomain.data]);

  useEffect(() => {
    if (!namespaceDomain.data) {
      if (namespaceDomain.status === 'idle') {
        updateNamespaces([]);
      }
      return;
    }

    if (!activeClusterId || !activeClusterRefreshAvailable) {
      updateNamespaces([]);
      return;
    }
    if (scopedNamespaces.length === 0) {
      updateNamespaces([]);
      return;
    }
    const mappedNamespaces = scopedNamespaces.map((ns) => {
      const createdAtMs = (ns.creationTimestamp || 0) * 1000;
      const age = formatAge(createdAtMs || Date.now());
      const workloadsUnknown = Boolean(ns.workloadsUnknown);
      const workloadSummary = workloadsUnknown
        ? 'Workloads: Unknown'
        : ns.hasWorkloads
          ? 'Workloads: Present'
          : 'Workloads: None';
      const unhealthyWorkloads = ns.unhealthyWorkloads ?? 0;
      const warningEvents = ns.warningEvents ?? 0;
      const warningEventsState = ns.warningEventsState ?? 'unavailable';
      const warningEventSummary =
        warningEventsState === 'available'
          ? String(warningEvents)
          : warningEventsState === 'loading'
            ? 'Loading'
            : 'Unavailable';
      const cpuUsageMilli = ns.cpuUsageMilli ?? 0;
      const memoryUsageBytes = ns.memoryUsageBytes ?? 0;
      const utilizationState = namespaceDomain.data?.metricsState ?? 'unavailable';
      const usageDisplay = namespaceAggregateUsageDisplay(cpuUsageMilli, memoryUsageBytes);
      const utilizationSummary =
        utilizationState === 'available'
          ? `${usageDisplay.cpu} CPU, ${usageDisplay.memory} memory${namespaceMetricsBanner ? ` (${namespaceMetricsBanner.message})` : ''}`
          : utilizationState === 'loading'
            ? (namespaceMetricsBanner?.message ?? 'Collecting')
            : (namespaceDomain.data?.metrics?.lastError?.trim() ?? 'Unavailable');
      const quotaCount = ns.quotaCount ?? 0;
      const quotaHighestUsedPercentage = ns.quotaHighestUsedPercentage ?? 0;
      const quotaPressure = ns.quotaPressure ?? '';
      const quotaPressureState = ns.quotaPressureState ?? 'unavailable';
      const quotaSummary =
        quotaPressureState === 'available'
          ? quotaCount > 0
            ? `${quotaHighestUsedPercentage}%`
            : 'No quotas'
          : quotaPressureState === 'loading'
            ? 'Loading'
            : 'Unavailable';

      return {
        name: ns.name,
        scope: ns.name,
        status: ns.status || ns.phase,
        details: `Status: ${ns.status || ns.phase} • ${workloadSummary} • Unhealthy workloads: ${unhealthyWorkloads} • Warning events: ${warningEventSummary} • Utilization: ${utilizationSummary} • Quota pressure: ${quotaSummary}`,
        age,
        hasWorkloads: ns.hasWorkloads ?? false,
        workloadsUnknown,
        unhealthyWorkloads,
        warningEvents,
        warningEventsState,
        cpuUsageMilli,
        memoryUsageBytes,
        utilizationState,
        quotaCount,
        quotaHighestUsedPercentage,
        quotaPressure,
        quotaPressureState,
        resourceVersion: ns.resourceVersion,
        scopeStatus: ns.scopeStatus,
        clusterId: ns.clusterId,
        clusterName: ns.clusterName,
      } satisfies NamespaceListItem;
    });

    updateNamespaces([allNamespaceItem, ...mappedNamespaces]);
  }, [
    activeClusterId,
    activeClusterRefreshAvailable,
    allNamespaceItem,
    namespaceDomain.status,
    namespaceDomain.data,
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
      const scopes =
        namespaceScopes.length > 0 ? namespaceScopes : namespacesScope ? [namespacesScope] : [];
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
    [namespaceScopes, namespacesScope]
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

    // Skip scoped calls when no clusters are connected (scope is empty).
    if (namespaceScopes.length === 0) {
      if (!enabled) {
        clearSelection();
        refreshOrchestrator.resetDomain('namespaces');
        updateNamespaces([]);
        lastEvaluatedNamespaceRef.current = null;
        requestedNamespaceScopesRef.current.clear();
      }
      return;
    }

    // Diff-based reconciliation — NEVER a blanket disable/re-enable. This
    // effect re-runs whenever the scope-set identity changes (any tab
    // open/close, any cluster lifecycle event), and a disable->enable cycle on
    // an unchanged scope resets its store: the active cluster's list blanked
    // (spinner) and its Diagnostics row churned whenever ANY OTHER cluster's
    // tab or lifecycle moved. One cluster's state must never disturb another's.
    const activeScopeSet = new Set(namespaceScopes);
    requestedNamespaceScopesRef.current.forEach((scope) => {
      if (!activeScopeSet.has(scope)) {
        setRefreshDomainEnabled({ domain: 'namespaces', scope, enabled: false });
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
  }, [clearSelection, namespaceScopes, selectedKubeconfig, updateNamespaces]);

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
    };

    const handleKubeconfigChanging = () => {
      namespaceScopes.forEach((scope) => {
        setRefreshDomainEnabled({ domain: 'namespaces', scope, enabled: false });
      });
      requestedNamespaceScopesRef.current.clear();
      refreshOrchestrator.resetDomain('namespaces');
      clearSelection();
      updateNamespaces([]);
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

    // A namespace-scope rebuild finished (docs/plans/namespace-scope.md): the
    // namespaces domain now serves the new scope. Derive the scope from the
    // EVENT's clusterId — the local scope memo can be empty or stale at this
    // moment (the cluster cycled through teardown) — and re-ask on a short
    // schedule so convergence never depends on one fetch racing the rebuilt
    // subsystem's HTTP wiring.
    const scopeRefetchTimers: number[] = [];
    const handleClusterScopeChanged = (payload: { clusterId: string }) => {
      const scope = payload.clusterId ? buildClusterScope(payload.clusterId, '') : namespacesScope;
      if (!scope) {
        return;
      }
      setRefreshDomainEnabled({ domain: 'namespaces', scope, enabled: true });
      requestedNamespaceScopesRef.current.add(scope);
      [0, 2000, 6000].forEach((delay) => {
        scopeRefetchTimers.push(
          window.setTimeout(() => {
            void requestRefreshDomain({ domain: 'namespaces', scope, reason: 'user' });
          }, delay)
        );
      });
    };

    const unsubReset = eventBus.on('view:reset', handleResetViews);
    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);
    const unsubScopeChanged = eventBus.on('cluster:scope-changed', handleClusterScopeChanged);

    return () => {
      unsubReset();
      unsubChanging();
      unsubChanged();
      unsubScopeChanged();
      scopeRefetchTimers.forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, [clearSelection, namespaceScopes, namespacesScope, updateNamespaces]);

  // Structural flag stamped by the orchestrator from the typed 403 (checked
  // once per session; the scope is settled and background retries stop).
  const namespacesPermissionDenied = namespaceDomain.permissionDenied === true;

  useEffect(() => {
    if (namespaceDomain.status === 'error' && namespaceDomain.error) {
      // Permission denial is a designed, rendered state (the sidebar shows the
      // message) — not an error to toast.
      if (namespacesPermissionDenied) {
        lastErrorRef.current = namespaceDomain.error;
        return;
      }
      if (namespaceDomain.error !== lastErrorRef.current) {
        lastErrorRef.current = namespaceDomain.error;
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
      lastErrorRef.current = null;
    }
  }, [
    namespaceDomain.status,
    namespaceDomain.error,
    namespacesPermissionDenied,
    selectedKubeconfig,
  ]);

  const contextValue = useMemo(
    () => ({
      namespaces,
      namespaceSummaries: scopedNamespaces,
      namespaceMetricsState: namespaceDomain.data?.metricsState ?? 'unavailable',
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
      namespaceDomain.data?.metricsState,
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
