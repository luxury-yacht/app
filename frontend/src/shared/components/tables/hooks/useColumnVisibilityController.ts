import { useCallback, useEffect, useMemo, useState } from 'react';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

const areVisibilityMapsEqual = (
  a: Record<string, boolean>,
  b: Record<string, boolean>
): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};

// Controls which columns GridTable renders: respects locked/non-hideable columns,
// merges controlled visibility with internal state, and provides mutators for
// callers (including show/hide-all helpers upstream).

export interface ColumnVisibilityControllerOptions<T> {
  columns: GridColumnDefinition<T>[];
  columnVisibility?: Record<string, boolean> | null;
  nonHideableColumns: string[];
  onColumnVisibilityChange?: (next: Record<string, boolean>) => void;
}

export interface ColumnVisibilityController<T> {
  renderedColumns: GridColumnDefinition<T>[];
  isColumnVisible: (key: string) => boolean;
  toggleColumnVisibility: (key: string) => void;
  updateColumnVisibility: (key: string, visible: boolean) => void;
  applyVisibilityChanges: (mutator: (next: Record<string, boolean>) => boolean) => void;
  effectiveColumnVisibility: Record<string, boolean> | undefined;
  lockedColumns: Set<string>;
}

export function useColumnVisibilityController<T>({
  columns,
  columnVisibility,
  nonHideableColumns,
  onColumnVisibilityChange,
}: ColumnVisibilityControllerOptions<T>): ColumnVisibilityController<T> {
  const [localColumnVisibility, setLocalColumnVisibility] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (columnVisibility == null) {
      return;
    }
    // Avoid re-setting local state when the map is referentially new but equivalent.
    setLocalColumnVisibility((prev) =>
      areVisibilityMapsEqual(prev, columnVisibility) ? prev : columnVisibility
    );
  }, [columnVisibility]);

  const lockedColumns = useMemo(() => {
    const set = new Set<string>(['kind', 'type', 'name']);
    nonHideableColumns.forEach((key) => set.add(key));
    return set;
  }, [nonHideableColumns]);

  const effectiveColumnVisibility = useMemo(
    () => columnVisibility ?? localColumnVisibility,
    [columnVisibility, localColumnVisibility]
  );

  const isColumnVisible = useCallback(
    (key: string) => {
      if (lockedColumns.has(key)) {
        return true;
      }
      if (!effectiveColumnVisibility) {
        return true;
      }
      return effectiveColumnVisibility[key] !== false;
    },
    [effectiveColumnVisibility, lockedColumns]
  );

  const applyVisibilityChanges = useCallback(
    (mutator: (next: Record<string, boolean>) => boolean) => {
      const base = columnVisibility ?? localColumnVisibility;
      const next: Record<string, boolean> = { ...base };
      let changed = mutator(next);

      lockedColumns.forEach((lockedKey) => {
        if (lockedKey in next) {
          delete next[lockedKey];
          changed = true;
        }
      });

      if (!changed) {
        return;
      }

      if (!columnVisibility) {
        setLocalColumnVisibility(next);
      }

      onColumnVisibilityChange?.(next);
    },
    [columnVisibility, localColumnVisibility, lockedColumns, onColumnVisibilityChange]
  );

  const updateColumnVisibility = useCallback(
    (columnKey: string, visible: boolean) => {
      if (lockedColumns.has(columnKey)) {
        return;
      }
      applyVisibilityChanges((next) => {
        if (visible) {
          if (columnKey in next) {
            delete next[columnKey];
            return true;
          }
          return false;
        }

        if (next[columnKey] !== false) {
          next[columnKey] = false;
          return true;
        }

        return false;
      });
    },
    [applyVisibilityChanges, lockedColumns]
  );

  const toggleColumnVisibility = useCallback(
    (columnKey: string) => {
      const currentlyVisible = isColumnVisible(columnKey);
      updateColumnVisibility(columnKey, !currentlyVisible);
    },
    [isColumnVisible, updateColumnVisibility]
  );

  const renderedColumns = useMemo(
    () => columns.filter((column) => isColumnVisible(column.key)),
    [columns, isColumnVisible]
  );

  return {
    renderedColumns,
    isColumnVisible,
    toggleColumnVisibility,
    updateColumnVisibility,
    applyVisibilityChanges,
    effectiveColumnVisibility,
    lockedColumns,
  };
}
