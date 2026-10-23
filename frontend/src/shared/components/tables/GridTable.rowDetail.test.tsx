/**
 * frontend/src/shared/components/tables/GridTable.rowDetail.test.tsx
 *
 * Row detail: each open row shows a full-width detail (for example a nested
 * table) directly under it. The nested content owns its own focus and keys,
 * one highlight moves through parent and nested rows in screen order, and a
 * virtualized table positions rows below each open detail at any page zoom.
 * Runs the real GridTable inside the production shell (keyboard, zoom, and
 * dockable layout owners) with only the backend boundary faked
 * (test-utils/appState); the page zoom is the level the backend has saved.
 */

import { AppRegionNavigation } from '@ui/layout/AppRegionNavigation';
import { act, type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { isMacPlatform } from '@/utils/platform';
import GridTable from './GridTable';
import type { GridColumnDefinition, GridTableRowDetail } from './GridTable.types';
import { getGridTableRowDetailId } from './GridTable.utils';
import { withRowDetailToggle } from './rowDetailToggle';

const app = installAppStateHarness();

interface Row {
  id: string;
  name: string;
}

const parentRows: Row[] = ['a', 'b', 'c'].map((id) => ({ id: `cluster-a|${id}`, name: id }));
const nestedRows: Row[] = ['x', 'y'].map((id) => ({ id: `cluster-a|pod-${id}`, name: id }));
const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row: Row) => row.name },
];
const keyOf = (row: Row) => row.id;
type SelectionProps = {
  isRowSelected: (row: Row) => boolean;
  onRowPointerClick: (row: Row) => void;
  onRowSelectionClear?: () => void;
};

const NestedTable = ({ onClose }: { onClose?: () => void }) => (
  <GridTable
    data={nestedRows}
    columns={columns}
    keyExtractor={keyOf}
    tableClassName="nested"
    filters={
      onClose && {
        enabled: true,
        options: {
          trailingActions: [
            {
              type: 'action',
              id: 'close',
              icon: <span>×</span>,
              title: 'Close pods',
              onClick: onClose,
            },
          ],
        },
      }
    }
  />
);

const detailFor = (
  openRowKeys: readonly string[],
  onClose?: () => void
): GridTableRowDetail<Row> => ({
  openRowKeys,
  render: () => <NestedTable onClose={onClose} />,
  getLabel: (row) => `Pods for ${row.name}`,
});

