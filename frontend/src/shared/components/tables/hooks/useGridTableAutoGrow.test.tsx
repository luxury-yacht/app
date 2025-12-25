/**
 * frontend/src/shared/components/tables/hooks/useGridTableAutoGrow.test.tsx
 *
 * Test suite for useGridTableAutoGrow.
 * Covers key behaviors and edge cases for useGridTableAutoGrow.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGridTableAutoGrow } from '@shared/components/tables/hooks/useGridTableAutoGrow';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useGridTableAutoGrow', () => {
  it('updates column widths when measured width grows', async () => {
    const tableRef = { current: document.createElement('div') };
    const container = document.createElement('div');
    container.className = 'gridtable-wrapper';
    container.appendChild(tableRef.current);
    document.body.appendChild(container);

    const columns: GridColumnDefinition<{ value: string }>[] = [
      { key: 'kind', header: 'Kind', render: (row) => row.value },
      { key: 'name', header: 'Name', render: (row) => row.value },
    ];

    const setColumnWidths = vi.fn(
      (updater: (prev: Record<string, number>) => Record<string, number>) => {
        const next = updater({ kind: 100, name: 150 });
        return next;
      }
    );

    const reconcile = vi.fn((base: Record<string, number>) => base);
    const measure = vi.fn(() => 140);
    const updateNaturalWidth = vi.fn();

    const Harness = () => {
      useGridTableAutoGrow({
        tableRef,
        tableDataLength: 5,
        renderedColumns: columns,
        isKindColumnKey: (key) => key === 'kind',
        externalColumnWidths: null,
        measureColumnWidth: measure,
        setColumnWidths,
        reconcileWidthsToContainer: reconcile,
        updateNaturalWidth,
      });
      return null;
    };

    const root = ReactDOM.createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Harness />);
    });

    expect(setColumnWidths).toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalled();
    expect(updateNaturalWidth).toHaveBeenCalledWith('kind', 140);
  });
});
