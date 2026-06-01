import { useCallback, useMemo, useState } from 'react';
import type { RefreshDomain } from '@/core/refresh/types';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import type { SortConfig } from '@hooks/useTableSort';
import { useNamespaceResourceGridTable } from './useResourceGridTable';
import type {
  NamespaceResourceGridTableParams,
  ResourceGridTableResult,
  ResourceGridTableRow,
} from './resourceGridTableTypes';
import { useTypedResourceQuery, type TypedQueryPayload } from './useTypedResourceQuery';

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
  const [tableState, setTableState] = useState<{
    filters: GridTableFilterState;
    sortConfig: SortConfig | null;
  }>({
    filters: DEFAULT_GRID_TABLE_FILTER_STATE,
    sortConfig: defaultSort,
  });

  const handleTableStateChange = useCallback(
    (next: { filters: GridTableFilterState; sortConfig: SortConfig | null }) => {
      setTableState((previous) => {
        if (
          previous.sortConfig?.key === next.sortConfig?.key &&
          previous.sortConfig?.direction === next.sortConfig?.direction &&
          JSON.stringify(previous.filters) === JSON.stringify(next.filters)
        ) {
          return previous;
        }
        return next;
      });
    },
    []
  );

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
      ? {
          ...filterOptionOverrides,
          ...query.filterOptions,
        }
      : filterOptionOverrides,
    onTableStateChange: enabled ? handleTableStateChange : undefined,
  });

  const gridTableProps = useMemo(
    () =>
      enabled
        ? {
            ...table.gridTableProps,
            hasMore: Boolean(query.continueToken),
            onRequestMore: () => query.loadMore(),
            isRequestingMore: query.isRequestingMore,
            loadMoreLabel: 'Next page',
            showLoadMoreButton: true,
            showPaginationStatus: true,
          }
        : table.gridTableProps,
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
