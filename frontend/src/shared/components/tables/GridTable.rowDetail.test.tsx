/**
 * frontend/src/shared/components/tables/GridTable.rowDetail.test.tsx
 *
 * Row detail: one open row shows a full-width detail (for example a nested
 * table) directly under it. The nested content owns its own focus and keys.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelLayoutTestProvider } from '@/test-utils/PanelLayoutTestProvider';
import { requireValue } from '@/test-utils/requireValue';
import GridTable from './GridTable';
import type { GridTableRowDetail } from './GridTable.types';
import { getGridTableRowDetailId } from './GridTable.utils';

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: () => () => undefined,
}));

interface Row {
  id: string;
  name: string;
}

const parentRows: Row[] = ['a', 'b', 'c'].map((id) => ({ id: `cluster-a|${id}`, name: id }));
const nestedRows: Row[] = ['x', 'y'].map((id) => ({ id: `cluster-a|pod-${id}`, name: id }));
const columns = [{ key: 'name', header: 'Name', render: (row: Row) => row.name }];
const keyOf = (row: Row) => row.id;

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

const detailFor = (openRowKey: string | null, onClose?: () => void): GridTableRowDetail<Row> => ({
  openRowKey,
  render: () => <NestedTable onClose={onClose} />,
  getLabel: (row) => `Pods for ${row.name}`,
});

describe('GridTable row detail', () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderTable = (
    detail: GridTableRowDetail<Row>,
    data: Row[] = parentRows,
    virtualization = { enabled: false }
  ) =>
    act(async () => {
      root.render(
        <PanelLayoutTestProvider>
          <KeyboardProvider>
            <ZoomProvider>
              <main data-app-region="content">
                <GridTable
                  data={data}
                  columns={columns}
                  keyExtractor={keyOf}
                  tableClassName="parent"
                  rowDetail={detail}
                  virtualization={virtualization}
                />
              </main>
            </ZoomProvider>
          </KeyboardProvider>
        </PanelLayoutTestProvider>
      );
    });

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
    await renderTable(detailFor('cluster-a|b'));

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
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // A parent refresh keeps the open detail where it is without scrolling again.
    await renderTable(
      detailFor('cluster-a|b'),
      parentRows.map((row) => ({ ...row }))
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    await renderTable(detailFor(null));
    expect(container.querySelector('[data-gridtable-row-detail]')).toBeNull();
  });

  it('keeps arrow keys inside the nested table and returns to the open row on Escape', async () => {
    await renderTable(detailFor('cluster-a|b'));
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

    await press('ArrowDown');
    expect(parentRow('c').classList.contains('gridtable-row--focused')).toBe(true);
  });

  it("closes from the nested table's own Close and returns the keyboard to the open row", async () => {
    const onClose = vi.fn();
    await renderTable(detailFor('cluster-a|b', onClose));
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
    await renderTable(detailFor(null, onClose));

    expect(container.querySelector('[data-gridtable-row-detail]')).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>('.parent.gridtable--body')
    );
    expect(parentRow('b').classList.contains('gridtable-row--focused')).toBe(true);
  });

  it('still starts keyboard row focus in the parent after a click inside the nested table', async () => {
    await renderTable(detailFor('cluster-a|b'));
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
      await renderTable(detailFor('cluster-a|row-1'), manyRows, virtual);
      // Re-render once so measured heights reach the virtualizer.
      await renderTable(detailFor('cluster-a|row-1'), manyRows, virtual);

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
  });
});
