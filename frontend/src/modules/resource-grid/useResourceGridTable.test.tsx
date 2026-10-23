/**
 * frontend/src/modules/resource-grid/useResourceGridTable.test.tsx
 *
 * The shared resource-grid hooks that bind a view's rows to GridTable: the
 * canonical row key, which filter-bar controls a table offers (Include
 * metadata, the view's own actions, Favorite), the namespace and kind filter
 * options and the query state they publish, the default sort, and the
 * favorite's column choices. The hooks run inside the app shell with the real
 * kubeconfig, namespace, favorites, and table-persistence owners; only the
 * backend boundary is faked (test-utils/appState).
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { createCustomMetadataColumnDefinition } from '@shared/components/tables/customMetadataColumns';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import type { ResourceGridTableResult, ResourceGridTableRow } from './resourceGridTableTypes';
import {
  useNamespaceResourceGridTable,
  useObjectPanelResourceGridTable,
} from './useResourceGridTable';

interface TestRow extends ResourceGridTableRow {
  kind: string;
  name: string;
  namespace: string;
  clusterId: string;
}

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let table: ResourceGridTableResult<TestRow> | undefined;

const columns: GridColumnDefinition<TestRow>[] = [
  { key: 'name', header: 'Name', render: (resourceRow) => resourceRow.name },
  { key: 'age', header: 'Age', render: (resourceRow) => resourceRow.name },
];

const row = (): TestRow => ({
  kind: 'Pod',
  name: 'api',
  namespace: 'team-a',
  clusterId: dev.clusterId,
});

const current = () => requireValue(table, 'expected the resource grid table');
const preActionIds = () =>
  (current().gridTableProps.filters?.options?.preActions ?? []).map((item) =>
    'id' in item ? item.id : item.type
  );

type ObjectPanelParams = Partial<Parameters<typeof useObjectPanelResourceGridTable<TestRow>>[0]>;

function ObjectPanelProbe(props: Readonly<ObjectPanelParams>) {
  table = useObjectPanelResourceGridTable<TestRow>({
    viewId: 'test-grid',
    tableMode: 'Local Complete',
    supportsCustomMetadataColumns: true,
    clusterIdentity: dev.clusterId,
    data: [row()],
    columns,
    ...props,
  });
  return null;
}

type NamespaceParams = Partial<Parameters<typeof useNamespaceResourceGridTable<TestRow>>[0]>;

// The query-backed and bounded wrappers own persistence and pass it as
// persistenceOverride; the probe does the same.
function NamespaceProbe(props: Readonly<NamespaceParams>) {
  const persistence = useGridTablePersistence<TestRow>({
    viewId: 'namespace-pods',
    clusterIdentity: dev.clusterId,
    namespace: null,
    isNamespaceScoped: false,
    columns,
    filterOptions: { isNamespaceScoped: false },
  });
  table = useNamespaceResourceGridTable<TestRow>({
    viewId: 'namespace-pods',
    tableMode: 'Query Backed Dynamic',
    supportsCustomMetadataColumns: true,
    namespace: ALL_NAMESPACES_SCOPE,
    data: [row()],
    columns,
    keyExtractor: (item) => item.name,
    showNamespaceFilters: true,
    filterOptionOverrides: { namespaces: ['team-a'] },
    persistenceOverride: persistence,
    ...props,
  });
  return <>{table.favModal}</>;
}

const run = async (action: () => void) => {
  await act(async () => {
    action();
  });
  await app.settle();
};

beforeEach(async () => {
  table = undefined;
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  view = await app.render(null);
});

describe('useObjectPanelResourceGridTable', () => {
  it('keys rows by their canonical object identity unless the view supplies a key', async () => {
    await view.show(<ObjectPanelProbe />);
    expect(current().gridTableProps.keyExtractor(row(), 0)).toBe(
      `${dev.clusterId}|/v1/Pod/team-a/api`
    );

    await view.show(<ObjectPanelProbe keyExtractor={(item) => `custom:${item.name}`} />);
    expect(current().gridTableProps.keyExtractor(row(), 0)).toBe('custom:api');
  });
});

describe('useNamespaceResourceGridTable', () => {
  it('offers Include metadata and custom metadata columns exactly when rows carry labels and annotations', async () => {
    await view.show(<NamespaceProbe supportsCustomMetadataColumns={false} />);
    expect(preActionIds()).not.toContain('include-metadata');
    expect(current().gridTableProps.customMetadataColumns).toBeUndefined();

    await view.show(<NamespaceProbe supportsCustomMetadataColumns />);
    expect(preActionIds()).toContain('include-metadata');
    expect(current().gridTableProps.customMetadataColumns).toBeDefined();
  });

  it('offers the view’s own actions in the filter bar alongside Favorite', async () => {
    await view.show(
      <NamespaceProbe
        viewActions={[
          { type: 'action', id: 'view-action', icon: null, title: 'View action', onClick: vi.fn() },
        ]}
      />
    );

    expect(preActionIds()).toEqual(expect.arrayContaining(['view-action', 'favorite']));
  });

  it('offers a custom metadata column among a favorite’s column choices', async () => {
    await view.show(<NamespaceProbe />);
    const ownerColumn = createCustomMetadataColumnDefinition({
      source: 'label',
      metadataKey: 'example.com/owner',
      header: 'Owner',
    });
    await run(() => current().persistence?.setCustomColumns([ownerColumn]));

    const favorite = requireValue(
      (current().gridTableProps.filters?.options?.preActions ?? []).find(
        (item) => 'id' in item && item.id === 'favorite'
      ),
      'expected the Favorite toggle'
    );
    await run(() => (favorite as { onClick: () => void }).onClick());

    const columnsLabel = requireValue(
      Array.from(document.querySelectorAll<HTMLLabelElement>('label')).find(
        (label) => label.textContent === 'Columns'
      ),
      'expected the favorite’s Columns setting'
    );
    const columnsTrigger = requireValue(
      document.getElementById(columnsLabel.htmlFor),
      'expected the Columns dropdown'
    );
    await run(() => columnsTrigger.click());
    const columnsMenu = requireValue(
      document.querySelector<HTMLElement>('.dropdown-columns-menu'),
      'expected the favorite’s Columns menu'
    );
    expect(columnsMenu.querySelector(`[data-column-key="${ownerColumn.key}"]`)).not.toBeNull();
  });

  it('keeps every namespace selected in the dropdown while querying all namespaces', async () => {
    const onTableStateChange = vi.fn();
    await view.show(<NamespaceProbe onTableStateChange={onTableStateChange} />);
    expect(current().gridTableProps.filters?.options?.namespaces).toEqual(['team-a', 'team-b']);

    await run(() =>
      current().gridTableProps.filters?.onChange?.({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: { mode: 'some', values: ['team-a', 'team-b'] },
      })
    );
    expect(current().gridTableProps.filters?.value?.namespaces).toEqual({
      mode: 'some',
      values: ['team-a', 'team-b'],
    });
    expect(onTableStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ namespaces: { mode: 'all' } }) })
    );

    await run(() =>
      current().gridTableProps.filters?.onChange?.({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: { mode: 'all' },
      })
    );
    expect(current().gridTableProps.filters?.value?.namespaces).toEqual({ mode: 'all' });
  });

  it('keeps the static kind vocabulary when query facets collapse to the selected kind', async () => {
    // Backend facets are computed after the kind filter: with Secret selected
    // they shrink to ['Secret']. The view's list must win or other kinds
    // become unselectable.
    await view.show(
      <NamespaceProbe
        availableKinds={['ConfigMap', 'Secret']}
        showKindDropdown
        filterOptionOverrides={{ kinds: ['Secret'], namespaces: ['team-a'] }}
      />
    );

    expect(current().gridTableProps.filters?.options?.kinds).toEqual(['ConfigMap', 'Secret']);
  });

  it('publishes the default sort before any user sort', async () => {
    const onTableStateChange = vi.fn();
    await view.show(
      <NamespaceProbe
        defaultSort={{ key: 'age', direction: 'desc' }}
        onTableStateChange={onTableStateChange}
      />
    );

    expect(current().gridTableProps.sortConfig).toEqual({ key: 'age', direction: 'desc' });
    expect(onTableStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sortConfig: expect.objectContaining({ key: 'age', direction: 'desc' }),
      })
    );
  });

  it('searches a Local Partial table locally and labels it as a partial window', async () => {
    await view.show(<NamespaceProbe tableMode="Local Partial" filterOptionOverrides={undefined} />);

    const options = current().gridTableProps.filters?.options;
    expect(options?.searchBehavior).toBe('local');
    expect(options?.partialDataLabel).toBeTruthy();
  });
});
