/**
 * frontend/src/core/persistence/favorites.ts
 *
 * Persistence helpers for favorites backed by the backend store.
 * Mirrors the pattern established in clusterTabOrder.ts.
 */

import { eventBus } from '@/core/events';
import { requestAppState } from '@/core/app-state-access';

// ---------- Types ----------

export interface FavoriteFilters {
  search: string;
  kinds: string[];
  namespaces: string[];
  caseSensitive: boolean;
  includeMetadata: boolean;
}

export interface FavoriteTableState {
  sortColumn: string;
  sortDirection: string;
  columnVisibility: Record<string, boolean>;
}

export interface Favorite {
  id: string;
  name: string;
  clusterSelection: string;
  viewType: string;
  view: string;
  namespace: string;
  filters: FavoriteFilters | null;
  tableState: FavoriteTableState | null;
  order: number;
}

// ---------- Internal state ----------

let cachedFavorites: Favorite[] = [];
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

const getRuntimeApp = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as any)?.go?.backend?.App;
};

const emitChanged = () => {
  eventBus.emit('favorites:changed', [...cachedFavorites]);
};

// ---------- Public API ----------

/**
 * Hydrates the favorites cache from the Go backend.
 * Deduplicates concurrent calls and skips if already hydrated unless `force` is set.
 */
export const hydrateFavorites = async (options?: { force?: boolean }): Promise<Favorite[]> => {
  if (hydrated && !options?.force) {
    return cachedFavorites;
  }
  if (hydrationPromise && !options?.force) {
    await hydrationPromise;
    return cachedFavorites;
  }

  hydrationPromise = (async () => {
    const runtimeApp = getRuntimeApp();
    if (!runtimeApp || typeof runtimeApp.GetFavorites !== 'function') {
      hydrated = true;
      return;
    }
    try {
      const result = await requestAppState({
        resource: 'favorites',
        adapter: 'persistence-read',
        read: () => runtimeApp.GetFavorites(),
      });
      cachedFavorites = Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('Failed to hydrate favorites:', error);
    } finally {
      hydrated = true;
    }
  })();

  try {
    await hydrationPromise;
  } finally {
    hydrationPromise = null;
  }

  return cachedFavorites;
};

/** Returns the cached favorites list synchronously. */
export const getFavorites = (): Favorite[] => cachedFavorites;

/** Adds a favorite via the backend, updates the cache, and emits a change event. */
export const addFavorite = async (fav: Favorite): Promise<Favorite> => {
  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.AddFavorite !== 'function') {
    throw new Error('Backend not available');
  }
  const created: Favorite = await runtimeApp.AddFavorite(fav);
  cachedFavorites = [...cachedFavorites, created];
  hydrated = true;
  emitChanged();
  return created;
};

/** Updates a favorite via the backend, updates the cache, and emits a change event. */
export const updateFavorite = async (fav: Favorite): Promise<void> => {
  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.UpdateFavorite !== 'function') {
    throw new Error('Backend not available');
  }
  await runtimeApp.UpdateFavorite(fav);
  cachedFavorites = cachedFavorites.map((existing) => (existing.id === fav.id ? fav : existing));
  emitChanged();
};

/** Deletes a favorite via the backend, removes it from the cache, and emits a change event. */
export const deleteFavorite = async (id: string): Promise<void> => {
  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.DeleteFavorite !== 'function') {
    throw new Error('Backend not available');
  }
  await runtimeApp.DeleteFavorite(id);
  cachedFavorites = cachedFavorites.filter((fav) => fav.id !== id);
  emitChanged();
};

/** Reorders favorites via the backend, reorders the cache, and emits a change event. */
export const setFavoriteOrder = async (ids: string[]): Promise<void> => {
  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.SetFavoriteOrder !== 'function') {
    throw new Error('Backend not available');
  }
  await runtimeApp.SetFavoriteOrder(ids);

  // Reorder the cache to match the requested ID order.
  const lookup = new Map(cachedFavorites.map((fav) => [fav.id, fav]));
  const reordered: Favorite[] = [];
  const seen = new Set<string>();

  ids.forEach((id, idx) => {
    const fav = lookup.get(id);
    if (fav && !seen.has(id)) {
      reordered.push({ ...fav, order: idx });
      seen.add(id);
    }
  });

  // Append any favorites not in the provided list.
  cachedFavorites.forEach((fav) => {
    if (!seen.has(fav.id)) {
      reordered.push({ ...fav, order: reordered.length });
    }
  });

  cachedFavorites = reordered;
  emitChanged();
};

/** Subscribes to favorites changes. Returns an unsubscribe function. */
export const subscribeFavorites = (handler: (favs: Favorite[]) => void): (() => void) => {
  return eventBus.on('favorites:changed', handler as (payload: unknown[]) => void);
};

/** Test helper to clear cached state between runs. */
export const resetFavoritesCacheForTesting = (): void => {
  cachedFavorites = [];
  hydrated = false;
  hydrationPromise = null;
};
