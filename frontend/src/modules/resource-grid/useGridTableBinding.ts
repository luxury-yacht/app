/**
 * frontend/src/modules/resource-grid/useGridTableBinding.ts
 *
 * Builds the GridTable prop bundle shared by resource-grid adapters, including
 * sorting, persistence-backed table state, virtualization, and canonical row keys.
 */

import {
  type ColumnWidthState,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
  type GridTableFilterConfig,
  type GridTableVirtualizationOptions,
} from '@shared/components/tables/GridTable';
import { useMemo } from 'react';
import { type SortConfig, type SortDirection, useTableSort } from '@/hooks/useTableSort';
import type { ResourceGridTableMode } from './resourceGridTableTypes';
import { isQueryBackedResourceGridTableMode } from './resourceGridTableTypes';

interface GridTableBindingPersistence {
  sortConfig?: SortConfig | null;
  setSortConfig?: (next: SortConfig | null) => void;
  columnWidths?: Record<string, ColumnWidthState> | null;
  setColumnWidths?: (next: Record<string, ColumnWidthState>) => void;
  columnVisibility?: Record<string, boolean> | null;
  setColumnVisibility?: (next: Record<string, boolean>) => void;
}

interface GridTableBindingParams<T> {
  data: T[];
  tableMode: ResourceGridTableMode;
  columns: GridColumnDefinition<T>[];
  keyExtractor: (item: T, index: number) => string;
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
  diagnosticsLabel?: string;
  rowIdentity?: (item: T, index: number) => string;
  filters?: GridTableFilterConfig<T>;
  persistence?: GridTableBindingPersistence;
  virtualization?: GridTableVirtualizationOptions;
}

export function useGridTableBinding<T>({
  data,
  tableMode,
  columns,
  keyExtractor,
  defaultSortKey,
  defaultSortDirection = 'asc',
  diagnosticsLabel,
  rowIdentity,
  filters,
  persistence,
  virtualization = GRIDTABLE_VIRTUALIZATION_DEFAULT,
}: GridTableBindingParams<T>) {
  const { sortedData, sortConfig, handleSort } = useTableSort(
    data,
    defaultSortKey,
    defaultSortDirection,
    {
      columns,
      controlledSort: persistence?.sortConfig,
      onChange: persistence?.setSortConfig,
      diagnosticsLabel,
      rowIdentity,
      disableLocalSort: isQueryBackedResourceGridTableMode(tableMode),
    }
  );

  return useMemo(
    () => ({
      sortedData,
      sortConfig,
      gridTableProps: {
        data: sortedData,
        keyExtractor,
        onSort: handleSort,
        sortConfig,
        ...(filters ? { filters } : {}),
        virtualization,
        ...(persistence
          ? {
              columnWidths: persistence.columnWidths ?? null,
              onColumnWidthsChange: persistence.setColumnWidths,
              columnVisibility: persistence.columnVisibility ?? null,
              onColumnVisibilityChange: persistence.setColumnVisibility,
              allowHorizontalOverflow: true,
            }
          : {}),
      },
    }),
    [filters, handleSort, keyExtractor, persistence, sortConfig, sortedData, virtualization]
  );
}
