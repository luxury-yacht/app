/**
 * frontend/src/shared/components/tables/GridTableBody.test.tsx
 *
 * Test suite for GridTableBody.
 * Covers key behaviors and edge cases for GridTableBody.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import GridTableBody from '@shared/components/tables/GridTableBody';
import type { RenderRowContentFn } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

afterEach(() => {
  document.head.querySelectorAll('style[data-gridtable-body-contract]').forEach((style) => {
    style.remove();
  });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('GridTableBody', () => {
  type TestRow = { id: string };
  type BodyProps = React.ComponentProps<typeof GridTableBody<TestRow>>;

  const renderTableBody = async (props: Partial<BodyProps> = {}) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const wrapper = document.createElement('div');
    wrapper.className = 'gridtable-wrapper';
    const grid = document.createElement('table');
    const table = document.createElement('tbody');
    grid.appendChild(table);
    wrapper.appendChild(grid);
    container.appendChild(wrapper);

    const wrapperRef = { current: wrapper };
    const gridRef = { current: grid };
    const tableRef = { current: table };

    const defaultRenderRowContent: RenderRowContentFn<TestRow> = (item, index) => (
      <tr key={item.id} data-index={index}>
        <td>Row {item.id}</td>
      </tr>
    );

    const defaultProps: BodyProps = {
      wrapperRef,
      gridRef,
      tableRef,
      tableClassName: '',
      useShortNames: false,
      hoverState: { visible: false, selected: false, focused: false, top: 0, height: 0 },
      onWrapperContextMenu: vi.fn(),
      tableData: [{ id: '1' }, { id: '2' }],
      keyExtractor: (item) => item.id,
      emptyMessage: 'No rows',
      shouldVirtualize: false,
      virtualRows: [],
      virtualRangeStart: 0,
      totalVirtualHeight: 0,
      getRowTop: (index) => index * 44,
      renderRowContent: defaultRenderRowContent,
      onWrapperFocus: vi.fn(),
      onWrapperBlur: vi.fn(),
      contentWidth: 0,
      allowHorizontalOverflow: false,
      viewportWidth: 0,
      loading: false,
      hasActiveFilters: false,
      onClearFilters: vi.fn(),
    };

    const allProps = { ...defaultProps, ...props } as BodyProps;

    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<GridTableBody {...allProps} />);
    });

    return {
      container,
      root,
      props: allProps,
    };
  };

  it('renders static rows', async () => {
    const { container } = await renderTableBody();

    const rows = container.querySelectorAll('[data-index]');
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('Row 1');
  });

  it('renders virtualization body when enabled', async () => {
    const renderRowContent: RenderRowContentFn<TestRow> = (item, _index, _attach, key) => (
      <tr key={key} data-slot={key}>
        <td>Virtual {item.id}</td>
      </tr>
    );

    const { container } = await renderTableBody({
      shouldVirtualize: true,
      virtualRows: [{ id: 'A' }, { id: 'B' }] as unknown as TestRow[],
      renderRowContent: renderRowContent as RenderRowContentFn<unknown>,
    });

    const virtualBody = container.querySelector('.gridtable-virtual-body');
    expect(virtualBody).not.toBeNull();
    expect(
      requireValue(virtualBody, 'expected test value in GridTableBody.test.tsx').textContent
    ).toContain('Virtual A');
  });

  it('remounts virtualized rows when the data window changes to prevent state leaks', async () => {
    const StatefulCell: React.FC<{ id: string }> = ({ id }) => {
      const [initialId] = React.useState(id);
      return (
        <div className="stateful-cell" data-initial-id={initialId}>
          {id}
        </div>
      );
    };

    const renderRowContent: RenderRowContentFn<TestRow> = (item, _index, _attach, key) => (
      <StatefulCell key={key} id={item.id} />
    );

    const initialRows = [{ id: 'row-a' }] as unknown as TestRow[];

    const { container, root, props } = await renderTableBody({
      shouldVirtualize: true,
      virtualRows: initialRows,
      tableData: initialRows,
      renderRowContent: renderRowContent as RenderRowContentFn<unknown>,
    });

    const firstCell = container.querySelector('.stateful-cell');
    expect(firstCell?.getAttribute('data-initial-id')).toBe('row-a');

    const nextRows = [{ id: 'row-b' }] as unknown as TestRow[];

    await act(async () => {
      root.render(
        <GridTableBody
          {...props}
          tableData={nextRows}
          virtualRows={nextRows}
          virtualRangeStart={0}
          shouldVirtualize={true}
        />
      );
    });

    const secondCell = container.querySelector('.stateful-cell');
    expect(secondCell?.getAttribute('data-initial-id')).toBe('row-b');
  });

  it('shows empty message when no rows', async () => {
    const { container } = await renderTableBody({
      tableData: [],
      virtualRows: [],
      shouldVirtualize: false,
    });

    const empty = container.querySelector('.gridtable-empty');
    expect(empty?.textContent).toBe('No rows');
  });

  it('centers the semantic empty row horizontally without changing its vertical position', async () => {
    const style = document.createElement('style');
    style.dataset.gridtableBodyContract = 'empty-centering';
    style.textContent = readFileSync(
      resolve(process.cwd(), 'styles/components/gridtables.css'),
      'utf8'
    );
    document.head.appendChild(style);

    const { container } = await renderTableBody({
      tableData: [],
      virtualRows: [],
      shouldVirtualize: false,
    });

    const body = container.querySelector<HTMLTableSectionElement>('tbody');
    const row = container.querySelector<HTMLTableRowElement>('tr');
    const cell = container.querySelector<HTMLTableCellElement>('td');
    expect(window.getComputedStyle(body as HTMLTableSectionElement).flexGrow).toBe('0');
    expect(window.getComputedStyle(body as HTMLTableSectionElement).alignItems).toBe('center');
    expect(window.getComputedStyle(body as HTMLTableSectionElement).justifyContent).toBe('normal');
    expect(window.getComputedStyle(row as HTMLTableRowElement).display).toBe('table-row');
    expect(window.getComputedStyle(cell as HTMLTableCellElement).display).toBe('table-cell');
  });

  it('shows a filtered-empty message and clear-filters affordance when filters are active', async () => {
    const onClearFilters = vi.fn();
    const { container } = await renderTableBody({
      tableData: [],
      virtualRows: [],
      shouldVirtualize: false,
      hasActiveFilters: true,
      onClearFilters,
    });

    const empty = container.querySelector('.gridtable-empty');
    expect(empty?.textContent).toContain('No matching items');
    expect(empty?.textContent).toContain('Filters are enabled that may be hiding objects.');

    const clearLink = container.querySelector<HTMLAnchorElement>(
      '.gridtable-empty-filter-hint__link'
    );
    expect(clearLink?.textContent).toBe('Clear filters');

    await act(async () => {
      clearLink?.click();
    });

    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('prevents native right-click text selection inside grid cells', async () => {
    const renderRowContent: RenderRowContentFn<TestRow> = (item) => (
      <div key={item.id} className="gridtable-row">
        <div className="grid-cell">
          <span className="grid-cell-content">Row {item.id}</span>
        </div>
      </div>
    );

    const { container } = await renderTableBody({
      renderRowContent: renderRowContent as RenderRowContentFn<unknown>,
    });

    const cell = container.querySelector('.grid-cell') as HTMLDivElement | null;
    expect(cell).not.toBeNull();

    const removeAllRanges = vi.fn();
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);

    const mouseDownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    cell?.dispatchEvent(mouseDownEvent);

    expect(mouseDownEvent.defaultPrevented).toBe(true);
    expect(removeAllRanges).toHaveBeenCalledTimes(1);

    getSelectionSpy.mockRestore();
  });

  it('clears any active selection before opening the wrapper context menu for a cell', async () => {
    const onWrapperContextMenu = vi.fn();
    const renderRowContent: RenderRowContentFn<TestRow> = (item) => (
      <div key={item.id} className="gridtable-row">
        <div className="grid-cell">
          <span className="grid-cell-content">Row {item.id}</span>
        </div>
      </div>
    );

    const { container } = await renderTableBody({
      renderRowContent: renderRowContent as RenderRowContentFn<unknown>,
      onWrapperContextMenu,
    });

    const cell = container.querySelector('.grid-cell') as HTMLDivElement | null;
    expect(cell).not.toBeNull();

    const removeAllRanges = vi.fn();
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);

    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 20,
      clientY: 20,
    });
    cell?.dispatchEvent(contextMenuEvent);

    expect(removeAllRanges).toHaveBeenCalledTimes(1);
    expect(onWrapperContextMenu).toHaveBeenCalledTimes(1);

    getSelectionSpy.mockRestore();
  });
});
