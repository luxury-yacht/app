import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { RefreshDomain } from '@/core/refresh/types';
import { useRefreshScopedDomain } from '@/core/refresh';
import { useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { GridTableFilterOptions } from '@shared/components/tables/GridTable';
import type { SortConfig } from '@/hooks/useTableSort';
import { useDefaultTablePageSize } from '@/hooks/useDefaultTablePageSize';
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
import { backendQuerySource } from './backendQuerySource';
import type { ResourceInventorySourceState } from './useResourceInventoryTable';
import {
  useTypedResourceQuery,
  type TypedQueryPayload,
  type UseTypedResourceQueryResult,
} from './useTypedResourceQuery';
import {
  TABLE_PAGE_SIZE_OPTIONS,
  isTablePageSize,
  type TablePageSize,
} from '@shared/components/tables/pageSizeOptions';
import { mergeQueryBackedFilterOptions, useQueryBackedTableState } from './queryBackedTableState';
import type { QueryBackedTableState } from './queryBackedTableState';

// The namespace prop is the raw name for a single namespace but the `namespace:all` sentinel for
// all-namespaces; the backend scope key is always `namespace:<value>` (see pods.go collectPods,
// which splits the scope on ':' and rejects a bare name). Normalize before building any scope.
const namespaceScopeKey = (namespace: string): string =>
  namespace.startsWith('namespace:') ? namespace : `namespace:${namespace}`;

// A view's persisted page size wins when it is a real option; otherwise the
// fallback applies (the app-wide Default Page Size preference).
export const typedQueryPageLimitOrDefault = (
  value: number | null | undefined,
  fallback: TablePageSize
): TablePageSize => (isTablePageSize(value) ? value : fallback);

// The live-data identity the typed query watches to decide when to refetch. It
// uses the opaque source token emitted by snapshots and doorbell signals, not
// refresh timestamps or the legacy version/checksum tuple.
export const liveDomainVersion = (state: {
  sourceVersion?: string;
  version?: number | string;
  checksum?: string;
  etag?: string;
  streamRevision?: number;
  lastUpdated?: number;
  lastAutoRefresh?: number;
  lastManualRefresh?: number;
}): string => state.sourceVersion ?? state.etag ?? '';

// Derives the controller source state (data/loading/loaded/error) for a query-backed
// resource grid. Sourced ONLY from the typed query — never the live snapshot, which is the
// wrong representation for a query-backed view (unsorted client-side, unpaginated). While the
// query is gating or before its first page applies, it reports empty+loading so the controller
// bridges with the cached page (correctly sorted) or shows a first-load spinner.
//
// `loading` is true ONLY for that initial gap. Every later refetch — filter, sort, page size,
// manual, or background liveness — is visually silent: the table keeps the last applied rows
// (or the settled "no matches" state, which keeps the filter input mounted and focused) until
// the new page lands.
export function deriveQueryBackedData<TRow>({
  clusterId,
  queryEnabled,
  queryRows,
  queryLoaded,
  queryError,
}: {
  clusterId?: string | null;
  queryEnabled: boolean;
  queryRows: TRow[];
  queryLoaded: boolean;
  queryError: string | null;
}): { data: TRow[]; loading: boolean; loaded: boolean; error: string | null } {
  if (!queryEnabled) {
    // Gating (awaiting cluster/persistence/live-domain readiness): hold loading so the
    // controller replays the cached page or shows a spinner — never the live snapshot.
    return { data: [], loading: Boolean(clusterId), loaded: false, error: null };
  }
  return {
    data: queryRows,
    loading: queryRows.length === 0 && !queryLoaded && !queryError,
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
  const defaultPageSize = useDefaultTablePageSize();
  const pageLimit = typedQueryPageLimitOrDefault(persistence.pageSize, defaultPageSize);
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
  const hydratedRef = useRef(persistence.hydrated);
  hydratedRef.current = persistence.hydrated;
  const handlePublishedTableState = useCallback(
    (next: QueryBackedTableState) => {
      // A publish from before persistence hydration carries the default
      // filters; arming the query then would fire a wrong-filters fetch the
      // moment `hydrated` flips (it gets discarded, but it still runs). Only
      // the post-hydration publish (guaranteed by the table's publish effect
      // depending on `hydrated`) marks the state ready.
      if (hydratedRef.current) {
        setTableStateReady(true);
      }
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

  const effectiveFilterOptionOverrides = useMemo(
    () => mergeQueryBackedFilterOptions(filterOptionOverrides, query.filterOptions),
    [filterOptionOverrides, query.filterOptions]
  );

  const { data, loading, loaded, error } = deriveQueryBackedData<TRow>({
    clusterId,
    queryEnabled,
    queryRows: query.rows,
    queryLoaded: query.loaded,
    queryError: query.error,
  });

  return {
    data,
    loading,
    loaded,
    error,
    tableMode: queryTableMode,
    effectiveFilterOptionOverrides,
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
}): QueryBackedNamespaceGridResult<TRow, TPayload> {
  // Full-result fetcher for the Copy/Export "all matching rows" scope: walks the query's pages.
  // Threaded onto gridTableProps so the GridTable filter bar wires the scope toggle + Copy +
  // Export cluster itself (no per-view export action here).
  const fetchAllRows = useCallback((): Promise<TRow[]> => query.fetchAllRows(), [query]);

  const gridTableProps = useMemo(() => {
    const base = {
      ...table.gridTableProps,
      // Mirrors the footer buttons' disabled logic so ArrowLeft/ArrowRight
      // page exactly when the buttons are clickable.
      onPagePrevious: query.loadPrevious,
      onPageNext: query.loadMore,
      canPagePrevious: query.hasPrevious && !query.isRequestingMore,
      canPageNext: Boolean(query.continueToken) && !query.isRequestingMore,
      paginationControls: React.createElement(QueryPaginationControls, {
        idPrefix: viewId,
        pageIndex: query.pageIndex,
        pageSize: query.pageSize,
        visibleItemCount: data.length,
        pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
        totalCount: query.totalCount,
        totalIsExact: query.totalIsExact,
        hasPrevious: query.hasPrevious,
        hasNext: Boolean(query.continueToken),
        loading: query.isRequestingMore,
        onPrevious: query.loadPrevious,
        onNext: query.loadMore,
        onPageSizeChange: (value: number) => {
          if (isTablePageSize(value)) {
            persistence.setPageSize(value);
          }
        },
      }),
    };
    return { ...base, fetchAllRows, exportFilename: viewId };
  }, [data.length, fetchAllRows, persistence, query, table.gridTableProps, viewId]);

  return {
    ...table,
    gridTableProps,
    queryPayload: query.payload,
    // The typed query source feeds the one controller contract as the single source of truth
    // (no separate wrapper-level rows/loading/loaded/error). enabled is true:
    // query gating is already folded into loading/loaded by deriveQueryBackedData.
    source: backendQuerySource({
      enabled: true,
      rows: gridTableProps.data,
      loading,
      loaded,
      error,
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
      | 'data'
      | 'tableMode'
      | 'onTableStateChange'
      | 'filterOptionOverrides'
      | 'persistenceOverride'
      | 'keyExtractor'
      | 'availableKinds'
    >,
    QueryBackedGridParamsCommon<TPayload, TRow> {
  /** Optional: the wrapper resolves a canonical default when omitted. */
  keyExtractor?: (item: TRow, index: number) => string;
}

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
    pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
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
    // The Kinds dropdown vocabulary is backend-owned: the family's capabilities
    // publish it on every query payload (facets collapse to the selection by
    // design and never feed the dropdown).
    availableKinds: lifecycle.query.kindVocabulary ?? undefined,
    pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
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
  });
}

export interface QueryBackedClusterGridParams<
  TPayload extends TypedQueryPayload,
  TRow extends ResourceGridTableRow,
>
  extends
    Omit<
      ClusterResourceGridTableParams<TRow>,
      | 'data'
      | 'tableMode'
      | 'onTableStateChange'
      | 'filterOptionOverrides'
      | 'persistenceOverride'
      | 'keyExtractor'
      | 'availableKinds'
    >,
    QueryBackedGridParamsCommon<TPayload, TRow> {
  /** Optional: the wrapper resolves a canonical default when omitted. */
  keyExtractor?: (item: TRow, index: number) => string;
}

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
    pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
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
    // The Kinds dropdown vocabulary is backend-owned (see the namespace wrapper).
    availableKinds: lifecycle.query.kindVocabulary ?? undefined,
    pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
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
  });
}
