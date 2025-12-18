import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ContextMenuSource,
  type UseGridTableContextMenuItemsParams,
  useGridTableContextMenuItems,
} from '@shared/components/tables/hooks/useGridTableContextMenuItems';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import type { ContextMenuItem } from '@shared/components/ContextMenu';

type Row = {
  id: string;
  name: string;
  status: string;
};

const baseColumns: GridColumnDefinition<Row>[] = [
  { key: 'id', header: 'ID', render: (row) => row.id },
  { key: 'name', header: 'Name', render: (row) => row.name, sortable: true },
  { key: 'age', header: 'Age', render: (row) => row.status },
];

const rowSample: Row = { id: '1', name: 'alpha', status: 'running' };

describe('useGridTableContextMenuItems', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  const renderHook = async (
    params: UseGridTableContextMenuItemsParams<Row>
  ): Promise<{
    getItems: () => ReturnType<typeof useGridTableContextMenuItems<Row>>;
    rerender: (nextParams: UseGridTableContextMenuItemsParams<Row>) => Promise<void>;
  }> => {
    const resultRef: {
      current: ReturnType<typeof useGridTableContextMenuItems<Row>> | null;
    } = { current: null };

    const Harness: React.FC<{ hookParams: UseGridTableContextMenuItemsParams<Row> }> = ({
      hookParams,
    }) => {
      const callback = useGridTableContextMenuItems<Row>(hookParams);
      useEffect(() => {
        resultRef.current = callback;
      }, [callback]);
      return null;
    };

    const mount = async (hookParams: UseGridTableContextMenuItemsParams<Row>) => {
      await act(async () => {
        root.render(<Harness hookParams={hookParams} />);
        await Promise.resolve();
      });
    };

    await mount(params);

    return {
      getItems: () => {
        if (!resultRef.current) {
          throw new Error('Hook result not available');
        }
        return resultRef.current;
      },
      rerender: async (nextParams: UseGridTableContextMenuItemsParams<Row>) => {
        await mount(nextParams);
      },
    };
  };

  const buildParams = (
    overrides: Partial<UseGridTableContextMenuItemsParams<Row>> = {}
  ): UseGridTableContextMenuItemsParams<Row> => ({
    columns: baseColumns,
    getCustomContextMenuItems: undefined,
    ...overrides,
  });

  const invoke = (
    getItems: ReturnType<typeof useGridTableContextMenuItems<Row>>,
    columnKey: string,
    item: Row | null,
    source: ContextMenuSource
  ) => getItems(columnKey, item, source);

  it('returns no items for empty-state context menus', async () => {
    const customItems: ContextMenuItem[] = [
      { label: 'Select All', onClick: vi.fn() },
      { label: 'Clear Selection', onClick: vi.fn() },
      { label: 'Refresh', onClick: vi.fn() },
    ];
    const params = buildParams({
      getCustomContextMenuItems: vi.fn().mockReturnValue(customItems),
    });
    const { getItems } = await renderHook(params);

    expect(invoke(getItems(), 'name', null, 'empty')).toEqual([]);
  });

  it('returns cell-level custom items untouched', async () => {
    const cellItems: ContextMenuItem[] = [
      { label: 'Inspect', onClick: vi.fn() },
      { label: 'Copy Name', onClick: vi.fn() },
    ];
    const params = buildParams({
      getCustomContextMenuItems: () => cellItems,
    });
    const { getItems } = await renderHook(params);

    const result = invoke(getItems(), 'name', rowSample, 'cell');
    expect(result).toEqual(cellItems);
  });

  it('schedules sort toggles when descending from an unsorted state', async () => {
    vi.useFakeTimers();
    const onSort = vi.fn();
    const params = buildParams({
      onSort,
      sortConfig: null,
    });
    const { getItems } = await renderHook(params);

    const headerItems = invoke(getItems(), 'name', null, 'header');
    const clearSort = headerItems.find((item) => item.label === 'Clear Sort');
    expect(clearSort?.disabled).toBe(true);

    const sortDesc = headerItems.find((item) => item.label === 'Sort Name Desc');
    sortDesc?.onClick?.();
    expect(onSort).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(onSort).toHaveBeenCalledTimes(2);
  });

  it('respects current ascending sort state when toggling options', async () => {
    vi.useFakeTimers();
    const onSort = vi.fn();
    const params = buildParams({
      onSort,
      sortConfig: { key: 'name', direction: 'asc' },
    });
    const { getItems } = await renderHook(params);

    const headerItems = invoke(getItems(), 'name', null, 'header');
    const sortAsc = headerItems.find((item) => item.label === 'Sort Name Asc');
    const sortDesc = headerItems.find((item) => item.label === 'Sort Name Desc');
    const clearSort = headerItems.find((item) => item.label === 'Clear Sort');

    expect(sortAsc?.disabled).toBe(true);
    sortDesc?.onClick?.();
    expect(onSort).toHaveBeenCalledTimes(1);

    clearSort?.onClick?.();
    expect(onSort).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
    expect(onSort).toHaveBeenCalledTimes(3);
  });

  it('clears descending sort with a single toggle', async () => {
    vi.useFakeTimers();
    const onSort = vi.fn();
    const params = buildParams({
      onSort,
      sortConfig: { key: 'name', direction: 'desc' },
    });
    const { getItems } = await renderHook(params);

    const headerItems = invoke(getItems(), 'name', null, 'header');
    const sortDesc = headerItems.find((item) => item.label === 'Sort Name Desc');
    const clearSort = headerItems.find((item) => item.label === 'Clear Sort');

    expect(sortDesc?.disabled).toBe(true);

    clearSort?.onClick?.();
    expect(onSort).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(onSort).toHaveBeenCalledTimes(1);
  });
});
