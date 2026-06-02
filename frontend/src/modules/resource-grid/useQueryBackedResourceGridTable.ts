import React, { useCallback, useMemo, useState } from 'react';
import type { RefreshDomain } from '@/core/refresh/types';
import type { GridTableFilterOptions } from '@shared/components/tables/GridTable';
import { useClusterResourceGridTable, useNamespaceResourceGridTable } from './useResourceGridTable';
import type {
  ClusterResourceGridTableParams,
  NamespaceResourceGridTableParams,
  ResourceGridTableResult,
  ResourceGridTableMode,
  ResourceGridTableRow,
} from './resourceGridTableTypes';
import QueryPaginationControls from './QueryPaginationControls';
import {
  TYPED_QUERY_PAGE_LIMIT_OPTIONS,
  useTypedResourceQuery,
  type TypedQueryPageLimit,
  type TypedQueryPayload,
} from './useTypedResourceQuery';
import {
  mergeQueryBackedFilterOptions,
  queryBackedPaginationProps,
  useQueryBackedTableState,
} from './queryBackedTableState';
import type { QueryBackedTableState } from './queryBackedTableState';

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
  baseScope?: string;
  queryTableMode?: Extract<ResourceGridTableMode, 'Query Backed Static' | 'Query Backed Dynamic'>;
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
  baseScope,
  queryTableMode = 'Query Backed Dynamic',
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
  const [tableStateReady, setTableStateReady] = useState(false);
  const [pageLimit, setPageLimit] = useState<TypedQueryPageLimit>(50);
  const handlePublishedTableState = useCallback(
    (next: QueryBackedTableState) => {
      setTableStateReady(true);
      handleTableStateChange(next);
    },
    [handleTableStateChange]
  );
  const queryEnabled = enabled && tableStateReady;

  const query = useTypedResourceQuery<TPayload, TRow>({
    enabled: queryEnabled,
    clusterId,
    domain,
    label,
    baseScope,
    filters: tableState.filters,
    sortConfig: tableState.sortConfig,
    pageLimit,
    predicates,
    selectRows,
  });

  const data = queryEnabled ? query.rows : localData;
  const loading = queryEnabled ? query.loading : localLoading;
  const loaded = queryEnabled ? query.loaded : localLoaded;
  const error = queryEnabled ? query.error : localError;

  const table = useNamespaceResourceGridTable<TRow>({
    ...tableParams,
    defaultSort,
    tableMode: enabled ? queryTableMode : 'Local Complete',
    data,
    filterOptionOverrides: enabled
      ? mergeQueryBackedFilterOptions(filterOptionOverrides, query.filterOptions)
      : filterOptionOverrides,
    onTableStateChange: enabled ? handlePublishedTableState : undefined,
  });

  const gridTableProps = useMemo(() => {
    if (!enabled) {
      return table.gridTableProps;
    }
    const paginationControls = React.createElement(QueryPaginationControls, {
      idPrefix: tableParams.viewId,
      pageIndex: query.pageIndex,
      pageSize: query.pageSize,
      visibleItemCount: query.rows.length,
      pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
      totalCount: query.totalCount,
      totalIsExact: query.totalIsExact,
      hasPrevious: query.hasPrevious,
      hasNext: Boolean(query.continueToken),
      loading: query.isRequestingMore || query.loading,
      onPrevious: query.loadPrevious,
      onNext: query.loadMore,
      onPageSizeChange: (value: number) => {
        if (TYPED_QUERY_PAGE_LIMIT_OPTIONS.includes(value as TypedQueryPageLimit)) {
          setPageLimit(value as TypedQueryPageLimit);
        }
      },
    });
    return queryBackedPaginationProps(table.gridTableProps, query, paginationControls);
  }, [enabled, query, table.gridTableProps, tableParams.viewId]);

  return {
    ...table,
    gridTableProps,
    rows: gridTableProps.data,
    loading,
    loaded,
    error,
  };
}

export interface QueryBackedClusterGridParams<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
> extends Omit<
  ClusterResourceGridTableParams<TRow>,
  'data' | 'tableMode' | 'onTableStateChange' | 'filterOptionOverrides'
