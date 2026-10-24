/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.multicluster.test.tsx
 *
 * A table's saved state is per cluster: switching the workspace between
 * clusters hydrates each cluster's own sort, column visibility, and backend
 * query facets, a cluster with nothing saved starts from defaults, and a change
 * saves only into the visible cluster's entry. Runs inside the production
 * shell with two open clusters, the real kubeconfig owner, and the real
 * persistence store over a faked backend (test-utils/appState).
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import {
  buildGridTableStorageKey,
  computeClusterHash,
  type GridTablePersistedState,
} from './gridTablePersistence';
import { useGridTablePersistence } from './useGridTablePersistence';

type Row = { id: string };

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.id },
  { key: 'age', header: 'Age', sortable: true, render: (row) => row.id },
];

const app = installAppStateHarness();
let alpha: TestCluster;
let beta: TestCluster;
let view: MountedApp;
let latest: ReturnType<typeof useGridTablePersistence<Row>> | undefined;
const table = () => requireValue(latest, 'expected the table’s persisted state');

/** A namespace table of the visible cluster, as the namespace views mount it. */
function Table() {
  const { selectedClusterId } = useKubeconfig();
  latest = useGridTablePersistence<Row>({
    viewId: 'namespace-pods',
    clusterIdentity: selectedClusterId,
    namespace: 'default',
    isNamespaceScoped: true,
    columns,
  });
  return null;
}

// The backend's saved table state: what hydration returns and saves write.
let savedTables = new Map<string, unknown>();

// The default persistence mode keeps one entry per view for all of a
// cluster's namespaces (useGridTablePersistence.ts).
const storageKey = async (cluster: TestCluster) =>
  requireValue(
    buildGridTableStorageKey({
      clusterHash: await computeClusterHash(cluster.clusterId),
      viewId: 'namespace-pods',
      namespace: '__shared__',
    }),
    'expected a table storage key'
  );

const saveTable = async (cluster: TestCluster, state: Omit<GridTablePersistedState, 'version'>) => {
  savedTables.set(await storageKey(cluster), { version: 3, ...state });
};

const alphaState = {
  sort: { key: 'name', direction: 'asc' },
  columnVisibility: { age: false },
  filters: {
    ...DEFAULT_GRID_TABLE_FILTER_STATE,
    queryFacets: { types: { mode: 'some', values: ['Warning'] } },
  },
} satisfies Omit<GridTablePersistedState, 'version'>;

const betaState = {
  sort: { key: 'age', direction: 'desc' },
  columnVisibility: { name: false },
  filters: {
    ...DEFAULT_GRID_TABLE_FILTER_STATE,
    queryFacets: { statuses: { mode: 'some', values: ['Healthy'] } },
  },
} satisfies Omit<GridTablePersistedState, 'version'>;

const shown = () => ({
  sort: table().sortConfig,
  columnVisibility: table().columnVisibility,
  filters: table().filters,
});

// Saved table state hydrates once, at startup: save it before starting.
const start = async () => {
  view = await app.render(null);
  await view.show(<Table />);
};

beforeEach(() => {
  latest = undefined;
  savedTables = new Map();
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'prod', context: 'beta' });
  app.namespaces(alpha, ['default']);
  app.namespaces(beta, ['default']);
  app.backend.answer('GetGridTablePersistence', () => Object.fromEntries(savedTables));
  app.backend.answer('SetGridTablePersistence', (key, state) => {
    savedTables.set(key, state);
  });
  app.backend.answer('DeleteGridTablePersistence', (key) => {
    savedTables.delete(key);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useGridTablePersistence across clusters', () => {
  it('hydrates each cluster’s own sort, column visibility, and query facets', async () => {
    await saveTable(alpha, alphaState);
    await saveTable(beta, betaState);
    await start();
    expect(shown()).toEqual(alphaState);

    await view.selectCluster(beta);
    expect(shown()).toEqual(betaState);

    await view.selectCluster(alpha);
    expect(shown()).toEqual(alphaState);
  });

  it('starts from defaults in a cluster with nothing saved', async () => {
    await saveTable(alpha, alphaState);
    await start();
    expect(table().sortConfig).toEqual(alphaState.sort);

    await view.selectCluster(beta);

    expect(table().hydrated).toBe(true);
    expect(table().sortConfig).toBeNull();
    expect(table().columnVisibility).toBeNull();
    expect(table().filters).toEqual(DEFAULT_GRID_TABLE_FILTER_STATE);
  });

  it('saves a change into the visible cluster’s entry only', async () => {
    await saveTable(alpha, alphaState);
    await start();
    vi.useFakeTimers();
    await view.selectCluster(beta);

    await act(async () => table().setSortConfig({ key: 'name', direction: 'desc' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const betaKey = await storageKey(beta);
    expect(app.backend.calls('SetGridTablePersistence').map(([key]) => key)).toEqual([betaKey]);
    expect(savedTables.get(betaKey)).toEqual({
      version: 3,
      sort: { key: 'name', direction: 'desc' },
    });
    expect(savedTables.get(await storageKey(alpha))).toEqual({ version: 3, ...alphaState });
  });
});
