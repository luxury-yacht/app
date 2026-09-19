import type { Favorite } from '@/core/persistence/favorites';
import { parseGlobalViewType } from '@/types/navigation/views';

export type FavoriteRouteScope = 'global' | 'cluster' | 'namespace';

export interface FavoriteRoute {
  scope: FavoriteRouteScope;
  view: string;
}

/**
 * Normalize persisted favorite routes at the navigation boundary. Global
 * favorites were historically stored as cluster routes, so both encodings
 * resolve to the first-class Global workspace.
 */
export const resolveFavoriteRoute = (viewType: string, view: string): FavoriteRoute => {
  if (viewType === 'global' || (viewType === 'cluster' && parseGlobalViewType(view))) {
    return { scope: 'global', view };
  }
  return {
    scope: viewType === 'namespace' ? 'namespace' : 'cluster',
    view,
  };
};

type FavoriteClusterTarget = Pick<Favorite, 'viewType' | 'view' | 'clusterId' | 'clusterSelection'>;

export const isClusterSpecificFavorite = (favorite: FavoriteClusterTarget): boolean =>
  resolveFavoriteRoute(favorite.viewType, favorite.view).scope !== 'global' &&
  Boolean(favorite.clusterId?.trim() || favorite.clusterSelection);

export const favoriteMatchesCluster = (
  favorite: FavoriteClusterTarget,
  location: { selectedClusterId: string; selectedKubeconfig: string }
): boolean => {
  if (!isClusterSpecificFavorite(favorite)) {
    return true;
  }
  const clusterId = favorite.clusterId?.trim();
  return clusterId
    ? location.selectedClusterId === clusterId
    : location.selectedKubeconfig === favorite.clusterSelection;
};
