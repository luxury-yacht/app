/**
 * frontend/src/ui/favorites/FavToggle.tsx
 *
 * Hook that returns an IconBarItem for a heart toggle in the GridTableFiltersBar.
 * When the current view matches a saved favorite the heart is filled;
 * otherwise it is outlined. Clicking the heart opens a modal to save,
 * update, or delete the favorite.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FavoriteOutlineIcon, FavoriteFilledIcon } from '@shared/components/icons/MenuIcons';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { useFavorites } from '@core/contexts/FavoritesContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';
import FavSaveModal from './FavSaveModal';

/** Current view state that the FavToggle needs to snapshot when saving a favorite.
 *  Also accepts setters for restoring state from a pending favorite on navigation. */
export interface FavToggleState {
  /** Current grid table filter state (search, kinds, namespaces, caseSensitive). */
  filters: GridTableFilterState;
  /** Whether the include-metadata search toggle is active. */
  includeMetadata?: boolean;
  /** Current sort column key, or null if unsorted. */
  sortColumn: string | null;
  /** Current sort direction. */
  sortDirection: 'asc' | 'desc';
  /** Current column visibility map. */
  columnVisibility: Record<string, boolean>;
  /** Available kind values for the favorites modal kind filter dropdown. */
  availableKinds?: string[];
  /** Available namespace values for the favorites modal namespace filter dropdown. */
  availableFilterNamespaces?: string[];
  /** Whether the persistence layer has finished hydrating. Restore waits for this. */
  hydrated?: boolean;
  /** Setters for restoring state from a pending favorite. */
  setFilters?: (filters: GridTableFilterState) => void;
  setSortConfig?: (config: { key: string; direction: 'asc' | 'desc' }) => void;
  setColumnVisibility?: (visibility: Record<string, boolean>) => void;
  setIncludeMetadata?: (value: boolean) => void;
}

// ---------------------------------------------------------------------------
// View-label lookup — maps tab id to display label for auto-generated names.
// Mirrors the labels used in the Sidebar navigation.
// ---------------------------------------------------------------------------

const NAMESPACE_VIEW_LABELS: Record<string, string> = {
  browse: 'Browse',
  workloads: 'Workloads',
  pods: 'Pods',
  config: 'Config',
  network: 'Network',
  rbac: 'RBAC',
  storage: 'Storage',
  autoscaling: 'Autoscaling',
  quotas: 'Quotas',
  custom: 'Custom',
  helm: 'Helm',
  events: 'Events',
};

const CLUSTER_VIEW_LABELS: Record<string, string> = {
  browse: 'Browse',
  nodes: 'Nodes',
  config: 'Config',
  crds: 'CRDs',
  custom: 'Custom',
  events: 'Events',
  rbac: 'RBAC',
  storage: 'Storage',
};

// ---------------------------------------------------------------------------
// useFavToggle hook
// ---------------------------------------------------------------------------

/**
 * Returns an IconBarItem (toggle type) for the heart favorite button
 * in the GridTableFiltersBar's preActions slot.
 */
