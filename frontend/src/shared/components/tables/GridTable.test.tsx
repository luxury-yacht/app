/**
 * frontend/src/shared/components/tables/GridTable.test.tsx
 *
 * The shared table: virtualization renders only the visible window and keeps
 * focus while it shifts; pointer clicks select without opening; local search,
 * kind filters, and pagination narrow the rows and their counts; the empty,
 * filtered-empty, loading, and busy states; header sorting, reordering, and
 * semantics; custom metadata columns; column resizing and width reset; row
 * menus; and the Download button's clipboard contents. Keyboard navigation is
 * in GridTable.keyboard.test.tsx and GridTable.rowDetail.test.tsx, header menus
 * in hooks/useGridTableHeaderContextMenu.test.tsx. Runs the real GridTable
 * inside the production shell (keyboard and zoom owners) with only the backend
 * boundary faked (test-utils/appState); copies go to the Wails clipboard.
 */

import {
  createResourceBarColumn,
  createTextColumn,
} from '@shared/components/tables/columnFactories';
import { createCustomMetadataColumnDefinition } from '@shared/components/tables/customMetadataColumns';
import GridTable, {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
  type GridTableFilterState,
  type GridTableProps,
} from '@shared/components/tables/GridTable';
import { Clipboard } from '@wailsio/runtime';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

interface SimpleRow {
  id: string;
  label: string;
  name?: string;
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
}

const defaultColumns: GridColumnDefinition<SimpleRow>[] = [
  {
    key: 'label',
    header: 'Label',
    render: (row) => <button type="button">{row.label}</button>,
  },
];

const NO_FILTERS: GridTableFilterState = {
  search: '',
  kinds: { mode: 'all' },
  namespaces: { mode: 'all' },
  clusters: { mode: 'all' },
  includeMetadata: false,
};

const app = installAppStateHarness();
// Spies this file installs, restored after each test; the harness keeps its own.
const spies: Array<{ mockRestore(): void }> = [];
const track = <S extends { mockRestore(): void }>(spy: S): S => {
  spies.push(spy);
  return spy;
};
const writeText = vi.mocked(Clipboard.SetText);
let view: MountedApp;
let container: HTMLElement;
let currentProps: GridTableProps<SimpleRow>;

beforeEach(async () => {
  writeText.mockReset().mockResolvedValue(undefined);
  view = await app.render(null);
  container = view.container;
});

afterEach(() => {
  vi.useRealTimers();
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

function createRows(count: number): SimpleRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    label: `Row ${index}`,
    name: `Row ${index}`,
  }));
}

/** Shows the table as a view would; later calls update the same table. */
const renderGridTable = async (props: Partial<GridTableProps<SimpleRow>> = {}) => {
  currentProps = {
    data: createRows(30),
    columns: defaultColumns,
    keyExtractor: (item: SimpleRow) => `cluster-a|${item.id}`,
    ...props,
    virtualization: {
      enabled: true,
      threshold: 1,
      overscan: 1,
      estimateRowHeight: 40,
      ...props.virtualization,
    },
  };
  await view.show(<GridTable<SimpleRow> {...currentProps} />);
};

const rerender = (props: Partial<GridTableProps<SimpleRow>>) =>
  view.show(<GridTable<SimpleRow> {...currentProps} {...props} />);

const renderedRows = () =>
  Array.from(container.querySelectorAll<HTMLElement>('.gridtable-row'), (row) =>
    row.textContent?.trim()
  );
const focusedRows = () =>
  Array.from(container.querySelectorAll<HTMLElement>('.gridtable-row--focused'), (row) =>
    row.dataset.rowKey?.replace('cluster-a|', '')
  );
const scrollWrapper = () =>
  requireValue(container.querySelector<HTMLElement>('.gridtable-wrapper'), 'table scroller');
const tableBody = () =>
  requireValue(container.querySelector<HTMLElement>('table[tabindex="0"]'), 'table body');
const resultCount = () =>
  container.querySelector('[data-gridtable-filter-role="result-count"]')?.textContent;
const columnsButton = () =>
  requireValue(
    container.querySelector<HTMLButtonElement>('[data-gridtable-filter-role="columns"] button'),
    'Columns button'
  );
const bodyButton = (label: string) =>
  requireValue(
    document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    `button ${label}`
  );

const click = async (element: Element) => {
  await act(async () => {
    (element as HTMLElement).click();
  });
};

