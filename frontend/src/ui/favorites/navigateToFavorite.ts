/**
 * frontend/src/ui/favorites/navigateToFavorite.ts
 *
 * Shared navigation utility for favorites. Used by FavMenuDropdown (Task 4)
 * and will be consumed by the command palette integration (Task 6).
 *
 * Handles cluster switching, view routing, and namespace selection to restore
 * the saved navigation state of a favorite.
 */

import type { Favorite } from '@/core/persistence/favorites';
import type { ViewType, ClusterViewType, NamespaceViewType } from '@/types/navigation/views';
import type { SidebarSelectionType } from '@core/contexts/SidebarStateContext';

export interface NavigationContexts {
  selectedKubeconfigs: string[];
  setSelectedKubeconfigs: (configs: string[]) => Promise<void>;
  setActiveKubeconfig: (config: string) => void;
  setViewType: (view: ViewType) => void;
  setActiveClusterView: (tab: ClusterViewType | null) => void;
  setActiveNamespaceTab: (tab: NamespaceViewType) => void;
  setSelectedNamespace: (namespace: string, clusterId?: string) => void;
  onNamespaceSelect: (namespace: string) => void;
  setSidebarSelection: (selection: SidebarSelectionType) => void;
  /** Set the pending favorite so the target view can restore its filter/table state on mount. */
  setPendingFavorite: (fav: Favorite | null) => void;
}

/**
 * Navigates to a saved favorite by restoring its cluster, view, and namespace state.
 *
 * 1. If the favorite is cluster-specific and the cluster isn't currently open,
 *    it adds the cluster to selectedKubeconfigs before switching to it.
 * 2. If the favorite is cluster-specific and the cluster is already open,
 *    it simply activates that cluster tab.
 * 3. If the favorite is generic (empty clusterSelection), it uses whatever
 *    cluster is currently active — no cluster switching occurs.
 * 4. Sets the view type and tab to match the favorite.
 * 5. For namespace views, selects the saved namespace.
 * 6. Updates the sidebar selection to match the target view.
 */
export function navigateToFavorite(
  favorite: Favorite,
  contexts: NavigationContexts,
  onComplete?: () => void
): void {
  const { selectedKubeconfigs, setSelectedKubeconfigs, setActiveKubeconfig, setPendingFavorite } =
    contexts;

  // Store the favorite so effects in FavoritesContext can restore
  // the full navigation + filter state after the cluster has settled.
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
