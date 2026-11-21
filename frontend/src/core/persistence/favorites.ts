/**
 * frontend/src/core/persistence/favorites.ts
 *
 * Persistence helpers for favorites backed by the backend store.
 * Mirrors the pattern established in clusterTabOrder.ts.
 */

import type { backend } from '@core/backend-api/models';
import {
  ALL_MULTISELECT_FILTER,
  type MultiSelectFilterSelection,
  NONE_MULTISELECT_FILTER,
  normalizeExactMultiSelectFilterSelection,
  normalizeMultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';
import { requestAppState } from '@/core/app-state-access';
import {
  AddFavorite,
  DeleteFavorite,
  GetFavoriteClusters,
  GetFavorites,
  SetClusterFavorite,
  SetFavoriteOrder,
  UpdateFavorite,
} from '@/core/backend-api';
import { desktopRuntimeAvailable, emitBroadcastEvent } from '@/core/desktop-runtime';
import { eventBus } from '@/core/events';
import { reportOperationalError } from '@/utils/errorHandler';

// ---------- Types ----------

export type FavoriteFilters = GridTableFilterState;

export interface FavoriteTableState {
  sortColumn: string;
  sortDirection: string;
  columnVisibility: Record<string, boolean>;
  columnOrder?: string[];
}

/** A view's saved table settings: its filters plus sort and columns. */
export interface FavoriteTableSnapshot {
  filters: FavoriteFilters;
  tableState: FavoriteTableState;
}

export interface Favorite extends FavoriteTableSnapshot {
  id: string;
  name: string;
  clusterSelection: string;
  clusterId?: string;
  clusterName?: string;
  viewType: string;
  view: string;
  namespace: string;
  order: number;
}

const fromBackendSelection = (
  selection: backend.FavoriteFilterSelection | undefined,
  normalize = normalizeMultiSelectFilterSelection
): MultiSelectFilterSelection => {
  if (selection?.mode === 'none') {
    return NONE_MULTISELECT_FILTER;
  }
  if (selection?.mode === 'some') {
    return normalize({ mode: 'some', values: selection.values ?? [] });
  }
  return ALL_MULTISELECT_FILTER;
};

const fromBackendFilters = (
  filters: backend.FavoriteFilters | undefined
): FavoriteFilters | null => {
  if (!filters) {
    return null;
  }
  return {
    search: filters.search ?? '',
    kinds: fromBackendSelection(filters.kinds),
    namespaces: fromBackendSelection(filters.namespaces),
    clusters: fromBackendSelection(filters.clusters, normalizeExactMultiSelectFilterSelection),
    queryFacets: filters.queryFacets
      ? Object.fromEntries(
          Object.entries(filters.queryFacets).map(([key, selection]) => [
            key,
            fromBackendSelection(selection),
          ])
        )
      : undefined,
    includeMetadata: filters.includeMetadata ?? false,
  };
};

const fromBackendTableSnapshot = (
  favorite: Pick<backend.Favorite, 'filters' | 'tableState'>
): FavoriteTableSnapshot => {
  const tableState = favorite.tableState ?? { sortColumn: '', sortDirection: 'asc' };
  const columnOrder = Array.from(
    new Set((tableState.columnOrder ?? []).filter((key) => typeof key === 'string' && key))
  );
  return {
    filters: fromBackendFilters(favorite.filters) ?? {
      search: '',
      kinds: { mode: 'all' },
      namespaces: { mode: 'all' },
      clusters: { mode: 'all' },
      includeMetadata: false,
    },
    tableState: {
      sortColumn: tableState.sortColumn,
      sortDirection: tableState.sortDirection,
      columnVisibility: Object.fromEntries(
        Object.entries(tableState.columnVisibility ?? {}).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
        )
      ),
      ...(columnOrder.length > 0 ? { columnOrder } : {}),
    },
  };
};

const fromBackendFavorite = (favorite: backend.Favorite): Favorite =>
  migrateRetiredViewFavorite({
    id: favorite.id,
    name: favorite.name,
    clusterSelection: favorite.clusterSelection,
    clusterId: favorite.clusterId,
    clusterName: favorite.clusterName,
    viewType: favorite.viewType,
    view: favorite.view,
    namespace: favorite.namespace,
    ...fromBackendTableSnapshot(favorite),
    order: favorite.order,
  });

/**
 * A favorite saved on the cluster CRDs view, which API Resources replaced. It
 * listed custom resource definitions, so it becomes an API Resources favorite
 * filtered to custom kinds, keeping its search. Its column settings name the
 * old table's columns, so they reset; its sort is kept only on a column that
 * means the same in both tables. The stored favorite is rewritten when the
 * user next saves it.
 */