const scrollTo = async (top: number) => {
  const wrapper = scrollWrapper();
  await act(async () => {
    wrapper.scrollTop = top;
    wrapper.dispatchEvent(new Event('scroll'));
    // The scroll handler is throttled to an animation frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
};

// Opens the table's Download button (named for its row scope) and chooses where the rows go.
const chooseDownload = async (
  scope: 'Download all matching rows' | 'Download visible rows',
  choice: 'Copy to Clipboard' | 'Save to File'
) => {
  await click(
    requireValue(
      container.querySelector<HTMLButtonElement>(`.icon-bar-button[aria-label="${scope}"]`),
      `expected the ${scope} button`
    )
  );
  const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
    (element) => element.textContent === choice
  );
  await click(requireValue(item, `expected ${choice}`));
  await app.settle();
};

const copiedText = () => writeText.mock.calls.map(([text]) => text);

describe('GridTable virtualization', () => {
  let clientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    // jsdom has no layout: the table body is 400px tall.
    clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList?.contains('gridtable-wrapper')) {
          return 400;
        }
        return clientHeight?.get ? clientHeight.get.call(this) : 0;
      },
    });
  });

  afterEach(() => {
    if (clientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });

  it('renders only the visible window of rows and moves it when the table scrolls', async () => {
    await renderGridTable({ data: createRows(120) });
    const initial = renderedRows();
    expect(initial.length).toBeLessThan(120);
    expect(initial[0]).toBe('Row 0');

    await scrollTo(400);

    const scrolled = renderedRows();
    expect(scrolled).toHaveLength(initial.length);
    expect(scrolled[0]).toBe('Row 9');
    expect(scrolled[scrolled.length - 1]).toBe('Row 20');
  });

  it('virtualizes a large table with the default settings', async () => {
    await renderGridTable({
      data: createRows(500),
      virtualization: GRIDTABLE_VIRTUALIZATION_DEFAULT,
    });

    expect(renderedRows().length).toBeLessThan(500);
  });

  it('renders every row when virtualization is disabled', async () => {
    await renderGridTable({ data: createRows(25), virtualization: { enabled: false } });

    const rows = renderedRows();
    expect(rows).toHaveLength(25);
    expect(rows[0]).toBe('Row 0');
    expect(rows[24]).toBe('Row 24');
  });

  it('keeps focus on a focused row control while the virtual window shifts', async () => {
    await renderGridTable({ data: createRows(60), virtualization: { overscan: 2 } });
    const target = requireValue(
      container.querySelectorAll<HTMLButtonElement>('.gridtable-row button')[4],
      'fifth row button'
    );
    await act(async () => target.focus());

    await act(async () => {
      scrollWrapper().scrollTop = 200;
      scrollWrapper().dispatchEvent(new Event('scroll'));
    });

    expect(document.activeElement).toBe(target);
  });

  // The app root renders in React.StrictMode, whose development double-run of
  // effects runs the measurement queue's cleanup once before the table is used.
  it('remeasures auto-width columns when the virtual row window changes', async () => {
    vi.useFakeTimers();
    const renderCell = vi.fn((row: SimpleRow) => row.label);
    const rows = createRows(120);
    await renderGridTable({
      data: rows,
      columns: [{ key: 'label', header: 'Label', autoWidth: true, render: renderCell }],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    renderCell.mockClear();

    await act(async () => {
      scrollWrapper().scrollTop = 400;
      scrollWrapper().dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(20);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });

    // Measuring samples the whole row set, including its last row.
    expect(renderCell).toHaveBeenCalledWith(rows[rows.length - 1]);
  });

  it('grows the scroll height when a rendered row grows taller', async () => {
    const rows = createRows(50);
    let measuredHeight = 60;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    track(vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')).mockImplementation(function (
      this: HTMLElement
    ) {
      return this.classList.contains('gridtable-row')
        ? DOMRect.fromRect({ width: 320, height: measuredHeight })
        : originalRect.call(this);
    });
    const virtualHeight = () =>
      Number.parseFloat(
        requireValue(
          container.querySelector<HTMLElement>('.gridtable-virtual-body'),
          'virtual body'
        ).style.height
      );

    await renderGridTable({ data: rows });
    await app.settle();
    const initialHeight = virtualHeight();
    // Rendered rows measure 60px; the rest use the 40px estimate.
    expect(initialHeight).toBeGreaterThan(rows.length * 40);

    measuredHeight = 140;
    await rerender({ data: [{ ...rows[0], label: 'Row 0 updated' }, ...rows.slice(1)] });
    await app.settle();

    expect(virtualHeight()).toBeGreaterThan(initialHeight);
  });
});