describe('GridTable row detail', () => {
  let view: MountedApp | null = null;
  let container: HTMLElement;
  let restoreGeometry: () => void = () => undefined;

  // Starts the shell; the page zoom loads from the level the backend has saved.
  const start = async (savedZoom = 100): Promise<MountedApp> => {
    app.backend.answer('GetZoomLevel', () => savedZoom);
    const started = await app.render(null);
    view = started;
    container = started.container;
    return started;
  };

  beforeEach(() => {
    view = null;
  });

  afterEach(() => {
    restoreGeometry();
    restoreGeometry = () => undefined;
  });

  // The parent table shows 100px of 1000px of rows, and a detail that opens
  // spans 150-210px: below the view until the table scrolls 110px down.
  const parentWrapper = () =>
    requireValue(container.querySelector<HTMLElement>('.gridtable-wrapper'), 'parent wrapper');
  const scrollableParent = () => {
    const wrapper = parentWrapper();
    Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(wrapper, 'scrollTop', { configurable: true, value: 0, writable: true });
    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        return this.matches('[data-gridtable-row-detail]')
          ? DOMRect.fromRect({ y: 150, width: 400, height: 60 })
          : DOMRect.fromRect();
      });
    restoreGeometry = () => rectSpy.mockRestore();
    return wrapper;
  };

  const renderTable = async (
    detail: GridTableRowDetail<Row>,
    data: Row[] = parentRows,
    virtualization = { enabled: false },
    parentColumns = columns,
    onRowPointerClick?: (row: Row) => void,
    onRowExpandToggle?: (row: Row) => void
  ) => {
    const shell = view ?? (await start());
    await shell.show(
      <main data-app-region="content">
        <GridTable
          data={data}
          columns={parentColumns}
          keyExtractor={keyOf}
          tableClassName="parent"
          rowDetail={detail}
          virtualization={virtualization}
          onRowPointerClick={onRowPointerClick}
          onRowExpandToggle={onRowExpandToggle}
        />
      </main>
    );
  };

  const parentRow = (name: string) =>
    requireValue(
      container.querySelector<HTMLElement>(`.parent [data-row-key="cluster-a|${name}"]`),
      `parent row ${name}`
    );
  const press = (key: string) =>
    act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
    });

  it('shows the open row detail directly under its row as a labelled region and scrolls it into view once', async () => {
    await renderTable(detailFor([]));
    const wrapper = scrollableParent();
    await renderTable(detailFor(['cluster-a|b']));

    const detailRow = parentRow('b').nextElementSibling;
    expect(detailRow?.matches('[data-gridtable-row-detail]')).toBe(true);
    const region = requireValue(
      // A labelled <section> is a region landmark.
      detailRow?.querySelector<HTMLElement>('section[aria-label]'),
      'detail region'
    );
    expect(region.getAttribute('aria-label')).toBe('Pods for b');
    // The opening control points at this id through aria-controls.
    expect(region.id).toBe(getGridTableRowDetailId('cluster-a|b'));
    expect(region.querySelectorAll('.nested [data-row-key]')).toHaveLength(2);
    expect(wrapper.scrollTop).toBe(110);

    // A parent refresh leaves where the user scrolled to alone.
    wrapper.scrollTop = 0;
    await renderTable(
      detailFor(['cluster-a|b']),
      parentRows.map((row) => ({ ...row }))
    );
    expect(wrapper.scrollTop).toBe(0);

    await renderTable(detailFor([]));
    expect(container.querySelector('[data-gridtable-row-detail]')).toBeNull();
  });

  it('shows a detail under every open row and keeps each nested table when another opens or closes', async () => {
    const detailUnder = (name: string) => parentRow(name).nextElementSibling;
    await renderTable(detailFor([]));
    const wrapper = scrollableParent();
    await renderTable(detailFor(['cluster-a|b']));
    const nestedUnderB = detailUnder('b')?.querySelector('.nested');
    expect(nestedUnderB).not.toBeNull();

    wrapper.scrollTop = 0;
    await renderTable(detailFor(['cluster-a|b', 'cluster-a|a']));

    expect(detailUnder('a')?.matches('[data-gridtable-row-detail]')).toBe(true);
    expect(detailUnder('a')?.querySelector('section')?.id).toBe(
      getGridTableRowDetailId('cluster-a|a')
    );
    // Opening another row does not rebuild the nested table already open.
    expect(detailUnder('b')?.querySelector('.nested')).toBe(nestedUnderB);
    // Each detail scrolls into view once, when it opens.
    expect(wrapper.scrollTop).toBe(110);

    wrapper.scrollTop = 0;
    await renderTable(detailFor(['cluster-a|a']));
    expect(detailUnder('b')?.matches('[data-gridtable-row-detail]')).toBe(false);
    expect(detailUnder('a')?.matches('[data-gridtable-row-detail]')).toBe(true);
    expect(wrapper.scrollTop).toBe(0);
  });

  // The same pod can be listed under two open rows (a CronJob and its Job); the
  // page must still carry each DOM id once, so id references stay unambiguous.
  it('keeps DOM ids unique when open details list the same rows', async () => {
    await renderTable(detailFor(['cluster-a|a', 'cluster-a|b']));

    const ids = Array.from(container.querySelectorAll('[id]'), (element) => element.id);
    expect(container.querySelectorAll('[data-gridtable-row-detail]')).toHaveLength(2);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it('returns Escape from one of several open details to the row it belongs to', async () => {
    await renderTable(detailFor(['cluster-a|a', 'cluster-a|c']));
    const nestedUnderC = requireValue(
      parentRow('c').nextElementSibling?.querySelector<HTMLElement>('table[tabindex="0"]'),
      'nested table under c'
    );

    await act(async () => nestedUnderC.focus());
    await press('Escape');

    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>('.parent.gridtable--body')
    );
    expect(parentRow('c').classList.contains('gridtable-row--focused')).toBe(true);
    expect(parentRow('a').classList.contains('gridtable-row--focused')).toBe(false);
  });

  it('treats a click on the count chevron as the toggle, not as a row click', async () => {
    const onToggle = vi.fn();
    const onRowPointerClick = vi.fn();
    const toggleColumns = [
      withRowDetailToggle<Row>(
        { key: 'pods', header: 'Pods', render: () => '2/3' },
        {
          getRowKey: keyOf,
          isOpen: () => false,
          onToggle,
          getLabel: (row) => `Pods for ${row.name}`,
          getText: () => '2/3',
        }
      ),
    ];
    await renderTable(
      detailFor([]),
      parentRows,
      { enabled: false },
      toggleColumns,
      onRowPointerClick
    );
    const chevron = requireValue(
      parentRow('b').querySelector('.gridtable-row-detail-toggle__chevron path'),
      'count chevron'
    );

    await act(async () => {
      chevron.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
      );
    });

    // The same as clicking the count text: the view toggles, and the table does
    // not also run its own row click.
    expect(onToggle).toHaveBeenCalledWith(parentRows[1]);
    expect(onRowPointerClick).not.toHaveBeenCalled();
    expect(parentRow('b').classList.contains('gridtable-row--focused')).toBe(false);
  });

  it('keeps arrow keys inside the nested table and returns to the open row on Escape', async () => {
    await renderTable(detailFor(['cluster-a|b']));
    const nestedTable = requireValue(
      container.querySelector<HTMLElement>('[data-gridtable-row-detail] table[tabindex="0"]'),
      'nested table'
    );

    await act(async () => nestedTable.focus());
    await press('ArrowDown');

    const focusedKeys = () =>
      Array.from(container.querySelectorAll<HTMLElement>('.gridtable-row--focused')).map(
        (row) => row.dataset.rowKey
      );
    // Only the nested table moved; the parent did not take the key as well.
    expect(focusedKeys()).toEqual(['cluster-a|pod-y']);

    await press('Escape');
    const parentTable = requireValue(
      container.querySelector<HTMLElement>('.parent.gridtable--body'),
      'parent table'
    );
    expect(document.activeElement).toBe(parentTable);
    expect(parentRow('b').classList.contains('gridtable-row--focused')).toBe(true);

    // Screen order resumes from that row: Down walks into its table again.
    await press('ArrowDown');
    expect(focusedKeys()).toEqual(['cluster-a|pod-x']);
  });

  it('keeps Space inside a nested table without expandable rows', async () => {
    const onToggle = vi.fn();
    await renderTable(
      detailFor(['cluster-a|b']),
      parentRows,
      { enabled: false },
      columns,
      undefined,
      onToggle
    );
    const nestedTable = requireValue(
      container.querySelector<HTMLElement>('[data-gridtable-row-detail] table[tabindex="0"]'),
      'nested table'
    );
    await act(async () => nestedTable.focus());

    await press(' ');

    // The nested table has nothing to expand, and the parent row stays open.
    expect(onToggle).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[data-gridtable-row-detail]')).toHaveLength(1);
  });

  it("closes from the nested table's own Close and returns the keyboard to the open row", async () => {
    const onClose = vi.fn();
    await renderTable(detailFor(['cluster-a|b'], onClose));
    const close = requireValue(
      container.querySelector<HTMLButtonElement>(
        '[data-gridtable-row-detail] .gridtable-filter-bar button[aria-label="Close pods"]'
      ),
      'nested Close'
    );

    await act(async () => {
      close.focus();
      close.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await renderTable(detailFor([], onClose));

    expect(container.querySelector('[data-gridtable-row-detail]')).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>('.parent.gridtable--body')
    );
    expect(parentRow('b').classList.contains('gridtable-row--focused')).toBe(true);
  });

  it('still starts keyboard row focus in the parent after a click inside the nested table', async () => {
    await renderTable(detailFor(['cluster-a|b']));
    const nestedCell = requireValue(
      container.querySelector<HTMLElement>('[data-gridtable-row-detail] .grid-cell'),
      'nested cell'
    );
    await act(async () => {
      nestedCell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    await act(async () =>
      requireValue(
        container.querySelector<HTMLElement>('.parent.gridtable--body'),
        'parent table'
      ).focus()
    );

    expect(parentRow('a').classList.contains('gridtable-row--focused')).toBe(true);
  });

  // One highlight moves through what is on screen: parent rows and, under an
  // expanded row, its table's rows. Tab and the filter shortcut follow it.
  describe('keyboard with expanded rows', () => {
    // Like the Workloads and Nodes views: a click selects a row, and clearing is
    // offered only while a row is selected.
    const Selectable = ({ children }: { children: (props: SelectionProps) => ReactNode }) => {
      const [selected, setSelected] = useState<string | null>(null);
      return children({
        isRowSelected: (row) => row.id === selected,
        onRowPointerClick: (row) => setSelected(row.id),
        onRowSelectionClear: selected ? () => setSelected(null) : undefined,
      });
    };
    const renderKeyboard = async (openRowKeys: readonly string[], { selectable = false } = {}) => {
      const toggleColumn = withRowDetailToggle<Row>(
        { key: 'pods', header: 'Pods', render: () => '2/2' },
        {
          getRowKey: keyOf,
          isOpen: (row) => openRowKeys.includes(row.id),
          onToggle: () => undefined,
          getLabel: (row, open) => `${open ? 'Hide' : 'Show'} pods for ${row.name}`,
          getText: () => '2/2',
        }
      );
      const shell = await start();
      await shell.show(
        <>
          <AppRegionNavigation />
          <main data-app-region="content">
            <Selectable>
              {(selection) => (
                <GridTable
                  data={parentRows}
                  columns={[...columns, toggleColumn]}
                  keyExtractor={keyOf}
                  tableClassName="parent"
                  onRowClick={() => undefined}
                  filters={{ enabled: true }}
                  rowDetail={detailFor(openRowKeys, () => undefined)}
                  {...(selectable ? selection : {})}
                />
              )}
            </Selectable>
            <button type="button">After table</button>
          </main>
        </>
      );
    };
    const key = (name: string, init: KeyboardEventInit = {}) =>
      act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })
        );
      });
    const mod: KeyboardEventInit = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
    // Every highlighted row: a parent row as its name, a nested row as parent/name.
    const highlighted = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>('.gridtable-row--focused, .gridtable-row--selected')
      ).map((row) => {
        const detail = row.closest('[data-gridtable-row-detail]');
        const name = row.dataset.rowKey?.replace('cluster-a|', '').replace('pod-', '');
        const owner = (detail?.previousElementSibling as HTMLElement | null)?.dataset.rowKey;
        return owner ? `${owner.replace('cluster-a|', '')}/${name}` : (name ?? '');
      });
    // Where the keyboard is: the parent row a detail belongs to, and what is focused.
    const where = () => {
      const active = document.activeElement as HTMLElement;
      const detail = active.closest('[data-gridtable-row-detail]');
      const owner = detail
        ? `${(detail.previousElementSibling as HTMLElement | null)?.dataset.rowKey?.split('|')[1]} table: `
        : '';
      const label = active.matches('.gridtable--body')
        ? 'rows'
        : (active.getAttribute('aria-label') ??
          active.getAttribute('title') ??
          active.getAttribute('placeholder') ??
          active.textContent?.trim());
      return `${owner}${label}`;
    };
    const focusParent = () =>
      act(async () =>
        requireValue(
          container.querySelector<HTMLElement>('.parent.gridtable--body'),
          'parent table'
        ).focus()
      );
    const click = (cell: Element | null | undefined) =>
      act(async () => {
        const target = requireValue(cell, 'cell to click');
        target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 1 }));
        (target as HTMLElement).closest<HTMLElement>('table[tabindex]')?.focus();
        target.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
        );
      });

    it('moves one highlight through the rows in screen order, into and out of an expanded table', async () => {
      await renderKeyboard(['cluster-a|b']);
      await focusParent();
      expect(highlighted()).toEqual(['a']);

      const downs: string[][] = [];
      for (let step = 0; step < 4; step += 1) {
        await key('ArrowDown');
        downs.push(highlighted());
      }
      expect(downs).toEqual([['b'], ['b/x'], ['b/y'], ['c']]);

      const ups: string[][] = [];
      for (let step = 0; step < 3; step += 1) {
        await key('ArrowUp');
        ups.push(highlighted());
      }
      expect(ups).toEqual([['b/y'], ['b/x'], ['b']]);
    });

    it('skips an expanded table with Alt+arrows', async () => {
      await renderKeyboard(['cluster-a|b']);
      await focusParent();
      await key('ArrowDown');

      await key('ArrowDown', { altKey: true });
      expect(highlighted()).toEqual(['c']);
      await key('ArrowUp');
      expect(highlighted()).toEqual(['b/y']);
      // From inside the table, Alt+Up returns to its row and Alt+Down goes past it.
      await key('ArrowUp', { altKey: true });
      expect(highlighted()).toEqual(['b']);
      await key('ArrowDown');
      await key('ArrowDown', { altKey: true });
      expect(highlighted()).toEqual(['c']);
    });

    it('jumps to the first and last row on screen with Home and End', async () => {
      await renderKeyboard(['cluster-a|c']);
      await focusParent();

      await key('End');
      expect(highlighted()).toEqual(['c/y']);
      await key('Home');
      expect(highlighted()).toEqual(['a']);
    });

    it('Tabs from the highlighted row to its buttons and out; Shift+Tab retraces the filter bars above it', async () => {
      await renderKeyboard(['cluster-a|b']);
      await focusParent();
      await key('ArrowDown');

      // On a parent row: its own buttons, then out, never into its expanded table.
      await key('Tab');
      expect(where()).toBe('Hide pods for b');
      await key('Tab');
      expect(where()).toBe('After table');

      // In the expanded table: its rows, then out.
      await focusParent();
      await key('ArrowDown');
      expect(where()).toBe('b table: rows');
      await key('Tab');
      expect(where()).toBe('After table');

      // Shift+Tab walks back up: the table's rows, its own filter bar, then the
      // parent's filter bar, without stopping on the parent rows or row b's buttons.
      const back: string[] = [];
      for (let step = 0; step < 12 && where() !== 'Filter'; step += 1) {
        await key('Tab', { shiftKey: true });
        back.push(where());
      }
      expect(back[0]).toBe('b table: rows');
      expect(back).toContain('b table: Close pods');
      expect(back).toContain('b table: Filter');
      expect(back[back.length - 1]).toBe('Filter');
      expect(back).not.toContain('Hide pods for b');
      expect(back).not.toContain('rows');

      // Tab retraces the same stops forward.
      const forward: string[] = [];
      for (let step = 0; step < back.length - 1; step += 1) {
        await key('Tab');
        forward.push(where());
      }
      expect(forward).toEqual(back.slice(0, -1).reverse());
    });

    it('filters the table the keyboard is in, and Esc in a filter returns to its rows', async () => {
      await renderKeyboard(['cluster-a|b']);
      await focusParent();

      await key('f', mod);
      expect(where()).toBe('Filter');
      await key('Escape');
      expect(where()).toBe('rows');
      expect(highlighted()).toEqual(['a']);

      await key('ArrowDown');
      await key('ArrowDown');
      await key('f', mod);
      expect(where()).toBe('b table: Filter');
      await key('Escape');
      expect(where()).toBe('b table: rows');
      expect(highlighted()).toEqual(['b/x']);
    });

    // WebKit reveals a newly focused table's whole box, including rows clipped
    // by its own scroller, so focusing an expanded table with many rows jumps
    // the parent even when the highlighted row is on screen. The table reveals
    // only the highlighted row itself, so its own focus moves never scroll.
    it('moves the keyboard between tables without letting the browser scroll to reveal a table', async () => {
      await renderKeyboard(['cluster-a|b']);
      await focusParent();
      const focusCalls: Array<FocusOptions | undefined> = [];
      const originalFocus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
        if (this.matches('.gridtable--body')) {
          focusCalls.push(options);
        }
        originalFocus.call(this, options);
      };
      try {
        await key('ArrowDown');
        await key('ArrowDown'); // into b's table
        await key('ArrowUp'); // back out to b
        await key('ArrowDown');
        await key('Escape'); // from b's table to its row
        await key('ArrowDown');
        await key('f', mod);
        await key('Escape'); // from b's table filter to its rows
      } finally {
        HTMLElement.prototype.focus = originalFocus;
      }

      expect(focusCalls.length).toBeGreaterThanOrEqual(4);
      expect(focusCalls.filter((options) => options?.preventScroll !== true)).toEqual([]);
    });

    // The view's selection is a highlight too: entering an expanded table, by
    // click or keyboard, takes the one highlight from it.
    it('clears the parent selection when a click or the keyboard enters an expanded table', async () => {
      await renderKeyboard(['cluster-a|b'], { selectable: true });
      await click(parentRow('a').querySelector('.grid-cell'));
      expect(highlighted()).toEqual(['a']);

      await click(
        parentRow('b').nextElementSibling?.querySelector(
          '[data-row-key="cluster-a|pod-y"] .grid-cell'
        )
      );
      expect(highlighted()).toEqual(['b/y']);
      expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);

      await click(parentRow('b').querySelector('.grid-cell'));
      expect(highlighted()).toEqual(['b']);
      await key('ArrowDown'); // into b's table
      expect(highlighted()).toEqual(['b/x']);
    });

    it('keeps one highlight when the mouse moves it between tables', async () => {
      await renderKeyboard(['cluster-a|b']);
      await focusParent();
      await key('ArrowDown');
      await key('ArrowDown');
      expect(highlighted()).toEqual(['b/x']);

      await click(parentRow('c').querySelector('.grid-cell'));
      expect(highlighted()).toEqual(['c']);
      await click(
        parentRow('b').nextElementSibling?.querySelector(
          '[data-row-key="cluster-a|pod-y"] .grid-cell'
        )
      );
      expect(highlighted()).toEqual(['b/y']);
    });
  });

  describe('when virtualized', () => {
    const heights = new Map([
      ['gridtable-row', 30],
      ['gridtable-row-detail', 200],
    ]);
    let originalRect: typeof Element.prototype.getBoundingClientRect;
    let clientHeight: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const height = Array.from(heights).find(([className]) =>
          this.classList.contains(className)
        )?.[1];
        return height === undefined
          ? originalRect.call(this)
          : ({ top: 0, left: 0, width: 800, height, bottom: height, right: 800 } as DOMRect);
      };
      clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('gridtable-wrapper') ? 400 : 0;
        },
      });
    });

    afterEach(() => {
      Element.prototype.getBoundingClientRect = originalRect;
      if (clientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
      }
    });

    const manyRows = Array.from({ length: 60 }, (_, index) => ({
      id: `cluster-a|row-${index}`,
      name: `row-${index}`,
    }));
    const virtual = { enabled: true, threshold: 1, overscan: 1, estimateRowHeight: 30 };
    const topOf = (element: Element | null) =>
      Number(/translateY\((\d+(?:\.\d+)?)px\)/.exec((element as HTMLElement).style.transform)?.[1]);

    it('places the following rows below the open detail and keeps the open row mounted when scrolled away', async () => {
      await renderTable(detailFor(['cluster-a|row-1']), manyRows, virtual);
      // Re-render once so measured heights reach the virtualizer.
      await renderTable(detailFor(['cluster-a|row-1']), manyRows, virtual);

      const detail = container.querySelector('[data-gridtable-row-detail]');
      expect(topOf(detail)).toBe(60);
      expect(topOf(parentRow('row-2'))).toBe(260);

      const wrapper = requireValue(
        container.querySelector<HTMLElement>('.gridtable-wrapper'),
        'parent wrapper'
      );
      await act(async () => {
        wrapper.scrollTop = 1400;
        wrapper.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      // The open row and its nested table stay mounted, so the nested table keeps its state.
      expect(container.querySelector('.parent [data-row-key="cluster-a|row-1"]')).not.toBeNull();
      expect(container.querySelector('[data-gridtable-row-detail] .nested')).not.toBeNull();
      expect(container.querySelector('.parent [data-row-key="cluster-a|row-5"]')).toBeNull();
    });

    // The app zooms the page: bounding rects come back in zoomed pixels while
    // the virtualizer positions rows in CSS pixels.
    it('positions rows and an open detail by their CSS heights at a page zoom', async () => {
      const open = detailFor(['cluster-a|row-1']);
      heights.set('gridtable-row', 60);
      heights.set('gridtable-row-detail', 400);
      try {
        await start(200);
        await renderTable(open, manyRows, virtual);
        // Re-render once so measured heights reach the virtualizer.
        await renderTable(open, manyRows, virtual);

        // The shell applied the saved 200% zoom.
        expect(
          getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor')
        ).toBe('2');
        expect(topOf(container.querySelector('[data-gridtable-row-detail]'))).toBe(60);
        expect(topOf(parentRow('row-2'))).toBe(260);
      } finally {
        heights.set('gridtable-row', 30);
        heights.set('gridtable-row-detail', 200);
        document.documentElement.style.removeProperty('--app-zoom-factor');
        document.body.style.removeProperty('zoom');
      }
    });

    it('adds every open detail to the row positions and keeps each open row mounted when scrolled away', async () => {
      const open = detailFor(['cluster-a|row-1', 'cluster-a|row-3']);
      await renderTable(open, manyRows, virtual);
      // Re-render once so measured heights reach the virtualizer.
      await renderTable(open, manyRows, virtual);

      const detailUnder = (name: string) => parentRow(name).nextElementSibling;
      expect(topOf(detailUnder('row-1'))).toBe(60);
      expect(topOf(parentRow('row-2'))).toBe(260);
      expect(topOf(parentRow('row-3'))).toBe(290);
      expect(topOf(detailUnder('row-3'))).toBe(320);
      expect(topOf(parentRow('row-4'))).toBe(520);

      const wrapper = requireValue(
        container.querySelector<HTMLElement>('.gridtable-wrapper'),
        'parent wrapper'
      );
      await act(async () => {
        wrapper.scrollTop = 1400;
        wrapper.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      // Both open rows and their nested tables stay mounted, so each keeps its state.
      expect(container.querySelector('.parent [data-row-key="cluster-a|row-1"]')).not.toBeNull();
      expect(container.querySelector('.parent [data-row-key="cluster-a|row-3"]')).not.toBeNull();
      expect(container.querySelectorAll('[data-gridtable-row-detail]')).toHaveLength(2);
      expect(container.querySelector('.parent [data-row-key="cluster-a|row-5"]')).toBeNull();
    });
  });
});
