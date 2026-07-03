/**
 * frontend/src/modules/namespace/contexts/NsResourcesContext.tsx
 *
 * Tracks which namespace and namespace tab are active, publishes that
 * selection to the refresh orchestrator, and primes single-namespace
 * permission checks.
 *
 * This context deliberately holds NO domain leases and fetches NO data. Row
 * data for every namespace tab is owned by the query-backed tables
 * (useQueryBackedNamespaceResourceGridTable), which hold their own base-scope
 * lifecycle leases — the descriptor-backed copies this context used to keep
 * were rendered nowhere and doubled every metric-tick fetch.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { queryNamespacePermissions } from '@/core/capabilities';
import { refreshOrchestrator } from '@/core/refresh';
import type { NamespaceViewType } from '@/types/navigation/views';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';

interface NamespaceResourcesContextType {
  currentNamespace: string | null;
  setCurrentNamespace: (namespace: string | null) => void;

  activeResourceType: NamespaceViewType | null;
  setActiveResourceType: React.Dispatch<React.SetStateAction<NamespaceViewType | null>>;
}

const NamespaceResourcesContext = createContext<NamespaceResourcesContextType | undefined>(
  undefined
);

const DEFAULT_NAMESPACE_VIEW: NamespaceViewType = 'workloads';

// Extracts the concrete namespace name for capability checks; the
// all-namespaces sentinel has no single namespace to query.
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

export const useNamespaceResources = () => {
  const context = useContext(NamespaceResourcesContext);
  if (!context) {
    throw new Error('useNamespaceResources must be used within NamespaceResourcesProvider');
  }
  return context;
};

interface NamespaceResourcesProviderProps {
  children: ReactNode;
  namespace?: string | null;
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

  // Publish the active namespace selection to the orchestrator: scope routing
  // and streaming gating across the refresh subsystem read it from context.
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

  // Single-namespace permission query.
  useEffect(() => {
    const capabilityNamespace = getCapabilityNamespace(currentNamespace);
    if (!capabilityNamespace) {
      return;
    }
    queryNamespacePermissions(capabilityNamespace, namespaceClusterId ?? null);
  }, [currentNamespace, namespaceClusterId]);

  const contextValue = useMemo(
    () => ({
      currentNamespace,
      setCurrentNamespace,
      activeResourceType,
      setActiveResourceType,
    }),
    [currentNamespace, activeResourceType, setActiveResourceType]
  );

  return (
    <NamespaceResourcesContext.Provider value={contextValue}>
      {children}
    </NamespaceResourcesContext.Provider>
  );
};