describe('GridTable states', () => {
  it('shows the loading state, not an empty table, while the first rows load', async () => {
    await renderGridTable({ data: [], loading: true, virtualization: { enabled: false } });

    expect(container.textContent).toContain('Loading resources');
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows the view’s empty message when there are no rows', async () => {
    await renderGridTable({
      data: [],
      virtualization: { enabled: false },
      emptyMessage: 'Nothing to see here',
    });

    expect(container.textContent).toContain('Nothing to see here');
  });

  it('shows a filtered-empty state whose Clear filters brings the rows back', async () => {
    await renderGridTable({
      data: createRows(5),
      virtualization: { enabled: false },
      emptyMessage: 'No rows available',
      filters: { enabled: true, initial: { search: 'does-not-match' } },
    });

    expect(renderedRows()).toEqual([]);
    expect(container.textContent).toContain('No matching items');
    expect(container.textContent).not.toContain('No rows available');

    const clear = requireValue(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent === 'Clear filters'
      ),
      'Clear filters'
    );
    await click(clear);
    expect(renderedRows()).toHaveLength(5);
  });

  it('marks the table busy with a status overlay while it refreshes', async () => {
    await renderGridTable({
      data: createRows(5),
      virtualization: { enabled: false },
      loading: true,
      loadingOverlay: { show: true, message: 'Syncing…' },
    });

    expect(tableBody().getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Syncing…');
    expect(renderedRows()).toHaveLength(5);
  });

  it('warns in development about row keys that are not cluster-scoped', async () => {
    const warn = track(vi.spyOn(console, 'warn')).mockImplementation(() => undefined);
    const clusterKeyWarnings = () =>
      warn.mock.calls.filter(
        ([message]) => typeof message === 'string' && message.includes('cluster-scoped')
      );

    await renderGridTable({ data: createRows(1), virtualization: { enabled: false } });
    expect(clusterKeyWarnings()).toHaveLength(0);

    await rerender({ keyExtractor: (item) => item.id });
    expect(clusterKeyWarnings()).toHaveLength(1);
  });
});

