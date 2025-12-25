/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnVirtualization.test.tsx
 *
 * Test suite for useGridTableColumnVirtualization.
 * Covers key behaviors and edge cases for useGridTableColumnVirtualization.
 */

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { useGridTableColumnVirtualization } from '@shared/components/tables/hooks/useGridTableColumnVirtualization';
import type {
  GridColumnDefinition,
  GridTableVirtualizationOptions,
} from '@shared/components/tables/GridTable.types';

type Row = { id: string };

const createColumn = (key: string, width: number, className = '') =>
  ({
    key,
    header: key.toUpperCase(),
    render: (_row: Row) => key,
    className,
    width: `${width}px`,
  }) as GridColumnDefinition<Row>;

describe('useGridTableColumnVirtualization', () => {
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
    document.body.innerHTML = '';
  });

  const renderHook = async (
    options: Parameters<typeof useGridTableColumnVirtualization<Row>>[0]
  ): Promise<{
    getResult: () => ReturnType<typeof useGridTableColumnVirtualization<Row>> | null;
    rerender: (next: Parameters<typeof useGridTableColumnVirtualization<Row>>[0]) => Promise<void>;
  }> => {
    const resultRef: {
      current: ReturnType<typeof useGridTableColumnVirtualization<Row>> | null;
    } = { current: null };

    const HookHarness: React.FC<{
      opts: Parameters<typeof useGridTableColumnVirtualization<Row>>[0];
    }> = ({ opts }) => {
      const result = useGridTableColumnVirtualization<Row>(opts);
      useEffect(() => {
        resultRef.current = result;
      }, [result]);
      return null;
    };

    await act(async () => {
      root.render(<HookHarness opts={options} />);
      await Promise.resolve();
    });

    const rerender = async (next: Parameters<typeof useGridTableColumnVirtualization<Row>>[0]) => {
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

  it('returns full column window when virtualization is disabled', async () => {
    const columns = [createColumn('a', 120), createColumn('b', 140), createColumn('c', 160)];

    const { getResult } = await renderHook({
      renderedColumns: columns,
      columnWidths: { a: 120, b: 140, c: 160 },
      virtualization: undefined,
      wrapperRef: { current: null },
    });

    const result = getResult();
    expect(result?.columnVirtualizationConfig.enabled).toBe(false);
    expect(result?.columnWindowRange).toEqual({ startIndex: 0, endIndex: 2 });
    expect(result?.columnRenderModelsWithOffsets.map((model) => model.width)).toEqual([
      120, 140, 160,
    ]);
    expect(result?.columnRenderModelsWithOffsets[1]?.start).toBe(120);
  });

  it('computes a window range based on scroll position when virtualization is enabled', async () => {
    const columns = [
      createColumn('a', 100),
      createColumn('b', 120),
      createColumn('c', 90),
      createColumn('d', 80),
    ];
    const columnWidths = { a: 100, b: 120, c: 90, d: 80 };

    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'clientWidth', {
      configurable: true,
      value: 180,
    });
    Object.defineProperty(wrapper, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: 100,
    });

    const virtualization: GridTableVirtualizationOptions = {
      columnWindow: {
        enabled: true,
        overscanColumns: 1,
        stickyStart: 1,
        stickyEnd: 0,
      },
    };

    const { getResult } = await renderHook({
      renderedColumns: columns,
      columnWidths,
      virtualization,
      wrapperRef: { current: wrapper },
    });

    const result = getResult();
    expect(result?.columnVirtualizationConfig.enabled).toBe(true);
    expect(result?.columnVirtualizationConfig.overscanColumns).toBe(1);

    await act(async () => {
      result?.updateColumnWindowRange();
      await Promise.resolve();
    });

    expect(result?.columnWindowRange.startIndex).toBe(0);
    expect(result?.columnWindowRange.endIndex).toBe(3);
    expect(result?.columnRenderModelsWithOffsets.map((model) => model.start)).toEqual([
      0, 100, 220, 310,
    ]);
  });
});
