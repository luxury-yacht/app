/**
 * frontend/src/core/contexts/FavoritesContext.test.tsx
 *
 * The favorites owner: it lists the backend's saved favorites, and applies an
 * activated favorite's navigation (view, namespace, sidebar selection) only
 * once its target is ready: the favorite's own cluster is visible and
 * operational, and a namespace favorite's namespaces have loaded. Global
 * favorites open the Global workspace; an unknown saved view falls back to the
 * scope's default. A table restores the favorite's saved settings only after
 * navigation, and a favorite whose target makes no progress for 15 seconds
 * expires. Runs the production shell's own favorites provider over the real
 * kubeconfig, lifecycle, view-state, and namespace owners (test-utils/appState);
 * readiness reaches it only through the faked backend.
 */

import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import type { Favorite } from '@/core/persistence/favorites';
import type { NamespaceSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';
import { useFavToggle } from '@/ui/favorites/FavToggle';
import { useFavorites } from './FavoritesContext';

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;
let favorites: ReturnType<typeof useFavorites> | null = null;

function Probe() {
  favorites = useFavorites();
  return null;
}

const current = () => requireValue(favorites, 'favorites owner');
const navigation = () => requireValue(view.owners().viewState, 'workspace navigation');

const NO_FILTERS: Favorite['filters'] = {
  search: '',
  kinds: { mode: 'all' },
  namespaces: { mode: 'all' },
  clusters: { mode: 'all' },
  includeMetadata: false,
};

const favorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'Team A workloads',
  clusterSelection: '',
  viewType: 'namespace',
  view: 'workloads',
  namespace: 'team-a',
  filters: NO_FILTERS,
  tableState: { sortColumn: 'name', sortDirection: 'asc', columnVisibility: {} },
  order: 0,
  ...overrides,
});

const nodesFavorite = (overrides: Partial<Favorite> = {}) =>
  favorite({ id: 'fav-nodes', viewType: 'cluster', view: 'nodes', namespace: '', ...overrides });

/** Alpha (visible) and beta, both listing team-a; alpha reports `alphaLifecycle`. */
const start = async (
  alphaLifecycle = backend.ClusterLifecycleState.ClusterStateReady,
  ui: ReactNode = <Probe />
) => {
  alpha = app.cluster({ name: 'dev', context: 'alpha', lifecycle: alphaLifecycle });
  beta = app.cluster({ name: 'dev', context: 'beta' });
  app.namespaces(alpha, ['default', 'team-a']);
  app.namespaces(beta, ['default', 'team-a']);
  view = await app.render(null);
  await view.show(ui);
};

const activate = async (next: Favorite | null) => {
  await act(async () => current().setPendingFavorite(next));
  await app.settle();
};

const emitLifecycle = async (cluster: TestCluster, state: string) => {
  await act(async () => {
    app.events.emit('cluster:lifecycle', { clusterId: cluster.clusterId, state });
  });
  await app.settle();
};

const namespaceSummary = (cluster: TestCluster, name: string): NamespaceSummary => ({
  ref: {
    clusterId: cluster.clusterId,
    group: '',
    version: 'v1',
    kind: 'Namespace',
    resource: 'namespaces',
    name,
    namespace: '',
    uid: `${cluster.clusterId}/${name}`,
  },
  phase: 'Active',
  resourceVersion: '1',
  creationTimestamp: 0,
  hasWorkloads: true,
  warningEventsState: 'available',
  quotaPressureState: 'available',
});

/**
 * Holds the visible cluster's namespace list until the returned release
 * answers it, so namespace-driven UI is not ready yet. Call before mounting.
 */
