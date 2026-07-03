/**
 * frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx
 *
 * Tracks which cluster tab is active and resets the managed cluster domains
 * when the kubeconfig changes.
 *
 * This context deliberately holds NO domain leases and fetches NO data. Row
 * data for every cluster tab is owned by the query-backed tables
 * (useQueryBackedClusterResourceGridTable), which hold their own base-scope
 * lifecycle leases — the per-domain handles this context used to keep were
 * rendered nowhere (the manager read only their errors) and their doorbell
 * refetches re-downloaded each base scope every metric tick.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { refreshOrchestrator } from '@/core/refresh';
import type { RefreshDomain } from '@/core/refresh/types';
import type { ClusterViewType } from '@/types/navigation/views';
import { eventBus } from '@/core/events';

// The managed cluster domains, reset together on kubeconfig switches so no
// stale per-cluster rows survive into the next selection. (Catalog is
// excluded — browse owns its own lifecycle.)
const CLUSTER_DOMAIN_SET = new Set<RefreshDomain>([
  'nodes',
  'cluster-rbac',
  'cluster-storage',
  'cluster-config',
  'cluster-crds',
  'cluster-events',
]);

interface ClusterResourcesContextType {
  activeResourceType: ClusterViewType | null;
  setActiveResourceType: React.Dispatch<React.SetStateAction<ClusterViewType | null>>;
}

const ClusterResourcesContext = createContext<ClusterResourcesContextType | undefined>(undefined);

export const useClusterResources = () => {
  const context = useContext(ClusterResourcesContext);
  if (!context) {
    throw new Error('useClusterResources must be used within ClusterResourcesProvider');
  }
  return context;
};

interface ClusterResourcesProviderProps {
  children: ReactNode;
  activeView?: ClusterViewType | null;
}

export const ClusterResourcesProvider: React.FC<ClusterResourcesProviderProps> = ({
  children,
  activeView,
}) => {
  const [activeResourceType, setActiveResourceType] = useState<ClusterViewType | null>(
    activeView ?? null
  );

  useEffect(() => {
    if (activeView !== undefined) {
      setActiveResourceType(activeView ?? null);
    }
  }, [activeView]);

  const setActiveResourceTypeWithCallback = useCallback(
    (view: ClusterViewType | null | ((prev: ClusterViewType | null) => ClusterViewType | null)) => {
      setActiveResourceType((prev) =>
        typeof view === 'function'
          ? (view as (prev: ClusterViewType | null) => ClusterViewType | null)(prev)
          : view
      );
    },
    []
  );

  useEffect(() => {
    const handleKubeconfigChanging = () => {
      CLUSTER_DOMAIN_SET.forEach((domain) => {
        // resetDomain already delegates to resetAllScopedDomainStates for scoped domains.
        refreshOrchestrator.resetDomain(domain);
      });
    };

    const handleKubeconfigChanged = () => {
      setActiveResourceTypeWithCallback(null);
    };

    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    const unsubChanged = eventBus.on('kubeconfig:changed', handleKubeconfigChanged);

    return () => {
      unsubChanging();
      unsubChanged();
    };
  }, [setActiveResourceTypeWithCallback]);

  const contextValue = useMemo(
    () => ({
      activeResourceType,
      setActiveResourceType: setActiveResourceTypeWithCallback,
    }),
    [activeResourceType, setActiveResourceTypeWithCallback]
  );

  return (
    <ClusterResourcesContext.Provider value={contextValue}>
      {children}
    </ClusterResourcesContext.Provider>
  );
};
