/**
 * frontend/src/ui/favorites/FavToggle.tsx
 *
 * Hook that returns an IconBarItem for a heart toggle in the GridTableFiltersBar.
 * When the current view matches a saved favorite the heart is filled;
 * otherwise it is outlined. Clicking the heart opens a modal to save,
 * update, or delete the favorite.
 */

import { useOptionalFavorites } from '@core/contexts/FavoritesContext';
import { useOptionalViewState, type useViewState } from '@core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import {
  isNarrowingFilterSelection,
  normalizeExactMultiSelectFilterSelection,
  normalizeMultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { FavoriteFilledIcon, FavoriteOutlineIcon } from '@shared/components/icons/FavoriteIcons';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';
import {
  DEFAULT_GRID_TABLE_FILTER_STATE,
  normalizeGridTableQueryFacets,
} from '@shared/components/tables/gridTableFilterState';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildActiveViewTitleParts,
  getActiveViewLabel,
  getActiveViewTab,
} from '@/core/navigation/activeViewTitle';
import { favoriteMatchesCluster, resolveFavoriteRoute } from '@/core/navigation/favoriteRoute';
import type { Favorite, FavoriteTableSnapshot } from '@/core/persistence/favorites';
import FavSaveModal, { type FavoriteModalColumn } from './FavSaveModal';
import { favoriteTableSnapshotsEqual } from './favoriteTableSnapshot';

const DISABLED_FAVORITES_CONTEXT = {
  favorites: [],
  addFavorite: (favorite: Favorite) => Promise.resolve(favorite),
  updateFavorite: () => Promise.resolve(),
  deleteFavorite: () => Promise.resolve(),
  reorderFavorites: () => Promise.resolve(),
  pendingFavorite: null,
  favoriteToRestore: null,
  setPendingFavorite: () => undefined,
} satisfies NonNullable<ReturnType<typeof useOptionalFavorites>>;

type ActiveViewType = ReturnType<typeof useViewState>['viewType'];

/** Current view state that the FavToggle needs to snapshot when saving a favorite.
 *  Also accepts setters for restoring state from a pending favorite on navigation. */
export interface FavToggleState {
  /** Embedded surfaces can opt out when they do not own a workspace route. */
  enabled?: boolean;
  /** Current grid table filter state (search, kinds, namespaces, metadata search). */
  filters: GridTableFilterState;
  /** Current sort column key, or null if unsorted. */
  sortColumn: string | null;
  /** Current sort direction. */
  sortDirection: 'asc' | 'desc';
  /** Current column visibility map. */
  columnVisibility: Record<string, boolean>;
  /** Current column order. */
  columnOrder?: string[];
  /** Current table column capabilities and user-facing labels. */
  columns?: FavoriteModalColumn[];
  /** Available kind values for the favorites modal kind filter dropdown. */
  availableKinds?: string[];
  /** Available namespace values for the favorites modal namespace filter dropdown. */
  availableFilterNamespaces?: string[];
  /** Complete live filter-control contract for this table. */
  filterOptions?: GridTableFilterOptions;
  /** Whether the persistence layer has finished hydrating. Restore waits for this. */
  hydrated?: boolean;
  /** Setters for restoring state from a pending favorite. */
  setFilters?: (filters: GridTableFilterState) => void;
  setSortConfig?: (config: { key: string; direction: 'asc' | 'desc' } | null) => void;
  setColumnVisibility?: (visibility: Record<string, boolean>) => void;
  setColumnOrder?: (order: string[]) => void;
}

// ---------------------------------------------------------------------------
// useFavToggle hook
// ---------------------------------------------------------------------------

const snapshotFavoriteTable = (state: FavToggleState): FavoriteTableSnapshot => {
  const queryFacets = normalizeGridTableQueryFacets(state.filters.queryFacets);
  return {
    filters: {
      search: state.filters.search,
      kinds: normalizeMultiSelectFilterSelection(state.filters.kinds),
      namespaces: normalizeMultiSelectFilterSelection(state.filters.namespaces),
      clusters: normalizeExactMultiSelectFilterSelection(state.filters.clusters),
      queryFacets: Object.keys(queryFacets).length > 0 ? queryFacets : undefined,
      includeMetadata: state.filters.includeMetadata ?? false,
    },
    tableState: {
      sortColumn: state.sortColumn ?? '',
      sortDirection: state.sortDirection,
      columnVisibility: { ...state.columnVisibility },
      columnOrder: [...(state.columnOrder ?? [])],
    },
  };
};

