/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderContextMenu.test.tsx
 *
 * A column header's context menu offers what the column allows: sorting for a
 * sortable column (with the current direction and Clear Sort disabled where
 * they would do nothing), Hide Column for a hideable one, and a single disabled
 * item for a column that allows neither. Its choices reach the table's sort and
 * column visibility. Runs the real GridTable inside the production shell
 * (keyboard and zoom owners) with only the backend boundary faked
 * (test-utils/appState).
 */

import GridTable, {
  type GridColumnDefinition,
  type GridTableProps,
} from '@shared/components/tables/GridTable';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

interface TestRow {
  id: string;
  status: string;
  name: string;
  kind: string;
  namespace: string;
}

const testRows: TestRow[] = [
  { id: 'r1', status: 'Running', name: 'pod-a', kind: 'Pod', namespace: 'default' },
  { id: 'r2', status: 'Pending', name: 'pod-b', kind: 'Pod', namespace: 'kube-system' },
];

// Every capability combination:
//   status    - sortable and hideable (the defaults)
//   name      - sortable, always shown
//   kind      - neither sortable nor hideable
//   namespace - hideable, not sortable
const testColumns: GridColumnDefinition<TestRow>[] = [
  { key: 'status', header: 'Status', render: (row) => row.status },
  { key: 'name', header: 'Name', sortable: true, hideable: false, render: (row) => row.name },
  { key: 'kind', header: 'Kind', sortable: false, hideable: false, render: (row) => row.kind },
  { key: 'namespace', header: 'Namespace', sortable: false, render: (row) => row.namespace },
];

const app = installAppStateHarness();
let view: MountedApp;

beforeEach(async () => {
  view = await app.render(null);
});

const showTable = (props: Partial<GridTableProps<TestRow>> = {}) =>
  view.show(
    <GridTable<TestRow>
      data={testRows}
      columns={testColumns}
      keyExtractor={(item) => `cluster-a|${item.id}`}
      virtualization={{ enabled: false }}
      enableContextMenu
      enableColumnVisibilityMenu
      onSort={vi.fn()}
      {...props}
    />
  );

const openHeaderMenu = async (columnKey: string) => {
  const header = requireValue(
    view.container.querySelector<HTMLElement>(`th[data-column="${columnKey}"]`),
    `header ${columnKey}`
  );
  await act(async () => {
    header.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 })
    );
  });
  await app.settle();
};

const closeMenu = async () => {
  const menu = requireValue(document.body.querySelector<HTMLElement>('[role="menu"]'), 'menu');
  await act(async () => {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await app.settle();
};

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const labelOf = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim() ?? '';
/** Each item as the user meets it: its label, and whether it can be chosen. */
const shownItems = () =>
  menuItems().map((item) => ({
    label: labelOf(item),
    enabled: item.getAttribute('aria-disabled') !== 'true',
  }));
const choose = async (label: string) => {
  const item = requireValue(
    menuItems().find((candidate) => labelOf(candidate) === label),
    `menu item ${label}`
  );
  await act(async () => {
    item.click();
  });
  await app.settle();
};

describe('GridTable header context menu', () => {
  it.each([
    {
      column: 'status',
      items: ['Sort Ascending', 'Sort Descending', 'Clear Sort', 'Hide Column'],
    },
    { column: 'name', items: ['Sort Ascending', 'Sort Descending', 'Clear Sort'] },
    { column: 'namespace', items: ['Hide Column'] },
  ])('offers the actions the $column column allows', async ({ column, items }) => {
    await showTable();

    await openHeaderMenu(column);

    expect(shownItems().map(({ label }) => label)).toEqual(items);
  });

  it('shows one disabled item for a column that can be neither sorted nor hidden', async () => {
    const onColumnVisibilityChange = vi.fn();
    await showTable({ onColumnVisibilityChange });

    await openHeaderMenu('kind');
    expect(shownItems()).toEqual([{ label: 'No Actions', enabled: false }]);
    await choose('No Actions');

    expect(onColumnVisibilityChange).not.toHaveBeenCalled();
  });

  it('disables the current sort direction, and Clear Sort on a column that is not sorted', async () => {
    await showTable({ sortConfig: { key: 'status', direction: 'asc' } });

    await openHeaderMenu('status');
    expect(shownItems()).toEqual([
      { label: 'Sort Ascending', enabled: false },
      { label: 'Sort Descending', enabled: true },
      { label: 'Clear Sort', enabled: true },
      { label: 'Hide Column', enabled: true },
    ]);
    await closeMenu();

    await openHeaderMenu('name');
    expect(shownItems()).toContainEqual({ label: 'Clear Sort', enabled: false });
  });

  it.each([
    { label: 'Sort Ascending', direction: 'asc' },
    { label: 'Sort Descending', direction: 'desc' },
  ])('sorts the column when $label is chosen', async ({ label, direction }) => {
    const onSort = vi.fn();
    await showTable({ onSort });

    await openHeaderMenu('status');
    await choose(label);

    expect(onSort).toHaveBeenCalledWith('status', direction);
  });

  it('hides the column when Hide Column is chosen', async () => {
    const onColumnVisibilityChange = vi.fn();
    await showTable({ onColumnVisibilityChange });

    await openHeaderMenu('status');
    await choose('Hide Column');

    expect(onColumnVisibilityChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: false })
    );
  });
});
