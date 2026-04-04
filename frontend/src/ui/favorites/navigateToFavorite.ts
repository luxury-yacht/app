/**
 * frontend/src/ui/favorites/navigateToFavorite.ts
 *
 * Shared navigation utility for favorites. Used by FavMenuDropdown
 * and the command palette.
 *
 * Handles cluster switching and sets pendingFavorite. The actual view/namespace
 * navigation is handled by the FavoritesContext effect once the cluster is ready.
 */

import type { Favorite } from '@/core/persistence/favorites';

export interface NavigationContexts {
  selectedKubeconfigs: string[];
  setSelectedKubeconfigs: (configs: string[]) => Promise<void>;
  setActiveKubeconfig: (config: string) => void;
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
  const { selectedKubeconfigs, setSelectedKubeconfigs, setActiveKubeconfig, setPendingFavorite } =
    contexts;

  setPendingFavorite(favorite);

  const isClusterSpecific = favorite.clusterSelection !== '';

  if (isClusterSpecific) {
    const alreadyOpen = selectedKubeconfigs.includes(favorite.clusterSelection);
    if (!alreadyOpen) {
      const updated = [...selectedKubeconfigs, favorite.clusterSelection];
      void setSelectedKubeconfigs(updated).then(() => {
        setActiveKubeconfig(favorite.clusterSelection);
      });
    } else {
      setActiveKubeconfig(favorite.clusterSelection);
    }
  }

  onComplete?.();
}
