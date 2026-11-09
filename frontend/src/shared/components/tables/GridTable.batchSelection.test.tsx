/**
 * frontend/src/shared/components/tables/GridTable.batchSelection.test.tsx
 *
 * Batch-select mode on the real GridTable: nothing shows until the toolbar
 * button turns it on, row clicks then select instead of running the view's
 * pointer click, the header covers the rows on screen, only rows on screen
 * count (destructive actions must never reach a hidden row), and the checkbox
 * column stays out of the Columns menu, downloads, and saved widths.
 */

import { createResourceNameColumn } from '@shared/components/tables/columnFactories';
import GridTable, {
  type GridColumnDefinition,
  type GridTableBatchAction,
  type GridTableProps,
} from '@shared/components/tables/GridTable';
import { Clipboard } from '@wailsio/runtime';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((name) => ({
  id: name,
  name,
}));
const keyOf = (row: Row) => `cluster-a|${row.id}`;
const columns: GridColumnDefinition<Row>[] = [{ key: 'id', header: 'Id', render: (row) => row.id }];

const app = installAppStateHarness();
const writeText = vi.mocked(Clipboard.SetText);
let view: MountedApp;
let container: HTMLElement;

beforeEach(async () => {
  writeText.mockReset().mockResolvedValue(undefined);
  view = await app.render(null);
  container = view.container;
});

afterEach(() => {
  vi.useRealTimers();
});

const getActionsSpy = vi.fn<(selected: Row[]) => GridTableBatchAction[]>();
const runDelete = vi.fn();

function BatchTable({
  getActionsOverride,
  actionsPending,
  ...props
}: Readonly<
  Partial<GridTableProps<Row>> & {
    getActionsOverride?: () => GridTableBatchAction[];
    actionsPending?: boolean;
  }
>) {
  const [active, setActive] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  return (
    <GridTable<Row>
      data={rows}
      columns={columns}
      keyExtractor={keyOf}
      filters={{ enabled: true, accessors: { getSearchText: (row) => row.name } }}
      virtualization={{ enabled: false }}
      batchSelection={{
        active,
        onActiveChange: setActive,
        selectedKeys,
        onSelectedKeysChange: setSelectedKeys,
        actionsPending,
        getActions: (selected) => {
          getActionsSpy(selected.map(({ row }) => row));
          if (getActionsOverride) {
            return getActionsOverride();
          }
          return selected.length > 0
            ? [
                {
                  id: 'delete',
                  icon: <span />,
                  label: `Delete ${selected.length}`,
                  onRun: runDelete,
                },
              ]
            : [];
        },
      }}
      {...props}
    />
  );
}

const click = async (element: Element, init: MouseEventInit = {}) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
};

const toolbarButton = (label: string) =>
  container.querySelector<HTMLButtonElement>(`.icon-bar-button[aria-label="${label}"]`);
const enterBatchMode = () =>
  click(requireValue(toolbarButton('Batch select'), 'Batch select button'));
const bodyRows = () => Array.from(container.querySelectorAll<HTMLElement>('.gridtable-row'));
const rowCell = (index: number) =>
  requireValue(bodyRows()[index]?.querySelector('[data-column="id"]'), `row ${index} cell`);
const rowChecks = () =>
  Array.from(container.querySelectorAll<HTMLInputElement>('.gridtable-row input[type="checkbox"]'));
const headerCheck = () => container.querySelector<HTMLInputElement>('thead input[type="checkbox"]');
const checkedRows = () =>
  bodyRows()
    .filter((row) => row.dataset.rowSelected === 'true')
    .map((row) => row.dataset.rowKey?.replace('cluster-a|', ''));
const batchBar = () => container.querySelector<HTMLElement>('.gridtable-batch-bar');
const batchAction = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('.gridtable-batch-action')).find(
    (button) => button.querySelector('.gridtable-batch-action-label')?.textContent === label
  );
const batchBarButtons = () =>
  Array.from(batchBar()?.querySelectorAll('button') ?? [], (button) => button.textContent);