> {
  enabled: boolean;
  clusterId?: string | null;
  domain: RefreshDomain;
  label: string;
  baseScope?: string;
  queryTableMode?: Extract<ResourceGridTableMode, 'Query Backed Static' | 'Query Backed Dynamic'>;
  localData: TRow[];
  localLoading?: boolean;
  localLoaded?: boolean;
  localError?: string | null;
  selectRows: (payload: TPayload) => TRow[];
  predicates?: Record<string, string | null | undefined>;
  filterOptionOverrides?: Partial<GridTableFilterOptions>;
}

export function useQueryBackedClusterResourceGridTable<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
>({
  enabled,
  clusterId,
  domain,
  label,
  baseScope = '',
  queryTableMode = 'Query Backed Static',
  localData,
  localLoading = false,
  localLoaded = false,
  localError = null,
  selectRows,
  predicates,
  filterOptionOverrides,
  defaultSortKey = 'name',
  defaultSortDirection = 'asc',
  ...tableParams
}: QueryBackedClusterGridParams<TPayload, TRow>): QueryBackedNamespaceGridResult<TRow> {
  const defaultSort = useMemo(
    () => ({ key: defaultSortKey, direction: defaultSortDirection }),
    [defaultSortDirection, defaultSortKey]
  );
  const { tableState, handleTableStateChange } = useQueryBackedTableState(defaultSort);
  const [tableStateReady, setTableStateReady] = useState(false);
  const [pageLimit, setPageLimit] = useState<TypedQueryPageLimit>(50);
  const handlePublishedTableState = useCallback(
    (next: QueryBackedTableState) => {
      setTableStateReady(true);
      handleTableStateChange(next);
    },
    [handleTableStateChange]
  );
  const queryEnabled = enabled && tableStateReady;

  const query = useTypedResourceQuery<TPayload, TRow>({
    enabled: queryEnabled,
    clusterId,
    domain,
    label,
    baseScope,
    filters: tableState.filters,
    sortConfig: tableState.sortConfig,
    pageLimit,
    predicates,
    selectRows,
  });

  const data = queryEnabled ? query.rows : localData;
  const loading = queryEnabled ? query.loading : localLoading;
  const loaded = queryEnabled ? query.loaded : localLoaded;
  const error = queryEnabled ? query.error : localError;

  const table = useClusterResourceGridTable<TRow>({
    ...tableParams,
    defaultSortKey,
    defaultSortDirection,
    tableMode: enabled ? queryTableMode : 'Local Complete',
    data,
    filterOptionOverrides: enabled
      ? mergeQueryBackedFilterOptions(filterOptionOverrides, query.filterOptions)
      : filterOptionOverrides,
    onTableStateChange: enabled ? handlePublishedTableState : undefined,
  });

  const gridTableProps = useMemo(() => {
    if (!enabled) {
      return table.gridTableProps;
    }
    const paginationControls = React.createElement(QueryPaginationControls, {
      idPrefix: tableParams.viewId,
      pageIndex: query.pageIndex,
      pageSize: query.pageSize,
      visibleItemCount: query.rows.length,
      pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
      totalCount: query.totalCount,
      totalIsExact: query.totalIsExact,
      hasPrevious: query.hasPrevious,
      hasNext: Boolean(query.continueToken),
      loading: query.isRequestingMore || query.loading,
      onPrevious: query.loadPrevious,
      onNext: query.loadMore,
      onPageSizeChange: (value: number) => {
        if (TYPED_QUERY_PAGE_LIMIT_OPTIONS.includes(value as TypedQueryPageLimit)) {
          setPageLimit(value as TypedQueryPageLimit);
        }
      },
    });
    return queryBackedPaginationProps(table.gridTableProps, query, paginationControls);
  }, [enabled, query, table.gridTableProps, tableParams.viewId]);

  return {
    ...table,
    gridTableProps,
    rows: gridTableProps.data,
    loading,
    loaded,
    error,
  };
}