describe('GridTable pointer interaction', () => {
  it('focuses a row on a pointer click without opening it', async () => {
    const onRowClick = vi.fn();
    await renderGridTable({ virtualization: { enabled: false }, onRowClick });

    await click(requireValue(container.querySelectorAll('.gridtable-row')[2], 'third row'));

    expect(onRowClick).not.toHaveBeenCalled();
    expect(focusedRows()).toEqual(['row-2']);
  });

  it('clears the row selection only when unused body space is clicked', async () => {
    const onRowSelectionClear = vi.fn();
    await renderGridTable({
      data: createRows(1),
      virtualization: { enabled: false },
      onRowSelectionClear,
    });

    await click(requireValue(container.querySelector('.gridtable-row'), 'row'));
    expect(onRowSelectionClear).not.toHaveBeenCalled();
    expect(focusedRows()).toEqual(['row-0']);

    await click(scrollWrapper());
    expect(onRowSelectionClear).toHaveBeenCalledTimes(1);
    expect(focusedRows()).toEqual([]);
  });

  it('leaves the row alone when a control inside it is clicked', async () => {
    const onRowClick = vi.fn();
    await renderGridTable({
      columns: [
        {
          key: 'toggle',
          header: 'Toggle',
          render: (row) => (
            <button type="button" className="toggle-button">
              <span className="toggle-icon" data-row={row.id}>
                ⇵
              </span>
            </button>
          ),
        },
      ],
      virtualization: { enabled: false },
      onRowClick,
    });

    await act(async () => {
      requireValue(container.querySelector('.toggle-icon'), 'toggle icon').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });

    expect(onRowClick).not.toHaveBeenCalled();
    expect(focusedRows()).toEqual([]);
  });

  it('runs a cell link’s action and focuses its row', async () => {
    const onRowClick = vi.fn();
    const cellClick = vi.fn();
    await renderGridTable({
      columns: [
        createTextColumn<SimpleRow>('name', 'Name', (row) => row.name, { onClick: cellClick }),
      ],
      virtualization: { enabled: false },
      onRowClick,
    });

    await click(requireValue(container.querySelector('.gridtable-link'), 'cell link'));

    expect(cellClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(focusedRows()).toEqual(['row-0']);
  });

  it('shows the focused row’s hover highlight when the table gets keyboard focus', async () => {
    await renderGridTable({ data: createRows(4), virtualization: { enabled: false } });

    await act(async () => tableBody().focus());

    expect(focusedRows()).toEqual(['row-0']);
    expect(
      container.querySelector('.gridtable-hover-overlay')?.classList.contains('is-visible')
    ).toBe(true);
  });
});

describe('GridTable row menus', () => {
  it('builds the cell menu for the targeted row and column', async () => {
    const customItems = vi.fn((item: SimpleRow, columnKey: string) => [
      { label: `Inspect ${item.label}`, onClick: vi.fn(), id: `${columnKey}-inspect` },
    ]);
    await renderGridTable({
      data: createRows(2),
      virtualization: { enabled: false },
      enableContextMenu: true,
      getCustomContextMenuItems: customItems,
    });

    await act(async () => {
      requireValue(
        container.querySelectorAll('.gridtable-row .grid-cell[data-column="label"]')[1],
        'second row cell'
      ).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }));
    });

    expect(customItems).toHaveBeenCalledWith(expect.objectContaining({ id: 'row-1' }), 'label');
    expect(document.body.querySelector('[role="menu"]')?.textContent).toContain('Inspect Row 1');
  });

  it('closes the row menu on a pointer click elsewhere and keeps the table’s row focus', async () => {
    await renderGridTable({
      virtualization: { enabled: false },
      enableContextMenu: true,
      getCustomContextMenuItems: () => [{ label: 'Action', onClick: () => undefined }],
    });
    await act(async () => tableBody().focus());
    await act(async () => {
      requireValue(container.querySelector('.grid-cell'), 'cell').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 50, clientY: 50 })
      );
    });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      scrollWrapper().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await act(async () => tableBody().focus());

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(focusedRows()).toHaveLength(1);
  });

  it('leaves the native menu alone on empty table space when it has no items there', async () => {
    const customItems = vi.fn(() => [{ label: 'Refresh', onClick: vi.fn() }]);
    await renderGridTable({
      data: createRows(2),
      virtualization: { enabled: false },
      enableContextMenu: true,
      getCustomContextMenuItems: customItems,
    });

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50,
    });
    await act(async () => {
      scrollWrapper().dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(customItems).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('GridTable filtering and pagination', () => {
  it('searches the full local row set and counts the matches', async () => {
    await renderGridTable({
      data: createRows(8),
      virtualization: { enabled: false },
      filters: { enabled: true, initial: { search: 'Row 7' } },
    });

    expect(renderedRows()).toEqual(['Row 7']);
    expect(resultCount()).toBe('Showing 1 of 8 items');
  });

  it('counts a backend query window by the backend’s total', async () => {
    await renderGridTable({
      data: createRows(8),
      virtualization: { enabled: false },
      filters: {
        enabled: true,
        // The result count shows only with a narrowing filter; this search
        // matches the whole page of 8 rows of a backend total of 20.
        initial: { search: 'Row' },
        options: { searchBehavior: 'query', totalCount: 20, totalIsExact: true },
      },
    });

    expect(renderedRows()).toHaveLength(8);
    expect(resultCount()).toBe('Showing 20 of 20 items');
  });

  it('filters rows by the selected kinds', async () => {
    await renderGridTable({
      data: [
        { id: 'a1', label: 'Alpha' },
        { id: 'a2', label: 'Alpha Prime' },
        { id: 'b1', label: 'Beta' },
      ],
      virtualization: { enabled: false },
      filters: {
        enabled: true,
        initial: { kinds: { mode: 'some', values: ['Alpha'] } },
        accessors: { getKind: (row) => (row.label.startsWith('Alpha') ? 'Alpha' : 'Beta') },
      },
    });

    expect(renderedRows()).toEqual(['Alpha', 'Alpha Prime']);
  });

  it('narrows controlled filters as the user types and clears them all', async () => {
    const onChange = vi.fn();
    function FilteredTable() {
      const [filters, setFilters] = useState(NO_FILTERS);
      return (
        <GridTable<SimpleRow>
          data={createRows(30)}
          columns={defaultColumns}
          keyExtractor={(item) => `cluster-a|${item.id}`}
          virtualization={{ enabled: false }}
          filters={{
            enabled: true,
            value: filters,
            onChange: (next) => {
              onChange(next);
              setFilters(next);
            },
          }}
        />
      );
    }
    await view.show(<FilteredTable />);
    const search = requireValue(
      container.querySelector<HTMLInputElement>('[data-gridtable-filter-role="search"] input'),
      'search box'
    );

    await act(async () => {
      search.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        'Row 1'
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await app.settle();
    expect(renderedRows()).toEqual(
      createRows(30)
        .filter((row) => row.label.includes('Row 1'))
        .map((row) => row.label)
    );

    await click(bodyButton('Clear all filters'));
    await app.settle();
    expect(onChange).toHaveBeenLastCalledWith(NO_FILTERS);
    expect(renderedRows()).toHaveLength(30);
  });

  it('paginates a local row set after filtering and moves between pages', async () => {
    await renderGridTable({
      data: createRows(5),
      virtualization: { enabled: false },
      localPagination: {
        idPrefix: 'local-table',
        pageSize: 2,
        pageSizeOptions: [2, 3],
        onPageSizeChange: vi.fn(),
      },
    });
    const footer = () => container.querySelector('.gridtable-pagination')?.textContent;

    expect(renderedRows()).toEqual(['Row 0', 'Row 1']);
    expect(footer()).toContain('1-2 of 5');

    await click(bodyButton('Next page'));

    expect(renderedRows()).toEqual(['Row 2', 'Row 3']);
    expect(footer()).toContain('3-4 of 5');
  });

  it('clamps the local page when the row set shrinks and keeps it when the rows return', async () => {
    await renderGridTable({
      data: createRows(6),
      virtualization: { enabled: false },
      localPagination: {
        idPrefix: 'local-shrinking-table',
        pageSize: 2,
        pageSizeOptions: [2, 3],
        onPageSizeChange: vi.fn(),
      },
    });
    const footer = () => container.querySelector('.gridtable-pagination')?.textContent;
    await click(bodyButton('Next page'));
    await click(bodyButton('Next page'));
    expect(footer()).toContain('5-6 of 6');

    await rerender({ data: createRows(3) });
    expect(renderedRows()).toEqual(['Row 2']);
    expect(footer()).toContain('3-3 of 3');

    await rerender({ data: createRows(6) });
    expect(renderedRows()).toEqual(['Row 2', 'Row 3']);
    expect(footer()).toContain('3-4 of 6');
  });

  it('returns local pagination to the first page after a filter is applied and removed', async () => {
    const pagination = {
      idPrefix: 'local-filtered-table',
      pageSize: 2,
      pageSizeOptions: [2, 3],
      onPageSizeChange: vi.fn(),
    };
    const filters = (search: string) => ({
      enabled: true,
      value: { ...NO_FILTERS, search },
      onChange: vi.fn(),
    });
    await renderGridTable({
      data: createRows(6),
      filters: filters(''),
      virtualization: { enabled: false },
      localPagination: pagination,
    });
    const footer = () => container.querySelector('.gridtable-pagination')?.textContent;
    await click(bodyButton('Next page'));
    await click(bodyButton('Next page'));
    expect(footer()).toContain('5-6 of 6');

    await rerender({ filters: filters('Row 0') });
    expect(renderedRows()).toEqual(['Row 0']);
    expect(container.querySelector('.gridtable-pagination')).toBeNull();

    await rerender({ filters: filters('') });
    expect(renderedRows()).toEqual(['Row 0', 'Row 1']);
    expect(footer()).toContain('1-2 of 6');
  });
});

describe('GridTable Download', () => {
  it('offers Copy to Clipboard and Save to File from one Download button', async () => {
    await renderGridTable({
      data: createRows(3),
      virtualization: { enabled: false },
      fetchAllRows: () => Promise.resolve(createRows(9)),
      exportFilename: 'rows',
      filters: { enabled: true },
    });

    const download = requireValue(
      container.querySelector<HTMLButtonElement>('[aria-label="Download all matching rows"]'),
      'expected the Download button'
    );
    expect(download.getAttribute('aria-haspopup')).toBe('menu');
    await click(download);

    expect(
      Array.from(document.body.querySelectorAll('[role="menuitem"]'), (item) => item.textContent)
    ).toEqual(['Copy to Clipboard', 'Save to File']);
  });

  // The Download button names its scope: a complete local table holds every matching
  // row even without paging, while a partial window holds only what it shows.
  it('names the Download scope from whether the table holds every matching row', async () => {
    const downloadLabel = () =>
      container.querySelector('.icon-bar-button[aria-haspopup="menu"]')?.getAttribute('aria-label');

    await renderGridTable({
      data: createRows(3),
      virtualization: { enabled: false },
      filters: { enabled: true },
    });
    expect(downloadLabel()).toBe('Download all matching rows');

    await rerender({
      filters: {
        enabled: true,
        options: { partialDataLabel: 'This table is showing a bounded or recent local window.' },
      },
    });
    expect(downloadLabel()).toBe('Download visible rows');
  });

  it('copies every matching row the view fetches, not just the visible page', async () => {
    const fetchAllRows = vi.fn().mockResolvedValue(createRows(9));
    await renderGridTable({
      data: createRows(3),
      virtualization: { enabled: false },
      fetchAllRows,
      filters: { enabled: true },
    });

    await chooseDownload('Download all matching rows', 'Copy to Clipboard');

    expect(fetchAllRows).toHaveBeenCalledTimes(1);
    expect(copiedText()).toEqual([['Label', ...createRows(9).map((row) => row.label)].join('\n')]);
  });

  it('copies only the local rows that match the active search', async () => {
    await renderGridTable({
      data: createRows(12),
      virtualization: { enabled: false },
      filters: { enabled: true, initial: { search: 'Row 1' } },
    });

    await chooseDownload('Download all matching rows', 'Copy to Clipboard');

    expect(copiedText()).toEqual(['Label\nRow 1\nRow 10\nRow 11']);
  });

  it('copies every filtered local row when only one local page is rendered', async () => {
    await renderGridTable({
      data: createRows(5),
      virtualization: { enabled: false },
      filters: { enabled: true },
      localPagination: {
        idPrefix: 'local-copy-table',
        pageSize: 2,
        pageSizeOptions: [2, 3],
        onPageSizeChange: vi.fn(),
      },
    });
    expect(renderedRows()).toHaveLength(2);

    await chooseDownload('Download all matching rows', 'Copy to Clipboard');

    expect(copiedText()).toEqual(['Label\nRow 0\nRow 1\nRow 2\nRow 3\nRow 4']);
  });

  it('copies the visible columns as escaped CSV', async () => {
    type NoteRow = SimpleRow & { notes: string; secret: string };
    const columns: GridColumnDefinition<NoteRow>[] = [
      { key: 'label', header: 'Label', render: (row) => row.label },
      { key: 'notes', header: 'Notes', render: (row) => row.notes },
      { key: 'secret', header: 'Secret', render: (row) => row.secret },
    ];
    const rows: NoteRow[] = [
      { id: 'row-0', label: 'Alpha,One', notes: 'He said "hi"', secret: 'omit me' },
      { id: 'row-1', label: 'Beta', notes: 'Line\nBreak', secret: 'omit me too' },
    ];
    await renderGridTable({
      data: rows,
      columns: columns as GridColumnDefinition<SimpleRow>[],
      virtualization: { enabled: false },
      filters: { enabled: true },
      columnVisibility: { secret: false },
    });

    await chooseDownload('Download all matching rows', 'Copy to Clipboard');

    expect(copiedText()).toEqual(['Label,Notes\n"Alpha,One","He said ""hi"""\nBeta,"Line\nBreak"']);
  });

  it('copies resource-bar columns as plain millicores and KiB under unit headers', async () => {
    type ResourceRow = SimpleRow & { cpu: number; memory: number };
    const columns: GridColumnDefinition<ResourceRow>[] = [
      { key: 'label', header: 'Label', render: (row) => row.label },
      createResourceBarColumn<ResourceRow>({
        key: 'cpu',
        header: 'CPU',
        type: 'cpu',
        getUsage: (row) => row.cpu,
      }),
      createResourceBarColumn<ResourceRow>({
        key: 'memory',
        header: 'Memory',
        type: 'memory',
        getUsage: (row) => row.memory,
      }),
    ];
    const rows: ResourceRow[] = [
      { id: 'row-0', label: 'Alpha', cpu: 250, memory: 512 * 1024 * 1024 },
      { id: 'row-1', label: 'Beta', cpu: 1000, memory: 2 * 1024 * 1024 * 1024 },
    ];
    await renderGridTable({
      data: rows,
      columns: columns as GridColumnDefinition<SimpleRow>[],
      virtualization: { enabled: false },
      filters: { enabled: true },
    });

    await chooseDownload('Download all matching rows', 'Copy to Clipboard');

    expect(copiedText()).toEqual([
      'Label,CPU (m),Memory (KiB)\nAlpha,250,524288\nBeta,1000,2097152',
    ]);
  });
});

describe('GridTable headers', () => {
  const sortableColumns: GridColumnDefinition<SimpleRow>[] = [
    { key: 'label', header: 'Label', sortable: true, render: (row) => row.label },
    { key: 'name', header: 'Name', sortable: true, render: (row) => row.name ?? '' },
  ];

  it('sorts by a sortable header when it is clicked', async () => {
    const onSort = vi.fn();
    await renderGridTable({
      data: createRows(3),
      columns: sortableColumns,
      virtualization: { enabled: false },
      onSort,
    });

    await click(
      requireValue(
        container.querySelector('th[data-column="label"] .header-content button'),
        'Label sort button'
      )
    );

    expect(onSort).toHaveBeenCalledWith('label');
  });

  it('uses native table semantics and marks the sorted column', async () => {
    await renderGridTable({
      data: createRows(3),
      columns: sortableColumns,
      virtualization: { enabled: false },
      sortConfig: { key: 'label', direction: 'asc' },
      onSort: vi.fn(),
    });

    expect(container.querySelectorAll('thead th')).toHaveLength(2);
    expect(container.querySelectorAll('table[tabindex="0"] > tbody > tr')).toHaveLength(3);
    expect(container.querySelectorAll('tbody td')).toHaveLength(6);
    expect(container.querySelector('th[data-column="label"]')?.getAttribute('aria-sort')).toBe(
      'ascending'
    );
    expect(container.querySelector('th[data-column="name"]')?.getAttribute('aria-sort')).toBe(
      'none'
    );
  });

  it.each([
    { name: 'without a Columns menu', props: {} },
    {
      name: 'with a read-only column order',
      props: {
        columnOrder: ['label', 'name'],
        filters: { enabled: true },
        enableColumnVisibilityMenu: true,
      },
    },
  ])('offers no header reordering $name', async ({ props }) => {
    await renderGridTable({
      data: createRows(1),
      columns: sortableColumns,
      virtualization: { enabled: false },
      ...props,
    });

    expect(
      Array.from(container.querySelectorAll<HTMLElement>('th')).some((header) => header.draggable)
    ).toBe(false);
  });

  it('reorders visible columns by dragging a header across the same insertion boundary as tabs', async () => {
    const columns: GridColumnDefinition<SimpleRow>[] = [
      { key: 'label', header: 'Label', render: (row) => row.label },
      { key: 'name', header: 'Name', render: (row) => row.name ?? '' },
      { key: 'id', header: 'ID', render: (row) => row.id },
    ];
    function ReorderableTable() {
      const [columnOrder, setColumnOrder] = useState(['label', 'name', 'id']);
      return (
        <GridTable<SimpleRow>
          data={[{ id: 'row-1', label: 'Example', name: 'demo' }]}
          columns={columns}
          columnOrder={columnOrder}
          onColumnOrderChange={setColumnOrder}
          filters={{ enabled: true }}
          enableColumnVisibilityMenu
          keyExtractor={(item) => `cluster|${item.id}`}
          virtualization={{ enabled: false }}
        />
      );
    }
    await view.show(<ReorderableTable />);
    const header = (key: string) =>
      requireValue(container.querySelector<HTMLElement>(`th[data-column="${key}"]`), key);
    header('id').getBoundingClientRect = () => DOMRect.fromRect({ x: 200, width: 100 });
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      types: [] as string[],
      setData: vi.fn((type: string) => {
        dataTransfer.types = [type];
      }),
      getData: vi.fn(() => 'label'),
    };
    const drag = async (type: string, target: HTMLElement, clientX?: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      if (clientX !== undefined) {
        Object.defineProperty(event, 'clientX', { value: clientX });
      }
      await act(async () => {
        target.dispatchEvent(event);
      });
      return event;
    };

    expect(header('label').draggable).toBe(true);
    await drag('dragstart', header('label'));
    expect(dataTransfer.effectAllowed).toBe('move');
    const over = await drag('dragover', header('id'), 275);
    expect(over.defaultPrevented).toBe(true);
    expect(header('id').dataset.dropPosition).toBe('after');
    await drag('drop', header('id'), 275);

    const order = (selector: string) =>
      Array.from(container.querySelectorAll<HTMLElement>(selector), (cell) => cell.dataset.column);
    expect(order('th[data-column]')).toEqual(['name', 'id', 'label']);
    expect(order('tbody > .gridtable-row:first-child > td[data-column]')).toEqual([
      'name',
      'id',
      'label',
    ]);
  });
});

describe('GridTable Columns menu', () => {
  const ownerLabelRow = (id: string): SimpleRow => ({
    id,
    label: `Row ${id}`,
    metadata: { labels: { 'example.com/owner': 'platform' } },
  });
  const owner = createCustomMetadataColumnDefinition({
    source: 'label',
    metadataKey: 'example.com/owner',
    header: 'Owner',
  });

  it('names the Columns button by the hidden-column count and opens the menu from it', async () => {
    await renderGridTable({
      data: createRows(2),
      columns: [
        { key: 'label', header: 'Label', render: (row) => row.label },
        { key: 'name', header: 'Name', render: (row) => row.name ?? '' },
      ],
      filters: { enabled: true },
      enableColumnVisibilityMenu: true,
      virtualization: { enabled: false },
      columnVisibility: { name: false },
    });

    expect(columnsButton().getAttribute('aria-label')).toBe('Columns (1 hidden)');
    await click(columnsButton());

    expect(
      document.body.querySelector('[aria-label="Columns"].dropdown-columns-menu')
    ).not.toBeNull();
  });

  it('shows a configured metadata column’s value per row', async () => {
    await renderGridTable({
      data: [ownerLabelRow('1'), { id: '2', label: 'Row 2' }],
      columns: [{ key: 'label', header: 'Label', render: (row) => row.label }],
      virtualization: { enabled: false },
      customMetadataColumns: { definitions: [owner], onChange: vi.fn() },
    });

    expect(container.querySelector('thead')?.textContent).toContain('Owner');
    expect(renderedRows()).toEqual(['Row 1platform', 'Row 2-']);
  });

  it('does not read row metadata until the custom-column editor opens', async () => {
    let metadataReads = 0;
    const row: SimpleRow = { id: 'row-1', label: 'Row 1' };
    Object.defineProperty(row, 'metadata', {
      configurable: true,
      get: () => {
        metadataReads += 1;
        return { labels: { 'example.com/owner': 'platform' } };
      },
    });
    await renderGridTable({
      data: [row],
      filters: { enabled: true },
      enableColumnVisibilityMenu: true,
      virtualization: { enabled: false },
      customMetadataColumns: { definitions: [], onChange: vi.fn() },
    });

    expect(metadataReads).toBe(0);
    await click(columnsButton());
    expect(metadataReads).toBe(0);

    await click(bodyButton('Add Custom Column'));
    expect(metadataReads).toBeGreaterThan(0);
  });

  it('creates a custom metadata column from a label the rows carry', async () => {
    const onChange = vi.fn();
    await renderGridTable({
      data: [ownerLabelRow('1'), { id: '2', label: 'Row 2' }],
      filters: { enabled: true },
      enableColumnVisibilityMenu: true,
      virtualization: { enabled: false },
      customMetadataColumns: { definitions: [], onChange },
    });

    await click(columnsButton());
    await click(bodyButton('Add Custom Column'));
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('dialog[aria-label="Columns"]')).toBeNull();
    await click(bodyButton('Metadata Key'));
    await click(
      requireValue(
        Array.from(document.body.querySelectorAll<HTMLElement>('.dropdown-option')).find((option) =>
          option.textContent?.includes('example.com/owner')
        ),
        'expected metadata key option'
      )
    );
    await click(
      requireValue(
        document.body.querySelector('.custom-metadata-column-editor button[type="submit"]'),
        'Add'
      )
    );

    expect(onChange).toHaveBeenCalledWith([
      {
        key: 'metadata:label:example.com/owner',
        source: 'label',
        metadataKey: 'example.com/owner',
        header: 'Owner',
      },
    ]);
  });

  it('deletes a custom metadata column directly from the Columns menu', async () => {
    const onChange = vi.fn();
    await renderGridTable({
      data: [ownerLabelRow('1')],
      filters: { enabled: true },
      enableColumnVisibilityMenu: true,
      virtualization: { enabled: false },
      customMetadataColumns: { definitions: [owner], onChange },
    });

    await click(columnsButton());
    await click(bodyButton('Delete Owner'));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('returns auto-width columns to automatic sizing from the Columns reset action', async () => {
    const onColumnWidthsChange = vi.fn();
    const userWidth = (width: number) => ({
      width,
      unit: 'px' as const,
      autoWidth: false,
      source: 'user' as const,
      updatedAt: 1,
    });
    await renderGridTable({
      data: createRows(3),
      columns: [
        { key: 'label', header: 'Label', autoWidth: true, render: (row) => row.label },
        { key: 'name', header: 'Name', render: (row) => row.name ?? '' },
      ],
      filters: { enabled: true },
      enableColumnVisibilityMenu: true,
      enableColumnResizing: true,
      virtualization: { enabled: false },
      columnWidths: { label: userWidth(300), name: userWidth(220) },
      onColumnWidthsChange,
    });

    await click(columnsButton());
    expect(bodyButton('Reset columns').disabled).toBe(false);
    onColumnWidthsChange.mockClear();
    await click(bodyButton('Reset columns'));

    expect(onColumnWidthsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        label: expect.objectContaining({ autoWidth: true, source: 'auto' }),
        name: expect.objectContaining({ autoWidth: false, source: 'user' }),
      })
    );
  });
});

describe('GridTable column resizing', () => {
  it('reports a resized width once, when the drag ends', async () => {
    const onColumnWidthsChange = vi.fn();
    await renderGridTable({
      data: createRows(3),
      columns: [
        { key: 'label', header: 'Label', render: (row) => row.label },
        { key: 'name', header: 'Name', render: (row) => row.name ?? '' },
      ],
      enableColumnResizing: true,
      virtualization: { enabled: false },
      onColumnWidthsChange,
    });
    // Column widths settle on the first frame, before the user can drag.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    onColumnWidthsChange.mockClear();
    const handle = requireValue(
      container.querySelector<HTMLElement>('.resize-handle'),
      'resize handle'
    );

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 140 }));
      // The dragged width applies on the next frame.
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(onColumnWidthsChange).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(onColumnWidthsChange).toHaveBeenCalledTimes(1);
  });
});
