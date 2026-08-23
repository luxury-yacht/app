/**
 * frontend/src/ui/favorites/FavToggle.tsx
 *
 * Hook that returns an IconBarItem for a heart toggle in the GridTableFiltersBar.
 * When the current view matches a saved favorite the heart is filled;
 * otherwise it is outlined. Clicking the heart opens a modal to save,
 * update, or delete the favorite.
 */

import { useFavorites } from '@core/contexts/FavoritesContext';
import { useViewState } from '@core/contexts/ViewStateContext';
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
  areGridTableFilterStatesEqual,
  normalizeGridTableQueryFacets,
} from '@shared/components/tables/gridTableFilterState';
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
import { resolveFavoriteRoute } from '@/core/navigation/favoriteRoute';
import { getViewDescriptor, type ViewScope } from '@/core/navigation/viewRegistry';
import type { Favorite, FavoritePaneState } from '@/core/persistence/favorites';
import { compareUtf16Strings } from '@/shared/utils/sort';
import FavSaveModal from './FavSaveModal';

type ActiveViewType = ReturnType<typeof useViewState>['viewType'];

/** Current view state that the FavToggle needs to snapshot when saving a favorite.
 *  Also accepts setters for restoring state from a pending favorite on navigation. */
export interface FavToggleState {
  /** Current grid table filter state (search, kinds, namespaces, caseSensitive). */
  filters: GridTableFilterState;
  /** Current sort column key, or null if unsorted. */
  sortColumn: string | null;
  /** Current sort direction. */
  sortDirection: 'asc' | 'desc';
  /** Current column visibility map. */
  columnVisibility: Record<string, boolean>;
  /** Current column order. */
  columnOrder?: string[];
  /** Available kind values for the favorites modal kind filter dropdown. */
  availableKinds?: string[];
  /** Available namespace values for the favorites modal namespace filter dropdown. */
  availableFilterNamespaces?: string[];
  /** Stable pane key used when a route owns multiple GridTables. */
  paneId?: string;
  /** User-facing pane label shown in the save modal. */
  paneLabel?: string;
  /** Complete live filter-control contract for this pane. */
  filterOptions?: GridTableFilterOptions;
  /** Whether the persistence layer has finished hydrating. Restore waits for this. */
  hydrated?: boolean;
  /** Setters for restoring state from a pending favorite. */
  setFilters?: (filters: GridTableFilterState) => void;
  setSortConfig?: (config: { key: string; direction: 'asc' | 'desc' } | null) => void;
  setColumnVisibility?: (visibility: Record<string, boolean>) => void;
  setColumnOrder?: (order: string[]) => void;
}

interface RegisteredFavoritePane {
  id: string;
  label: string;
  state: FavToggleState;
  snapshot: FavoritePaneState;
  filterOptions: GridTableFilterOptions;
  signature: string;
}

interface FavoritePaneGroupValue {
  primaryPaneId: string;
  expectedPaneIds: readonly string[];
  version: number;
  updatePane: (pane: RegisteredFavoritePane) => void;
  removePane: (paneId: string) => void;
  getPane: (paneId: string) => RegisteredFavoritePane | undefined;
}

const FavoritePaneGroupContext = createContext<FavoritePaneGroupValue | null>(null);

export interface FavoritePaneGroupProps {
  primaryPaneId: string;
  expectedPaneIds: readonly string[];
  children: React.ReactNode;
}

