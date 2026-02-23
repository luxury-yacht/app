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
import { useMemo, useState } from 'react';
import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';
import type { SortConfig } from '@hooks/useTableSort';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import type { GridTableFilterPersistenceOptions } from '@shared/components/tables/persistence/gridTablePersistence';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';

export interface NamespaceGridTablePersistenceParams<T> {
  viewId: string;
  namespace: string;
  columns: GridColumnDefinition<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  defaultSort?: SortConfig;
  filterOptions?: GridTableFilterPersistenceOptions;
}

export interface NamespaceGridTablePersistenceResult {
  sortConfig: SortConfig;
  onSortChange: (next: SortConfig) => void;
  columnWidths: Record<string, ColumnWidthState> | null;
  setColumnWidths: (next: Record<string, ColumnWidthState>) => void;
  columnVisibility: Record<string, boolean> | null;
  setColumnVisibility: (next: Record<string, boolean>) => void;
  filters: GridTableFilterState;
  setFilters: (next: GridTableFilterState) => void;
  isNamespaceScoped: boolean;
  resetState: () => void;
}

export function useNamespaceGridTablePersistence<T>({
  viewId,
  namespace,
  columns,
  data,
  keyExtractor,
  defaultSort = { key: '', direction: null },
  filterOptions,
}: NamespaceGridTablePersistenceParams<T>): NamespaceGridTablePersistenceResult {
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
    resetState,
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
  });

  const sortConfig = useMemo<SortConfig>(
    () => persistedSort ?? localSort,
    [localSort, persistedSort]
  );

  const handleSortChange = useMemo(
    () => (next: SortConfig) => {
      setLocalSort(next);
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

  return {
    sortConfig,
    onSortChange: handleSortChange,
    columnWidths,
    setColumnWidths,
    columnVisibility,
    setColumnVisibility,
    filters,
    setFilters,
    isNamespaceScoped,
    resetState: handleReset,
  };
}