interface FavoriteLocation {
  selectedKubeconfig: string;
  selectedClusterId: string;
  viewType: ActiveViewType;
  activeViewTab: string | null;
  selectedNamespace: string | undefined;
}

const favoriteMatchesLocation = (favorite: Favorite, location: FavoriteLocation): boolean => {
  const route = resolveFavoriteRoute(favorite.viewType, favorite.view);
  if (!favoriteMatchesCluster(favorite, location) || location.viewType !== route.scope) {
    return false;
  }
  if (location.activeViewTab !== favorite.view) {
    return false;
  }
  return location.viewType !== 'namespace' || location.selectedNamespace === favorite.namespace;
};

const findMatchingFavorite = (
  favorites: Favorite[],
  location: FavoriteLocation,
  table: FavoriteTableSnapshot
): Favorite | null =>
  favorites.find(
    (favorite) =>
      favoriteMatchesLocation(favorite, location) && favoriteTableSnapshotsEqual(table, favorite)
  ) ?? null;

const restoreFavoriteTable = (state: FavToggleState, favorite: Favorite) => {
  state.setFilters?.(favorite.filters);
  state.setSortConfig?.(
    favorite.tableState.sortColumn
      ? {
          key: favorite.tableState.sortColumn,
          direction: favorite.tableState.sortDirection as 'asc' | 'desc',
        }
      : null
  );
  state.setColumnVisibility?.(favorite.tableState.columnVisibility);
  state.setColumnOrder?.(favorite.tableState.columnOrder ?? []);
};

// Normalize the optional providers once; embedded surfaces can disable favorites.
const useFavoriteViewContext = (enabled: boolean) => {
  const favoritesContext = useOptionalFavorites();
  const viewState = useOptionalViewState();
  if (enabled && !favoritesContext) {
    throw new Error('useFavorites must be used within FavoritesProvider');
  }
  if (enabled && !viewState) {
    throw new Error('useViewState must be used within ViewStateProvider');
  }
  const viewType = viewState?.viewType ?? 'cluster';
  return {
    // A table without the favorite control never restores or matches favorites;
    // a pending favorite belongs to its view's own table.
    favoritesContext: (enabled ? favoritesContext : null) ?? DISABLED_FAVORITES_CONTEXT,
    viewType,
    activeViewTab: getActiveViewTab(
      viewType,
      viewState?.activeGlobalTab ?? 'fleet',
      viewState?.activeNamespaceTab ?? 'workloads',
      viewState?.activeClusterTab ?? null
    ),
  };
};

/**
 * Returns an IconBarItem (toggle type) for the heart favorite button
 * in the GridTableFiltersBar's preActions slot.
 */
