/**
 * frontend/src/core/contexts/FavoritesContext.tsx
 *
 * React context that provides the favorites list and mutation functions
 * to the component tree. Manages pendingFavorite for navigation — when a
 * favorite is activated, this context waits for the cluster to be ready
 * then applies the view/namespace/sidebar state.
 */

import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isClusterOperationalState } from '@/core/contexts/clusterLifecycleState';
import { resolveFavoriteRoute } from '@/core/navigation/favoriteRoute';
import type { Favorite } from '@/core/persistence/favorites';
import {
  hydrateFavorites,
  addFavorite as persistAddFavorite,
  deleteFavorite as persistDeleteFavorite,
  updateFavorite as persistUpdateFavorite,
  setFavoriteOrder,
  subscribeFavorites,
} from '@/core/persistence/favorites';
import {
  parseClusterViewType,
  parseGlobalViewType,
  parseNamespaceViewType,
} from '@/types/navigation/views';

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

export const useOptionalFavorites = (): FavoritesContextType | undefined =>
  useContext(FavoritesContext);

// ---------- Provider ----------

interface FavoritesProviderProps {
  children: React.ReactNode;
}

type FavoriteRoute = ReturnType<typeof resolveFavoriteRoute>;
type ClusterLifecycle = ReturnType<typeof useClusterLifecycle>;
type ViewState = ReturnType<typeof useViewState>;
type NamespaceContext = ReturnType<typeof useNamespace>;

interface FavoriteNavigationReadiness {
  favorite: Favorite;
  route: FavoriteRoute;
  selectedKubeconfig: string;
  selectedClusterId: string;
  namespaceReady: boolean;
  getClusterState: ClusterLifecycle['getClusterState'];
}

const isFavoriteClusterOperational = ({
  favorite,
  route,
  selectedKubeconfig,
  selectedClusterId,
  getClusterState,
}: FavoriteNavigationReadiness): boolean => {
  const favoriteClusterId = favorite.clusterId?.trim() ?? '';
  const isClusterSpecific =
    route.scope !== 'global' && (favorite.clusterSelection !== '' || favoriteClusterId !== '');
  if (!isClusterSpecific) {
    return !selectedClusterId || isClusterOperationalState(getClusterState(selectedClusterId));
  }
  if (favoriteClusterId && selectedClusterId !== favoriteClusterId) {
    return false;
  }
  if (!favoriteClusterId && selectedKubeconfig !== favorite.clusterSelection) {
    return false;
  }
  return isClusterOperationalState(getClusterState(favoriteClusterId || selectedClusterId));
};

const canApplyFavoriteNavigation = (readiness: FavoriteNavigationReadiness): boolean =>
  isFavoriteClusterOperational(readiness) &&
  (readiness.route.scope !== 'namespace' || readiness.namespaceReady);

const applyNamespaceFavoriteNavigation = (
  favorite: Favorite,
  viewState: ViewState,
  namespaceContext: NamespaceContext
) => {
  viewState.setViewType('namespace');
  if (favorite.namespace) {
    namespaceContext.setSelectedNamespace(favorite.namespace);
    viewState.onNamespaceSelect(favorite.namespace);
  }
  const favoriteTab = parseNamespaceViewType(favorite.view);
  if (favoriteTab) {
    viewState.setActiveNamespaceTab(favoriteTab);
  }
  viewState.setSidebarSelection({ type: 'namespace', value: favorite.namespace || '' });
};

const applyFavoriteNavigation = (
  favorite: Favorite,
  route: FavoriteRoute,
  viewState: ViewState,
  namespaceContext: NamespaceContext
) => {
  if (route.scope === 'global') {
    const globalView = parseGlobalViewType(route.view);
    if (globalView) {
      viewState.navigateToGlobal(globalView);
    }
    return;
  }
  if (route.scope === 'namespace') {
    applyNamespaceFavoriteNavigation(favorite, viewState, namespaceContext);
    return;
  }
  viewState.setViewType('cluster');
  viewState.setActiveClusterView(parseClusterViewType(favorite.view) ?? null);
  viewState.setSidebarSelection({ type: 'cluster', value: 'cluster' });
};

export const FavoritesProvider: React.FC<FavoritesProviderProps> = ({ children }) => {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [pendingFavorite, setPendingFavoriteState] = useState<Favorite | null>(null);
  const navigationAppliedRef = useRef(false);
  const setPendingFavorite = useCallback((favorite: Favorite | null) => {
    navigationAppliedRef.current = false;
    setPendingFavoriteState(favorite);
  }, []);
  const { selectedKubeconfig, selectedClusterId } = useKubeconfig();
  const { getClusterState } = useClusterLifecycle();
  const viewState = useViewState();
  const namespaceCtx = useNamespace();
  const namespaceReady = namespaceCtx.namespaceReady;
  const pendingClusterId = pendingFavorite?.clusterId?.trim() || selectedClusterId;
  const pendingClusterState = pendingClusterId ? getClusterState(pendingClusterId) : undefined;
  const pendingProgressKey = `${pendingClusterId}\u0000${pendingClusterState ?? ''}`;
  const pendingProgressRef = useRef('');

  useEffect(() => {
    if (!pendingFavorite) {
      return;
    }
    pendingProgressRef.current = pendingProgressKey;
    const timer = window.setTimeout(() => {
      setPendingFavoriteState((current) =>
        current === pendingFavorite && pendingProgressRef.current === pendingProgressKey
          ? null
          : current
      );
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [pendingFavorite, pendingProgressKey]);

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
  // once the correct cluster is operational. The lifecycle gate replaces
  // the old queueMicrotask timing hack — the effect re-runs when cluster lifecycle
  // state changes, so navigation applies once data services are usable.
  useEffect(() => {
    if (!pendingFavorite) {
      navigationAppliedRef.current = false;
      return;
    }
    if (navigationAppliedRef.current) {
      return;
    }

    const route = resolveFavoriteRoute(pendingFavorite.viewType, pendingFavorite.view);
    if (
      !canApplyFavoriteNavigation({
        favorite: pendingFavorite,
        route,
        selectedKubeconfig,
        selectedClusterId,
        namespaceReady,
        getClusterState,
      })
    ) {
      return;
    }

    navigationAppliedRef.current = true;
    applyFavoriteNavigation(pendingFavorite, route, viewState, namespaceCtx);
  }, [
    pendingFavorite,
    selectedKubeconfig,
    selectedClusterId,
    getClusterState,
    namespaceReady,
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
      setPendingFavorite,
    ]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
};
