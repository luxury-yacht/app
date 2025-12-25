/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnsDropdown.ts
 *
 * React hook for useGridTableColumnsDropdown.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useMemo } from 'react';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

const COLUMN_ACTION_SHOW_ALL = '__grid_columns_show_all__';
const COLUMN_ACTION_HIDE_ALL = '__grid_columns_hide_all__';

// Builds the column visibility dropdown (options + change handler) so GridTable
// doesn't reimplement show/hide-all logic and locked-column guards inline.

type UseGridTableColumnsDropdownOptions<T> = {
  columns: GridColumnDefinition<T>[];
  lockedColumns: Set<string>;
  isColumnVisible: (key: string) => boolean;
  applyVisibilityChanges: (updater: (next: Record<string, boolean | undefined>) => boolean) => void;
  enableColumnVisibilityMenu: boolean;
};

type ColumnsDropdownConfig = {
  options: Array<{ label: string; value: string; metadata?: { isAction?: boolean } }>;
  value: string[];
  onChange: (value: string | string[]) => void;
};

// Builds the column visibility dropdown (options + handlers) so GridTable doesn't
// have to assemble it inline. It honors locked columns, adds show/hide-all actions,
// and returns null when the menu should be hidden.
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

      const requestedShowAll = nextValue.includes(COLUMN_ACTION_SHOW_ALL);
      const requestedHideAll = nextValue.includes(COLUMN_ACTION_HIDE_ALL);

      if (requestedShowAll) {
        applyVisibilityChanges((next) => {
          let changed = false;
          hideableColumns.forEach((column) => {
            if (column.key in next) {
              delete next[column.key];
              changed = true;
            }
          });
          return changed;
        });
      }

      if (requestedHideAll) {
        applyVisibilityChanges((next) => {
          let changed = false;
          hideableColumns.forEach((column) => {
            if (next[column.key] !== false) {
              next[column.key] = false;
              changed = true;
            }
          });
          return changed;
        });
      }

      if (requestedShowAll || requestedHideAll) {
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

  const options: ColumnsDropdownConfig['options'] = [
    { label: 'Show All Columns', value: COLUMN_ACTION_SHOW_ALL, metadata: { isAction: true } },
    { label: 'Hide All Columns', value: COLUMN_ACTION_HIDE_ALL, metadata: { isAction: true } },
    ...hideableColumns.map((column) => ({
      label: column.header,
      value: column.key,
    })),
  ];

  const value = hideableColumns
    .filter((column) => isColumnVisible(column.key))
    .map((column) => column.key);

  return { options, value, onChange: handleColumnsDropdownChange };
}
