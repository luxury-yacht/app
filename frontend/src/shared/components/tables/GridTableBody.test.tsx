/**
 * frontend/src/shared/components/tables/GridTableBody.test.tsx
 *
 * Test suite for GridTableBody.
 * Covers key behaviors and edge cases for GridTableBody.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GridTableBody from '@shared/components/tables/GridTableBody';
import type { RenderRowContentFn } from '@shared/components/tables/hooks/useGridTableRowRenderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('GridTableBody', () => {
  type TestRow = { id: string };
  type BodyProps = React.ComponentProps<typeof GridTableBody<any>>;

  const renderTableBody = async (props: Partial<BodyProps> = {}) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const wrapper = document.createElement('div');
    wrapper.className = 'gridtable-wrapper';
    const table = document.createElement('div');
    wrapper.appendChild(table);
    container.appendChild(wrapper);

    const wrapperRef = { current: wrapper };
    const tableRef = { current: table };
    const rowControllerPoolRef = { current: [] as Array<{ id: string }> };
    const firstVirtualRowRef = { current: null as HTMLDivElement | null };
    const sentinelRef = { current: document.createElement('div') };

    const defaultRenderRowContent: RenderRowContentFn<TestRow> = (item, index) => (
      <div key={item.id} data-index={index}>
        Row {item.id}
      </div>
    );

    const defaultProps: BodyProps = {
      wrapperRef,
      tableRef,
      tableClassName: '',
      useShortNames: false,
      hoverState: { visible: false, selected: false, focused: false, top: 0, height: 0 },
      onWrapperContextMenu: vi.fn(),
      tableData: [{ id: '1' }, { id: '2' }] as unknown as TestRow[],
      keyExtractor: ((item: TestRow) => item.id) as any,
      emptyMessage: 'No rows',
      shouldVirtualize: false,
      virtualRows: [],
      virtualRangeStart: 0,
      totalVirtualHeight: 0,
      virtualOffset: 0,
      renderRowContent: defaultRenderRowContent as RenderRowContentFn<any>,
      rowControllerPoolRef,
      firstVirtualRowRef,
      paginationEnabled: true,
      paginationStatus: 'More rows',
      showPaginationStatus: true,
      showLoadMoreButton: true,
      loadMoreLabel: 'Load more',
      hasMore: true,
      isRequestingMore: false,
      onManualLoadMore: vi.fn(),
      sentinelRef,
      onWrapperFocus: vi.fn(),
      onWrapperBlur: vi.fn(),
      contentWidth: 0,
      allowHorizontalOverflow: false,
      viewportWidth: 0,
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
      rowControllerPoolRef,
      firstVirtualRowRef,
    };
  };

  it('renders static rows and pagination controls', async () => {
    const { container, props } = await renderTableBody();

    const rows = container.querySelectorAll('[data-index]');
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('Row 1');

    const button = container.querySelector<HTMLButtonElement>('.gridtable-pagination-button');
    expect(button).not.toBeNull();

    await act(async () => {
      button!.click();
    });

    expect(props.onManualLoadMore).toHaveBeenCalled();
  });

  it('renders virtualization body when enabled', async () => {
    const renderRowContent: RenderRowContentFn<TestRow> = (item, _index, _attach, key) => (
      <div key={key} data-slot={key}>
        Virtual {item.id}
      </div>
    );

    const { container, rowControllerPoolRef } = await renderTableBody({
      shouldVirtualize: true,
      virtualRows: [{ id: 'A' }, { id: 'B' }] as unknown as TestRow[],
      renderRowContent: renderRowContent as RenderRowContentFn<any>,
    });

    const virtualInner = container.querySelector('.gridtable-virtual-inner');
    expect(virtualInner).not.toBeNull();
    expect(virtualInner!.textContent).toContain('Virtual A');
    expect(rowControllerPoolRef.current.length).toBeGreaterThan(0);
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
      renderRowContent: renderRowContent as RenderRowContentFn<any>,
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
});
