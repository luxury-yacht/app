import { useMemo } from 'react';
import type { RefreshDomain } from '@/core/refresh/types';
import type { GridTableFilterOptions } from '@shared/components/tables/GridTable';
import { useNamespaceResourceGridTable } from './useResourceGridTable';
import type {
  NamespaceResourceGridTableParams,
  ResourceGridTableResult,
  ResourceGridTableRow,
} from './resourceGridTableTypes';
import { useTypedResourceQuery, type TypedQueryPayload } from './useTypedResourceQuery';
import {
  mergeQueryBackedFilterOptions,
  queryBackedPaginationProps,
  useQueryBackedTableState,
} from './queryBackedTableState';

export interface QueryBackedNamespaceGridResult<
  T extends ResourceGridTableRow,
> extends ResourceGridTableResult<T> {
  rows: T[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface QueryBackedNamespaceGridParams<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
> extends Omit<
  NamespaceResourceGridTableParams<TRow>,
  'data' | 'tableMode' | 'onTableStateChange' | 'filterOptionOverrides'
> {
  enabled: boolean;
  clusterId?: string | null;
  domain: RefreshDomain;
  label: string;
  localData: TRow[];
  localLoading?: boolean;
  localLoaded?: boolean;
  localError?: string | null;
  selectRows: (payload: TPayload) => TRow[];
  predicates?: Record<string, string | null | undefined>;
  filterOptionOverrides?: Partial<GridTableFilterOptions>;
}

export function useQueryBackedNamespaceResourceGridTable<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
>({
  enabled,
  clusterId,
  domain,
  label,
  localData,
  localLoading = false,
  localLoaded = false,
  localError = null,
  selectRows,
  predicates,
  filterOptionOverrides,
  defaultSort = { key: 'name', direction: 'asc' },
  ...tableParams
}: QueryBackedNamespaceGridParams<TPayload, TRow>): QueryBackedNamespaceGridResult<TRow> {
  const { tableState, handleTableStateChange } = useQueryBackedTableState(defaultSort);

  const query = useTypedResourceQuery<TPayload, TRow>({
    enabled,
    clusterId,
    domain,
    label,
    filters: tableState.filters,
    sortConfig: tableState.sortConfig,
    predicates,
    selectRows,
  });

  const data = enabled ? query.rows : localData;
  const loading = enabled ? query.loading : localLoading;
  const loaded = enabled ? query.loaded : localLoaded;
  const error = enabled ? query.error : localError;

  const table = useNamespaceResourceGridTable<TRow>({
    ...tableParams,
    defaultSort,
    tableMode: enabled ? 'Query Backed Dynamic' : 'Local Complete',
    data,
    filterOptionOverrides: enabled
      ? mergeQueryBackedFilterOptions(filterOptionOverrides, query.filterOptions)
      : filterOptionOverrides,
    onTableStateChange: enabled ? handleTableStateChange : undefined,
  });

  const gridTableProps = useMemo(
    () =>
      enabled ? queryBackedPaginationProps(table.gridTableProps, query) : table.gridTableProps,
    [enabled, query, table.gridTableProps]
  );

  return {
    ...table,
    gridTableProps,
    rows: gridTableProps.data,
    loading,
    loaded,
    error,
  };
}
