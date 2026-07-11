/**
 * frontend/src/shared/components/tables/hooks/useGridTableAutoWidthMeasurementQueue.test.ts
 *
 * Regression tests for useDirtyQueue / handleManualResizeEvent.
 * Covers the autoSize event keeping phase in idle so markColumnsDirty
 * proceeds, and subsequent data-driven updates are not permanently suppressed.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  type DirtyQueueResult,
  useDirtyQueue,
} from '@shared/components/tables/hooks/useGridTableAutoWidthMeasurementQueue';
import type { ColumnWidthPhase } from '@shared/components/tables/hooks/useGridTableColumnWidths';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

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
    const phaseRef = { current: 'idle' as ColumnWidthPhase };
    const transitionPhase = vi.fn((to: ColumnWidthPhase) => {
      phaseRef.current = to;
    });

    const options = {
      tableRef: { current: document.createElement('div') },
      renderedColumnsRef: { current: columns },
      manuallyResizedColumnsRef: { current: new Set<string>() },
      naturalWidthsRef: { current: {} as Record<string, number> },
      dirtyColumnsRef: { current: dirtyColumns },
      columnHashesRef: { current: new Map<string, string>() },
      allowShrinkColumnsRef: { current: new Set<string>() },
      phaseRef,
      transitionPhase,
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

    return { resultRef, dirtyColumns, phaseRef };
  };

  it('autoSize event stays in idle phase and queues dirty columns', () => {
    const { resultRef, dirtyColumns, phaseRef } = setupHook();

    // Baseline: phase is idle (auto-sizing active).
    expect(phaseRef.current).toBe('idle');

    // Fire an autoSize event.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'autoSize',
        columns: ['col-a'],
      });
    });

    // Phase must stay idle after autoSize (not stuck in dragging).
    expect(phaseRef.current).toBe('idle');
    // The column must be queued as dirty.
    expect(dirtyColumns.has('col-a')).toBe(true);
  });

  it('data-driven markColumnsDirty works after an autoSize event', () => {
    const { resultRef, dirtyColumns, phaseRef } = setupHook();

    // Fire an autoSize event first.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'autoSize',
        columns: ['col-a'],
      });
    });

    // Clear dirty set to isolate the next call.
    dirtyColumns.clear();

    // Subsequent data-driven mark should work — phase must not be
    // permanently stuck in dragging.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).markColumnsDirty(['col-b']);
    });

    expect(phaseRef.current).not.toBe('dragging');
    expect(dirtyColumns.has('col-b')).toBe(true);
  });
});

describe('useDirtyQueue debounce and retry', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
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
    const phaseRef = { current: 'idle' as ColumnWidthPhase };
    const transitionPhase = vi.fn((to: ColumnWidthPhase) => {
      phaseRef.current = to;
    });
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
      phaseRef,
      transitionPhase,
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
      phaseRef,
      setColumnWidths,
      measureColumnWidth,
      options,
    };
  };

  it('debounces markColumnsDirty — dirty columns accumulate before flush', () => {
    const { resultRef, dirtyColumns } = setupHookWithMeasurer();

    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).markColumnsDirty(['col-a']);
    });
    expect(dirtyColumns.has('col-a')).toBe(true);

    // Mark another column before the debounce fires.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).markColumnsDirty(['col-b']);
    });
    expect(dirtyColumns.has('col-b')).toBe(true);

    // Both should be queued before the debounce timer fires.
    expect(dirtyColumns.size).toBe(2);
  });

  it('skips markColumnsDirty when phase is dragging', () => {
    const { resultRef, dirtyColumns, phaseRef } = setupHookWithMeasurer();

    // Set phase to dragging (replaces both old isAutoSizingEnabled=false
    // and isManualResizeActive=true guards).
    phaseRef.current = 'dragging';

    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).markColumnsDirty(['col-a']);
    });

    // Should not have queued anything.
    expect(dirtyColumns.has('col-a')).toBe(false);
  });

  it('skips manually resized columns in markColumnsDirty', () => {
    const { resultRef, dirtyColumns, options } = setupHookWithMeasurer();

    // Mark col-a as manually resized.
    options.manuallyResizedColumnsRef.current.add('col-a');

    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).markColumnsDirty(['col-a', 'col-b']);
    });

    // col-a should be skipped, col-b should be queued.
    expect(dirtyColumns.has('col-a')).toBe(false);
    expect(dirtyColumns.has('col-b')).toBe(true);
  });

  it('autoSize event adds columns to allowShrink set', () => {
    const { resultRef, options } = setupHookWithMeasurer();

    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'autoSize',
        columns: ['col-a'],
      });
    });

    expect(options.allowShrinkColumnsRef.current.has('col-a')).toBe(true);
  });

  it('dragStart transitions phase to dragging', () => {
    const { resultRef, phaseRef } = setupHookWithMeasurer();

    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'dragStart',
        columns: ['col-a'],
      });
    });

    expect(phaseRef.current).toBe('dragging');
  });

  it('dragEnd transitions phase back to idle', () => {
    const { resultRef, phaseRef } = setupHookWithMeasurer();

    // Start a drag.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'dragStart',
        columns: ['col-a'],
      });
    });
    expect(phaseRef.current).toBe('dragging');

    // End the drag.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'dragEnd',
        columns: ['col-a'],
      });
    });
    expect(phaseRef.current).toBe('idle');
  });

  it('returns to idle after full drag cycle so data changes trigger measurement', () => {
    const { resultRef, dirtyColumns, phaseRef } = setupHookWithMeasurer();

    // 1. Start a drag — phase should be dragging.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'dragStart',
        columns: ['col-a'],
      });
    });
    expect(phaseRef.current).toBe('dragging');

    // 2. End the drag — phase must return to idle.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'dragEnd',
        columns: ['col-a'],
      });
    });
    expect(phaseRef.current).toBe('idle');

    // 3. Simulate a data change after the drag cycle completes.
    dirtyColumns.clear();
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).markColumnsDirty(['col-a']);
    });

    // col-a must be queued — the phase gate should be open again.
    expect(dirtyColumns.has('col-a')).toBe(true);
  });

  it('reset event stays in idle and marks all auto columns dirty', () => {
    const { resultRef, dirtyColumns, phaseRef } = setupHookWithMeasurer();

    // Perform a full drag cycle first.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'dragStart',
        columns: ['col-a'],
      });
    });
    expect(phaseRef.current).toBe('dragging');
    dirtyColumns.clear();

    // End drag.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'dragEnd',
        columns: ['col-a'],
      });
    });

    // Reset should stay in idle and queue all columns.
    act(() => {
      requireValue(
        resultRef.current,
        'expected test value in useGridTableAutoWidthMeasurementQueue.test.tsx'
      ).handleManualResizeEvent({
        type: 'reset',
        columns: ['col-a'],
      });
    });

    expect(phaseRef.current).toBe('idle');
    // Both auto-width columns should be queued.
    expect(dirtyColumns.has('col-a')).toBe(true);
    expect(dirtyColumns.has('col-b')).toBe(true);
  });
});
