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
  canReorderColumns?: boolean;
  moveColumn: (key: string, offset: -1 | 1) => void;
  reorderColumn: (key: string, targetIndex: number) => void;
  canResetColumnOrder: boolean;
  resetColumnOrder: () => void;
  canResetAutoWidthColumns: boolean;
  resetAutoWidthColumns: () => void;
  customMetadataColumnKeys?: Set<string>;
  onAddCustomMetadataColumn?: () => void;
  onEditCustomMetadataColumn?: (key: string) => void;
  onRemoveCustomMetadataColumn?: (key: string) => void;
};

type ColumnsDropdownConfig = {
  options: Array<{ label: string; value: string; disabled?: boolean }>;
  value: string[];
  onChange: (value: string | string[]) => void;
  /** Trigger label. Names the hidden count, and only while something is hidden. */
  renderValue: () => string;
  onMoveColumn?: (key: string, offset: -1 | 1) => void;
  onReorderColumn?: (key: string, targetIndex: number) => void;
  canResetColumns: boolean;
  onResetColumns: () => void;
  customMetadataColumnKeys?: Set<string>;
  onAddCustomMetadataColumn?: () => void;
  onEditCustomMetadataColumn?: (key: string) => void;
  onRemoveCustomMetadataColumn?: (key: string) => void;
};

// Builds the column visibility options and handler so GridTable does not have to
// assemble them inline. The Dropdown owns shared select-all/select-none controls.
export function useGridTableColumnsDropdown<T>({
  columns,
  lockedColumns,
  isColumnVisible,
  applyVisibilityChanges,
  enableColumnVisibilityMenu,
  canReorderColumns = true,
  moveColumn,
  reorderColumn,
  canResetColumnOrder,
  resetColumnOrder,
  canResetAutoWidthColumns,
  resetAutoWidthColumns,
  customMetadataColumnKeys,
  onAddCustomMetadataColumn,
  onEditCustomMetadataColumn,
  onRemoveCustomMetadataColumn,
}: UseGridTableColumnsDropdownOptions<T>): ColumnsDropdownConfig | null {
  const hideableColumns = useMemo(
    () => columns.filter((column) => !lockedColumns.has(column.key)),
    [columns, lockedColumns]
  );

  const showColumnsDropdown =
    enableColumnVisibilityMenu &&
    (hideableColumns.length > 0 || columns.length > 1 || Boolean(onAddCustomMetadataColumn));

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

  // One reset restores every column preference owned by this menu.
  const handleResetColumns = useCallback(() => {
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
    resetColumnOrder();
    resetAutoWidthColumns();
  }, [applyVisibilityChanges, hideableColumns, resetAutoWidthColumns, resetColumnOrder]);

  if (!showColumnsDropdown) {
    return null;
  }

  const options: ColumnsDropdownConfig['options'] = columns.map((column) => ({
    label: column.header,
    value: column.key,
    disabled: lockedColumns.has(column.key),
  }));

  const value = columns.filter((column) => isColumnVisible(column.key)).map((column) => column.key);

  // Required columns are always visible, so `value` covers them too: the counts
  // differ exactly when the user has hidden something. The label names that
  // count rather than reporting shown-of-total, which would make the reader
  // subtract to learn the one thing they want to know.
  const hiddenCount = options.length - value.length;

  return {
    options,
    value,
    onChange: handleColumnsDropdownChange,
    renderValue: () => (hiddenCount > 0 ? `Columns (${hiddenCount} hidden)` : 'Columns'),
    onMoveColumn: canReorderColumns ? moveColumn : undefined,
    onReorderColumn: canReorderColumns ? reorderColumn : undefined,
    canResetColumns:
      (canReorderColumns && canResetColumnOrder) || canResetAutoWidthColumns || hiddenCount > 0,
    onResetColumns: handleResetColumns,
    customMetadataColumnKeys,
    onAddCustomMetadataColumn,
    onEditCustomMetadataColumn,
    onRemoveCustomMetadataColumn,
  };
}