describe('GridTable batch-select mode', () => {
  it('shows no checkboxes until the toolbar button turns the mode on', async () => {
    await view.show(<BatchTable />);

    expect(rowChecks()).toHaveLength(0);
    expect(headerCheck()).toBeNull();

    await enterBatchMode();

    expect(rowChecks()).toHaveLength(rows.length);
    expect(headerCheck()).not.toBeNull();
    expect(toolbarButton('Exit batch select')).not.toBeNull();
  });

  it('offers no toolbar button on a table that does not opt in', async () => {
    await view.show(<BatchTable batchSelection={undefined} />);

    expect(toolbarButton('Batch select')).toBeNull();
  });

  it('routes row clicks to selection only while the mode is on', async () => {
    const onRowPointerClick = vi.fn();
    await view.show(<BatchTable onRowPointerClick={onRowPointerClick} />);

    await click(rowCell(1));
    expect(onRowPointerClick).toHaveBeenCalledTimes(1);
    expect(checkedRows()).toEqual([]);

    onRowPointerClick.mockClear();
    await enterBatchMode();
    await click(rowCell(1));

    expect(onRowPointerClick).not.toHaveBeenCalled();
    expect(checkedRows()).toEqual(['bravo']);
    expect(rowChecks()[1]?.checked).toBe(true);
    expect(batchAction('Delete 1')).toBeDefined();
  });

  it('keeps a link in the row opening its object instead of selecting the row', async () => {
    const onOpen = vi.fn();
    await view.show(
      <BatchTable
        columns={[
          createResourceNameColumn<Row>((row) => row.name, { onClick: onOpen }),
          ...columns,
        ]}
      />
    );
    await enterBatchMode();

    const link = requireValue(
      bodyRows()[0]?.querySelector(
        '[data-column="name"] [role="button"], [data-column="name"] button'
      ),
      'name link'
    );
    await click(link);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(checkedRows()).toEqual([]);
  });

  it('extends the selection across a range with Shift-click', async () => {
    await view.show(<BatchTable />);
    await enterBatchMode();

    await click(rowCell(1));
    await click(rowCell(3), { shiftKey: true });

    expect(checkedRows()).toEqual(['bravo', 'charlie', 'delta']);
  });

  it('selects from a checkbox without counting the click twice', async () => {
    await view.show(<BatchTable />);
    await enterBatchMode();

    await click(requireValue(rowChecks()[2], 'row checkbox'));
    expect(checkedRows()).toEqual(['charlie']);

    await click(requireValue(rowChecks()[2], 'row checkbox'));
    expect(checkedRows()).toEqual([]);
  });

  it('selects and clears the rows on screen from the header checkbox', async () => {
    await view.show(<BatchTable />);
    await enterBatchMode();

    await click(rowCell(0));
    expect(headerCheck()?.indeterminate).toBe(true);

    await click(requireValue(headerCheck(), 'header checkbox'));
    expect(checkedRows()).toHaveLength(rows.length);
    expect(headerCheck()?.checked).toBe(true);
    expect(headerCheck()?.indeterminate).toBe(false);

    await click(requireValue(headerCheck(), 'header checkbox'));
    expect(checkedRows()).toEqual([]);
  });

  it('never hands a row hidden by a filter to an action', async () => {
    await view.show(
      <BatchTable
        filters={{
          enabled: true,
          accessors: { getSearchText: (row) => row.name },
          value: {
            search: 'a',
            kinds: { mode: 'all' },
            namespaces: { mode: 'all' },
            clusters: { mode: 'all' },
            includeMetadata: false,
          },
        }}
      />
    );
    await enterBatchMode();
    // "a" matches alpha, bravo, charlie, delta; echo is hidden.
    await click(requireValue(headerCheck(), 'header checkbox'));
    expect(batchAction('Delete 4')).toBeDefined();

    await view.show(
      <BatchTable
        filters={{
          enabled: true,
          accessors: { getSearchText: (row) => row.name },
          value: {
            search: 'alpha',
            kinds: { mode: 'all' },
            namespaces: { mode: 'all' },
            clusters: { mode: 'all' },
            includeMetadata: false,
          },
        }}
      />
    );

    expect(batchAction('Delete 1')).toBeDefined();
    expect(getActionsSpy).toHaveBeenLastCalledWith([rows[0]]);
  });

  it('shows the action bar only once rows are selected, and keeps actions out of the toolbar', async () => {
    await view.show(<BatchTable />);
    await enterBatchMode();
    expect(batchBar()).toBeNull();

    await click(rowCell(0));

    expect(batchBar()?.querySelector('.status-chip')).toBeNull();
    expect(toolbarButton('Delete 1')).toBeNull();
    expect(batchBarButtons()).toEqual(['Delete 1']);
    await click(requireValue(batchAction('Delete 1'), 'Delete action'));
    expect(runDelete).toHaveBeenCalledTimes(1);

    await click(rowCell(0));
    expect(checkedRows()).toEqual([]);
    expect(batchBar()).toBeNull();
  });

  it('shows no bar when no action applies to the selection', async () => {
    const selectionWithoutActions = <BatchTable getActionsOverride={() => []} />;
    await view.show(selectionWithoutActions);
    await enterBatchMode();

    await click(rowCell(0));

    expect(checkedRows()).toEqual(['alpha']);
    expect(batchBar()).toBeNull();
  });

  it('keeps actions on the bar but unusable while the rows on screen are being replaced', async () => {
    runDelete.mockClear();
    await view.show(<BatchTable actionsPending />);
    await enterBatchMode();
    await click(rowCell(0));

    const action = requireValue(batchAction('Delete 1'), 'Delete 1');
    expect(action.disabled).toBe(true);
    await click(action);

    expect(runDelete).not.toHaveBeenCalled();
  });

  it('forgets the mode when the button is pressed again', async () => {
    await view.show(<BatchTable />);
    await enterBatchMode();
    await click(rowCell(0));

    await click(requireValue(toolbarButton('Exit batch select'), 'Exit button'));

    expect(rowChecks()).toHaveLength(0);
    await enterBatchMode();
    expect(checkedRows()).toEqual([]);
  });

  it('keeps the checkbox column out of downloads, the Columns menu, and saved widths', async () => {
    const onColumnWidthsChange = vi.fn();
    await view.show(
      <BatchTable
        columns={[{ key: 'id', header: 'Id', autoWidth: true, render: (row) => row.id }]}
        enableColumnVisibilityMenu
        enableColumnResizing
        onColumnWidthsChange={onColumnWidthsChange}
        columnWidths={{
          id: { width: 300, unit: 'px', autoWidth: false, source: 'user', updatedAt: 1 },
        }}
      />
    );
    await enterBatchMode();

    await click(
      requireValue(
        container.querySelector('.icon-bar-button[aria-label="Download all matching rows"]'),
        'Download'
      )
    );
    await click(
      requireValue(
        Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
          (element) => element.textContent === 'Copy to Clipboard'
        ),
        'Copy to Clipboard'
      )
    );
    await app.settle();
    expect(writeText.mock.calls[0]?.[0].split('\n')[0]).toBe('Id');

    await click(
      requireValue(
        container.querySelector('[data-gridtable-filter-role="columns"] button'),
        'Columns button'
      )
    );
    const options = Array.from(document.body.querySelectorAll<HTMLElement>('.dropdown-option'));
    expect(options.some((option) => option.dataset.columnKey === '__batch-select')).toBe(false);

    onColumnWidthsChange.mockClear();
    await click(
      requireValue(
        document.body.querySelector('button[aria-label="Reset columns"]'),
        'Reset columns'
      )
    );
    expect(onColumnWidthsChange).toHaveBeenCalled();
    for (const [payload] of onColumnWidthsChange.mock.calls) {
      expect(Object.keys(payload)).not.toContain('__batch-select');
    }
  });
});
