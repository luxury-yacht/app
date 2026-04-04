/**
 * frontend/src/core/persistence/favorites.test.ts
 *
 * Test suite for favorites persistence helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import {
  addFavorite,
  deleteFavorite,
  getFavorites,
  hydrateFavorites,
  resetFavoritesCacheForTesting,
  subscribeFavorites,
  updateFavorite,
  setFavoriteOrder,
  type Favorite,
} from './favorites';

const makeFavorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'My Pods',
  clusterSelection: 'cluster-a',
  viewType: 'namespace',
  view: 'workloads',
  namespace: 'default',
  filters: null,
  tableState: null,
  order: 0,
  ...overrides,
});

describe('favorites persistence', () => {
  let mockApp: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    resetFavoritesCacheForTesting();

    mockApp = {
      GetFavorites: vi.fn(),
      AddFavorite: vi.fn(),
      UpdateFavorite: vi.fn(),
      DeleteFavorite: vi.fn(),
      SetFavoriteOrder: vi.fn(),
    };

    (window as any).go = {
      backend: {
        App: mockApp,
      },
    };
  });

  afterEach(() => {
    delete (window as any).go;
    eventBus.clear();
  });

  // Test 1: hydrateFavorites fetches from backend and caches
  it('hydrateFavorites fetches from backend and caches', async () => {
    const favs = [makeFavorite({ id: 'a' }), makeFavorite({ id: 'b', order: 1 })];
    mockApp.GetFavorites.mockResolvedValue(favs);

    const result = await hydrateFavorites();

    expect(mockApp.GetFavorites).toHaveBeenCalledTimes(1);
    expect(result).toEqual(favs);
    expect(getFavorites()).toEqual(favs);
  });

  // Test 2: second hydrateFavorites call returns cached data without re-fetching
  it('second hydrateFavorites call returns cached data without re-fetching', async () => {
    const favs = [makeFavorite()];
    mockApp.GetFavorites.mockResolvedValue(favs);

    await hydrateFavorites();
    const result = await hydrateFavorites();

    expect(mockApp.GetFavorites).toHaveBeenCalledTimes(1);
    expect(result).toEqual(favs);
  });

  it('hydrateFavorites with force re-fetches from backend', async () => {
    mockApp.GetFavorites.mockResolvedValueOnce([makeFavorite({ id: 'old' })]);
    await hydrateFavorites();

    const updated = [makeFavorite({ id: 'new' })];
    mockApp.GetFavorites.mockResolvedValueOnce(updated);

    const result = await hydrateFavorites({ force: true });
    expect(mockApp.GetFavorites).toHaveBeenCalledTimes(2);
    expect(result).toEqual(updated);
  });

  it('hydrateFavorites deduplicates concurrent calls', async () => {
    mockApp.GetFavorites.mockResolvedValue([makeFavorite()]);

    // Reset so nothing is hydrated.
    resetFavoritesCacheForTesting();

    const [r1, r2] = await Promise.all([hydrateFavorites(), hydrateFavorites()]);

    expect(mockApp.GetFavorites).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  // Test 3: addFavorite calls backend and updates cache
  it('addFavorite calls backend and updates cache', async () => {
    mockApp.GetFavorites.mockResolvedValue([]);
    await hydrateFavorites();

    const input = makeFavorite({ id: '' });
    const created = makeFavorite({ id: 'server-generated-id', order: 0 });
    mockApp.AddFavorite.mockResolvedValue(created);

    const result = await addFavorite(input);

    expect(mockApp.AddFavorite).toHaveBeenCalledWith(input);
    expect(result).toEqual(created);
    expect(getFavorites()).toEqual([created]);
  });

  // Test 4: deleteFavorite removes from cache
  it('deleteFavorite removes from cache', async () => {
    const fav1 = makeFavorite({ id: 'keep' });
    const fav2 = makeFavorite({ id: 'remove', order: 1 });
    mockApp.GetFavorites.mockResolvedValue([fav1, fav2]);
    await hydrateFavorites();

    mockApp.DeleteFavorite.mockResolvedValue(undefined);

    await deleteFavorite('remove');

    expect(mockApp.DeleteFavorite).toHaveBeenCalledWith('remove');
    expect(getFavorites()).toEqual([fav1]);
  });

  it('updateFavorite calls backend and updates cache', async () => {
    const original = makeFavorite({ id: 'u1', name: 'Old Name' });
    mockApp.GetFavorites.mockResolvedValue([original]);
    await hydrateFavorites();

    const updated = { ...original, name: 'New Name' };
    mockApp.UpdateFavorite.mockResolvedValue(undefined);

    await updateFavorite(updated);

    expect(mockApp.UpdateFavorite).toHaveBeenCalledWith(updated);
    expect(getFavorites()[0].name).toBe('New Name');
  });

  it('setFavoriteOrder reorders cache', async () => {
    const a = makeFavorite({ id: 'a', order: 0 });
    const b = makeFavorite({ id: 'b', order: 1 });
    const c = makeFavorite({ id: 'c', order: 2 });
    mockApp.GetFavorites.mockResolvedValue([a, b, c]);
    await hydrateFavorites();

    mockApp.SetFavoriteOrder.mockResolvedValue(undefined);

    await setFavoriteOrder(['c', 'a', 'b']);

    expect(mockApp.SetFavoriteOrder).toHaveBeenCalledWith(['c', 'a', 'b']);
    const ordered = getFavorites();
    expect(ordered.map((f) => f.id)).toEqual(['c', 'a', 'b']);
    expect(ordered.map((f) => f.order)).toEqual([0, 1, 2]);
  });

  // Test 5: mutations emit 'favorites:changed' event
  it('mutations emit favorites:changed event', async () => {
    mockApp.GetFavorites.mockResolvedValue([]);
    await hydrateFavorites();

    const handler = vi.fn();
    subscribeFavorites(handler);

    const created = makeFavorite({ id: 'new-1' });
    mockApp.AddFavorite.mockResolvedValue(created);
    await addFavorite(makeFavorite({ id: '' }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([created]);
  });

  it('subscribeFavorites returns an unsubscribe function', async () => {
    mockApp.GetFavorites.mockResolvedValue([]);
    await hydrateFavorites();

    const handler = vi.fn();
    const unsub = subscribeFavorites(handler);

    const created = makeFavorite({ id: 'x' });
    mockApp.AddFavorite.mockResolvedValue(created);
    await addFavorite(makeFavorite());

    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    mockApp.AddFavorite.mockResolvedValue(makeFavorite({ id: 'y' }));
    await addFavorite(makeFavorite());

    // Should not be called again after unsubscribing.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('deleteFavorite emits favorites:changed event', async () => {
    const fav = makeFavorite({ id: 'del-me' });
    mockApp.GetFavorites.mockResolvedValue([fav]);
    await hydrateFavorites();

    const handler = vi.fn();
    subscribeFavorites(handler);

    mockApp.DeleteFavorite.mockResolvedValue(undefined);
    await deleteFavorite('del-me');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([]);
  });

  it('updateFavorite emits favorites:changed event', async () => {
    const fav = makeFavorite({ id: 'upd' });
    mockApp.GetFavorites.mockResolvedValue([fav]);
    await hydrateFavorites();

    const handler = vi.fn();
    subscribeFavorites(handler);

    mockApp.UpdateFavorite.mockResolvedValue(undefined);
    await updateFavorite({ ...fav, name: 'Updated' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([{ ...fav, name: 'Updated' }]);
  });

  it('setFavoriteOrder emits favorites:changed event', async () => {
    const a = makeFavorite({ id: 'a', order: 0 });
    const b = makeFavorite({ id: 'b', order: 1 });
    mockApp.GetFavorites.mockResolvedValue([a, b]);
    await hydrateFavorites();

    const handler = vi.fn();
    subscribeFavorites(handler);

    mockApp.SetFavoriteOrder.mockResolvedValue(undefined);
    await setFavoriteOrder(['b', 'a']);

    expect(handler).toHaveBeenCalledTimes(1);
    const emitted = handler.mock.calls[0][0];
    expect(emitted.map((f: Favorite) => f.id)).toEqual(['b', 'a']);
  });
});
