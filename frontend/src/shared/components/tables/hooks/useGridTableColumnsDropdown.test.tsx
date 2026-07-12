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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

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

  it('returns null when all columns are locked', () => {
    const result = renderHook({
      lockedColumns: new Set(['name', 'status', 'age']),
    });
    expect(result).toBeNull();
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

  it('excludes locked columns from options', () => {
    const result = renderHook({ lockedColumns: new Set(['status']) });
    expect(result).not.toBeNull();

    const columnLabels = requireValue(
      result,
      'expected test value in useGridTableColumnsDropdown.test.tsx'
    ).options.map((o) => o.label);
    expect(columnLabels).toContain('Name');
    expect(columnLabels).toContain('Age');
    expect(columnLabels).not.toContain('Status');
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
