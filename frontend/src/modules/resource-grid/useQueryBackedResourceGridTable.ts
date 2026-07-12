import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { GridTableFilterOptions } from '@shared/components/tables/GridTable';
import {
  type GridTableFocusRequest,
  matchesGridTableFocusRequest,
} from '@shared/components/tables/hooks/gridTableFocusRequest';
import { peekPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import {
  isTablePageSize,
  TABLE_PAGE_SIZE_OPTIONS,
  type TablePageSize,
} from '@shared/components/tables/pageSizeOptions';
import type { UseGridTablePersistenceResult } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { buildRequiredCanonicalObjectRowKey } from '@shared/utils/objectIdentity';
import { errorHandler } from '@utils/errorHandler';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { doorbellSourceClocks } from '@/core/refresh/streaming/resourceStreamDomains';
import type { RefreshDomain } from '@/core/refresh/types';
import { useDefaultTablePageSize } from '@/hooks/useDefaultTablePageSize';
import type { SortConfig } from '@/hooks/useTableSort';
import { backendQuerySource } from './backendQuerySource';
import QueryPaginationControls from './QueryPaginationControls';
import type { QueryBackedTableState } from './queryBackedTableState';
import { mergeQueryBackedFilterOptions, useQueryBackedTableState } from './queryBackedTableState';
import type {
  ClusterResourceGridTableParams,
  NamespaceResourceGridTableParams,
  ResourceGridTableMode,
  ResourceGridTableResult,
  ResourceGridTableRow,
} from './resourceGridTableTypes';
import { useClusterResourceGridTable, useNamespaceResourceGridTable } from './useResourceGridTable';
import type { ResourceInventorySourceState } from './useResourceInventoryTable';
import {
  type TypedQueryPayload,
  type UseTypedResourceQueryResult,
  useTypedResourceQuery,
} from './useTypedResourceQuery';

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

// The live-data identity the typed query watches to decide when to refetch.
// For domains with declared doorbell clocks it keys on signalVersions — the
// field ONLY the stream manager's doorbell path writes — never the folded
// sourceVersion, which payload applies rewrite: any OTHER consumer fetching
// the same base scope would flip the folded value and echo a pointless 304
// refetch out of this table (observed live as 0-byte 304s trailing every
// metric-tick 200 pair). Domains without doorbell clocks (plain snapshot
// domains) keep the folded token.
export const liveDomainVersion = (
  domain: RefreshDomain,
  state: {
    sourceVersion?: string;
    signalVersions?: Partial<Record<string, string>>;
    version?: number | string;
    checksum?: string;
    etag?: string;
    streamRevision?: number;
    lastUpdated?: number;
    lastAutoRefresh?: number;
    lastManualRefresh?: number;
  }
): string => {
  const clocks = doorbellSourceClocks(domain);
  if (clocks.length === 0) {
    return state.sourceVersion ?? state.etag ?? '';
  }
  return clocks.map((clock) => `${clock}:${state.signalVersions?.[clock] ?? ''}`).join(' ');
};

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

// A permission-denied live scope is SETTLED, not pending: gating the typed
// query on it would hold the table in its loading state for as long as the
// (blocked) stream machinery takes to move — observed live as a 7s spinner
// before "Insufficient permissions". The query issues its own fetch and gets
// the same typed 403 immediately.
export const isLiveDomainInitialLoadPending = (state: {
  status?: string;
  data?: unknown;
  permissionDenied?: boolean;
}): boolean =>
  !state.data &&
  !state.permissionDenied &&
  (state.status === 'loading' || state.status === 'initialising');

export interface QueryBackedNamespaceGridResult<T extends ResourceGridTableRow, TPayload = unknown>
  extends ResourceGridTableResult<T> {
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
  viewId,
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
  viewId: string;
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
  const liveDataVersion = liveDomainVersion(domain, liveDomain);
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

  // One query serves every sort, including cpu/memory: the backend joins live
  // usage onto the rows at serve and sorts by it, so there is no separate
  // metric-domain query and no row-key hydration leg.
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

  useAnchorOnUnmatchedFocusRequest({
    clusterId,
    domain,
    viewId,
    loaded,
    rows: data,
    anchorTo: query.anchorTo,
    anchorResult: query.anchorResult,
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

// Field-based matching only for the anchor decision: the request's rowKey
// branch needs the view's real keyExtractor, which the focus machinery inside
// GridTable owns. A false negative here just fires a redundant jump onto the
// same page; a false positive leaves today's behavior.
const anchorDecisionKeyExtractor = () => '';

// "Show in list" upgrade (plan P8): the existing gridtable:focus-request
// machinery highlights and scrolls a row only when it is on the LOADED page.
// When a pending request targets this table's cluster but matches no loaded
// row, turn it into a backend anchor jump — the landing page then contains
// the row and the normal buffer match takes over. A missing anchor
// (filtered/not-found) is reported through the app's notification channel.
export function useAnchorOnUnmatchedFocusRequest<TRow>({
  clusterId,
  domain,
  viewId,
  loaded,
  rows,
  anchorTo,
  anchorResult,
}: {
  clusterId?: string | null;
  domain: RefreshDomain;
  viewId: string;
  loaded: boolean;
  rows: TRow[];
  anchorTo: UseTypedResourceQueryResult<TRow>['anchorTo'];
  anchorResult: UseTypedResourceQueryResult<TRow>['anchorResult'];
}): void {
  const anchoredRequestRef = useRef<GridTableFocusRequest | null>(null);

  useEffect(() => {
    if (!clusterId || !loaded) {
      return;
    }
    const request = peekPendingFocusRequest();
    if (!request || request.clusterId !== clusterId) {
      return;
    }
    // Only the navigation DESTINATION table reacts: the request is stamped with
    // the destination viewId (useNavigateToView), so a same-cluster non-target
    // table (an object-panel pods list, a different tab) can't consume it and
    // fire a spurious anchor / false not-found. A request with no destination
    // (no emitter produces one today) does not anchor.
    if (request.destinationViewId !== viewId) {
      return;
    }
    // One jump per request (buffer identity): a not-found landing must not
    // re-fire forever.
    if (anchoredRequestRef.current === request) {
      return;
    }
    // A backend anchor needs a full reference; version missing (no builtin
    // backfill either) degrades to the current-page-only behavior.
    if (!request.version) {
      return;
    }
    const probe = { ...request, rowKey: undefined };
    const onPage = rows.some((row, index) =>
      matchesGridTableFocusRequest(row, index, anchorDecisionKeyExtractor, probe)
    );
    if (onPage) {
      return;
    }
    anchoredRequestRef.current = request;
    anchorTo({
      clusterId: request.clusterId,
      group: request.group ?? '',
      version: request.version,
      kind: request.kind,
      namespace: request.namespace,
      name: request.name,
      uid: request.uid,
    });
  }, [anchorTo, clusterId, loaded, rows, viewId]);

  useEffect(() => {
    if (!anchorResult || anchorResult.found) {
      return;
    }
    const request = anchoredRequestRef.current;
    const target = request
      ? `${request.kind} ${request.namespace ? `${request.namespace}/` : ''}${request.name}`
      : 'The requested object';
    // Loud, inline-adjacent truth (degraded states must be visible): the jump
    // landed on page 1 because the object is not in this view.
    errorHandler.handle(
      new Error(
        anchorResult.reason === 'filtered'
          ? `${target} is not shown: the current filters exclude it`
          : `${target} was not found — it may have been deleted`
      ),
      { source: 'resource-grid-anchor', domain }
    );
  }, [anchorResult, domain]);
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
      // Mirrors the footer buttons' disabled logic so the modified-arrow
      // shortcuts page exactly when the buttons are clickable.
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
        // Numbered jumps ride the bounded startRank contract; the control
        // renders only while the total is exact.
        onPageJump: query.jumpToPage,
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
> extends Omit<
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
    viewId: tableParams.viewId,
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
> extends Omit<
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
    viewId: tableParams.viewId,
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