const migrateRetiredViewFavorite = (favorite: Favorite): Favorite => {
  if (favorite.viewType !== 'cluster' || favorite.view !== 'crds') {
    return favorite;
  }
  const { sortColumn, sortDirection } = favorite.tableState;
  const keepsSort = CRDS_SORTS_API_RESOURCES_SHARES.has(sortColumn);
  return {
    ...favorite,
    view: 'api-resources',
    filters: {
      search: favorite.filters.search,
      kinds: ALL_MULTISELECT_FILTER,
      namespaces: ALL_MULTISELECT_FILTER,
      clusters: ALL_MULTISELECT_FILTER,
      includeMetadata: false,
      // The API Resources Type filter's value for kinds a CRD defines.
      queryFacets: { types: { mode: 'some', values: ['Custom'] } },
    },
    tableState: {
      sortColumn: keepsSort ? sortColumn : '',
      sortDirection: keepsSort ? sortDirection : 'asc',
      columnVisibility: {},
    },
  };
};

// CRDs sort columns that order API Resources rows the same way. Kind is not
// one: the CRDs Kind column read CustomResourceDefinition on every row, where
// the API Resources Kind column is the kind a definition defines.
const CRDS_SORTS_API_RESOURCES_SHARES: ReadonlySet<string> = new Set(['name', 'scope']);

const toBackendSelection = (
  selection: MultiSelectFilterSelection
): backend.FavoriteFilterSelection => ({
  mode: selection.mode,
  values: selection.mode === 'some' ? selection.values : undefined,
});

const toBackendFavorite = (favorite: Favorite): backend.Favorite => ({
  ...favorite,
  filters: {
    ...favorite.filters,
    kinds: toBackendSelection(favorite.filters.kinds),
    namespaces: toBackendSelection(favorite.filters.namespaces),
    clusters: toBackendSelection(favorite.filters.clusters),
    queryFacets: favorite.filters.queryFacets
      ? Object.fromEntries(
          Object.entries(favorite.filters.queryFacets).map(([facetKey, selection]) => [
            facetKey,
            toBackendSelection(selection),
          ])
        )
      : undefined,
  },
});

// ---------- Internal state ----------

let cachedFavorites: Favorite[] = [];
// Favorite clusters as kubeconfig selections (`<kubeconfig path>:<context>`).
let cachedFavoriteClusters: string[] = [];
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
// Moves with every saved change and forced reload, so a read of favorites.json
// that overlaps one is read again instead of replacing newer state.
let favoritesRevision = 0;

const emitChanged = () => {
  eventBus.emit('favorites:changed', [...cachedFavorites]);
};

const emitFavoriteClustersChanged = () => {
  eventBus.emit('favorites:clusters-changed', [...cachedFavoriteClusters]);
};

const toFavoriteClusters = (clusters: string[] | null): string[] =>
  Array.isArray(clusters) ? clusters : [];

const readLatestFavorites = async (): Promise<void> => {
  const revision = favoritesRevision;
  const [result, clusters] = await requestAppState({
    resource: 'favorites',
    adapter: 'persistence-read',
    read: () => Promise.all([GetFavorites(), GetFavoriteClusters()]),
  });
  if (revision !== favoritesRevision) {
    // Favorites changed while favorites.json was read; read it again.
    return readLatestFavorites();
  }
  cachedFavorites = Array.isArray(result) ? result.map(fromBackendFavorite) : [];
  cachedFavoriteClusters = toFavoriteClusters(clusters);
  emitChanged();
  emitFavoriteClustersChanged();
};

const hydrateLatestFavorites = async (): Promise<void> => {
  if (!desktopRuntimeAvailable()) {
    hydrated = true;
    return;
  }
  try {
    await readLatestFavorites();
  } catch (error) {
    reportOperationalError(error, { source: 'Favorites', action: 'hydrateFavorites' });
  } finally {
    hydrated = true;
  }
};

/**
 * Records a saved change: overlapping reads start over, and every app window
 * reloads favorites.json. A failed broadcast is reported, not thrown, because
 * the change itself was saved.
 */
const publishSavedChange = async (): Promise<void> => {
  favoritesRevision++;
  try {
    await emitBroadcastEvent('favorites:library-changed', undefined);
  } catch (error) {
    reportOperationalError(error, { source: 'Favorites', action: 'broadcast-favorites-change' });
  }
};

// ---------- Public API ----------

