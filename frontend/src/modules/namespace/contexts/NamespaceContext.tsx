/**
 * frontend/src/modules/namespace/contexts/NamespaceContext.tsx
 *
 * Context and provider for NamespaceContext.
 * - Manages the state and operations related to Kubernetes namespaces.
 * - Provides functionality to load, refresh, and select namespaces.
 * - Includes error handling and integration with the refresh orchestrator.
 * - Exposes a custom hook `useNamespace` for easy access to the context.
 */
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { formatAge } from '@utils/ageFormatter';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { errorHandler } from '@utils/errorHandler';
import { queryNamespacePermissions } from '@/core/capabilities';
import { requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { eventBus } from '@/core/events';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import {
  ALL_NAMESPACES_DISPLAY_NAME,
  ALL_NAMESPACES_DETAILS,
  ALL_NAMESPACES_RESOURCE_VERSION,
  ALL_NAMESPACES_SCOPE,
  isAllNamespaces,
} from '@modules/namespace/constants';

export interface NamespaceListItem {
  name: string;
  scope: string;
  status: string;
  details: string;
  age: string;
  hasWorkloads: boolean;
  workloadsUnknown: boolean;
  resourceVersion: string;
  isSynthetic?: boolean;
  // Multi-cluster identity — required for stable row keys and scoped operations.
  clusterId?: string;
  clusterName?: string;
}

interface NamespaceContextType {
  namespaces: NamespaceListItem[];
  selectedNamespace?: string;
  selectedNamespaceClusterId?: string;
  namespaceLoading: boolean;
  namespaceRefreshing: boolean;
  namespaceReady: boolean;
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

interface NamespaceProviderProps {
  children: ReactNode;
}

export const NamespaceProvider: React.FC<NamespaceProviderProps> = ({ children }) => {
  const { selectedKubeconfig, selectedClusterId, selectedClusterIds } = useKubeconfig();

  // Namespace refresh state is per cluster. Cross-cluster namespace views should
  // derive from per-cluster scoped entries rather than one aggregate domain.
  const namespacesScope = useMemo(
    () => buildClusterScope(selectedClusterId ?? undefined, ''),
    [selectedClusterId]
  );
  const namespaceScopes = useMemo(() => {
    const seen = new Set<string>();
    const scopes: string[] = [];
    selectedClusterIds.forEach((clusterId) => {
      const scope = buildClusterScope(clusterId, '');
      if (!scope || seen.has(scope)) {
        return;
      }
      seen.add(scope);
      scopes.push(scope);
    });
    return scopes;
  }, [selectedClusterIds]);

  const namespaceDomain = useRefreshScopedDomain('namespaces', namespacesScope);
  const { suppressPassiveLoading } = useAutoRefreshLoadingState();
  const activeClusterId = selectedClusterId?.trim() || '';
  // Track namespace selection per cluster tab to avoid cross-tab selection bleed.
  const [namespaceSelections, setNamespaceSelections] = useState<
    Record<string, string | undefined>
  >({});
  const clusterKey = selectedClusterId || '__default__';
  const selectedNamespace = namespaceSelections[clusterKey];
  const selectedNamespaceClusterId =
    selectedNamespace && selectedClusterId ? selectedClusterId : undefined;
  const lastErrorRef = useRef<string | null>(null);
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
    return namespaceDomain.data.namespaces.filter((ns) => ns.clusterId === activeClusterId);
  }, [activeClusterId, namespaceDomain.data]);

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
    const mappedNamespaces = scopedNamespaces.map((ns) => {
      const createdAtMs = (ns.creationTimestamp || 0) * 1000;
      const age = formatAge(createdAtMs || Date.now());
      const workloadsUnknown = Boolean(ns.workloadsUnknown);
      const workloadSummary = workloadsUnknown
        ? 'Workloads: Unknown'
        : ns.hasWorkloads
          ? 'Workloads: Present'
          : 'Workloads: None';

      return {
        name: ns.name,
        scope: ns.name,
        status: ns.status || ns.phase,
        details: `Status: ${ns.status || ns.phase} • ${workloadSummary}`,
        age,
        hasWorkloads: ns.hasWorkloads ?? false,
        workloadsUnknown,
        resourceVersion: ns.resourceVersion,
        clusterId: ns.clusterId,
        clusterName: ns.clusterName,
      } satisfies NamespaceListItem;
    });

    updateNamespaces([allNamespaceItem, ...mappedNamespaces]);
  }, [
    activeClusterId,
    allNamespaceItem,
    namespaceDomain.status,
    namespaceDomain.data,
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
      if (scopes.length === 0) return;
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

    const activeScopeSet = new Set(namespaceScopes);
    requestedNamespaceScopesRef.current.forEach((scope) => {
      if (!activeScopeSet.has(scope)) {
        refreshOrchestrator.setScopedDomainEnabled('namespaces', scope, false);
        requestedNamespaceScopesRef.current.delete(scope);
      }
    });

    namespaceScopes.forEach((scope) => {
      refreshOrchestrator.setScopedDomainEnabled('namespaces', scope, enabled);
    });

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

    return () => {
      namespaceScopes.forEach((scope) => {
        refreshOrchestrator.setScopedDomainEnabled('namespaces', scope, false, {
          preserveState: true,
        });
      });
    };
  }, [clearSelection, namespaceScopes, selectedKubeconfig, updateNamespaces]);

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
    selectedClusterId,
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
        refreshOrchestrator.setScopedDomainEnabled('namespaces', scope, false);
      });
      requestedNamespaceScopesRef.current.clear();
      refreshOrchestrator.resetDomain('namespaces');
      clearSelection();
      updateNamespaces([]);
    };

    const handleKubeconfigChanged = () => {
      namespaceScopes.forEach((scope) => {
        refreshOrchestrator.setScopedDomainEnabled('namespaces', scope, true);
        requestedNamespaceScopesRef.current.add(scope);
        void requestRefreshDomain({
          domain: 'namespaces',
          scope,
          reason: 'startup',
        });
      });
    };

    const unsubReset = eventBus.on('view:reset', handleResetViews);
    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);

    return () => {
      unsubReset();
      unsubChanging();
      unsubChanged();
    };
  }, [clearSelection, namespaceScopes, updateNamespaces]);

  useEffect(() => {
    if (namespaceDomain.status === 'error' && namespaceDomain.error) {
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
  }, [namespaceDomain.status, namespaceDomain.error, selectedKubeconfig]);

  const contextValue = useMemo(
    () => ({
      namespaces,
      selectedNamespace,
      selectedNamespaceClusterId,
      namespaceLoading,
      namespaceRefreshing,
      namespaceReady,
      setSelectedNamespace: handleSetSelectedNamespace,
      loadNamespaces,
      refreshNamespaces,
      getClusterNamespace,
    }),
    [
      namespaces,
      selectedNamespace,
      selectedNamespaceClusterId,
      namespaceLoading,
      namespaceRefreshing,
      namespaceReady,
      handleSetSelectedNamespace,
      loadNamespaces,
      refreshNamespaces,
      getClusterNamespace,
    ]
  );

  return <NamespaceContext.Provider value={contextValue}>{children}</NamespaceContext.Provider>;
};
