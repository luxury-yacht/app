/**
 * frontend/src/core/contexts/FavoritesContext.tsx
 *
 * React context that provides the favorites list and mutation functions
 * to the component tree. Computes `currentFavoriteMatch` — whether the
 * user's current navigation state (cluster, view, namespace) matches
 * any saved favorite.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { Favorite } from '@/core/persistence/favorites';
import {
  hydrateFavorites,
  addFavorite as persistAddFavorite,
  updateFavorite as persistUpdateFavorite,
  deleteFavorite as persistDeleteFavorite,
  setFavoriteOrder,
  subscribeFavorites,
} from '@/core/persistence/favorites';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import type { ClusterViewType, NamespaceViewType } from '@/types/navigation/views';

// ---------- Types ----------

interface FavoritesContextType {
  favorites: Favorite[];
  addFavorite: (fav: Favorite) => Promise<Favorite>;
  updateFavorite: (fav: Favorite) => Promise<void>;
  deleteFavorite: (id: string) => Promise<void>;
  reorderFavorites: (ids: string[]) => Promise<void>;
  /** Set by navigateToFavorite — the favorite being navigated to. Views read this
   *  on mount to restore saved filter/table state, then clear it. */
  pendingFavorite: Favorite | null;
  setPendingFavorite: (fav: Favorite | null) => void;
}

// ---------- Context ----------

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

// ---------- Hook ----------

export const useFavorites = (): FavoritesContextType => {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used within FavoritesProvider');
  }
  return context;
};

// ---------- Provider ----------

interface FavoritesProviderProps {
  children: React.ReactNode;
}

export const FavoritesProvider: React.FC<FavoritesProviderProps> = ({ children }) => {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [pendingFavorite, setPendingFavorite] = useState<Favorite | null>(null);
  const { selectedKubeconfig, selectedClusterId } = useKubeconfig();
  const { isClusterReady } = useClusterLifecycle();
  const viewState = useViewState();
  const namespaceCtx = useNamespace();
  // Track whether navigation state has been applied for the current pending favorite.
  const navigationAppliedRef = useRef(false);

  // Hydrate the favorites cache from the backend on mount.
  useEffect(() => {
    let active = true;
    hydrateFavorites().then((favs) => {
      if (active) {
        setFavorites(favs);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Subscribe to persistence-layer change events so React state stays in sync
  // with mutations that happen outside this provider (e.g. another window).
  useEffect(() => {
    return subscribeFavorites((favs) => {
      setFavorites(favs);
    });
  }, []);

  // Apply navigation state (view, namespace, sidebar) from a pending favorite
  // once the correct cluster is active and ready. The isClusterReady gate replaces
  // the old queueMicrotask timing hack — the effect re-runs when cluster lifecycle
  // state changes, so navigation applies exactly when the cluster is ready.
  useEffect(() => {
    if (!pendingFavorite) {
      navigationAppliedRef.current = false;
      return;
    }
    if (navigationAppliedRef.current) return;

    // For cluster-specific favorites, wait for the correct cluster to be active AND ready.
    const isClusterSpecific = pendingFavorite.clusterSelection !== '';
    if (isClusterSpecific) {
      if (selectedKubeconfig !== pendingFavorite.clusterSelection) return;
      if (!isClusterReady(selectedClusterId)) return;
    } else {
      // Generic favorite: wait for the active cluster to be ready.
      if (selectedClusterId && !isClusterReady(selectedClusterId)) return;
    }

    navigationAppliedRef.current = true;

    if (pendingFavorite.viewType === 'namespace') {
      viewState.setViewType('namespace');
      if (pendingFavorite.namespace) {
        namespaceCtx.setSelectedNamespace(pendingFavorite.namespace);
        viewState.onNamespaceSelect(pendingFavorite.namespace);
      }
      // Set the tab AFTER onNamespaceSelect, which defaults to 'browse'
      // when coming from a non-namespace view. The favorite's view overrides that.
      viewState.setActiveNamespaceTab(pendingFavorite.view as NamespaceViewType);
      viewState.setSidebarSelection({
        type: 'namespace',
        value: pendingFavorite.namespace || '',
      });
    } else if (pendingFavorite.viewType === 'cluster') {
      viewState.setViewType('cluster');
      viewState.setActiveClusterView((pendingFavorite.view as ClusterViewType) || null);
      viewState.setSidebarSelection({ type: 'cluster', value: 'cluster' });
    }
  }, [
    pendingFavorite,
    selectedKubeconfig,
    selectedClusterId,
    isClusterReady,
    viewState,
    namespaceCtx,
  ]);

  // ---------- Mutation callbacks ----------

  const handleAddFavorite = useCallback(async (fav: Favorite): Promise<Favorite> => {
    return persistAddFavorite(fav);
  }, []);

  const handleUpdateFavorite = useCallback(async (fav: Favorite): Promise<void> => {
    return persistUpdateFavorite(fav);
  }, []);

  const handleDeleteFavorite = useCallback(async (id: string): Promise<void> => {
    return persistDeleteFavorite(id);
  }, []);

  const handleReorderFavorites = useCallback(async (ids: string[]): Promise<void> => {
    return setFavoriteOrder(ids);
  }, []);

  // ---------- Context value ----------

  const value = useMemo<FavoritesContextType>(
    () => ({
      favorites,
      addFavorite: handleAddFavorite,
      updateFavorite: handleUpdateFavorite,
      deleteFavorite: handleDeleteFavorite,
      reorderFavorites: handleReorderFavorites,
      pendingFavorite,
      setPendingFavorite,
    }),
    [
      favorites,
      handleAddFavorite,
      handleUpdateFavorite,
      handleDeleteFavorite,
      handleReorderFavorites,
      pendingFavorite,
    ]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
};
