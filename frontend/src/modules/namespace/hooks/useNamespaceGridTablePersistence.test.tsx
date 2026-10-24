/**
 * frontend/src/modules/namespace/hooks/useNamespaceGridTablePersistence.test.tsx
 *
 * Table state of the namespace views, saved through the backend's grid-table
 * persistence: a single namespace's table saves in its cluster's entry for the
 * view (shared by the cluster's namespaces, the default persistence mode)
 * without a Namespaces filter; All Namespaces tables keep the
 * Namespaces selection in one entry per cluster that they share; a saved sort
 * is restored and reset returns to the view's default sort. Runs inside the
 * production shell with the real kubeconfig owner and persistence store over a
 * faked backend (test-utils/appState).
 */

import type { MultiSelectFilterSelection } from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  buildGridTableStorageKey,
  computeClusterHash,
} from '@shared/components/tables/persistence/gridTablePersistence';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useNamespaceGridTablePersistence } from './useNamespaceGridTablePersistence';

const app = installAppStateHarness();

type Row = { name: string };
const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.name },
  { key: 'age', header: 'Age', sortable: true, render: () => '1d' },
];
const DEFAULT_SORT = { key: 'age', direction: 'desc' } as const;

const tables = new Map<string, ReturnType<typeof useNamespaceGridTablePersistence<Row>>>();

function Table({ viewId, namespace }: Readonly<{ viewId: string; namespace: string }>) {
  tables.set(
    viewId,
    useNamespaceGridTablePersistence<Row>({
      viewId,
      namespace,
      columns,
      defaultSort: DEFAULT_SORT,
    })
  );
  return null;
}

const table = (viewId: string) => requireValue(tables.get(viewId), `expected the ${viewId} table`);

const storageKey = async (cluster: TestCluster, viewId: string, namespace?: string) =>
  requireValue(
    buildGridTableStorageKey({
      clusterHash: await computeClusterHash(cluster.clusterId),
      viewId,
      namespace,
    }),
    'expected a storage key'
  );

// The default persistence mode keeps one entry per view for all of a cluster's
// namespaces (useGridTablePersistence.ts).
const namespaceTableKey = (cluster: TestCluster, viewId: string) =>
  storageKey(cluster, viewId, '__shared__');

const sharedNamespacesKey = (cluster: TestCluster) =>
  storageKey(cluster, 'shared-namespace-filter');

const saved = () =>
  Object.fromEntries(
    app.backend.calls('SetGridTablePersistence').map(([key, state]) => [key, state])
  );

const teamB: MultiSelectFilterSelection = { mode: 'some', values: ['team-b'] };

let dev: TestCluster;
let view: MountedApp;

const start = async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  app.backend.answer('DeleteGridTablePersistence', () => undefined);
  view = await app.render(null);
};

/** Lets the debounced table save run. */
const flushSaves = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  tables.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNamespaceGridTablePersistence', () => {
  it('saves a namespace’s table in its cluster’s entry for the view without a Namespaces filter', async () => {
    await start();
    await view.show(<Table viewId="namespace-config" namespace="team-a" />);

    await act(async () => {
      table('namespace-config').setFilters({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        search: 'api',
        namespaces: teamB,
      });
    });
    await flushSaves();

    expect(saved()).toEqual({
      [await namespaceTableKey(dev, 'namespace-config')]: {
        version: 3,
        filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, search: 'api' },
      },
    });
  });

  it('keeps the All Namespaces selection in the cluster’s shared entry for every such table', async () => {
    await start();
    await view.show(<Table viewId="namespace-config" namespace="namespace:all" />);

    await act(async () => {
      table('namespace-config').setFilters({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: teamB,
      });
    });
    await flushSaves();

    expect(saved()).toEqual({
      [await sharedNamespacesKey(dev)]: {
        version: 3,
        filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, namespaces: teamB },
      },
    });

    await view.show(<Table viewId="namespace-network" namespace="namespace:all" />);
    expect(table('namespace-network').filters.namespaces).toEqual(teamB);
  });

  it('restores a saved sort, saves the user’s sort, and returns to the default sort on reset', async () => {
    app.backend.answer('GetGridTablePersistence', async () => ({
      [await namespaceTableKey(dev, 'namespace-config')]: {
        version: 3,
        sort: { key: 'name', direction: 'asc' },
      },
    }));
    await start();
    await view.show(<Table viewId="namespace-config" namespace="team-a" />);
    expect(table('namespace-config').sortConfig).toEqual({ key: 'name', direction: 'asc' });

    await act(async () => {
      table('namespace-config').onSortChange({ key: 'name', direction: 'desc' });
    });
    await flushSaves();
    expect(saved()).toEqual({
      [await namespaceTableKey(dev, 'namespace-config')]: {
        version: 3,
        sort: { key: 'name', direction: 'desc' },
      },
    });

    await act(async () => {
      table('namespace-config').resetState();
    });
    await flushSaves();

    expect(table('namespace-config').sortConfig).toEqual(DEFAULT_SORT);
    expect(app.backend.calls('DeleteGridTablePersistence')).toEqual([
      [await namespaceTableKey(dev, 'namespace-config')],
    ]);
  });
});
