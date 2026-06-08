import React, { useCallback, useMemo, useState } from 'react';
import type { RefreshDomain } from '@/core/refresh/types';
import { useRefreshScopedDomain } from '@/core/refresh';
import { useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { GridTableFilterOptions } from '@shared/components/tables/GridTable';
import type { SortConfig } from '@/hooks/useTableSort';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import type { UseGridTablePersistenceResult } from '@shared/components/tables/persistence/useGridTablePersistence';
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
import { boundedRowsSource } from './boundedRowsSource';
import type { ResourceInventorySourceState } from './useResourceInventoryTable';
import {
  TYPED_QUERY_PAGE_LIMIT_OPTIONS,
  useTypedResourceQuery,
  type TypedQueryPageLimit,
  type TypedQueryPayload,
  type UseTypedResourceQueryResult,
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

// The live-data identity the typed query watches to decide when to refetch. It
// uses ONLY the data identity (version + checksum/etag) — deliberately NOT a
// refresh timestamp. Including a timestamp made it change on every poll tick even
// when the data was identical, so the query refetched continuously (~5×/sec while
// idle on the view) and intermittently raced into a transient "returned no data"
// that blanked the table. Keyed on data identity, it refetches only on real change.
export const liveDomainVersion = (state: {
  version?: number | string;
  checksum?: string;
  etag?: string;
  // Accepted from the scoped domain state but deliberately IGNORED below — see comment.
  lastUpdated?: number;
  lastAutoRefresh?: number;
  lastManualRefresh?: number;
}): string => [state.version ?? '', state.checksum ?? state.etag ?? ''].join(':');

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
  /**
   * Normalized source state for the resource-inventory controller — the single
   * source of truth for the table's lifecycle. Views render
   * `<ResourceInventoryTable source={source} gridTableProps={gridTableProps} />`
   * and read rows/loading/error from `source` (there are no separate
   * wrapper-level rows/loading/loaded/error fields). The pagination footer and
   * partial-data label ride on `gridTableProps`; this source carries the
   * lifecycle (rows/loading/loaded/error/completeness) the controller needs for
   * the loading boundary, refresh overlay, and settled-empty gate.
   */
  source: ResourceInventorySourceState<T>;
}

const buildQueryBackedSource = <T extends ResourceGridTableRow>({
  rows,
  loading,
  loaded,
  error,
  mode,
  cacheKey,
}: {
  rows: T[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  mode: ResourceGridTableMode;
  cacheKey: string;
}): ResourceInventorySourceState<T> => ({
  rows,
  loading,
  loaded,
  error,
  completeness: mode === 'Local Partial' ? 'partial' : 'complete',
  partialLabel: null,
  pagination: null,
  cacheKey,
});

// Fields shared by the cluster and namespace query wrappers. Each wrapper adds
// the scope-specific binding params (namespace vs cluster persistence + sort
// defaults) from its base resource-grid params type.
interface QueryBackedGridParamsCommon<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
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

interface TypedQueryLifecycle<TRow extends ResourceGridTableRow> {
  data: TRow[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  tableMode: ResourceGridTableMode;
  effectiveFilterOptionOverrides?: Partial<GridTableFilterOptions>;
  onTableStateChange?: (next: QueryBackedTableState) => void;
  query: UseTypedResourceQueryResult<TRow>;
}

// The shared query lifecycle for both scopes: it owns table state, the scoped
// refresh-domain lifecycle, the typed query, and the loading/empty derivation.
// The caller supplies the scope-specific `persistence` and `liveScope`; this hook
// produces the data + the binding inputs (tableMode, merged filter options,
// onTableStateChange) the base resource-grid hook needs, plus the query handle
// the pagination footer reads.
function useTypedQueryLifecycle<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
>({
  enabled,
  clusterId,
  domain,
  label,
  baseScope,
  queryTableMode,
  localTableMode,
  localData,
  localLoading,
  localLoaded,
  localError,
  selectRows,
  predicates,
  filterOptionOverrides,
  defaultSort,
  persistence,
  liveScope,
}: {
  enabled: boolean;
  clusterId?: string | null;
  domain: RefreshDomain;
  label: string;
  baseScope?: string;
  queryTableMode: Extract<ResourceGridTableMode, 'Query Backed Static' | 'Query Backed Dynamic'>;
  localTableMode: Extract<ResourceGridTableMode, 'Local Complete' | 'Local Partial'>;
  localData: TRow[];
  localLoading: boolean;
  localLoaded: boolean;
  localError: string | null;
  selectRows: (payload: TPayload) => TRow[];
  predicates?: Record<string, string | null | undefined>;
  filterOptionOverrides?: Partial<GridTableFilterOptions>;
  defaultSort: SortConfig;
  persistence: UseGridTablePersistenceResult;
  liveScope: string;
}): TypedQueryLifecycle<TRow> {
  const { tableState, handleTableStateChange } = useQueryBackedTableState(defaultSort);
  const [tableStateReady, setTableStateReady] = useState(false);
  const pageLimit = typedQueryPageLimitOrDefault(persistence.pageSize);
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
  // clusterId is required: without it buildTypedResourceQueryScope returns null
  // and no fetch is ever issued, so the query path could never settle. Gating
  // here routes a missing cluster to the local branch, which settles correctly.
  const queryEnabled =
    enabled &&
    Boolean(clusterId) &&
    tableStateReady &&
    persistence.hydrated &&
    !liveDomainInitialLoadPending;

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
    ? data.length === 0 && (query.loading || queryInitialLoading)
    : waitingForInitialQuery || localLoading;
  const loaded = queryEnabled ? query.loaded : waitingForInitialQuery ? false : localLoaded;
  const error = queryEnabled ? query.error : localError;

  return {
    data,
    loading,
    loaded,
    error,
    tableMode: enabled
      ? queryTableMode
      : localTableMode === 'Local Partial'
        ? 'Local Partial'
        : 'Local Complete',
    effectiveFilterOptionOverrides: enabled
      ? mergeQueryBackedFilterOptions(filterOptionOverrides, query.filterOptions)
      : filterOptionOverrides,
    onTableStateChange: enabled ? handlePublishedTableState : undefined,
    query,
  };
}

// Builds the shared result for both scopes: the pagination footer (query scope
// only) plus the normalized controller source (typed query source when enabled,
// bounded local source otherwise).
function useQueryBackedGridResult<TRow extends ResourceGridTableRow>({
  enabled,
  viewId,
  cacheKey,
  table,
  query,
  persistence,
  data,
  loading,
  loaded,
  error,
  queryTableMode,
  localTableMode,
  filterOptionOverrides,
}: {
  enabled: boolean;
  viewId: string;
  cacheKey: string;
  table: ResourceGridTableResult<TRow>;
  query: UseTypedResourceQueryResult<TRow>;
  persistence: UseGridTablePersistenceResult;
  data: TRow[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  queryTableMode: Extract<ResourceGridTableMode, 'Query Backed Static' | 'Query Backed Dynamic'>;
  localTableMode: Extract<ResourceGridTableMode, 'Local Complete' | 'Local Partial'>;
  filterOptionOverrides?: Partial<GridTableFilterOptions>;
}): QueryBackedNamespaceGridResult<TRow> {
  const gridTableProps = useMemo(() => {
    if (!enabled) {
      return table.gridTableProps;
    }
    const paginationControls = React.createElement(QueryPaginationControls, {
      idPrefix: viewId,
      pageIndex: query.pageIndex,
      pageSize: query.pageSize,
      visibleItemCount: data.length,
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
  }, [data.length, enabled, persistence, query, table.gridTableProps, viewId]);

  return {
    ...table,
    gridTableProps,
    // Query scope → typed query source; single-namespace / disabled scope →
    // bounded local source. Both feed the one controller contract as the single
    // source of truth (no separate wrapper-level rows/loading/loaded/error). The
    // bounded path carries the partial label on the source so the controller's
    // render state owns the partial/degraded display (it also stays on
    // gridTableProps for the GridTable filter bar; the controller merge is
    // idempotent).
    source: enabled
      ? buildQueryBackedSource({
          rows: gridTableProps.data,
          loading,
          loaded,
          error,
          mode: queryTableMode,
          cacheKey,
        })
      : boundedRowsSource({
          rows: gridTableProps.data,
          loading,
          loaded,
          error,
          mode: localTableMode === 'Local Partial' ? 'Local Partial' : 'Local Complete',
          partialLabel: filterOptionOverrides?.partialDataLabel ?? null,
          cacheKey,
        }),
  };
}

const useResolvedQueryKeyExtractor = <TRow extends ResourceGridTableRow>(
  keyExtractor: ((item: TRow, index: number) => string) | undefined,
  objectIdentityKey: ((item: TRow, index: number) => string) | undefined,
  clusterId: string | null | undefined
): ((item: TRow, index: number) => string) => {
  const defaultKeyExtractor = useCallback(
    (item: TRow) => buildRequiredCanonicalObjectRowKey(item, { fallbackClusterId: clusterId }),
    [clusterId]
  );
  return keyExtractor ?? objectIdentityKey ?? defaultKeyExtractor;
};

export interface QueryBackedNamespaceGridParams<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
>
  extends
    Omit<
      NamespaceResourceGridTableParams<TRow>,
      'data' | 'tableMode' | 'onTableStateChange' | 'filterOptionOverrides' | 'persistenceOverride'
    >,
    QueryBackedGridParamsCommon<TPayload, TRow> {}

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
  const resolvedKeyExtractor = useResolvedQueryKeyExtractor(
    tableParams.keyExtractor,
    tableParams.objectIdentity?.key,
    clusterId
  );
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
  const liveScope = useMemo(
    () => (clusterId ? buildClusterScope(clusterId, baseScope ?? namespace) : ''),
    [baseScope, clusterId, namespace]
  );
  const lifecycle = useTypedQueryLifecycle<TPayload, TRow>({
    enabled,
    clusterId,
    domain,
    label,
    baseScope,
    queryTableMode,
    localTableMode,
    localData,
    localLoading,
    localLoaded,
    localError,
    selectRows,
    predicates,
    filterOptionOverrides,
    defaultSort,
    persistence,
    liveScope,
  });
  const table = useNamespaceResourceGridTable<TRow>({
    ...tableParams,
    keyExtractor: resolvedKeyExtractor,
    namespace,
    defaultSort,
    pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
    persistenceOverride: persistence,
    tableMode: lifecycle.tableMode,
    data: lifecycle.data,
    filterOptionOverrides: lifecycle.effectiveFilterOptionOverrides,
    onTableStateChange: lifecycle.onTableStateChange,
  });
  return useQueryBackedGridResult<TRow>({
    enabled,
    viewId: tableParams.viewId,
    cacheKey: `${tableParams.viewId}|${liveScope}`,
    table,
    query: lifecycle.query,
    persistence,
    data: lifecycle.data,
    loading: lifecycle.loading,
    loaded: lifecycle.loaded,
    error: lifecycle.error,
    queryTableMode,
    localTableMode,
    filterOptionOverrides,
  });
}

export interface QueryBackedClusterGridParams<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
>
  extends
    Omit<
      ClusterResourceGridTableParams<TRow>,
      'data' | 'tableMode' | 'onTableStateChange' | 'filterOptionOverrides' | 'persistenceOverride'
    >,
    QueryBackedGridParamsCommon<TPayload, TRow> {}

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
  const resolvedKeyExtractor = useResolvedQueryKeyExtractor(
    tableParams.keyExtractor,
    tableParams.objectIdentity?.key,
    clusterId
  );
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
  const liveScope = useMemo(
    () => (clusterId ? buildClusterScope(clusterId, baseScope) : ''),
    [baseScope, clusterId]
  );
  const lifecycle = useTypedQueryLifecycle<TPayload, TRow>({
    enabled,
    clusterId,
    domain,
    label,
    baseScope,
    queryTableMode,
    localTableMode,
    localData,
    localLoading,
    localLoaded,
    localError,
    selectRows,
    predicates,
    filterOptionOverrides,
    defaultSort,
    persistence,
    liveScope,
  });
  const table = useClusterResourceGridTable<TRow>({
    ...tableParams,
    keyExtractor: resolvedKeyExtractor,
    defaultSortKey,
    defaultSortDirection,
    pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
    persistenceOverride: persistence,
    tableMode: lifecycle.tableMode,
    data: lifecycle.data,
    filterOptionOverrides: lifecycle.effectiveFilterOptionOverrides,
    onTableStateChange: lifecycle.onTableStateChange,
  });
  return useQueryBackedGridResult<TRow>({
    enabled,
    viewId: tableParams.viewId,
    cacheKey: `${tableParams.viewId}|${liveScope}`,
    table,
    query: lifecycle.query,
    persistence,
    data: lifecycle.data,
    loading: lifecycle.loading,
    loaded: lifecycle.loaded,
    error: lifecycle.error,
    queryTableMode,
    localTableMode,
    filterOptionOverrides,
  });
}
