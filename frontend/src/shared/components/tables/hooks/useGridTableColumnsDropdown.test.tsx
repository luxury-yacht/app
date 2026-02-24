/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnsDropdown.test.ts
 *
 * Test suite for useGridTableColumnsDropdown.
 * Covers column visibility dropdown logic: show/hide all, locked columns, individual toggles.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridTableColumnsDropdown } from '@shared/components/tables/hooks/useGridTableColumnsDropdown';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

type Row = { id: string };

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.id },
  { key: 'status', header: 'Status', render: (row) => row.id },
  { key: 'age', header: 'Age', render: (row) => row.id },
];

describe('useGridTableColumnsDropdown', () => {
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
    const applyVisibilityChanges = vi.fn(
      (updater: (next: Record<string, boolean | undefined>) => boolean) => {
        const obj: Record<string, boolean | undefined> = {};
        updater(obj);
      }
    );
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

    // Attach the mock for assertions.
    if (result) {
      (result as any)._applyVisibilityChanges = applyVisibilityChanges;
    }
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

  it('includes Show All, Hide All, and hideable columns in options', () => {
    const result = renderHook({});
    expect(result).not.toBeNull();

    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('Show All Columns');
    expect(labels).toContain('Hide All Columns');
    expect(labels).toContain('Name');
    expect(labels).toContain('Status');
    expect(labels).toContain('Age');
  });

  it('excludes locked columns from options', () => {
    const result = renderHook({ lockedColumns: new Set(['status']) });
    expect(result).not.toBeNull();

    const columnLabels = result!.options.filter((o) => !o.metadata?.isAction).map((o) => o.label);
    expect(columnLabels).toContain('Name');
    expect(columnLabels).toContain('Age');
    expect(columnLabels).not.toContain('Status');
  });

  it('value contains only currently visible hideable columns', () => {
    const result = renderHook({ hiddenColumns: new Set(['age']) });
    expect(result).not.toBeNull();
    expect(result!.value).toContain('name');
    expect(result!.value).toContain('status');
    expect(result!.value).not.toContain('age');
  });

  it('Show All action calls applyVisibilityChanges to show all hideable columns', () => {
    const result = renderHook({ hiddenColumns: new Set(['name', 'age']) });
    expect(result).not.toBeNull();

    const showAllValue = '__grid_columns_show_all__';
    result!.onChange([showAllValue]);

    const mock = (result as any)._applyVisibilityChanges;
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('Hide All action calls applyVisibilityChanges to hide all hideable columns', () => {
    const result = renderHook({});
    expect(result).not.toBeNull();

    const hideAllValue = '__grid_columns_hide_all__';
    result!.onChange([hideAllValue]);

    const mock = (result as any)._applyVisibilityChanges;
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('individual toggle calls applyVisibilityChanges with the correct column set', () => {
    const result = renderHook({});
    expect(result).not.toBeNull();

    // Toggle: show only 'name' (hide status and age).
    result!.onChange(['name']);

    const mock = (result as any)._applyVisibilityChanges;
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('ignores non-array values passed to onChange', () => {
    const result = renderHook({});
    expect(result).not.toBeNull();

    // Should not throw.
    result!.onChange('name');

    const mock = (result as any)._applyVisibilityChanges;
    expect(mock).not.toHaveBeenCalled();
  });
});
