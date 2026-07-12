/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnsDropdown.ts
 *
 * React hook for useGridTableColumnsDropdown.
 * Encapsulates state and side effects for the shared components.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useCallback, useMemo } from 'react';

type UseGridTableColumnsDropdownOptions<T> = {
  columns: GridColumnDefinition<T>[];
  lockedColumns: Set<string>;
  isColumnVisible: (key: string) => boolean;
  applyVisibilityChanges: (updater: (next: Record<string, boolean | undefined>) => boolean) => void;
  enableColumnVisibilityMenu: boolean;
};

type ColumnsDropdownConfig = {
  options: Array<{ label: string; value: string }>;
  value: string[];
  onChange: (value: string | string[]) => void;
};

// Builds the column visibility options and handler so GridTable does not have to
// assemble them inline. The Dropdown owns shared select-all/select-none controls.
export function useGridTableColumnsDropdown<T>({
  columns,
  lockedColumns,
  isColumnVisible,
  applyVisibilityChanges,
  enableColumnVisibilityMenu,
}: UseGridTableColumnsDropdownOptions<T>): ColumnsDropdownConfig | null {
  const hideableColumns = useMemo(
    () => columns.filter((column) => !lockedColumns.has(column.key)),
    [columns, lockedColumns]
  );

  const showColumnsDropdown = enableColumnVisibilityMenu && hideableColumns.length > 0;

  const handleColumnsDropdownChange = useCallback(
    (nextValue: string | string[]) => {
      if (!Array.isArray(nextValue)) {
        return;
      }

      const nextVisible = new Set(nextValue);
      applyVisibilityChanges((next) => {
        let changed = false;
        hideableColumns.forEach((column) => {
          const shouldShow = nextVisible.has(column.key);
          const currentlyVisible = isColumnVisible(column.key);
          if (shouldShow && !currentlyVisible) {
            if (column.key in next) {
              delete next[column.key];
            }
            changed = true;
          } else if (!shouldShow && currentlyVisible) {
            if (next[column.key] !== false) {
              next[column.key] = false;
              changed = true;
            }
          }
        });
        return changed;
      });
    },
    [applyVisibilityChanges, hideableColumns, isColumnVisible]
  );

  if (!showColumnsDropdown) {
    return null;
  }

  const options: ColumnsDropdownConfig['options'] = hideableColumns.map((column) => ({
    label: column.header,
    value: column.key,
  }));

  const value = hideableColumns
    .filter((column) => isColumnVisible(column.key))
    .map((column) => column.key);

  return { options, value, onChange: handleColumnsDropdownChange };
}