export function useFavToggle(state: FavToggleState): {
  item: IconBarItem | null;
  modal: React.JSX.Element | null;
} {
  const enabled = state.enabled !== false;
  const { favoritesContext, viewType, activeViewTab } = useFavoriteViewContext(enabled);
  const {
    favorites,
    addFavorite,
    updateFavorite,
    deleteFavorite,
    favoriteToRestore,
    setPendingFavorite,
  } = favoritesContext;
  const { selectedKubeconfig, selectedClusterId, selectedClusterName } = useKubeconfig();
  const { selectedNamespace } = useNamespace();
  const filterOptions = useMemo<GridTableFilterOptions>(
    () =>
      state.filterOptions ?? {
        kinds: state.availableKinds,
        namespaces: state.availableFilterNamespaces,
        showKindDropdown: Boolean(state.availableKinds?.length),
        showNamespaceDropdown: Boolean(state.availableFilterNamespaces?.length),
      },
    [state.availableFilterNamespaces, state.availableKinds, state.filterOptions]
  );
  const currentTable = useMemo(
    () =>
      snapshotFavoriteTable(
        enabled ? state : { ...state, filters: DEFAULT_GRID_TABLE_FILTER_STATE }
      ),
    [enabled, state]
  );

  // Match the current view + table settings against saved favorites, so
  // favorites of the same view with different filters stay distinct.
  const currentFavoriteMatch = useMemo<Favorite | null>(
    () =>
      findMatchingFavorite(
        favorites,
        {
          selectedKubeconfig,
          selectedClusterId,
          viewType,
          activeViewTab,
          selectedNamespace,
        },
        currentTable
      ),
    [
      favorites,
      selectedKubeconfig,
      selectedClusterId,
      viewType,
      activeViewTab,
      selectedNamespace,
      currentTable,
    ]
  );

  // Restore table settings from a pending favorite once the correct view is
  // active and this table's persistence has hydrated. The FavoritesContext
  // effect handles cluster switching and view navigation first.
  useEffect(() => {
    if (!favoriteToRestore || !state.hydrated) {
      return;
    }
    if (
      !favoriteMatchesLocation(favoriteToRestore, {
        selectedClusterId,
        selectedKubeconfig,
        viewType,
        activeViewTab,
        selectedNamespace,
      })
    ) {
      return;
    }
    restoreFavoriteTable(state, favoriteToRestore);
    setPendingFavorite(null);
  }, [
    favoriteToRestore,
    setPendingFavorite,
    selectedClusterId,
    selectedKubeconfig,
    viewType,
    activeViewTab,
    selectedNamespace,
    state,
  ]);

  const [modalOpen, setModalOpen] = useState(false);

  const isFavorited = currentFavoriteMatch !== null;

  const viewLabel = useMemo(
    () => getActiveViewLabel(viewType, activeViewTab),
    [viewType, activeViewTab]
  );

  // Auto-generate a default name for new favorites.
  const defaultName = useMemo(() => {
    const base = buildActiveViewTitleParts({
      viewType,
      activeViewTab,
      clusterName: selectedClusterName,
      namespace: selectedNamespace,
    }).join(' / ');
    const { filters } = currentTable;
    const hasActiveFilters =
      filters.search.trim().length > 0 ||
      isNarrowingFilterSelection(filters.kinds) ||
      isNarrowingFilterSelection(filters.namespaces) ||
      isNarrowingFilterSelection(filters.clusters) ||
      Object.keys(normalizeGridTableQueryFacets(filters.queryFacets)).length > 0 ||
      filters.includeMetadata;
    return hasActiveFilters ? `${base} (filtered)` : base;
  }, [activeViewTab, currentTable, selectedClusterName, selectedNamespace, viewType]);

  const modalTable = useMemo(
    () => ({ ...currentTable, filterOptions, columns: state.columns }),
    [currentTable, filterOptions, state.columns]
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

  // Build the IconBarItem returned to the caller.
  const item = useMemo<IconBarItem | null>(() => {
    if (!enabled) {
      return null;
    }
    return {
      type: 'toggle' as const,
      id: 'favorite',
      icon: isFavorited ? (
        <FavoriteFilledIcon width={18} height={18} />
      ) : (
        <FavoriteOutlineIcon width={18} height={18} />
      ),
      active: isFavorited,
      onClick: () => setModalOpen(true),
      title: isFavorited ? 'Edit favorite' : 'Save as favorite',
    };
  }, [enabled, isFavorited]);

  return {
    item,
    modal: enabled ? (
      <FavSaveModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        existingFavorite={currentFavoriteMatch}
        defaultName={defaultName}
        kubeconfigSelection={selectedKubeconfig}
        viewType={viewType}
        viewLabel={viewLabel}
        namespace={viewType === 'namespace' ? (selectedNamespace ?? '') : ''}
        table={modalTable}
        unavailableNames={favorites
          .filter((favorite) => favorite.id !== currentFavoriteMatch?.id)
          .map((favorite) => favorite.name)}
        onSave={handleSave}
        onDelete={deleteFavorite}
      />
    ) : null,
  };
}
