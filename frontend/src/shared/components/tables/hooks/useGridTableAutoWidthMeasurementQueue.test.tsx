/**
 * frontend/src/shared/components/tables/hooks/useGridTableAutoWidthMeasurementQueue.test.ts
 *
 * Regression tests for useDirtyQueue / handleManualResizeEvent.
 * Covers the autoSize event re-enabling auto-sizing so markColumnsDirty
 * proceeds, and subsequent data-driven updates are not permanently suppressed.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  useDirtyQueue,
  type DirtyQueueResult,
} from '@shared/components/tables/hooks/useGridTableAutoWidthMeasurementQueue';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

type Row = { id: string; name: string };

const makeColumn = (key: string): GridColumnDefinition<Row> =>
  ({
    key,
    header: key,
    autoWidth: true,
    render: (row: Row) => row.name,
  }) as unknown as GridColumnDefinition<Row>;

describe('useDirtyQueue handleManualResizeEvent', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const setupHook = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    const columns = [makeColumn('col-a'), makeColumn('col-b')];
    const dirtyColumns = new Set<string>();
    const isAutoSizingEnabledRef = { current: true };

    const options = {
      tableRef: { current: document.createElement('div') },
      renderedColumnsRef: { current: columns },
      manuallyResizedColumnsRef: { current: new Set<string>() },
      naturalWidthsRef: { current: {} as Record<string, number> },
      dirtyColumnsRef: { current: dirtyColumns },
      columnHashesRef: { current: new Map<string, string>() },
      allowShrinkColumnsRef: { current: new Set<string>() },
      isManualResizeActiveRef: { current: false },
      isAutoSizingEnabledRef,
      setColumnWidths: vi.fn(),
      measureColumnWidth: vi.fn(() => 100),
      getColumnMinWidth: vi.fn(() => 72),
      getColumnMaxWidth: vi.fn(() => Infinity),
    };

    const resultRef: { current: DirtyQueueResult | null } = { current: null };

    const Harness: React.FC = () => {
      resultRef.current = useDirtyQueue<Row>(options);
      return null;
    };

    act(() => {
      root.render(<Harness />);
    });

    return { resultRef, dirtyColumns, isAutoSizingEnabledRef };
  };

  it('autoSize event re-enables auto-sizing and queues dirty columns', () => {
    const { resultRef, dirtyColumns, isAutoSizingEnabledRef } = setupHook();

    // Baseline: auto-sizing is enabled.
    expect(isAutoSizingEnabledRef.current).toBe(true);

    // Fire an autoSize event.
    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'autoSize',
        columns: ['col-a'],
      });
    });

    // Auto-sizing must be re-enabled after autoSize (not stuck at false).
    expect(isAutoSizingEnabledRef.current).toBe(true);
    // The column must be queued as dirty.
    expect(dirtyColumns.has('col-a')).toBe(true);
  });

  it('data-driven markColumnsDirty works after an autoSize event', () => {
    const { resultRef, dirtyColumns, isAutoSizingEnabledRef } = setupHook();

    // Fire an autoSize event first.
    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'autoSize',
        columns: ['col-a'],
      });
    });

    // Clear dirty set to isolate the next call.
    dirtyColumns.clear();

    // Subsequent data-driven mark should work — auto-sizing must not be
    // permanently disabled.
    act(() => {
      resultRef.current!.markColumnsDirty(['col-b']);
    });

    expect(isAutoSizingEnabledRef.current).toBe(true);
    expect(dirtyColumns.has('col-b')).toBe(true);
  });
});

describe('useDirtyQueue debounce and retry', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllTimers();
  });

  const setupHookWithMeasurer = (measureWidth = 100) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    const columns = [makeColumn('col-a'), makeColumn('col-b')];
    const dirtyColumns = new Set<string>();
    const isAutoSizingEnabledRef = { current: true };
    const setColumnWidths = vi.fn();
    const measureColumnWidth = vi.fn(() => measureWidth);

    const options = {
      tableRef: { current: document.createElement('div') },
      renderedColumnsRef: { current: columns },
      manuallyResizedColumnsRef: { current: new Set<string>() },
      naturalWidthsRef: { current: {} as Record<string, number> },
      dirtyColumnsRef: { current: dirtyColumns },
      columnHashesRef: { current: new Map<string, string>() },
      allowShrinkColumnsRef: { current: new Set<string>() },
      isManualResizeActiveRef: { current: false },
      isAutoSizingEnabledRef,
      setColumnWidths,
      measureColumnWidth,
      getColumnMinWidth: vi.fn(() => 72),
      getColumnMaxWidth: vi.fn(() => Infinity),
    };

    const resultRef: { current: DirtyQueueResult | null } = { current: null };

    const Harness: React.FC = () => {
      resultRef.current = useDirtyQueue<Row>(options);
      return null;
    };

    act(() => {
      root.render(<Harness />);
    });

    return {
      resultRef,
      dirtyColumns,
      isAutoSizingEnabledRef,
      setColumnWidths,
      measureColumnWidth,
      options,
    };
  };

  it('debounces markColumnsDirty — dirty columns accumulate before flush', () => {
    const { resultRef, dirtyColumns } = setupHookWithMeasurer();

    act(() => {
      resultRef.current!.markColumnsDirty(['col-a']);
    });
    expect(dirtyColumns.has('col-a')).toBe(true);

    // Mark another column before the debounce fires.
    act(() => {
      resultRef.current!.markColumnsDirty(['col-b']);
    });
    expect(dirtyColumns.has('col-b')).toBe(true);

    // Both should be queued before the debounce timer fires.
    expect(dirtyColumns.size).toBe(2);
  });

  it('skips markColumnsDirty when isAutoSizingEnabled is false', () => {
    const { resultRef, dirtyColumns, isAutoSizingEnabledRef } = setupHookWithMeasurer();

    // Disable auto-sizing.
    isAutoSizingEnabledRef.current = false;

    act(() => {
      resultRef.current!.markColumnsDirty(['col-a']);
    });

    // Should not have queued anything.
    expect(dirtyColumns.has('col-a')).toBe(false);
  });

  it('skips markColumnsDirty when a manual resize is active', () => {
    const { resultRef, dirtyColumns, options } = setupHookWithMeasurer();

    // Simulate an active manual drag.
    options.isManualResizeActiveRef.current = true;

    act(() => {
      resultRef.current!.markColumnsDirty(['col-a']);
    });

    expect(dirtyColumns.has('col-a')).toBe(false);
  });

  it('skips manually resized columns in markColumnsDirty', () => {
    const { resultRef, dirtyColumns, options } = setupHookWithMeasurer();

    // Mark col-a as manually resized.
    options.manuallyResizedColumnsRef.current.add('col-a');

    act(() => {
      resultRef.current!.markColumnsDirty(['col-a', 'col-b']);
    });

    // col-a should be skipped, col-b should be queued.
    expect(dirtyColumns.has('col-a')).toBe(false);
    expect(dirtyColumns.has('col-b')).toBe(true);
  });

  it('autoSize event adds columns to allowShrink set', () => {
    const { resultRef, options } = setupHookWithMeasurer();

    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'autoSize',
        columns: ['col-a'],
      });
    });

    expect(options.allowShrinkColumnsRef.current.has('col-a')).toBe(true);
  });

  it('dragStart disables auto-sizing and marks manual resize as active', () => {
    const { resultRef, isAutoSizingEnabledRef, options } = setupHookWithMeasurer();

    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'dragStart',
        columns: ['col-a'],
      });
    });

    expect(isAutoSizingEnabledRef.current).toBe(false);
    expect(options.isManualResizeActiveRef.current).toBe(true);
  });

  it('dragEnd re-activates manual resize tracking', () => {
    const { resultRef, options } = setupHookWithMeasurer();

    // Start a drag.
    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'dragStart',
        columns: ['col-a'],
      });
    });
    expect(options.isManualResizeActiveRef.current).toBe(true);

    // End the drag.
    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'dragEnd',
        columns: ['col-a'],
      });
    });
    expect(options.isManualResizeActiveRef.current).toBe(false);
  });

  it('reset event re-enables auto-sizing and marks all auto columns dirty', () => {
    const { resultRef, dirtyColumns, isAutoSizingEnabledRef } = setupHookWithMeasurer();

    // Disable via dragStart.
    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'dragStart',
        columns: ['col-a'],
      });
    });
    expect(isAutoSizingEnabledRef.current).toBe(false);
    dirtyColumns.clear();

    // End drag.
    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'dragEnd',
        columns: ['col-a'],
      });
    });

    // Reset should re-enable and queue all columns.
    act(() => {
      resultRef.current!.handleManualResizeEvent({
        type: 'reset',
        columns: ['col-a'],
      });
    });

    expect(isAutoSizingEnabledRef.current).toBe(true);
    // Both auto-width columns should be queued.
    expect(dirtyColumns.has('col-a')).toBe(true);
    expect(dirtyColumns.has('col-b')).toBe(true);
  });
});