/** Coordinates one route-level favorite across multiple independently persisted GridTables. */
export const FavoritePaneGroup: React.FC<FavoritePaneGroupProps> = ({
  primaryPaneId,
  expectedPaneIds,
  children,
}) => {
  const panesRef = useRef(new Map<string, RegisteredFavoritePane>());
  const [version, setVersion] = useState(0);
  const updatePane = useCallback((pane: RegisteredFavoritePane) => {
    const previous = panesRef.current.get(pane.id);
    panesRef.current.set(pane.id, pane);
    if (previous?.signature !== pane.signature) {
      setVersion((current) => current + 1);
    }
  }, []);
  const removePane = useCallback((paneId: string) => {
    if (panesRef.current.delete(paneId)) {
      setVersion((current) => current + 1);
    }
  }, []);
  const getPane = useCallback((paneId: string) => panesRef.current.get(paneId), []);
  const value = useMemo(
    () => ({ primaryPaneId, expectedPaneIds, version, updatePane, removePane, getPane }),
    [expectedPaneIds, getPane, primaryPaneId, removePane, updatePane, version]
  );
  return (
    <FavoritePaneGroupContext.Provider value={value}>{children}</FavoritePaneGroupContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// useFavToggle hook
// ---------------------------------------------------------------------------

const snapshotFavoritePane = (state: FavToggleState): FavoritePaneState => {
  const queryFacets = normalizeGridTableQueryFacets(state.filters.queryFacets);
  return {
    filters: {
      search: state.filters.search,
      kinds: normalizeMultiSelectFilterSelection(state.filters.kinds),
      namespaces: normalizeMultiSelectFilterSelection(state.filters.namespaces),
      clusters: normalizeExactMultiSelectFilterSelection(state.filters.clusters),
      queryFacets: Object.keys(queryFacets).length > 0 ? queryFacets : undefined,
      caseSensitive: state.filters.caseSensitive ?? false,
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

const favoritePaneMatches = (left: FavoritePaneState, right: FavoritePaneState): boolean =>
  areGridTableFilterStatesEqual(left.filters, right.filters) &&
  left.tableState.sortColumn === right.tableState.sortColumn &&
  left.tableState.sortDirection === right.tableState.sortDirection &&
  JSON.stringify(
    Object.entries(left.tableState.columnVisibility).sort(([leftKey], [rightKey]) =>
      compareUtf16Strings(leftKey, rightKey)
    )
  ) ===
    JSON.stringify(
      Object.entries(right.tableState.columnVisibility).sort(([leftKey], [rightKey]) =>
        compareUtf16Strings(leftKey, rightKey)
      )
    ) &&
  JSON.stringify(left.tableState.columnOrder ?? []) ===
    JSON.stringify(right.tableState.columnOrder ?? []);

const favoriteFilterOptionsSignature = (options: GridTableFilterOptions): string =>
  JSON.stringify({
    kinds: options.kinds,
    namespaces: options.namespaces,
    clusters: options.clusters?.map((option) => [option.value, String(option.label)]),
    showKindDropdown: options.showKindDropdown,
    showNamespaceDropdown: options.showNamespaceDropdown,
    showClusterDropdown: options.showClusterDropdown,
    namespaceDropdownSearchable: options.namespaceDropdownSearchable,
    namespaceDropdownBulkActions: options.namespaceDropdownBulkActions,
    clusterDropdownSearchable: options.clusterDropdownSearchable,
    clusterDropdownBulkActions: options.clusterDropdownBulkActions,
    queryFacets: options.queryFacets?.map((facet) => ({
      key: facet.key,
      label: facet.label,
      placeholder: facet.placeholder,
      searchable: facet.searchable,
      bulkActions: facet.bulkActions,
      options: facet.options.map((option) => [option.value, String(option.label)]),
    })),
  });

const getActiveViewTab = (
  viewType: ActiveViewType,
  activeGlobalTab: string | null,
  activeNamespaceTab: string | null,
  activeClusterTab: string | null
): string | null => {
  if (viewType === 'global') {
    return activeGlobalTab;
  }
  if (viewType === 'namespace') {
    return activeNamespaceTab;
  }
  return activeClusterTab;
};

interface FavoriteLocation {
  selectedKubeconfig: string;
  selectedClusterId: string;
  viewType: ActiveViewType;
  activeViewTab: string | null;
  selectedNamespace: string | undefined;
}

const favoriteMatchesCluster = (favorite: Favorite, location: FavoriteLocation): boolean => {
  const route = resolveFavoriteRoute(favorite.viewType, favorite.view);
  if (route.scope === 'global' || favorite.clusterSelection === '') {
    return true;
  }
  return favorite.clusterId
    ? location.selectedClusterId === favorite.clusterId
    : location.selectedKubeconfig === favorite.clusterSelection;
};

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

interface MatchableFavoritePane {
  id: string;
  snapshot: FavoritePaneState;
}

const getFavoritePanesToMatch = (
  paneGroup: FavoritePaneGroupValue | null,
  paneId: string,
  currentPane: FavoritePaneState
): Array<MatchableFavoritePane | undefined> =>
  paneGroup
    ? paneGroup.expectedPaneIds.map((id) => paneGroup.getPane(id))
    : [{ id: paneId, snapshot: currentPane }];

const favoriteMatchesPanes = (
  favorite: Favorite,
  panes: Array<MatchableFavoritePane | undefined>
): boolean =>
  panes.every((pane) => {
    if (!pane) {
      return false;
    }
    const savedPane = favorite.panes[pane.id];
    return Boolean(savedPane && favoritePaneMatches(pane.snapshot, savedPane));
  });

const findMatchingFavorite = (
  favorites: Favorite[],
  location: FavoriteLocation,
  panes: Array<MatchableFavoritePane | undefined>
): Favorite | null =>
  favorites.find(
    (favorite) =>
      favoriteMatchesLocation(favorite, location) && favoriteMatchesPanes(favorite, panes)
  ) ?? null;

interface RestorableFavoritePane {
  id: string;
  state: FavToggleState;
}

interface FavoritePaneRestoreEntry {
  pane: RestorableFavoritePane;
  savedPane: FavoritePaneState;
}

const getFavoritePanesToRestore = (
  paneGroup: FavoritePaneGroupValue | null,
  paneId: string,
  state: FavToggleState
): Array<RestorableFavoritePane | undefined> =>
  paneGroup
    ? paneGroup.expectedPaneIds.map((id) => paneGroup.getPane(id))
    : [{ id: paneId, state }];

const areFavoritePanesHydrated = (panes: Array<RestorableFavoritePane | undefined>): boolean =>
  panes.every((pane) => Boolean(pane?.state.hydrated));

const pendingFavoriteTargetIsActive = (
  favorite: Favorite,
  location: Pick<FavoriteLocation, 'viewType' | 'activeViewTab' | 'selectedNamespace'>
): boolean => {
  const route = resolveFavoriteRoute(favorite.viewType, favorite.view);
  if (route.scope !== location.viewType || favorite.view !== location.activeViewTab) {
    return false;
  }
  return location.viewType !== 'namespace' || favorite.namespace === location.selectedNamespace;
};

const buildFavoritePaneRestoreEntries = (
  favorite: Favorite,
  panes: Array<RestorableFavoritePane | undefined>
): FavoritePaneRestoreEntry[] | null => {
  const entries: FavoritePaneRestoreEntry[] = [];
  for (const pane of panes) {
    if (!pane) {
      return null;
    }
    const savedPane = favorite.panes[pane.id];
    if (!savedPane) {
      return null;
    }
    entries.push({ pane, savedPane });
  }
  return entries;
};

const restoreFavoritePane = ({ pane, savedPane }: FavoritePaneRestoreEntry) => {
  pane.state.setFilters?.(savedPane.filters);
  pane.state.setSortConfig?.(
    savedPane.tableState.sortColumn
      ? {
          key: savedPane.tableState.sortColumn,
          direction: savedPane.tableState.sortDirection as 'asc' | 'desc',
        }
      : null
  );
  pane.state.setColumnVisibility?.(savedPane.tableState.columnVisibility);
  if (savedPane.tableState.columnOrder) {
    pane.state.setColumnOrder?.(savedPane.tableState.columnOrder);
  }
};

/**
 * Returns an IconBarItem (toggle type) for the heart favorite button
 * in the GridTableFiltersBar's preActions slot.
 */
export function useFavToggle(state: FavToggleState): {
  item: IconBarItem | null;
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
  const { selectedKubeconfig, selectedClusterId, selectedClusterName } = useKubeconfig();
  const { viewType, activeNamespaceTab, activeClusterTab, activeGlobalTab } = useViewState();
  const { selectedNamespace } = useNamespace();
  const paneGroup = useContext(FavoritePaneGroupContext);
  const paneId = state.paneId ?? 'main';
  const paneLabel = state.paneLabel ?? 'Table';
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
  const currentPane = useMemo(() => snapshotFavoritePane(state), [state]);
  const paneSignature = useMemo(
    () => JSON.stringify(currentPane) + favoriteFilterOptionsSignature(filterOptions),
    [currentPane, filterOptions]
  );
  const updateGroupedPane = paneGroup?.updatePane;
  const removeGroupedPane = paneGroup?.removePane;

  useEffect(() => {
    updateGroupedPane?.({
      id: paneId,
      label: paneLabel,
      state,
      snapshot: currentPane,
      filterOptions,
      signature: paneSignature,
    });
  }, [currentPane, filterOptions, paneId, paneLabel, paneSignature, state, updateGroupedPane]);
  useEffect(
    () => () => {
      removeGroupedPane?.(paneId);
    },
    [paneId, removeGroupedPane]
  );

  const groupedPanes = paneGroup
    ? paneGroup.expectedPaneIds.map((id) => paneGroup.getPane(id)).filter(Boolean)
    : [];
  const groupReady = !paneGroup || groupedPanes.length === paneGroup.expectedPaneIds.length;
  const isPrimaryPane = !paneGroup || paneId === paneGroup.primaryPaneId;

  const activeViewTab = getActiveViewTab(
    viewType,
    activeGlobalTab,
    activeNamespaceTab,
    activeClusterTab
  );

  // Match the current view + filter state against saved favorites.
  // Includes filter comparison so multiple favorites on the same view
  // with different filters are treated as distinct entries.
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
        getFavoritePanesToMatch(paneGroup, paneId, currentPane)
      ),
    [
      favorites,
      selectedKubeconfig,
      selectedClusterId,
      viewType,
      activeViewTab,
      selectedNamespace,
      currentPane,
      paneGroup,
      paneId,
    ]
  );

  // Restore filter/table state from a pending favorite once:
  // 1. The correct view is active (viewType + tab + namespace match)
  // 2. The persistence layer has hydrated for this view
  //
  // The FavoritesContext effect handles cluster switching and view navigation.
  // This effect waits for those to settle before applying filter/table state.
  useEffect(() => {
    if (!pendingFavorite || !isPrimaryPane || !groupReady) {
      return;
    }
    const panesToRestore = getFavoritePanesToRestore(paneGroup, paneId, state);
    if (!areFavoritePanesHydrated(panesToRestore)) {
      return;
    }

    if (
      !pendingFavoriteTargetIsActive(pendingFavorite, {
        viewType,
        activeViewTab,
        selectedNamespace,
      })
    ) {
      return;
    }

    const restorablePanes = buildFavoritePaneRestoreEntries(pendingFavorite, panesToRestore);
    if (!restorablePanes) {
      setPendingFavorite(null);
      return;
    }

    for (const entry of restorablePanes) {
      restoreFavoritePane(entry);
    }
    setPendingFavorite(null);
  }, [
    pendingFavorite,
    setPendingFavorite,
    viewType,
    activeViewTab,
    selectedNamespace,
    state,
    paneGroup,
    paneId,
    isPrimaryPane,
    groupReady,
  ]);

  const [modalOpen, setModalOpen] = useState(false);

  const isFavorited = currentFavoriteMatch !== null && currentFavoriteMatch !== undefined;

  // Build a human-readable display label for the view tab.
  const viewLabel = useMemo(() => {
    const tab = activeViewTab ?? '';
    let scope: ViewScope;

    if (viewType === 'global') {
      scope = 'global';
    } else if (viewType === 'namespace') {
      scope = 'namespace';
    } else {
      scope = 'cluster';
    }

    return getViewDescriptor(scope, tab)?.label ?? tab;
  }, [viewType, activeViewTab]);

  // Auto-generate a default name for new favorites.
  const defaultName = useMemo(() => {
    const parts: string[] = [];
    if (viewType !== 'global' && selectedClusterName) {
      parts.push(selectedClusterName);
    }
    if (viewType === 'namespace' && selectedNamespace) {
      parts.push(selectedNamespace);
    }
    parts.push(viewLabel);
    const base = parts.join(' / ');
    const panes = paneGroup
      ? paneGroup.expectedPaneIds.map((id) => paneGroup.getPane(id)?.snapshot).filter(Boolean)
      : [currentPane];
    const hasActiveFilters = panes.some(
      (pane) =>
        pane &&
        (pane.filters.search.trim().length > 0 ||
          isNarrowingFilterSelection(pane.filters.kinds) ||
          isNarrowingFilterSelection(pane.filters.namespaces) ||
          isNarrowingFilterSelection(pane.filters.clusters) ||
          Object.keys(normalizeGridTableQueryFacets(pane.filters.queryFacets)).length > 0 ||
          pane.filters.caseSensitive ||
          pane.filters.includeMetadata)
    );
    return hasActiveFilters ? `${base} (filtered)` : base;
  }, [currentPane, paneGroup, selectedClusterName, selectedNamespace, viewLabel, viewType]);

  const modalPanes = useMemo(
    () =>
      paneGroup
        ? paneGroup.expectedPaneIds
            .map((id) => paneGroup.getPane(id))
            .filter((pane): pane is RegisteredFavoritePane => Boolean(pane))
            .map((pane) => ({
              id: pane.id,
              label: pane.label,
              ...pane.snapshot,
              filterOptions: pane.filterOptions,
            }))
        : [
            {
              id: paneId,
              label: paneLabel,
              ...currentPane,
              filterOptions,
            },
          ],
    [currentPane, filterOptions, paneGroup, paneId, paneLabel]
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
  const item = useMemo<IconBarItem | null>(() => {
    if (!isPrimaryPane) {
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
      disabled: !groupReady,
      onClick: () => setModalOpen(true),
      title: isFavorited ? 'Edit favorite' : 'Save as favorite',
    };
  }, [groupReady, isFavorited, isPrimaryPane]);

  return {
    item,
    modal: (
      <FavSaveModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        existingFavorite={currentFavoriteMatch}
        defaultName={defaultName}
        kubeconfigSelection={selectedKubeconfig}
        viewType={viewType}
        viewLabel={viewLabel}
        namespace={viewType === 'namespace' ? (selectedNamespace ?? '') : ''}
        filters={currentPane.filters}
        tableState={currentPane.tableState}
        includeMetadata={state.filters.includeMetadata ?? false}
        availableKinds={state.availableKinds}
        availableFilterNamespaces={state.availableFilterNamespaces}
        panes={modalPanes}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    ),
  };
}
