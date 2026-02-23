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
  type ManualResizeEvent,
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
