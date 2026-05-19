import { describe, expect, it, vi } from 'vitest';
import type { Favorite } from '@/core/persistence/favorites';
import { navigateToFavorite } from './navigateToFavorite';

const makeFavorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'Favorite',
  clusterSelection: '/kube/alpha:dev',
  clusterId: 'alpha:dev',
  clusterName: 'dev',
  viewType: 'cluster',
  view: 'nodes',
  namespace: '',
  filters: null,
  tableState: null,
  order: 0,
  ...overrides,
});

describe('navigateToFavorite', () => {
  it('uses clusterId to avoid reactivating an already active favorite cluster', () => {
    const openKubeconfig = vi.fn().mockResolvedValue(undefined);
    const setActiveKubeconfig = vi.fn();
    const setPendingFavorite = vi.fn();

    const favorite = makeFavorite({
      clusterSelection: '/different/path:dev',
      clusterId: 'alpha:dev',
    });

    navigateToFavorite(favorite, {
      selectedKubeconfigs: ['/different/path:dev'],
      selectedClusterId: 'alpha:dev',
      openKubeconfig,
      setActiveKubeconfig,
      setPendingFavorite,
    });

    expect(setPendingFavorite).toHaveBeenCalledWith(favorite);
    expect(openKubeconfig).not.toHaveBeenCalled();
    expect(setActiveKubeconfig).not.toHaveBeenCalled();
  });

  it('can resolve an open cluster selection from a persisted clusterId', () => {
    const openKubeconfig = vi.fn().mockResolvedValue(undefined);
    const setActiveKubeconfig = vi.fn();
    const setPendingFavorite = vi.fn();

    const favorite = makeFavorite({
      clusterSelection: '',
      clusterId: 'beta:prod',
    });

    navigateToFavorite(favorite, {
      selectedKubeconfigs: ['/kube/alpha:dev', '/kube/beta:prod'],
      selectedClusterId: 'alpha:dev',
      openKubeconfig,
      setActiveKubeconfig,
      getClusterMeta: (selection) =>
        selection === '/kube/beta:prod' ? { id: 'beta:prod', name: 'prod' } : { id: '', name: '' },
      setPendingFavorite,
    });

    expect(setActiveKubeconfig).toHaveBeenCalledWith('/kube/beta:prod');
    expect(openKubeconfig).not.toHaveBeenCalled();
  });

  it('does not issue a delayed activation after opening a favorite cluster', async () => {
    const openKubeconfig = vi.fn().mockResolvedValue(undefined);
    const setActiveKubeconfig = vi.fn();
    const setPendingFavorite = vi.fn();

    navigateToFavorite(makeFavorite(), {
      selectedKubeconfigs: ['/kube/beta:prod'],
      selectedClusterId: 'beta:prod',
      openKubeconfig,
      setActiveKubeconfig,
      setPendingFavorite,
    });

    expect(openKubeconfig).toHaveBeenCalledWith('/kube/alpha:dev');
    await Promise.resolve();
    expect(setActiveKubeconfig).not.toHaveBeenCalled();
  });
});
