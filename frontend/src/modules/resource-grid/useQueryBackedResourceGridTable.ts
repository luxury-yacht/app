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

// The namespace prop is the raw name for a single namespace but the `namespace:all` sentinel for
// all-namespaces; the backend scope key is always `namespace:<value>` (see pods.go collectPods,
// which splits the scope on ':' and rejects a bare name). Normalize before building any scope.
const namespaceScopeKey = (namespace: string): string =>
  namespace.startsWith('namespace:') ? namespace : `namespace:${namespace}`;

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
  // Bumped by the stream manager when streamed row updates change the data
  // without a new backend snapshot version — a real data change, not a tick.
  streamRevision?: number;
  // Accepted from the scoped domain state but deliberately IGNORED below — see comment.
  lastUpdated?: number;
  lastAutoRefresh?: number;
  lastManualRefresh?: number;
}): string =>
  [state.version ?? '', state.checksum ?? state.etag ?? '', state.streamRevision ?? ''].join(':');

// Derives the controller source state (data/loading/loaded/error) for a query-backed
// resource grid. Sourced ONLY from the typed query — never the live snapshot, which is the
// wrong representation for a query-backed view (unsorted client-side, unpaginated). While the
// query is gating or in flight, it reports empty+loading so the controller bridges with the
// cached page (correctly sorted) or shows a first-load spinner.
export function deriveQueryBackedData<TRow>({
  clusterId,
  queryEnabled,
  queryRows,
  queryLoading,
  queryLoaded,
  queryError,
}: {
  clusterId?: string | null;
  queryEnabled: boolean;
  queryRows: TRow[];
  queryLoading: boolean;
  queryLoaded: boolean;
  queryError: string | null;
}): { data: TRow[]; loading: boolean; loaded: boolean; error: string | null } {
  if (!queryEnabled) {
    // Gating (awaiting cluster/persistence/live-domain readiness): hold loading so the
    // controller replays the cached page or shows a spinner — never the live snapshot.
    return { data: [], loading: Boolean(clusterId), loaded: false, error: null };
  }
  const queryInitialLoading = queryRows.length === 0 && !queryLoaded && !queryError;
  return {
    data: queryRows,
    loading: queryRows.length === 0 && (queryLoading || queryInitialLoading),
    loaded: queryLoaded,
    error: queryError,
  };
}

const isLiveDomainInitialLoadPending = (state: { status?: string; data?: unknown }): boolean =>
  !state.data && (state.status === 'loading' || state.status === 'initialising');

export interface QueryBackedNamespaceGridResult<
  T extends ResourceGridTableRow,
  TPayload = unknown,
> extends ResourceGridTableResult<T> {
  /**
   * The typed query's last applied page payload. Rows come through `source`;
   * payload-level metadata (e.g. the pods metrics meta, scoped to the queried
   * cluster) is read from here.
   */
  queryPayload: TPayload | null;
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
  clusterId?: string | null;
  domain: RefreshDomain;
  label: string;
  baseScope?: string;
  queryTableMode?: Extract<ResourceGridTableMode, 'Query Backed Static' | 'Query Backed Dynamic'>;
  selectRows: (payload: TPayload) => TRow[];
  predicates?: Record<string, string | null | undefined>;
  filterOptionOverrides?: Partial<GridTableFilterOptions>;
}

interface TypedQueryLifecycle<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
> {
  data: TRow[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  tableMode: ResourceGridTableMode;
  effectiveFilterOptionOverrides?: Partial<GridTableFilterOptions>;
  onTableStateChange?: (next: QueryBackedTableState) => void;
  query: UseTypedResourceQueryResult<TRow, TPayload>;
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
  clusterId,
  domain,
  label,
  baseScope,
  queryTableMode,
  selectRows,
  predicates,
  filterOptionOverrides,
  defaultSort,
  persistence,
  liveScope,
}: {
  clusterId?: string | null;
  domain: RefreshDomain;
  label: string;
  baseScope?: string;
  queryTableMode: Extract<ResourceGridTableMode, 'Query Backed Static' | 'Query Backed Dynamic'>;
  selectRows: (payload: TPayload) => TRow[];
  predicates?: Record<string, string | null | undefined>;
  filterOptionOverrides?: Partial<GridTableFilterOptions>;
  defaultSort: SortConfig;
  persistence: UseGridTablePersistenceResult;
  liveScope: string;
}): TypedQueryLifecycle<TPayload, TRow> {
  const { tableState, handleTableStateChange } = useQueryBackedTableState(defaultSort);
  const [tableStateReady, setTableStateReady] = useState(false);
  const pageLimit = typedQueryPageLimitOrDefault(persistence.pageSize);
  useScopedRefreshDomainLifecycle({
    domain,
    scope: liveScope || null,
    enabled: true,
    preserveState: true,
    fetchOnEnable: false,
  });
  const liveDomain = useRefreshScopedDomain(domain, liveScope);
  const liveDataVersion = liveDomainVersion(liveDomain);
  const liveDomainInitialLoadPending = isLiveDomainInitialLoadPending(liveDomain);
  const handlePublishedTableState = useCallback(
    (next: QueryBackedTableState) => {
      setTableStateReady(true);
      handleTableStateChange(next);
    },
    [handleTableStateChange]
  );
  // clusterId is required: without it buildTypedResourceQueryScope returns null and no fetch is
  // ever issued, so the query path could never settle. Gating here holds the table in its gating
  // (empty + loading) state until a cluster and persistence are ready.
  const queryEnabled =
    Boolean(clusterId) && tableStateReady && persistence.hydrated && !liveDomainInitialLoadPending;

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

  const { data, loading, loaded, error } = deriveQueryBackedData<TRow>({
    clusterId,
    queryEnabled,
    queryRows: query.rows,
    queryLoading: query.loading,
    queryLoaded: query.loaded,
    queryError: query.error,
  });

  return {
    data,
    loading,
    loaded,
    error,
    tableMode: queryTableMode,
    effectiveFilterOptionOverrides: mergeQueryBackedFilterOptions(
      filterOptionOverrides,
      query.filterOptions
    ),
    onTableStateChange: handlePublishedTableState,
    query,
  };
}

