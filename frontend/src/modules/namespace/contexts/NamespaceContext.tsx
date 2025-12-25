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
  namespaceLoading: boolean;
  namespaceRefreshing: boolean;
  setSelectedNamespace: (namespace: string) => void;
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
  const { selectedKubeconfig } = useKubeconfig();
  const [selectedNamespace, setSelectedNamespace] = useState<string | undefined>();
  const lastErrorRef = useRef<string | null>(null);
  const lastEvaluatedNamespaceRef = useRef<string | null>(null);

  const [namespaces, setNamespaces] = useState<NamespaceListItem[]>([]);
  const hasLoadedOnceRef = useRef(false);
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

  useEffect(() => {
    if (!namespaceDomain.data) {
      if (namespaceDomain.status === 'idle') {
        setNamespaces([allNamespaceItem]);
        hasLoadedOnceRef.current = false;
      }
      return;
    }

    const mappedNamespaces = namespaceDomain.data.namespaces.map((ns) => {
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

    setNamespaces([allNamespaceItem, ...mappedNamespaces]);
    hasLoadedOnceRef.current = true;
  }, [allNamespaceItem, namespaceDomain.data, namespaceDomain.status]);

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

  const handleSetSelectedNamespace = useCallback((namespace: string) => {
    setSelectedNamespace((prev) => (prev === namespace ? prev : namespace));
  }, []);

  useEffect(() => {
    const enabled = Boolean(selectedKubeconfig);
    refreshOrchestrator.setDomainEnabled('namespaces', enabled);

    if (!enabled) {
      setSelectedNamespace(undefined);
      refreshOrchestrator.resetDomain('namespaces');
      setNamespaces([allNamespaceItem]);
      hasLoadedOnceRef.current = false;
      lastEvaluatedNamespaceRef.current = null;
      return;
    }

    if (namespaceDomain.status === 'idle' && !namespaceDomain.data) {
      void refreshOrchestrator.triggerManualRefresh('namespaces');
    }
  }, [allNamespaceItem, selectedKubeconfig, namespaceDomain.status, namespaceDomain.data]);

  useEffect(() => {
    if (!namespaces.length) {
      if (namespaceDomain.status === 'ready') {
        setSelectedNamespace(undefined);
      }
      lastEvaluatedNamespaceRef.current = null;
      return;
    }

    setSelectedNamespace((prev) => {
      if (prev && namespaces.some((item) => item.scope === prev)) {
        return prev;
      }
      const firstRealNamespace = namespaces.find((item) => !item.isSynthetic)?.scope;
      if (firstRealNamespace) {
        return firstRealNamespace;
      }
      return namespaces[0]?.scope;
    });
  }, [namespaces, namespaceDomain.status]);

  useEffect(() => {
    const namespaceToEvaluate = selectedNamespace?.trim();
    if (!namespaceToEvaluate) {
      return;
    }

    if (isAllNamespaces(namespaceToEvaluate)) {
      return;
    }

    const normalized = namespaceToEvaluate.toLowerCase();
    if (lastEvaluatedNamespaceRef.current === normalized) {
      return;
    }
    lastEvaluatedNamespaceRef.current = normalized;
    evaluateNamespacePermissions(namespaceToEvaluate);
  }, [selectedNamespace]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const timeout = window.setTimeout(() => {
      const normalized =
        selectedNamespace && selectedNamespace.trim().length > 0 ? selectedNamespace : undefined;
      refreshOrchestrator.updateContext({
        selectedNamespace: normalized,
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [selectedNamespace]);

  useEffect(() => {
    const handleResetViews = () => {
      refreshOrchestrator.resetDomain('namespaces');
      setSelectedNamespace(undefined);
      setNamespaces([allNamespaceItem]);
      hasLoadedOnceRef.current = false;
    };

    const handleKubeconfigChanging = () => {
      refreshOrchestrator.setDomainEnabled('namespaces', false);
      refreshOrchestrator.resetDomain('namespaces');
      setSelectedNamespace(undefined);
      setNamespaces([allNamespaceItem]);
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
  }, [allNamespaceItem]);

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
      namespaceLoading,
      namespaceRefreshing,
      setSelectedNamespace: handleSetSelectedNamespace,
      loadNamespaces,
      refreshNamespaces,
    }),
    [
      namespaces,
      selectedNamespace,
      namespaceLoading,
      namespaceRefreshing,
      handleSetSelectedNamespace,
      loadNamespaces,
      refreshNamespaces,
    ]
  );

  return <NamespaceContext.Provider value={contextValue}>{children}</NamespaceContext.Provider>;
};
