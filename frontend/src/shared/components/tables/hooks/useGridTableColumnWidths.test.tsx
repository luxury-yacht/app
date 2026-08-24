/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.test.tsx
 *
 * Test suite for useGridTableColumnWidths.
 * Covers key behaviors and edge cases for useGridTableColumnWidths.
 */

import type {
  ColumnWidthInput,
  ColumnWidthState,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import {
  DEFAULT_COLUMN_MIN_WIDTH,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';
import { useGridTableColumnWidths } from '@shared/components/tables/hooks/useGridTableColumnWidths';
import type React from 'react';
import { act, useEffect } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

type Row = { id: string; name: string };

const getColumnMinWidth = <T,>(column: GridColumnDefinition<T>) => {
  const parsed = parseWidthInputToNumber(column.minWidth);
  return parsed ?? DEFAULT_COLUMN_MIN_WIDTH;
};

describe('useGridTableColumnWidths', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let originalRaf: typeof globalThis.requestAnimationFrame | undefined;
  let originalCancelRaf: typeof globalThis.cancelAnimationFrame | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    originalRaf = globalThis.requestAnimationFrame;
    originalCancelRaf = globalThis.cancelAnimationFrame;
    const immediateRaf = (cb: FrameRequestCallback): number => {
      cb(0);
      return 0;
    };
    globalThis.requestAnimationFrame = immediateRaf;
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame = immediateRaf;
    }
    const noop = () => undefined;
    globalThis.cancelAnimationFrame = noop;
    if (typeof window !== 'undefined') {
      window.cancelAnimationFrame = noop;
    }
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalRaf) {
      globalThis.requestAnimationFrame = originalRaf;
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame = originalRaf;
      }
    } else {
      Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
      if (typeof window !== 'undefined') {
        Reflect.deleteProperty(window, 'requestAnimationFrame');
      }
    }
    if (originalCancelRaf) {
      globalThis.cancelAnimationFrame = originalCancelRaf;
      if (typeof window !== 'undefined') {
        window.cancelAnimationFrame = originalCancelRaf;
      }
    } else {
      Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
      if (typeof window !== 'undefined') {
        Reflect.deleteProperty(window, 'cancelAnimationFrame');
      }
    }
  });

  const renderHook = async (
    options: Parameters<typeof useGridTableColumnWidths<Row>>[0]
  ): Promise<{
    getResult: () => ReturnType<typeof useGridTableColumnWidths<Row>> | null;
    rerender: (next: Parameters<typeof useGridTableColumnWidths<Row>>[0]) => Promise<void>;
  }> => {
    const resultRef: {
      current: ReturnType<typeof useGridTableColumnWidths<Row>> | null;
    } = { current: null };

    const HookHarness: React.FC<{
      opts: Parameters<typeof useGridTableColumnWidths<Row>>[0];
    }> = ({ opts }) => {
      const result = useGridTableColumnWidths<Row>(opts);
      useEffect(() => {
        resultRef.current = result;
      }, [result]);
      return null;
    };

    await act(async () => {
      root.render(<HookHarness opts={options} />);
      await Promise.resolve();
    });

    const rerender = async (next: Parameters<typeof useGridTableColumnWidths<Row>>[0]) => {
      await act(async () => {
        root.render(<HookHarness opts={next} />);
        await Promise.resolve();
      });
    };

    return {
      getResult: () => resultRef.current,
      rerender,
    };
  };

  const createColumn = (key: string, config: Partial<GridColumnDefinition<Row>> = {}) =>
    ({
      key,
      header: key.toUpperCase(),
      render: (row: Row) => row.name,
      ...config,
    }) as GridColumnDefinition<Row>;

  const createWrapper = (tableRef: React.RefObject<HTMLElement | null>) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'gridtable-wrapper';
    Object.defineProperty(wrapper, 'clientWidth', {
      configurable: true,
      value: 640,
    });
    const table = document.createElement('div');
    wrapper.appendChild(table);
    tableRef.current = table;
    document.body.appendChild(wrapper);
    return wrapper;
  };

  it('initializes column widths using precedence rules and marks manual columns', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);

    const columns = [
      createColumn('name'),
      createColumn('kind'),
      createColumn('age'),
      createColumn('misc', { width: '120px' }),
    ];

    const controlledColumnWidths: Record<string, ColumnWidthState> = {
      name: {
        width: 320,
        unit: 'px',
        raw: 320,
        rawValue: 320,
        autoWidth: false,
        source: 'user',
        updatedAt: Date.now(),
      },
    };

    const measureColumnWidth = vi.fn((column: GridColumnDefinition<Row>) => {
      switch (column.key) {
        case 'kind':
          return 110;
        case 'misc':
          return 140;
        default:
          return 200;
      }
    });

    const { getResult } = await renderHook({
      columns,
      renderedColumns: columns,
      tableRef,
      tableData: [],
      controlledColumnWidths,
      externalColumnWidths: null,
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth,
    });

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result?.columnWidths.name).toBeGreaterThan(0);
    expect(result?.columnWidths.kind).toBeGreaterThan(0);
    expect(result?.columnWidths.age).toBeGreaterThanOrEqual(getColumnMinWidth(columns[2]));
    expect(result?.columnsRef.current.map((col) => col.key)).toEqual([
      'name',
      'kind',
      'age',
      'misc',
    ]);
    expect(result?.manuallyResizedColumnsRef.current.has('name')).toBe(true);
    expect(measureColumnWidth).not.toHaveBeenCalled();

    const nameState = requireValue(
      result,
      'expected test value in useGridTableColumnWidths.test.tsx'
    ).buildColumnWidthState(
      'name',
      requireValue(result, 'expected test value in useGridTableColumnWidths.test.tsx').columnWidths
        .name
    );
    expect(nameState.source).toBe('user');
    expect(nameState.autoWidth).toBe(false);

    const kindState = requireValue(
      result,
      'expected test value in useGridTableColumnWidths.test.tsx'
    ).buildColumnWidthState(
      'kind',
      requireValue(result, 'expected test value in useGridTableColumnWidths.test.tsx').columnWidths
        .kind
    );
    expect(kindState.source).toBe('table');
    expect(kindState.unit).toBe('px');

    const miscState = requireValue(
      result,
      'expected test value in useGridTableColumnWidths.test.tsx'
    ).buildColumnWidthState(
      'misc',
      requireValue(result, 'expected test value in useGridTableColumnWidths.test.tsx').columnWidths
        .misc
    );
    expect(miscState.source).toBe('column');
    expect(miscState.raw).toBe('120px' as ColumnWidthInput);

    wrapper.remove();
  });

  it('applies external column widths and notifies listeners', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);

    const columns = [
      createColumn('name'),
      createColumn('type', { autoWidth: true }),
      createColumn('misc'),
    ];

    const onColumnWidthsChange = vi.fn();
    const measureColumnWidth = vi.fn((_column: GridColumnDefinition<Row>) => 160);

    const baseOptions = {
      columns,
      renderedColumns: columns,
      tableRef,
      tableData: [{ id: '1', name: 'alpha' }],
      controlledColumnWidths: null,
      externalColumnWidths: null as Record<string, number> | null,
      enableColumnResizing: true,
      onColumnWidthsChange,
      useShortNames: false,
      measureColumnWidth,
    };

    const { getResult, rerender } = await renderHook(baseOptions);

    // Clear initial notification before asserting the external update behaviour.
    onColumnWidthsChange.mockClear();

    await rerender({
      ...baseOptions,
      externalColumnWidths: { name: 480, misc: 240 },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const result = getResult();
    expect(result?.columnWidths.name).toBe(480);
    expect(result?.columnWidths.misc).toBe(240);
    expect(onColumnWidthsChange).toHaveBeenCalled();

    wrapper.remove();
  });

  it('remeasures persisted automatic widths but preserves user-sized auto columns', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);
    const columns = [
      createColumn('kind', { autoWidth: true, width: 100 }),
      createColumn('name', { autoWidth: true, width: 100 }),
    ];
    const controlledColumnWidths: Record<string, ColumnWidthState> = {
      kind: {
        width: 100,
        unit: 'px',
        raw: 100,
        rawValue: 100,
        autoWidth: true,
        source: 'auto',
        updatedAt: Date.now(),
      },
      name: {
        width: 100,
        unit: 'px',
        raw: 100,
        rawValue: 100,
        autoWidth: false,
        source: 'user',
        updatedAt: Date.now(),
      },
    };

    const { getResult } = await renderHook({
      columns,
      renderedColumns: columns,
      tableRef,
      tableData: [{ id: '1', name: 'MutatingWebhook' }],
      controlledColumnWidths,
      externalColumnWidths: { kind: 100, name: 100 },
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth: vi.fn((column) => (column.key === 'kind' ? 188 : 240)),
    });

    expect(getResult()?.columnWidths).toMatchObject({ kind: 188, name: 100 });
    expect(getResult()?.manuallyResizedColumnsRef.current.has('name')).toBe(true);
    wrapper.remove();
  });

  it('remeasures a column-owned fixed width when the column becomes automatic', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);
    const columns = [createColumn('kind', { autoWidth: true, width: 100 })];
    const controlledColumnWidths: Record<string, ColumnWidthState> = {
      kind: {
        width: 160,
        unit: 'px',
        raw: 160,
        rawValue: 160,
        autoWidth: false,
        source: 'column',
        updatedAt: Date.now(),
      },
    };

    const { getResult } = await renderHook({
      columns,
      renderedColumns: columns,
      tableRef,
      tableData: [{ id: '1', name: 'ClusterRoleBinding' }],
      controlledColumnWidths,
      externalColumnWidths: { kind: 160 },
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth: vi.fn(() => 220),
    });

    expect(getResult()?.columnWidths.kind).toBe(220);
    expect(getResult()?.manuallyResizedColumnsRef.current.has('kind')).toBe(false);
    expect(getResult()?.buildColumnWidthState('kind', 220)).toMatchObject({
      autoWidth: true,
      source: 'auto',
    });
    wrapper.remove();
  });

  it('remeasures reordered columns without repeating the initialization phase transition', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);
    const columns = [
      createColumn('name', { autoWidth: true }),
      createColumn('kind', { autoWidth: true }),
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const baseOptions = {
      columns,
      renderedColumns: columns,
      tableRef,
      tableData: [{ id: '1', name: 'alpha' }],
      controlledColumnWidths: null,
      externalColumnWidths: null,
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth: vi.fn(() => 160),
    };

    const { rerender } = await renderHook(baseOptions);
    warn.mockClear();
    const reordered = [columns[1], columns[0]];
    await rerender({ ...baseOptions, columns: reordered, renderedColumns: reordered });

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('invalid transition'));
    wrapper.remove();
  });

  it('builds persisted width state for a manually resized auto column', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);

    const columns = [
      createColumn('kind'),
      createColumn('name', { autoWidth: true }),
      createColumn('misc', { autoWidth: true }),
    ];

    const measureColumnWidth = vi.fn((column: GridColumnDefinition<Row>) => {
      if (column.key === 'kind') {
        return 120;
      }
      return 180;
    });

    const { getResult } = await renderHook({
      columns,
      renderedColumns: columns,
      tableRef,
      tableData: [],
      controlledColumnWidths: null,
      externalColumnWidths: null,
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth,
    });

    const result = getResult();
    expect(result).not.toBeNull();
    requireValue(
      result,
      'expected test value in useGridTableColumnWidths.test.tsx'
    ).manuallyResizedColumnsRef.current.add('name');
    const state = requireValue(
      result,
      'expected test value in useGridTableColumnWidths.test.tsx'
    ).buildColumnWidthState('name', 210);
    expect(state.source).toBe('user');
    expect(state.autoWidth).toBe(false);

    wrapper.remove();
  });

  it('marks columns dirty and measures after debounce', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);
    const table = requireValue(
      tableRef.current,
      'expected test value in useGridTableColumnWidths.test.tsx'
    );

    const columns = [
      createColumn('name', { autoWidth: true }),
      createColumn('kind', { autoWidth: true }),
    ];

    const row = document.createElement('div');
    row.className = 'gridtable-row';
    columns.forEach((column, index) => {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.setAttribute('data-column', column.key);
      const content = document.createElement('span');
      content.className = 'grid-cell-content';
      content.textContent = index === 0 ? 'alpha' : 'beta';
      cell.appendChild(content);
      row.appendChild(cell);
    });
    table.appendChild(row);

    const measureColumnWidth = vi.fn((column: GridColumnDefinition<Row>) => {
      return column.key === 'name' ? 220 : 140;
    });

    const { getResult } = await renderHook({
      columns,
      renderedColumns: columns,
      tableRef,
      tableData: [{ id: '1', name: 'alpha' }],
      controlledColumnWidths: null,
      externalColumnWidths: null,
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth,
    });

    measureColumnWidth.mockClear();

    const result = getResult();
    expect(result).not.toBeNull();
    requireValue(
      result,
      'expected test value in useGridTableColumnWidths.test.tsx'
    ).markColumnsDirty(columns.map((col) => col.key));

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(measureColumnWidth).toHaveBeenCalled();
    wrapper.remove();
  });

  it('remeasures automatic widths in both directions when the page data changes', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);
    const table = requireValue(
      tableRef.current,
      'expected test value in useGridTableColumnWidths.test.tsx'
    );
    const kindColumn = createColumn('kind', { autoWidth: true });
    const columns = [kindColumn];
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    cell.dataset.column = 'kind';
    const content = document.createElement('span');
    content.className = 'grid-cell-content';
    cell.appendChild(content);
    table.appendChild(cell);

    let measuredWidth = 185;
    const measureColumnWidth = vi.fn(() => measuredWidth);
    const pageOne = [{ id: '1', name: 'ClusterRoleBinding' }];
    const pageTwo = [{ id: '2', name: 'CustomResourceDefinition' }];
    const baseOptions = {
      columns,
      renderedColumns: columns,
      tableRef,
      controlledColumnWidths: null,
      externalColumnWidths: null,
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth,
    };

    content.textContent = pageOne[0].name;
    const { getResult, rerender } = await renderHook({ ...baseOptions, tableData: pageOne });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(getResult()?.columnWidths.kind).toBe(185);

    measuredWidth = 239;
    content.textContent = pageTwo[0].name;
    await rerender({ ...baseOptions, tableData: pageTwo });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(getResult()?.columnWidths.kind).toBe(239);

    measuredWidth = 185;
    content.textContent = pageOne[0].name;
    await rerender({ ...baseOptions, tableData: pageOne });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(getResult()?.columnWidths.kind).toBe(185);

    wrapper.remove();
  });

  it('remeasures replacement page data without waiting for a rendered cell signature', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);
    const columns = [createColumn('kind', { autoWidth: true })];
    let measuredWidth = 185;
    const measureColumnWidth = vi.fn(() => measuredWidth);
    const pageOne = [{ id: '1', name: 'ClusterRoleBinding' }];
    const pageTwo = [{ id: '2', name: 'PriorityLevelConfiguration' }];
    const baseOptions = {
      columns,
      renderedColumns: columns,
      tableRef,
      controlledColumnWidths: null,
      externalColumnWidths: null,
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth,
    };

    const { getResult, rerender } = await renderHook({ ...baseOptions, tableData: pageOne });
    expect(getResult()?.columnWidths.kind).toBe(185);

    measuredWidth = 257;
    await rerender({ ...baseOptions, tableData: pageTwo });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(getResult()?.columnWidths.kind).toBe(257);
    wrapper.remove();
  });

  it('does not measure manually resized columns until they are reset', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);
    const table = requireValue(
      tableRef.current,
      'expected test value in useGridTableColumnWidths.test.tsx'
    );

    const columns = [
      createColumn('name', { autoWidth: true }),
      createColumn('kind', { autoWidth: true }),
    ];

    const row = document.createElement('div');
    row.className = 'gridtable-row';
    columns.forEach((column) => {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.setAttribute('data-column', column.key);
      const content = document.createElement('span');
      content.className = 'grid-cell-content';
      content.textContent = column.key;
      cell.appendChild(content);
      row.appendChild(cell);
    });
    table.appendChild(row);

    const measureColumnWidth = vi.fn((_column: GridColumnDefinition<Row>) => 180);

    const { getResult } = await renderHook({
      columns,
      renderedColumns: columns,
      tableRef,
      tableData: [{ id: '1', name: 'alpha' }],
      controlledColumnWidths: null,
      externalColumnWidths: null,
      enableColumnResizing: true,
      onColumnWidthsChange: vi.fn(),
      useShortNames: false,
      measureColumnWidth,
    });

    const result = getResult();
    expect(result).not.toBeNull();

    act(() => {
      requireValue(
        result,
        'expected test value in useGridTableColumnWidths.test.tsx'
      ).manuallyResizedColumnsRef.current.add('name');
      requireValue(
        result,
        'expected test value in useGridTableColumnWidths.test.tsx'
      ).handleManualResizeEvent({ type: 'dragStart', columns: ['name'] });
      requireValue(
        result,
        'expected test value in useGridTableColumnWidths.test.tsx'
      ).handleManualResizeEvent({ type: 'drag', columns: ['name'] });
      requireValue(
        result,
        'expected test value in useGridTableColumnWidths.test.tsx'
      ).handleManualResizeEvent({ type: 'dragEnd', columns: ['name'] });
    });
    measureColumnWidth.mockClear();
    act(() => {
      requireValue(
        result,
        'expected test value in useGridTableColumnWidths.test.tsx'
      ).markColumnsDirty(['name']);
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const measuredKeysAfterManual = measureColumnWidth.mock.calls.map(
      (call) => (call[0] as GridColumnDefinition<Row>).key
    );
    expect(measuredKeysAfterManual).not.toContain('name');

    const nameCell = table.querySelector('[data-column="name"] .grid-cell-content');
    if (nameCell) {
      nameCell.textContent = 'alpha-extended-value';
    }

    act(() => {
      requireValue(
        result,
        'expected test value in useGridTableColumnWidths.test.tsx'
      ).manuallyResizedColumnsRef.current.clear();
      requireValue(
        result,
        'expected test value in useGridTableColumnWidths.test.tsx'
      ).handleManualResizeEvent({ type: 'reset', columns: ['name'] });
      requireValue(
        result,
        'expected test value in useGridTableColumnWidths.test.tsx'
      ).markColumnsDirty(['name']);
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const measuredKeysAfterReset = measureColumnWidth.mock.calls.map(
      (call) => (call[0] as GridColumnDefinition<Row>).key
    );
    expect(measuredKeysAfterReset).toContain('name');
    wrapper.remove();
  });

  it('restores automatic sizing for a hidden column without clearing a manually sized fixed column', async () => {
    const tableRef = { current: null as HTMLElement | null };
    const wrapper = createWrapper(tableRef);
    const columns = [createColumn('name', { autoWidth: true }), createColumn('status')];
    const controlledColumnWidths: Record<string, ColumnWidthState> = {
      name: {
        width: 300,
        unit: 'px',
        autoWidth: false,
        source: 'user',
        updatedAt: 1,
      },
      status: {
        width: 220,
        unit: 'px',
        autoWidth: false,
        source: 'user',
        updatedAt: 1,
      },
    };
    const onColumnWidthsChange = vi.fn();
    const measureColumnWidth = vi.fn((column: GridColumnDefinition<Row>) =>
      column.key === 'name' ? 180 : 200
    );

    const { getResult } = await renderHook({
      columns,
      renderedColumns: [columns[1]],
      tableRef,
      tableData: [{ id: '1', name: 'alpha' }],
      controlledColumnWidths,
      externalColumnWidths: { name: 300, status: 220 },
      enableColumnResizing: true,
      onColumnWidthsChange,
      useShortNames: false,
      measureColumnWidth,
    });

    const initial = requireValue(
      getResult(),
      'expected test value in useGridTableColumnWidths.test.tsx'
    );
    expect(initial.canResetAutoWidthColumns).toBe(true);

    act(() => {
      initial.resetAutoWidthColumns();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const reset = requireValue(
      getResult(),
      'expected test value in useGridTableColumnWidths.test.tsx'
    );
    expect(reset.manuallyResizedColumnsRef.current.has('name')).toBe(false);
    expect(reset.manuallyResizedColumnsRef.current.has('status')).toBe(true);
    expect(reset.columnWidths.name).toBe(180);
    expect(onColumnWidthsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ autoWidth: true, source: 'auto' }),
        status: expect.objectContaining({ autoWidth: false, source: 'user' }),
      })
    );
    wrapper.remove();
  });
});
