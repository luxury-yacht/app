/**
 * frontend/src/ui/favorites/navigateToFavorite.ts
 *
 * Shared navigation utility for favorites. Used by FavMenuDropdown
 * and the command palette.
 *
 * Handles cluster switching and sets pendingFavorite. The actual view/namespace
 * navigation is handled by the FavoritesContext effect once the cluster is ready.
 */

import { isClusterSpecificFavorite } from '@/core/navigation/favoriteRoute';
import type { Favorite } from '@/core/persistence/favorites';

export interface NavigationContexts {
  selectedKubeconfigs: string[];
  selectedClusterId?: string;
  openKubeconfig: (selection: string) => Promise<void>;
  setActiveKubeconfig: (config: string) => void;
  getClusterMeta?: (config: string) => { id: string; name: string };
  /** Set the pending favorite so FavoritesContext can restore navigation + filter state. */
  setPendingFavorite: (fav: Favorite | null) => void;
}

/**
 * Navigates to a saved favorite.
 *
 * 1. Sets pendingFavorite so FavoritesContext can apply view/namespace/filter
 *    state once the cluster is ready.
 * 2. If the favorite is cluster-specific and the cluster isn't open, opens it.
 * 3. If the favorite is cluster-specific and already open, activates it.
 * 4. If generic, uses whatever cluster is active.
 */
export function navigateToFavorite(
  favorite: Favorite,
  contexts: NavigationContexts,
  onComplete?: () => void
): void {
  contexts.setPendingFavorite(favorite);
  if (isClusterSpecificFavorite(favorite)) {
    activateFavoriteCluster(favorite, contexts);
  }
  onComplete?.();
}

const activateFavoriteCluster = (favorite: Favorite, contexts: NavigationContexts): void => {
  const {
    selectedKubeconfigs,
    selectedClusterId,
    getClusterMeta,
    openKubeconfig,
    setActiveKubeconfig,
  } = contexts;
  const favoriteClusterId = favorite.clusterId?.trim() ?? '';
  if (favoriteClusterId && selectedClusterId === favoriteClusterId) {
    return;
  }
  const clusterSelection =
    favorite.clusterSelection ||
    selectedKubeconfigs.find((selection) => getClusterMeta?.(selection).id === favoriteClusterId);
  if (!clusterSelection) {
    return;
  }
  if (selectedKubeconfigs.includes(clusterSelection)) {
    setActiveKubeconfig(clusterSelection);
  } else {
    void openKubeconfig(clusterSelection);
  }
};
