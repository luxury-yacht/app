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
import { evaluateNamespacePermissions } from '@/core/capabilities';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScopeList } from '@/core/refresh/clusterScope';
import { eventBus } from '@/core/events';
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
  setSelectedNamespace: (namespace: string, clusterId?: string) => void;
  loadNamespaces: (showSpinner?: boolean) => Promise<void>;
  refreshNamespaces: () => Promise<void>;
  // Lookup a specific cluster's selected namespace (for background refresh).
  getClusterNamespace: (clusterId: string) => string | undefined;
}

const NamespaceContext = createContext<NamespaceContextType | undefined>(undefined);

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

  // Build scope covering all connected clusters for the namespaces domain.
  const namespacesScope = useMemo(
    () => buildClusterScopeList(selectedClusterIds, ''),
    [selectedClusterIds]
  );

  const namespaceDomain = useRefreshScopedDomain('namespaces', namespacesScope);
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
        status: ns.phase,
        details: `Status: ${ns.phase} • ${workloadSummary}`,
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
    Boolean(activeClusterId) && !hasActiveClusterNamespaces && namespaceDomain.status !== 'error';
  const namespaceRefreshing = hasActiveClusterNamespaces && namespaceDomain.status === 'updating';

  const loadNamespaces = useCallback(
    async (_showSpinner: boolean = true) => {
      if (!namespacesScope) return;
      await refreshOrchestrator.fetchScopedDomain('namespaces', namespacesScope, {
        isManual: true,
      });
    },
    [namespacesScope]
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
      // Always scope namespace selection to the active tab to avoid cross-tab updates.
      const targetKey = selectedClusterId || clusterId || '__default__';
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
    if (!namespacesScope) {
      if (!enabled) {
        clearSelection();
        refreshOrchestrator.resetDomain('namespaces');
        updateNamespaces([]);
        lastEvaluatedNamespaceRef.current = null;
      }
      return;
    }

    refreshOrchestrator.setScopedDomainEnabled('namespaces', namespacesScope, enabled);

    if (!enabled) {
      clearSelection();
      refreshOrchestrator.resetDomain('namespaces');
      updateNamespaces([]);
      lastEvaluatedNamespaceRef.current = null;
      return;
    }

    if (namespaceDomain.status === 'idle' && !namespaceDomain.data) {
      void refreshOrchestrator.fetchScopedDomain('namespaces', namespacesScope, { isManual: true });
    }
  }, [
    allNamespaceItem,
    clearSelection,
    namespacesScope,
    selectedKubeconfig,
    namespaceDomain.status,
    namespaceDomain.data,
    updateNamespaces,
  ]);

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
    evaluateNamespacePermissions(namespaceToEvaluate, { clusterId });
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
      if (namespacesScope) {
        refreshOrchestrator.setScopedDomainEnabled('namespaces', namespacesScope, false);
      }
      refreshOrchestrator.resetDomain('namespaces');
      clearSelection();
      updateNamespaces([]);
    };

    const handleKubeconfigChanged = () => {
      if (namespacesScope) {
        refreshOrchestrator.setScopedDomainEnabled('namespaces', namespacesScope, true);
        void refreshOrchestrator.fetchScopedDomain('namespaces', namespacesScope, {
          isManual: true,
        });
      }
    };

    const unsubReset = eventBus.on('view:reset', handleResetViews);
    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);

    return () => {
      unsubReset();
      unsubChanging();
      unsubChanged();
    };
  }, [allNamespaceItem, clearSelection, namespacesScope, updateNamespaces]);

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
      handleSetSelectedNamespace,
      loadNamespaces,
      refreshNamespaces,
      getClusterNamespace,
    ]
  );

  return <NamespaceContext.Provider value={contextValue}>{children}</NamespaceContext.Provider>;
};
