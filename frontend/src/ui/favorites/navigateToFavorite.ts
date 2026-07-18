/**
 * frontend/src/ui/favorites/navigateToFavorite.ts
 *
 * Shared navigation utility for favorites. Used by FavMenuDropdown
 * and the command palette.
 *
 * Handles cluster switching and sets pendingFavorite. The actual view/namespace
 * navigation is handled by the FavoritesContext effect once the cluster is ready.
 */

import { resolveFavoriteRoute } from '@/core/navigation/favoriteRoute';
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
  const {
    selectedKubeconfigs,
    selectedClusterId,
    openKubeconfig,
    setActiveKubeconfig,
    getClusterMeta,
    setPendingFavorite,
  } = contexts;

  setPendingFavorite(favorite);

  const route = resolveFavoriteRoute(favorite.viewType, favorite.view);
  const favoriteClusterId = favorite.clusterId?.trim() ?? '';
  const isClusterSpecific =
    route.scope !== 'global' && (favorite.clusterSelection !== '' || favoriteClusterId !== '');

  if (isClusterSpecific) {
    const clusterSelection =
      favorite.clusterSelection ||
      selectedKubeconfigs.find(
        (selection) => getClusterMeta?.(selection).id === favoriteClusterId
      ) ||
      '';
    if (!clusterSelection) {
      onComplete?.();
      return;
    }
    const alreadyActive =
      favoriteClusterId && selectedClusterId ? selectedClusterId === favoriteClusterId : false;
    const alreadyOpen = selectedKubeconfigs.includes(clusterSelection);
    if (alreadyActive) {
      // The same logical cluster can be open under a different kubeconfig path.
      // Cluster identity wins over the persisted path.
    } else if (!alreadyOpen) {
      void openKubeconfig(clusterSelection);
    } else {
      setActiveKubeconfig(clusterSelection);
    }
  }

  onComplete?.();
}
