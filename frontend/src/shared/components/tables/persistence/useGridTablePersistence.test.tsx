/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.test.tsx
 *
 * A table's saved state through the backend's grid-table persistence: each
 * namespace's entry hydrates when the table moves to it (namespaced mode), a
 * column choice saves while a live table republishes inline filter options,
 * transient tables never read or write saved state, saved custom columns
 * hydrate, and reset keeps their definitions. Runs inside the production shell
 * with the real preferences and persistence store over a faked backend
 * (test-utils/appState); saved state is what GetGridTablePersistence answers
 * at startup and what SetGridTablePersistence/DeleteGridTablePersistence write.
 */

import {
  type CustomMetadataColumnDefinition,
  createCustomMetadataColumnDefinition,
} from '@shared/components/tables/customMetadataColumns';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import {
  buildGridTableStorageKey,
  computeClusterHash,
  type GridTableFilterPersistenceOptions,
  type GridTablePersistedState,
} from './gridTablePersistence';
import {
  type UseGridTablePersistenceParams,
  useGridTablePersistence,
} from './useGridTablePersistence';

type Row = { id: string };

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.id },
  { key: 'age', header: 'Age', sortable: true, render: (row) => row.id },
];

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let latest: ReturnType<typeof useGridTablePersistence<Row>> | undefined;
const table = () => requireValue(latest, 'expected the table’s persisted state');

function Table(
  props: Readonly<
    Partial<UseGridTablePersistenceParams<Row>> & { rows?: Row[]; namespace?: string }
  >
) {
  const { rows, ...params } = props;
  latest = useGridTablePersistence<Row>({
    viewId: 'namespace-pods',
    clusterIdentity: dev.clusterId,
    isNamespaceScoped: true,
    columns,
    ...params,
  });
  return <span>{rows?.[0]?.id}</span>;
}

// The backend's saved table state: what hydration returns and saves write.
let savedTables = new Map<string, unknown>();

const storageKey = async (viewId: string, namespace?: string) =>
  requireValue(
    buildGridTableStorageKey({
      clusterHash: await computeClusterHash(dev.clusterId),
      viewId,
      namespace,
    }),
    'expected a table storage key'
  );

const saveTable = async (
  viewId: string,
  namespace: string | undefined,
  state: Omit<GridTablePersistedState, 'version'>
) => {
  savedTables.set(await storageKey(viewId, namespace), { version: 3, ...state });
};

/** Lets the debounced table save run. */
const letSavesRun = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
};

const ownerColumn: CustomMetadataColumnDefinition = createCustomMetadataColumnDefinition({
  source: 'label',
  metadataKey: 'app.kubernetes.io/owner',
  header: 'Owner',
});

// Saved table state hydrates once, at startup: save it before starting.
const start = async () => {
  view = await app.render(null);
};

beforeEach(() => {
  latest = undefined;
  savedTables = new Map();
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
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

describe('useGridTablePersistence', () => {
  it('hydrates the entry of the namespace the table moves to (namespaced mode)', async () => {
    app.preferences({ gridTablePersistenceMode: 'namespaced' });
    await saveTable('namespace-pods', 'team-a', {
      sort: { key: 'name', direction: 'desc' },
      columnOrder: ['age', 'name'],
    });
    await saveTable('namespace-pods', 'team-b', {
      sort: { key: 'age', direction: 'asc' },
      columnOrder: ['name', 'age'],
    });
    await start();

    await view.show(<Table namespace="team-a" />);
    expect(table().sortConfig).toEqual({ key: 'name', direction: 'desc' });
    expect(table().columnOrder).toEqual(['age', 'name']);

    await view.show(<Table namespace="team-b" />);
    expect(table().sortConfig).toEqual({ key: 'age', direction: 'asc' });
    expect(table().columnOrder).toEqual(['name', 'age']);
  });

  it.each([
    ['Browse', () => ({ kinds: [], namespaces: [], queryFacets: { apiGroups: [] } })],
    ['namespace summary', () => ({ clusters: ['cluster-a', 'cluster-b'] })],
  ] satisfies [string, () => GridTableFilterPersistenceOptions][])(
    'saves a column choice while %s refreshes with inline array options',
    async (_view, buildFilterOptions) => {
      await start();
      vi.useFakeTimers();
      // A live table republishes rows and inline filter options on every refresh.
      const LiveTable = ({ rows }: Readonly<{ rows: Row[] }>) => (
        <Table
          viewId="live-table"
          isNamespaceScoped={false}
          filterOptions={buildFilterOptions()}
          rows={rows}
        />
      );
      await view.show(<LiveTable rows={[{ id: 'a' }]} />);
      expect(table().hydrated).toBe(true);

      await act(async () => table().setColumnVisibility({ age: false }));
      for (let tick = 0; tick < 3; tick++) {
        await act(async () => vi.advanceTimersByTimeAsync(100));
        await view.show(<LiveTable rows={[{ id: `row-${tick}` }]} />);
      }

      expect(app.backend.calls('SetGridTablePersistence')).toContainEqual([
        await storageKey('live-table'),
        expect.objectContaining({ columnVisibility: { age: false } }),
      ]);
    }
  );

  it('keeps transient table state in memory: ready before saved state loads, from defaults, never saved', async () => {
    await saveTable('namespace-pods', '__shared__', { columnVisibility: { age: false } });
    const hydrate = app.backend.hold('GetGridTablePersistence');
    await start();
    vi.useFakeTimers();

    await view.show(<Table namespace="team-a" transient />);
    expect(table().hydrated).toBe(true);
    expect(table().columnVisibility).toBeNull();

    await act(async () => table().setSortConfig({ key: 'age', direction: 'desc' }));
    hydrate();
    await letSavesRun();

    expect(table().sortConfig).toEqual({ key: 'age', direction: 'desc' });
    expect(table().columnVisibility).toBeNull();
    expect(app.backend.calls('SetGridTablePersistence')).toEqual([]);
    expect(app.backend.calls('DeleteGridTablePersistence')).toEqual([]);
  });

  it('hydrates the saved custom column definitions of the table’s entry', async () => {
    await saveTable('namespace-pods', '__shared__', { customColumns: [ownerColumn] });
    await start();

    await view.show(<Table namespace="team-a" />);

    expect(table().customColumns).toEqual([ownerColumn]);
  });

  it('resets custom column presentation and keeps their definitions saved', async () => {
    const ownerKey = ownerColumn.key;
    await saveTable('namespace-pods', '__shared__', {
      customColumns: [ownerColumn],
      columnOrder: [ownerKey, 'name', 'age'],
      columnVisibility: { [ownerKey]: false },
    });
    await start();
    vi.useFakeTimers();
    await view.show(<Table namespace="team-a" />);
    expect(table().columnOrder).toEqual([ownerKey, 'name', 'age']);

    await act(async () => table().resetState());
    await letSavesRun();

    expect(table().customColumns).toEqual([ownerColumn]);
    expect(table().columnOrder).toBeNull();
    expect(table().columnVisibility).toEqual({});
    expect(savedTables.get(await storageKey('namespace-pods', '__shared__'))).toEqual({
      version: 3,
      customColumns: [ownerColumn],
    });
  });
});
