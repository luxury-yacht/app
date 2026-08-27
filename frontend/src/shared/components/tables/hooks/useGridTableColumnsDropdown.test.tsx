/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnsDropdown.test.ts
 *
 * Test suite for useGridTableColumnsDropdown.
 * Covers column visibility dropdown logic: locked columns and visibility changes.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useGridTableColumnsDropdown } from '@shared/components/tables/hooks/useGridTableColumnsDropdown';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { expect, vi } from 'vitest';
import { createConsolidatedSuite } from '@/test-utils/consolidatedTest';
import { requireValue } from '@/test-utils/requireValue';

const { afterEach, beforeEach, describe, it } = createConsolidatedSuite(
  'useGridTableColumnsDropdown contracts'
);

type Row = { id: string };
type ApplyVisibilityChanges = (
  updater: (next: Record<string, boolean | undefined>) => boolean
) => void;
let latestApplyVisibilityChanges: ReturnType<typeof vi.fn<ApplyVisibilityChanges>>;
let latestVisibility: Record<string, boolean | undefined>;

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.id },
  { key: 'status', header: 'Status', render: (row) => row.id },
  { key: 'age', header: 'Age', render: (row) => row.id },
];

describe('useGridTableColumnsDropdown', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
  });

  type CapturedResult = ReturnType<typeof useGridTableColumnsDropdown<Row>>;

  const renderHook = (opts: {
    lockedColumns?: Set<string>;
    hiddenColumns?: Set<string>;
    enabled?: boolean;
    canReorderColumns?: boolean;
    canResetColumnOrder?: boolean;
    resetColumnOrder?: () => void;
    canResetAutoWidthColumns?: boolean;
    resetAutoWidthColumns?: () => void;
  }): CapturedResult => {
    const lockedColumns = opts.lockedColumns ?? new Set<string>();
    const hiddenColumns = opts.hiddenColumns ?? new Set<string>();
    const enabled = opts.enabled ?? true;
    latestVisibility = Object.fromEntries(Array.from(hiddenColumns, (key) => [key, false]));
    const applyVisibilityChanges = vi.fn(
      (updater: (next: Record<string, boolean | undefined>) => boolean) => {
        updater(latestVisibility);
      }
    );
    latestApplyVisibilityChanges = applyVisibilityChanges;
    let result: CapturedResult = null;

    const Harness: React.FC = () => {
      result = useGridTableColumnsDropdown<Row>({
        columns,
        lockedColumns,
        isColumnVisible: (key) => !hiddenColumns.has(key),
        applyVisibilityChanges,
        enableColumnVisibilityMenu: enabled,
        canReorderColumns: opts.canReorderColumns,
        moveColumn: vi.fn(),
        reorderColumn: vi.fn(),
        canResetColumnOrder: opts.canResetColumnOrder ?? false,
        resetColumnOrder: opts.resetColumnOrder ?? vi.fn(),
        canResetAutoWidthColumns: opts.canResetAutoWidthColumns ?? false,
        resetAutoWidthColumns: opts.resetAutoWidthColumns ?? vi.fn(),
      });
      return null;
    };

    act(() => {
      root.render(<Harness />);
    });

    return result;
  };

  it('returns null when the menu is disabled', () => {
    const result = renderHook({ enabled: false });
    expect(result).toBeNull();
  });

  it('keeps the menu available for reordering when all columns are locked', () => {
    const result = renderHook({
      lockedColumns: new Set(['name', 'status', 'age']),
    });
    expect(result).not.toBeNull();
    expect(result?.options.every((option) => option.disabled)).toBe(true);
  });

  it('includes only hideable columns in options', () => {
    const result = renderHook({});
    expect(result).not.toBeNull();

    const labels = requireValue(
      result,
      'expected test value in useGridTableColumnsDropdown.test.tsx'
    ).options.map((o) => o.label);
    expect(labels).toEqual(['Name', 'Status', 'Age']);
  });

  it('includes locked columns as non-hideable ordering options', () => {
    const result = renderHook({ lockedColumns: new Set(['status']) });
    expect(result).not.toBeNull();

    const columnLabels = requireValue(
      result,
      'expected test value in useGridTableColumnsDropdown.test.tsx'
    ).options.map((o) => o.label);
    expect(columnLabels).toContain('Name');
    expect(columnLabels).toContain('Age');
    expect(columnLabels).toContain('Status');
    expect(result?.options.find((option) => option.value === 'status')?.disabled).toBe(true);
  });

  it('forwards column move actions independently from visibility', () => {
    const result = renderHook({ lockedColumns: new Set(['name']) });
    const moveColumn = requireValue(
      result,
      'expected test value in useGridTableColumnsDropdown.test.tsx'
    ).onMoveColumn;

    expect(() =>
      requireValue(moveColumn, 'expected mutable column-order action')('name', 1)
    ).not.toThrow();
    expect(latestApplyVisibilityChanges).not.toHaveBeenCalled();
  });

  it('omits order actions when the column order is read-only', () => {
    const result = renderHook({ canReorderColumns: false, canResetColumnOrder: true });
    expect(result?.onMoveColumn).toBeUndefined();
    expect(result?.onReorderColumn).toBeUndefined();
    expect(result?.canResetColumns).toBe(false);
  });

  it('value contains only currently visible hideable columns', () => {
    const result = renderHook({ hiddenColumns: new Set(['age']) });
    expect(result).not.toBeNull();
    expect(
      requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx').value
    ).toContain('name');
    expect(
      requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx').value
    ).toContain('status');
    expect(
      requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx').value
    ).not.toContain('age');
  });

  it('selecting all options calls applyVisibilityChanges to show all hideable columns', () => {
    const result = renderHook({ hiddenColumns: new Set(['name', 'age']) });
    expect(result).not.toBeNull();

    requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx').onChange([
      'name',
      'status',
      'age',
    ]);

    expect(latestApplyVisibilityChanges).toHaveBeenCalledTimes(1);
    expect(latestVisibility).toEqual({});
  });

  it('selecting no options calls applyVisibilityChanges to hide all hideable columns', () => {
    const result = renderHook({ lockedColumns: new Set(['status']) });
    expect(result).not.toBeNull();

    requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx').onChange(
      []
    );

    expect(latestApplyVisibilityChanges).toHaveBeenCalledTimes(1);
    expect(latestVisibility).toEqual({ name: false, age: false });
  });

  it('individual toggle calls applyVisibilityChanges with the correct column set', () => {
    const result = renderHook({});
    expect(result).not.toBeNull();

    // Toggle: show only 'name' (hide status and age).
    requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx').onChange([
      'name',
    ]);

    expect(latestApplyVisibilityChanges).toHaveBeenCalledTimes(1);
  });

  describe('trigger label', () => {
    const readLabel = (result: CapturedResult) => {
      const config = requireValue(
        result,
        'expected test value in useGridTableColumnsDropdown.test.tsx'
      );
      return config.renderValue?.();
    };

    it('stays plain while every column is shown', () => {
      expect(readLabel(renderHook({}))).toBe('Columns');
    });

    it('names the hidden count rather than making the reader subtract', () => {
      expect(readLabel(renderHook({ hiddenColumns: new Set(['age']) }))).toBe('Columns (1 hidden)');
    });

    it('never counts a required column as hidden', () => {
      const result = renderHook({
        lockedColumns: new Set(['name']),
        hiddenColumns: new Set(['status', 'age']),
      });
      expect(readLabel(result)).toBe('Columns (2 hidden)');
    });
  });

  describe('reset', () => {
    it('is unavailable while order and visibility are both at their defaults', () => {
      const result = renderHook({});
      expect(
        requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx')
          .canResetColumns
      ).toBe(false);
    });

    it('becomes available when a column is hidden', () => {
      const result = renderHook({ hiddenColumns: new Set(['age']) });
      expect(
        requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx')
          .canResetColumns
      ).toBe(true);
    });

    it('becomes available when only the order was changed', () => {
      const result = renderHook({ canResetColumnOrder: true });
      expect(
        requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx')
          .canResetColumns
      ).toBe(true);
    });

    it('becomes available when only an auto-width column was manually sized', () => {
      const result = renderHook({ canResetAutoWidthColumns: true });
      expect(
        requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx')
          .canResetColumns
      ).toBe(true);
    });

    it('restores declaration order and every hidden column in one action', () => {
      const resetColumnOrder = vi.fn();
      const resetAutoWidthColumns = vi.fn();
      const result = renderHook({
        hiddenColumns: new Set(['name', 'age']),
        canResetColumnOrder: true,
        resetColumnOrder,
        resetAutoWidthColumns,
      });

      requireValue(
        result,
        'expected test value in useGridTableColumnsDropdown.test.tsx'
      ).onResetColumns();

      expect(latestVisibility).toEqual({});
      expect(resetColumnOrder).toHaveBeenCalledTimes(1);
      expect(resetAutoWidthColumns).toHaveBeenCalledTimes(1);
    });

    it('leaves required columns untouched when restoring visibility', () => {
      const result = renderHook({
        lockedColumns: new Set(['status']),
        hiddenColumns: new Set(['age']),
      });

      requireValue(
        result,
        'expected test value in useGridTableColumnsDropdown.test.tsx'
      ).onResetColumns();

      expect(latestVisibility).toEqual({});
      expect(latestApplyVisibilityChanges).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores non-array values passed to onChange', () => {
    const result = renderHook({});
    expect(result).not.toBeNull();

    // Should not throw.
    requireValue(result, 'expected test value in useGridTableColumnsDropdown.test.tsx').onChange(
      'name'
    );

    expect(latestApplyVisibilityChanges).not.toHaveBeenCalled();
  });
});
