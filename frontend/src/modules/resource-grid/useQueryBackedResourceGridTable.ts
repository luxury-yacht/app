import React, { useCallback, useMemo, useState } from 'react';
import type { RefreshDomain } from '@/core/refresh/types';
import { useRefreshScopedDomain } from '@/core/refresh';
import { useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { GridTableFilterOptions } from '@shared/components/tables/GridTable';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { buildRequiredCanonicalObjectRowKey } from '@shared/utils/objectIdentity';
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

const DEFAULT_TYPED_QUERY_PAGE_LIMIT: TypedQueryPageLimit = 50;

const typedQueryPageLimitOrDefault = (value: number | null | undefined): TypedQueryPageLimit =>
  TYPED_QUERY_PAGE_LIMIT_OPTIONS.includes(value as TypedQueryPageLimit)
    ? (value as TypedQueryPageLimit)
    : DEFAULT_TYPED_QUERY_PAGE_LIMIT;

const liveDomainVersion = (state: {
  version?: number | string;
  checksum?: string;
  etag?: string;
  lastUpdated?: number;
  lastAutoRefresh?: number;
  lastManualRefresh?: number;
}): string =>
  [
    state.version ?? '',
    state.checksum ?? state.etag ?? '',
    state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh ?? '',
  ].join(':');

const shouldHoldInitialTypedQueryLoading = <TRow>({
  enabled,
  clusterId,
  queryEnabled,
  localData,
  localError,
}: {
  enabled: boolean;
  clusterId?: string | null;
  queryEnabled: boolean;
  localData: TRow[];
  localError: string | null;
}): boolean =>
  enabled && Boolean(clusterId) && !queryEnabled && localData.length === 0 && !localError;

const isLiveDomainInitialLoadPending = (state: { status?: string; data?: unknown }): boolean =>
  !state.data && (state.status === 'loading' || state.status === 'initialising');

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
  localTableMode?: Extract<ResourceGridTableMode, 'Local Complete' | 'Local Partial'>;
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
  localTableMode = 'Local Complete',
  localData,
  localLoading = false,
  localLoaded = false,
  localError = null,
  selectRows,
  predicates,
  filterOptionOverrides,
  defaultSort = { key: 'name', direction: 'asc' },
  namespace,
  ...tableParams
}: QueryBackedNamespaceGridParams<TPayload, TRow>): QueryBackedNamespaceGridResult<TRow> {
  const { tableState, handleTableStateChange } = useQueryBackedTableState(defaultSort);
  const [tableStateReady, setTableStateReady] = useState(false);
  const defaultKeyExtractor = useCallback(
    (item: TRow) => buildRequiredCanonicalObjectRowKey(item, { fallbackClusterId: clusterId }),
    [clusterId]
  );
  const resolvedKeyExtractor =
    tableParams.keyExtractor ?? tableParams.objectIdentity?.key ?? defaultKeyExtractor;
  const persistence = useGridTablePersistence<TRow>({
    viewId: tableParams.viewId,
    clusterIdentity: clusterId ?? '',
    namespace,
    isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE,
    columns: tableParams.columns,
    data: tableParams.persistenceData ?? localData,
    keyExtractor: resolvedKeyExtractor,
    filterOptions: {
      ...(tableParams.filterOptions ?? {}),
      isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE,
    },
    pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
  });
  const pageLimit = typedQueryPageLimitOrDefault(persistence.pageSize);
  const liveScope = useMemo(
    () => (clusterId ? buildClusterScope(clusterId, baseScope ?? namespace) : ''),
    [baseScope, clusterId, namespace]
  );
  useScopedRefreshDomainLifecycle({
    domain,
    scope: liveScope || null,
    enabled,
    preserveState: true,
    fetchOnEnable: false,
  });
  const liveDomain = useRefreshScopedDomain(domain, liveScope);
  const liveDataVersion = liveDomainVersion(liveDomain);
  const liveDomainInitialLoadPending = enabled && isLiveDomainInitialLoadPending(liveDomain);
  const handlePublishedTableState = useCallback(
    (next: QueryBackedTableState) => {
      setTableStateReady(true);
      handleTableStateChange(next);
    },
    [handleTableStateChange]
  );
  const queryEnabled =
    enabled && tableStateReady && persistence.hydrated && !liveDomainInitialLoadPending;

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
    liveDataVersion,
    selectRows,
  });

  const data = queryEnabled ? query.rows : localData;
  const waitingForInitialQuery = shouldHoldInitialTypedQueryLoading({
    enabled,
    clusterId,
    queryEnabled,
    localData,
    localError,
  });
  const queryInitialLoading = query.rows.length === 0 && !query.loaded && !query.error;
  const loading = queryEnabled
    ? query.rows.length === 0 && (query.loading || queryInitialLoading)
    : waitingForInitialQuery || localLoading;
  const loaded = queryEnabled ? query.loaded : waitingForInitialQuery ? false : localLoaded;
  const error = queryEnabled ? query.error : localError;

  const table = useNamespaceResourceGridTable<TRow>({
    ...tableParams,
    keyExtractor: resolvedKeyExtractor,
    namespace,
    defaultSort,
    pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
    persistenceOverride: persistence,
    tableMode: enabled
      ? queryTableMode
      : localTableMode === 'Local Partial'
        ? 'Local Partial'
        : 'Local Complete',
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
      loading: query.isRequestingMore,
      onPrevious: query.loadPrevious,
      onNext: query.loadMore,
      onPageSizeChange: (value: number) => {
        if (TYPED_QUERY_PAGE_LIMIT_OPTIONS.includes(value as TypedQueryPageLimit)) {
          persistence.setPageSize(value);
        }
      },
    });
    return queryBackedPaginationProps(table.gridTableProps, query, paginationControls);
  }, [enabled, persistence, query, table.gridTableProps, tableParams.viewId]);

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
  localTableMode?: Extract<ResourceGridTableMode, 'Local Complete' | 'Local Partial'>;
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
  localTableMode = 'Local Complete',
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
  const defaultKeyExtractor = useCallback(
    (item: TRow) => buildRequiredCanonicalObjectRowKey(item, { fallbackClusterId: clusterId }),
    [clusterId]
  );
  const resolvedKeyExtractor =
    tableParams.keyExtractor ?? tableParams.objectIdentity?.key ?? defaultKeyExtractor;
  const persistence = useGridTablePersistence<TRow>({
    viewId: tableParams.viewId,
    clusterIdentity: clusterId ?? '',
    namespace: null,
    isNamespaceScoped: false,
    columns: tableParams.columns,
    data: tableParams.persistenceData ?? localData,
    keyExtractor: resolvedKeyExtractor,
    filterOptions: { ...(tableParams.filterOptions ?? {}), isNamespaceScoped: false },
    pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
  });
  const pageLimit = typedQueryPageLimitOrDefault(persistence.pageSize);
  const liveScope = useMemo(
    () => (clusterId ? buildClusterScope(clusterId, baseScope) : ''),
    [baseScope, clusterId]
  );
  useScopedRefreshDomainLifecycle({
    domain,
    scope: liveScope || null,
    enabled,
    preserveState: true,
    fetchOnEnable: false,
  });
  const liveDomain = useRefreshScopedDomain(domain, liveScope);
  const liveDataVersion = liveDomainVersion(liveDomain);
  const liveDomainInitialLoadPending = enabled && isLiveDomainInitialLoadPending(liveDomain);
  const handlePublishedTableState = useCallback(
    (next: QueryBackedTableState) => {
      setTableStateReady(true);
      handleTableStateChange(next);
    },
    [handleTableStateChange]
  );
  const queryEnabled =
    enabled && tableStateReady && persistence.hydrated && !liveDomainInitialLoadPending;

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
    liveDataVersion,
    selectRows,
  });

  const data = queryEnabled ? query.rows : localData;
  const waitingForInitialQuery = shouldHoldInitialTypedQueryLoading({
    enabled,
    clusterId,
    queryEnabled,
    localData,
    localError,
  });
  const queryInitialLoading = query.rows.length === 0 && !query.loaded && !query.error;
  const loading = queryEnabled
    ? query.rows.length === 0 && (query.loading || queryInitialLoading)
    : waitingForInitialQuery || localLoading;
  const loaded = queryEnabled ? query.loaded : waitingForInitialQuery ? false : localLoaded;
  const error = queryEnabled ? query.error : localError;

  const table = useClusterResourceGridTable<TRow>({
    ...tableParams,
    keyExtractor: resolvedKeyExtractor,
    defaultSortKey,
    defaultSortDirection,
    pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
    persistenceOverride: persistence,
    tableMode: enabled
      ? queryTableMode
      : localTableMode === 'Local Partial'
        ? 'Local Partial'
        : 'Local Complete',
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
      loading: query.isRequestingMore,
      onPrevious: query.loadPrevious,
      onNext: query.loadMore,
      onPageSizeChange: (value: number) => {
        if (TYPED_QUERY_PAGE_LIMIT_OPTIONS.includes(value as TypedQueryPageLimit)) {
          persistence.setPageSize(value);
        }
      },
    });
    return queryBackedPaginationProps(table.gridTableProps, query, paginationControls);
  }, [enabled, persistence, query, table.gridTableProps, tableParams.viewId]);

  return {
    ...table,
    gridTableProps,
    rows: gridTableProps.data,
    loading,
    loaded,
    error,
  };
}
