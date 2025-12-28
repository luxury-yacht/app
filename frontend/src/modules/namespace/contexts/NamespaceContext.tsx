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
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
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
  const namespaceDomain = useRefreshDomain('namespaces');
  const { selectedKubeconfig, selectedClusterId, selectedClusterIds } = useKubeconfig();
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

  const [namespaces, setNamespaces] = useState<NamespaceListItem[]>([]);
  const hasLoadedOnceRef = useRef(false);
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

  useEffect(() => {
    const activeClusterId = selectedClusterId?.trim() || '';
    if (!namespaceDomain.data) {
      if (namespaceDomain.status === 'idle') {
        updateNamespaces([allNamespaceItem]);
        hasLoadedOnceRef.current = false;
      }
      return;
    }

    const scopedNamespaces = activeClusterId
      ? namespaceDomain.data.namespaces.filter((ns) => ns.clusterId === activeClusterId)
      : [];
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
      } satisfies NamespaceListItem;
    });

    updateNamespaces([allNamespaceItem, ...mappedNamespaces]);
    hasLoadedOnceRef.current = true;
  }, [
    allNamespaceItem,
    namespaceDomain.data,
    namespaceDomain.status,
    selectedClusterId,
    updateNamespaces,
  ]);

  const hasRealNamespaces = namespaces.some((item) => !item.isSynthetic);

  const namespaceLoading =
    (!hasRealNamespaces &&
      (namespaceDomain.status === 'idle' ||
        namespaceDomain.status === 'initialising' ||
        namespaceDomain.status === 'loading')) ||
    (!hasRealNamespaces && !hasLoadedOnceRef.current);

  const namespaceRefreshing = hasRealNamespaces && namespaceDomain.status === 'updating';

  const loadNamespaces = useCallback(async (showSpinner: boolean = true) => {
    await refreshOrchestrator.triggerManualRefresh('namespaces', {
      suppressSpinner: !showSpinner,
    });
  }, []);

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
    refreshOrchestrator.setDomainEnabled('namespaces', enabled);

    if (!enabled) {
      clearSelection();
      refreshOrchestrator.resetDomain('namespaces');
      updateNamespaces([allNamespaceItem]);
      hasLoadedOnceRef.current = false;
      lastEvaluatedNamespaceRef.current = null;
      return;
    }

    if (namespaceDomain.status === 'idle' && !namespaceDomain.data) {
      void refreshOrchestrator.triggerManualRefresh('namespaces');
    }
  }, [
    allNamespaceItem,
    clearSelection,
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

    const firstRealNamespace = activeNamespaces.find((item) => !item.isSynthetic)?.scope;
    const fallbackNamespace = activeNamespaces[0]?.scope;
    applySelection(firstRealNamespace ?? fallbackNamespace, clusterKey);
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
      updateNamespaces([allNamespaceItem]);
      hasLoadedOnceRef.current = false;
    };

    const handleKubeconfigChanging = () => {
      refreshOrchestrator.setDomainEnabled('namespaces', false);
      refreshOrchestrator.resetDomain('namespaces');
      clearSelection();
      updateNamespaces([allNamespaceItem]);
      hasLoadedOnceRef.current = false;
    };

    const handleKubeconfigChanged = () => {
      refreshOrchestrator.setDomainEnabled('namespaces', true);
      hasLoadedOnceRef.current = false;
      void refreshOrchestrator.triggerManualRefresh('namespaces');
    };

    const unsubReset = eventBus.on('view:reset', handleResetViews);
    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);

    return () => {
      unsubReset();
      unsubChanging();
      unsubChanged();
    };
  }, [allNamespaceItem, clearSelection, updateNamespaces]);

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
    ]
  );

  return <NamespaceContext.Provider value={contextValue}>{children}</NamespaceContext.Provider>;
};