// Builds the shared result for both scopes: the pagination footer (query scope
// only) plus the normalized controller source (typed query source when enabled,
// bounded local source otherwise).
function useQueryBackedGridResult<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
>({
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
}: {
  viewId: string;
  cacheKey: string;
  table: ResourceGridTableResult<TRow>;
  query: UseTypedResourceQueryResult<TRow, TPayload>;
  persistence: UseGridTablePersistenceResult;
  data: TRow[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  queryTableMode: Extract<ResourceGridTableMode, 'Query Backed Static' | 'Query Backed Dynamic'>;
}): QueryBackedNamespaceGridResult<TRow, TPayload> {
  // Full-result fetcher for the Copy/Export "all matching rows" scope: walks the query's pages.
  // Threaded onto gridTableProps so the GridTable filter bar wires the scope toggle + Copy +
  // Export cluster itself (no per-view export action here).
  const fetchAllRows = useCallback((): Promise<TRow[]> => query.fetchAllRows(), [query]);

  const gridTableProps = useMemo(() => {
    const base = queryBackedPaginationProps(
      table.gridTableProps,
      query,
      React.createElement(QueryPaginationControls, {
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
      })
    );
    return { ...base, fetchAllRows, exportFilename: viewId };
  }, [data.length, fetchAllRows, persistence, query, table.gridTableProps, viewId]);

  return {
    ...table,
    gridTableProps,
    queryPayload: query.payload,
    // The typed query source feeds the one controller contract as the single source of truth
    // (no separate wrapper-level rows/loading/loaded/error).
    source: buildQueryBackedSource({
      rows: gridTableProps.data,
      loading,
      loaded,
      error,
      mode: queryTableMode,
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
  clusterId,
  domain,
  label,
  baseScope,
  queryTableMode = 'Query Backed Dynamic',
  selectRows,
  predicates,
  filterOptionOverrides,
  defaultSort = { key: 'name', direction: 'asc' },
  namespace,
  ...tableParams
}: QueryBackedNamespaceGridParams<TPayload, TRow>): QueryBackedNamespaceGridResult<TRow, TPayload> {
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
    data: tableParams.persistenceData ?? [],
    keyExtractor: resolvedKeyExtractor,
    filterOptions: {
      ...(tableParams.filterOptions ?? {}),
      isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE,
    },
    pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
  });
  const liveScope = useMemo(
    () =>
      clusterId ? buildClusterScope(clusterId, baseScope ?? namespaceScopeKey(namespace)) : '',
    [baseScope, clusterId, namespace]
  );
  const lifecycle = useTypedQueryLifecycle<TPayload, TRow>({
    clusterId,
    domain,
    label,
    // Scope the typed query to the selected namespace, reusing the exact base the live
    // subscription above already uses. namespaceScopeKey normalizes the raw namespace name to the
    // backend scope key `namespace:<name>`; all-namespaces stays `namespace:all` (cluster-wide).
    baseScope: baseScope ?? namespaceScopeKey(namespace),
    queryTableMode,
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
  return useQueryBackedGridResult<TPayload, TRow>({
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
  clusterId,
  domain,
  label,
  baseScope = '',
  queryTableMode = 'Query Backed Static',
  selectRows,
  predicates,
  filterOptionOverrides,
  defaultSortKey = 'name',
  defaultSortDirection = 'asc',
  ...tableParams
}: QueryBackedClusterGridParams<TPayload, TRow>): QueryBackedNamespaceGridResult<TRow, TPayload> {
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
    data: tableParams.persistenceData ?? [],
    keyExtractor: resolvedKeyExtractor,
    filterOptions: { ...(tableParams.filterOptions ?? {}), isNamespaceScoped: false },
    pageSizeOptions: TYPED_QUERY_PAGE_LIMIT_OPTIONS,
  });
  const liveScope = useMemo(
    () => (clusterId ? buildClusterScope(clusterId, baseScope) : ''),
    [baseScope, clusterId]
  );
  const lifecycle = useTypedQueryLifecycle<TPayload, TRow>({
    clusterId,
    domain,
    label,
    baseScope,
    queryTableMode,
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
  return useQueryBackedGridResult<TPayload, TRow>({
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
  });
}