/**
 * Hydrates the favorites and favorite-clusters caches from the Go backend; both
 * live in favorites.json, so a forced reload (after an import, or another
 * window's change) refreshes both. Concurrent calls share one read; a forced
 * call makes a read already in flight start over.
 */
export const hydrateFavorites = async (options?: { force?: boolean }): Promise<Favorite[]> => {
  if (hydrated && !options?.force) {
    return cachedFavorites;
  }
  if (options?.force) {
    favoritesRevision++;
  }
  hydrationPromise ??= hydrateLatestFavorites().finally(() => {
    hydrationPromise = null;
  });
  await hydrationPromise;
  return cachedFavorites;
};

/**
 * Reloads favorites.json after an import replaced it, and tells every app
 * window to reload it too.
 */
export const reloadImportedFavorites = async (): Promise<Favorite[]> => {
  const favorites = await hydrateFavorites({ force: true });
  await publishSavedChange();
  return favorites;
};

/** Returns the cached favorites list synchronously. */
export const getFavorites = (): Favorite[] => cachedFavorites;

/** Adds a favorite via the backend, updates the cache, and emits a change event. */
export const addFavorite = async (fav: Favorite): Promise<Favorite> => {
  if (!desktopRuntimeAvailable()) {
    throw new Error('Backend not available');
  }
  const created = fromBackendFavorite(await AddFavorite(toBackendFavorite(fav)));
  cachedFavorites = [...cachedFavorites, created];
  hydrated = true;
  emitChanged();
  await publishSavedChange();
  return created;
};

/** Updates a favorite via the backend, updates the cache, and emits a change event. */
export const updateFavorite = async (fav: Favorite): Promise<void> => {
  if (!desktopRuntimeAvailable()) {
    throw new Error('Backend not available');
  }
  await UpdateFavorite(toBackendFavorite(fav));
  cachedFavorites = cachedFavorites.map((existing) => (existing.id === fav.id ? fav : existing));
  emitChanged();
  await publishSavedChange();
};

/** Deletes a favorite via the backend, removes it from the cache, and emits a change event. */
export const deleteFavorite = async (id: string): Promise<void> => {
  if (!desktopRuntimeAvailable()) {
    throw new Error('Backend not available');
  }
  await DeleteFavorite(id);
  cachedFavorites = cachedFavorites.filter((fav) => fav.id !== id);
  emitChanged();
  await publishSavedChange();
};

/** Reorders favorites via the backend, reorders the cache, and emits a change event. */
export const setFavoriteOrder = async (ids: string[]): Promise<void> => {
  if (!desktopRuntimeAvailable()) {
    throw new Error('Backend not available');
  }
  await SetFavoriteOrder(ids);

  // Reorder the cache to match the requested ID order.
  const lookup = new Map(cachedFavorites.map((fav) => [fav.id, fav]));
  const reordered: Favorite[] = [];
  for (const id of [...ids, ...lookup.keys()]) {
    const favorite = lookup.get(id);
    if (!favorite) {
      continue;
    }
    lookup.delete(id);
    reordered.push({ ...favorite, order: reordered.length });
  }

  cachedFavorites = reordered;
  emitChanged();
  await publishSavedChange();
};

/** Returns the cached favorite clusters' kubeconfig selections synchronously. */
export const getFavoriteClusters = (): string[] => cachedFavoriteClusters;

/** Adds or removes a favorite cluster via the backend and adopts the saved list. */
export const setClusterFavorite = async (selection: string, favorite: boolean): Promise<void> => {
  if (!desktopRuntimeAvailable()) {
    throw new Error('Backend not available');
  }
  cachedFavoriteClusters = toFavoriteClusters(await SetClusterFavorite(selection, favorite));
  emitFavoriteClustersChanged();
  await publishSavedChange();
};

/** Subscribes to favorite-cluster changes. Returns an unsubscribe function. */
export const subscribeFavoriteClusters = (handler: (clusters: string[]) => void): (() => void) =>
  eventBus.on('favorites:clusters-changed', handler);

/** Subscribes to favorites changes. Returns an unsubscribe function. */
export const subscribeFavorites = (handler: (favs: Favorite[]) => void): (() => void) => {
  return eventBus.on('favorites:changed', handler as (payload: unknown[]) => void);
};

/** Test helper to clear cached state between runs. */
export const resetFavoritesCacheForTesting = (): void => {
  cachedFavorites = [];
  cachedFavoriteClusters = [];
  hydrated = false;
  hydrationPromise = null;
  favoritesRevision = 0;
};