export function useFavToggle(state: FavToggleState): {
  item: IconBarItem;
  modal: React.JSX.Element;
} {
  const {
    favorites,
    addFavorite,
    updateFavorite,
    deleteFavorite,
    pendingFavorite,
    setPendingFavorite,
  } = useFavorites();
  const { selectedKubeconfig, selectedClusterName } = useKubeconfig();
  const { viewType, activeNamespaceTab, activeClusterTab } = useViewState();
  const { selectedNamespace } = useNamespace();

  // Derive the active view tab.
  const activeViewTab = viewType === 'namespace' ? activeNamespaceTab : activeClusterTab;

  // Match the current view + filter state against saved favorites.
  // Includes filter comparison so multiple favorites on the same view
  // with different filters are treated as distinct entries.
  const currentFavoriteMatch = useMemo<Favorite | null>(() => {
    for (const fav of favorites) {
      const clusterMatches =
        fav.clusterSelection === '' || selectedKubeconfig === fav.clusterSelection;
      if (!clusterMatches) continue;
      if (viewType !== fav.viewType) continue;
      if (activeViewTab !== fav.view) continue;
      if (viewType === 'namespace' && selectedNamespace !== fav.namespace) continue;

      // Compare filters: search text, kinds, namespaces, caseSensitive, includeMetadata.
      if (fav.filters) {
        const search = state.filters.search.trim();
        const favSearch = (fav.filters.search ?? '').trim();
        if (search !== favSearch) continue;

        const kinds = [...state.filters.kinds].sort().join(',');
        const favKinds = [...(fav.filters.kinds ?? [])].sort().join(',');
        if (kinds !== favKinds) continue;

        const ns = [...state.filters.namespaces].sort().join(',');
        const favNs = [...(fav.filters.namespaces ?? [])].sort().join(',');
        if (ns !== favNs) continue;

        if ((state.filters.caseSensitive ?? false) !== (fav.filters.caseSensitive ?? false))
          continue;
        if ((state.includeMetadata ?? false) !== (fav.filters.includeMetadata ?? false)) continue;
      }

      return fav;
    }
    return null;
  }, [
    favorites,
    selectedKubeconfig,
    viewType,
    activeViewTab,
    selectedNamespace,
    state.filters,
    state.includeMetadata,
  ]);

  // Restore filter/table state from a pending favorite once:
  // 1. The correct view is active (viewType + tab + namespace match)
  // 2. The persistence layer has hydrated for this view
  //
  // The FavoritesContext effect handles cluster switching and view navigation.
  // This effect waits for those to settle before applying filter/table state.
  useEffect(() => {
    if (!pendingFavorite) return;
    if (!state.hydrated) return;

    // Only apply in the view that matches the favorite's target.
    if (pendingFavorite.viewType !== viewType) return;
    const expectedTab = viewType === 'namespace' ? activeNamespaceTab : activeClusterTab;
    if (pendingFavorite.view !== expectedTab) return;
    if (viewType === 'namespace' && pendingFavorite.namespace !== selectedNamespace) return;

    if (pendingFavorite.filters && state.setFilters) {
      state.setFilters({
        search: pendingFavorite.filters.search ?? '',
        kinds: pendingFavorite.filters.kinds ?? [],
        namespaces: pendingFavorite.filters.namespaces ?? [],
        caseSensitive: pendingFavorite.filters.caseSensitive ?? false,
        includeMetadata: pendingFavorite.filters.includeMetadata ?? false,
      });
    }
    if (pendingFavorite.tableState?.sortColumn && state.setSortConfig) {
      state.setSortConfig({
        key: pendingFavorite.tableState.sortColumn,
        direction: (pendingFavorite.tableState.sortDirection as 'asc' | 'desc') ?? 'asc',
      });
    }
    if (pendingFavorite.tableState?.columnVisibility && state.setColumnVisibility) {
      state.setColumnVisibility(pendingFavorite.tableState.columnVisibility);
    }
    setPendingFavorite(null);
  }, [
    pendingFavorite,
    setPendingFavorite,
    viewType,
    activeNamespaceTab,
    activeClusterTab,
    selectedNamespace,
    state,
  ]);

  const [modalOpen, setModalOpen] = useState(false);

  const isFavorited = currentFavoriteMatch != null;

  // Build a human-readable display label for the view tab.
  const viewLabel = useMemo(() => {
    const tab = activeViewTab ?? '';
    if (viewType === 'namespace') {
      return NAMESPACE_VIEW_LABELS[tab] ?? tab;
    }
    return CLUSTER_VIEW_LABELS[tab] ?? tab;
  }, [viewType, activeViewTab]);

  // Auto-generate a default name for new favorites.
  const defaultName = useMemo(() => {
    const parts: string[] = [];
    if (selectedClusterName) {
      parts.push(selectedClusterName);
    }
    if (viewType === 'namespace' && selectedNamespace) {
      parts.push(selectedNamespace);
    }
    parts.push(viewLabel);
    const base = parts.join(' / ');
    const hasActiveFilters =
      state.filters.search.trim().length > 0 ||
      state.filters.kinds.length > 0 ||
      state.filters.namespaces.length > 0;
    return hasActiveFilters ? `${base} (filtered)` : base;
  }, [selectedClusterName, viewType, selectedNamespace, viewLabel, state.filters]);

  // Snapshot current filter and table state for the modal.
  const currentFilters = useMemo(
    (): FavoriteFilters => ({
      search: state.filters.search,
      kinds: [...state.filters.kinds],
      namespaces: [...state.filters.namespaces],
      caseSensitive: state.filters.caseSensitive ?? false,
      includeMetadata: state.includeMetadata ?? false,
    }),
    [state.filters, state.includeMetadata]
  );

  const currentTableState = useMemo(
    (): FavoriteTableState => ({
      sortColumn: state.sortColumn ?? '',
      sortDirection: state.sortDirection,
      columnVisibility: { ...state.columnVisibility },
    }),
    [state.sortColumn, state.sortDirection, state.columnVisibility]
  );

  const handleSave = useCallback(
    async (fav: Favorite) => {
      if (fav.id) {
        await updateFavorite(fav);
      } else {
        await addFavorite(fav);
      }
    },
    [addFavorite, updateFavorite]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteFavorite(id);
    },
    [deleteFavorite]
  );

  // Build the IconBarItem returned to the caller.
  const item = useMemo<IconBarItem>(() => {
    return {
      type: 'toggle' as const,
      id: 'favorite',
      icon: isFavorited ? <FavoriteFilledIcon /> : <FavoriteOutlineIcon />,
      active: isFavorited,
      onClick: () => setModalOpen(true),
      title: isFavorited ? 'Edit favorite' : 'Save as favorite',
    };
  }, [isFavorited]);

  return {
    item,
    modal: (
      <FavSaveModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        existingFavorite={currentFavoriteMatch}
        defaultName={defaultName}
        clusterName={selectedClusterName}
        kubeconfigSelection={selectedKubeconfig}
        viewType={viewType}
        viewLabel={viewLabel}
        namespace={viewType === 'namespace' ? (selectedNamespace ?? '') : ''}
        filters={currentFilters}
        tableState={currentTableState}
        includeMetadata={state.includeMetadata ?? false}
        availableKinds={state.availableKinds}
        availableFilterNamespaces={state.availableFilterNamespaces}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    ),
  };
}