const holdNamespaceList = () => {
  const pending: Array<() => void> = [];
  app.snapshots.respond((request) => {
    if (request.domain !== 'namespaces' || !request.scope.startsWith(`${alpha.clusterId}|`)) {
      return undefined;
    }
    return new Promise<Response>((resolve) => {
      pending.push(() =>
        resolve(
          snapshotResponse({
            domain: request.domain,
            scope: request.scope,
            version: 1,
            payload: {
              clusterId: alpha.clusterId,
              clusterName: alpha.clusterName,
              namespaces: ['default', 'team-a'].map((name) => namespaceSummary(alpha, name)),
            },
          })
        )
      );
    });
  });
  return async () => {
    app.snapshots.respond(null);
    await act(async () => {
      for (const answer of pending.splice(0)) {
        answer();
      }
    });
    await app.settle();
  };
};

afterEach(() => {
  favorites = null;
  vi.useRealTimers();
});

describe('favorites', () => {
  it('lists the favorites the backend saved', async () => {
    const saved = [favorite(), nodesFavorite({ name: 'Nodes', order: 1 })];
    app.backend.answer('GetFavorites', () => saved);

    await start();

    expect(current().favorites.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'fav-1', name: 'Team A workloads' },
      { id: 'fav-nodes', name: 'Nodes' },
    ]);
  });

  it('opens a namespace favorite’s namespace, view, and sidebar selection', async () => {
    await start();

    await activate(favorite({ view: 'pods' }));

    expect(navigation().viewType).toBe('namespace');
    expect(navigation().activeNamespaceTab).toBe('pods');
    expect(navigation().sidebarSelection).toEqual({ type: 'namespace', value: 'team-a' });
    expect(view.owners().namespace.selectedNamespace).toBe('team-a');
  });

  it('opens the scope’s default view for an unrecognized saved view', async () => {
    // A favorite saved before a view rename (or corrupted) must not set a bogus
    // tab; navigation still happens.
    await start();

    await activate(favorite({ view: 'wrokloads' }));
    expect(navigation().viewType).toBe('namespace');
    expect(navigation().activeNamespaceTab).toBe('workloads');

    await activate(nodesFavorite({ view: 'nodess' }));
    expect(navigation().viewType).toBe('cluster');
    expect(navigation().activeClusterTab).toBeNull();
  });

  it('applies a favorite when its cluster is operational but degraded', async () => {
    await start(backend.ClusterLifecycleState.ClusterStateDegraded);

    await activate(favorite());

    expect(navigation().viewType).toBe('namespace');
    expect(view.owners().namespace.selectedNamespace).toBe('team-a');
  });

  it('waits for the namespace list before opening a namespace favorite', async () => {
    alpha = app.cluster({ name: 'dev', context: 'alpha' });
    const releaseNamespaces = holdNamespaceList();
    app.namespaces(alpha, ['default', 'team-a']);
    view = await app.render(null);
    await view.show(<Probe />);

    await activate(favorite());
    expect(navigation().viewType).toBe('overview');

    await releaseNamespaces();

    expect(navigation().viewType).toBe('namespace');
    expect(navigation().activeNamespaceTab).toBe('workloads');
    expect(navigation().sidebarSelection).toEqual({ type: 'namespace', value: 'team-a' });
    expect(view.owners().namespace.selectedNamespace).toBe('team-a');
  });

  it('opens a cluster favorite without waiting for the namespace list', async () => {
    alpha = app.cluster({ name: 'dev', context: 'alpha' });
    const releaseNamespaces = holdNamespaceList();
    app.namespaces(alpha, ['default', 'team-a']);
    view = await app.render(null);
    await view.show(<Probe />);

    await activate(nodesFavorite());

    expect(navigation().viewType).toBe('cluster');
    expect(navigation().activeClusterTab).toBe('nodes');
    expect(navigation().sidebarSelection).toEqual({ type: 'cluster', value: 'cluster' });
    await releaseNamespaces();
  });

  it('applies each newly activated favorite without an intermediate clear', async () => {
    await start();

    await activate(favorite({ id: 'first', view: 'pods' }));
    expect(navigation().activeNamespaceTab).toBe('pods');

    await activate(nodesFavorite({ id: 'second' }));
    expect(navigation().viewType).toBe('cluster');
    expect(navigation().activeClusterTab).toBe('nodes');
  });

  it('opens new and legacy Global favorites in the Global workspace', async () => {
    await start();

    // Global favorites were once saved as cluster routes.
    await activate(nodesFavorite({ id: 'legacy-global', view: 'global-namespaces' }));
    expect(navigation().viewType).toBe('global');
    expect(navigation().activeGlobalTab).toBe('global-namespaces');
    expect(navigation().getClusterNavigationState(alpha.clusterId).viewType).toBe('overview');

    await activate(null);
    await activate(favorite({ id: 'global', viewType: 'global', view: 'fleet', namespace: '' }));
    expect(navigation().viewType).toBe('global');
    expect(navigation().activeGlobalTab).toBe('fleet');
  });

  it('applies a cluster-specific favorite only once its cluster is visible', async () => {
    await start();

    await activate(nodesFavorite({ clusterId: beta.clusterId, clusterSelection: beta.selection }));
    expect(navigation().viewType).toBe('overview');

    await view.selectCluster(beta);

    expect(navigation().viewType).toBe('cluster');
    expect(navigation().activeClusterTab).toBe('nodes');
    expect(navigation().getClusterNavigationState(alpha.clusterId).viewType).toBe('overview');
  });

  it.each(['cluster', 'lifecycle', 'namespace list'] as const)(
    'keeps saved table settings pending until the %s is ready and navigation applied',
    async (blocked) => {
      const restoredIn: Array<string | undefined> = [];
      const restore = vi.fn(() => {
        restoredIn.push(view.owners().viewState?.viewType);
      });
      function Table() {
        useFavToggle({
          filters: NO_FILTERS,
          sortColumn: 'name',
          sortDirection: 'asc',
          columnVisibility: {},
          hydrated: true,
          setFilters: restore,
        });
        return null;
      }
      const ui = (
        <>
          <Probe />
          <Table />
        </>
      );
      let unblock: () => Promise<void>;
      if (blocked === 'namespace list') {
        alpha = app.cluster({ name: 'dev', context: 'alpha' });
        unblock = holdNamespaceList();
        app.namespaces(alpha, ['default', 'team-a']);
        view = await app.render(null);
        await view.show(ui);
      } else if (blocked === 'lifecycle') {
        await start(backend.ClusterLifecycleState.ClusterStateConnecting, ui);
        unblock = () => emitLifecycle(alpha, 'ready');
      } else {
        await start(backend.ClusterLifecycleState.ClusterStateReady, ui);
        unblock = () => view.selectCluster(beta);
      }
      const target = blocked === 'cluster' ? beta : alpha;
      const saved = favorite({
        clusterId: target.clusterId,
        clusterSelection: target.selection,
        filters: { ...NO_FILTERS, search: 'saved filter' },
      });

      await activate(saved);
      expect(restore).not.toHaveBeenCalled();
      expect(current().pendingFavorite?.id).toBe(saved.id);

      await unblock();

      expect(restore).toHaveBeenCalledWith(saved.filters);
      // The table restores only on the favorite's view, then consumes it.
      expect(restoredIn).toEqual(['namespace']);
      expect(view.owners().kubeconfig.selectedClusterId).toBe(target.clusterId);
      expect(current().pendingFavorite).toBeNull();
    }
  );

  it('expires a pending favorite only after 15 seconds without lifecycle progress', async () => {
    vi.useFakeTimers();
    await start(backend.ClusterLifecycleState.ClusterStateConnecting);

    await activate(favorite());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    await emitLifecycle(alpha, 'connected');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(current().pendingFavorite?.id).toBe('fav-1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(13_000);
    });
    expect(current().pendingFavorite).toBeNull();
    expect(navigation().viewType).toBe('overview');
  });
});
