/**
 * frontend/src/modules/namespace/hooks/useNamespaceGridTablePersistence.ts
 *
 * Hook for useNamespaceGridTablePersistence.
 * - Manages grid table state persistence for namespace-specific data views.
 * - Integrates with kubeconfig and namespace context to scope data appropriately.
 * - Provides sorting, filtering, column width, and visibility state management.
 * - Exposes a reset function to clear persisted state.
 * - Utilizes useGridTablePersistence for core persistence logic.
 */

import type { SortConfig } from '@hooks/useTableSort';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type {
  ResourceGridPersistence,
  ResourceGridTableRow,
} from '@modules/resource-grid/resourceGridTableTypes';
import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';
import type { GridTableFilterPersistenceOptions } from '@shared/components/tables/persistence/gridTablePersistence';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useMemo, useState } from 'react';

export interface NamespaceGridTablePersistenceParams<T> {
  viewId: string;
  namespace: string;
  columns: GridColumnDefinition<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  defaultSort?: SortConfig;
  filterOptions?: GridTableFilterPersistenceOptions;
  pageSizeOptions?: readonly number[];
  enabled?: boolean;
}

export interface NamespaceGridTablePersistenceResult<
  T extends ResourceGridTableRow = ResourceGridTableRow,
> {
  sortConfig: SortConfig;
  onSortChange: (next: SortConfig) => void;
  columnWidths: Record<string, ColumnWidthState> | null;
  setColumnWidths: (next: Record<string, ColumnWidthState>) => void;
  columnVisibility: Record<string, boolean> | null;
  setColumnVisibility: (next: Record<string, boolean>) => void;
  filters: GridTableFilterState;
  setFilters: (next: GridTableFilterState) => void;
  pageSize: number | null;
  setPageSize: (next: number | null) => void;
  isNamespaceScoped: boolean;
  resetState: () => void;
  hydrated: boolean;
  /** The same state in the standard ResourceGridPersistence shape, memoized. */
  persistence: ResourceGridPersistence<T>;
}

export function useNamespaceGridTablePersistence<T extends ResourceGridTableRow>({
  viewId,
  namespace,
  columns,
  data,
  keyExtractor,
  defaultSort = { key: '', direction: null },
  filterOptions,
  pageSizeOptions,
  enabled = true,
}: NamespaceGridTablePersistenceParams<T>): NamespaceGridTablePersistenceResult<T> {
  const { selectedClusterId } = useKubeconfig();
  const isNamespaceScoped = namespace !== ALL_NAMESPACES_SCOPE;
  const [localSort, setLocalSort] = useState<SortConfig>(defaultSort);

  const {
    sortConfig: persistedSort,
    setSortConfig: setPersistedSort,
    columnWidths,
    setColumnWidths,
    columnVisibility,
    setColumnVisibility,
    filters,
    setFilters,
    pageSize,
    setPageSize,
    resetState,
    hydrated,
  } = useGridTablePersistence<T>({
    viewId,
    clusterIdentity: selectedClusterId,
    namespace,
    isNamespaceScoped,
    columns,
    data,
    keyExtractor,
    // isNamespaceScoped is passed as a top-level param; useGridTablePersistence
    // merges it into filterOptions internally, so we don't duplicate it here.
    filterOptions,
    pageSizeOptions,
    enabled,
  });

  const sortConfig = useMemo<SortConfig>(
    () => persistedSort ?? localSort,
    [localSort, persistedSort]
  );

  const handleSortChange = useMemo(
    () => (next: SortConfig | null) => {
      setLocalSort(next ?? { key: '', direction: null });
      setPersistedSort(next);
    },
    [setPersistedSort]
  );

  const handleReset = useMemo(
    () => () => {
      setLocalSort(defaultSort);
      resetState();
    },
    [defaultSort, resetState]
  );

  // The standard ResourceGridPersistence shape (onSortChange → setSortConfig is
  // the one renamed member), so consumers that need the shared persistence
  // contract take this directly instead of hand-remapping the fields.
  const persistence = useMemo<ResourceGridPersistence<T>>(
    () => ({
      sortConfig,
      setSortConfig: handleSortChange,
      columnWidths,
      setColumnWidths,
      columnVisibility,
      setColumnVisibility,
      filters,
      setFilters,
      pageSize,
      setPageSize,
      resetState: handleReset,
      hydrated,
    }),
    [
      columnVisibility,
      columnWidths,
      filters,
      handleReset,
      handleSortChange,
      hydrated,
      pageSize,
      setColumnVisibility,
      setColumnWidths,
      setFilters,
      setPageSize,
      sortConfig,
    ]
  );

  return {
    sortConfig,
    onSortChange: handleSortChange,
    columnWidths,
    setColumnWidths,
    columnVisibility,
    setColumnVisibility,
    filters,
    setFilters,
    pageSize,
    setPageSize,
    isNamespaceScoped,
    resetState: handleReset,
    hydrated,
    persistence,
  };
}
