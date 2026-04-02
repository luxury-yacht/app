/**
 * frontend/src/core/contexts/FavoritesContext.tsx
 *
 * React context that provides the favorites list and mutation functions
 * to the component tree. Computes `currentFavoriteMatch` — whether the
 * user's current navigation state (cluster, view, namespace) matches
 * any saved favorite.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
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
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';

// ---------- Types ----------

interface FavoritesContextType {
  favorites: Favorite[];
  currentFavoriteMatch: Favorite | null;
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
  const { selectedKubeconfig } = useKubeconfig();
  const { viewType, activeNamespaceTab, activeClusterTab } = useViewState();
  const { selectedNamespace } = useNamespace();

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

  // Determine the active view tab based on the current view type.
  const activeViewTab = viewType === 'namespace' ? activeNamespaceTab : activeClusterTab;

  // Compute `currentFavoriteMatch` — the first favorite whose saved navigation
  // state matches the user's current cluster, view, tab, and namespace.
  const currentFavoriteMatch = useMemo<Favorite | null>(() => {
    for (const fav of favorites) {
      // Cluster match: if a favorite is cluster-specific, it must match
      // the active kubeconfig; a generic favorite (empty clusterSelection)
      // matches any cluster.
      const clusterMatches =
        fav.clusterSelection === '' || selectedKubeconfig === fav.clusterSelection;
      if (!clusterMatches) continue;

      if (viewType !== fav.viewType) continue;

      if (activeViewTab !== fav.view) continue;

      // For namespace views, the selected namespace must also match.
      if (viewType === 'namespace' && selectedNamespace !== fav.namespace) continue;

      return fav;
    }
    return null;
  }, [favorites, selectedKubeconfig, viewType, activeViewTab, selectedNamespace]);

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
      currentFavoriteMatch,
      addFavorite: handleAddFavorite,
      updateFavorite: handleUpdateFavorite,
      deleteFavorite: handleDeleteFavorite,
      reorderFavorites: handleReorderFavorites,
      pendingFavorite,
      setPendingFavorite,
    }),
    [
      favorites,
      currentFavoriteMatch,
      handleAddFavorite,
      handleUpdateFavorite,
      handleDeleteFavorite,
      handleReorderFavorites,
      pendingFavorite,
    ]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
};
