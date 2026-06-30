import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefreshDomain } from '@/core/refresh/types';
import { useRefreshScopedDomain } from '@/core/refresh';
import { useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable';
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
  type FetchTypedResourceRowsOptions,
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

const EMPTY_QUERY_FILTERS: GridTableFilterState = {
  search: '',
  kinds: [],
  namespaces: [],
  caseSensitive: false,
  includeMetadata: false,
};

const METRIC_SORT_FIELDS = new Set(['cpu', 'memory']);
const METRIC_OVERLAY_FETCH_SORT: SortConfig = { key: 'name', direction: 'asc' };
const METRIC_OVERLAY_ROW_KEY_BATCH_SIZE = 250;
const METRIC_ROW_MISMATCH_MESSAGE = '[ResourceGridTable] Metric rows did not match standard rows';

const uniqueRowKeys = (keys: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  keys.forEach((key) => {
    const normalized = (key ?? '').trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

const rowKeysPredicateValue = (keys: string[]): string => uniqueRowKeys(keys).sort().join('|');

const unmatchedMetricRowKeys = <TRow>(
  standardRows: TRow[],
  metricRows: unknown[],
  getStandardRowKey: (row: TRow) => string,
  getMetricRowKey: (row: unknown) => string
): string[] => {
  if (metricRows.length === 0) {
    return [];
  }
  const standardRowKeys = new Set(uniqueRowKeys(standardRows.map(getStandardRowKey)));
  return uniqueRowKeys(
    metricRows.map(getMetricRowKey).filter((metricRowKey) => {
      const normalized = (metricRowKey ?? '').trim();
      return normalized && !standardRowKeys.has(normalized);
    })
  );
};

const logMetricRowMismatch = ({
  baseDomain,
  metricDomain,
  label,
  scope,
  source,
  rowKeys,
}: {
  baseDomain: RefreshDomain;
  metricDomain: RefreshDomain;
  label: string;
  scope: string;
  source: 'renderedRows' | 'fetchAllRows';
  rowKeys: string[];
}) => {
  if (rowKeys.length === 0) {
    return;
  }
  console.error(METRIC_ROW_MISMATCH_MESSAGE, {
    baseDomain,
    metricDomain,
    label,
    scope,
    source,
    rowKeys,
  });
};

const fetchRowsByRowKeys = async <TRow>(
  fetchAllRows: (options?: FetchTypedResourceRowsOptions) => Promise<TRow[]>,
  rowKeys: string[]
): Promise<TRow[]> => {
  const keys = uniqueRowKeys(rowKeys).sort();
  if (keys.length === 0) {
    return [];
  }
  const rows: TRow[] = [];
  for (let index = 0; index < keys.length; index += METRIC_OVERLAY_ROW_KEY_BATCH_SIZE) {
    const batch = keys.slice(index, index + METRIC_OVERLAY_ROW_KEY_BATCH_SIZE);
    const predicate = rowKeysPredicateValue(batch);
    if (!predicate) {
      continue;
    }
    rows.push(
      ...(await fetchAllRows({
        filters: EMPTY_QUERY_FILTERS,
        sortConfig: METRIC_OVERLAY_FETCH_SORT,
        predicates: { rowKeys: predicate },
      }))
    );
  }
  return rows;
};

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
  metricPayload?: unknown | null;
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
  metricOverlay?: QueryBackedMetricOverlay<TRow>;
}

export interface QueryBackedMetricOverlay<TRow extends ResourceGridTableRow> {
  domain: RefreshDomain;
  label?: string;
  selectRows: (payload: TypedQueryPayload) => unknown[];
  sortFields?: readonly string[];
  getBaseRowKey: (row: TRow) => string;
  getMetricRowKey: (row: unknown) => string;
  mergeMetric: (row: TRow, metric: unknown | undefined) => TRow;
  selectMetricPayload?: (payload: TypedQueryPayload | null) => unknown;
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
  metricPayload: unknown | null;
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
  metricOverlay,
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
  metricOverlay?: QueryBackedMetricOverlay<TRow>;
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
  useScopedRefreshDomainLifecycle({
    domain: metricOverlay?.domain ?? null,
    scope: metricOverlay ? liveScope || null : null,
    enabled: Boolean(metricOverlay),
    preserveState: true,
    fetchOnEnable: false,
  });
  const liveDomain = useRefreshScopedDomain(domain, liveScope);
  const metricLiveDomain = useRefreshScopedDomain(metricOverlay?.domain ?? domain, liveScope);
  const liveDataVersion = liveDomainVersion(liveDomain);
  const metricLiveDataVersion = liveDomainVersion(metricLiveDomain);
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

  const metricSortFields = useMemo(
    () => new Set(metricOverlay?.sortFields ?? METRIC_SORT_FIELDS),
    [metricOverlay?.sortFields]
  );
  const activeSortKey = tableState.sortConfig?.key?.toLowerCase() ?? '';
  const isMetricSort = Boolean(metricOverlay && metricSortFields.has(activeSortKey));

  const baseLiveDataVersion = isMetricSort
    ? `${liveDataVersion}|${metricLiveDataVersion}`
    : liveDataVersion;

  const baseQuery = useTypedResourceQuery<TPayload, TRow>({
    enabled: queryEnabled && !isMetricSort,
    clusterId,
    domain,
    label,
    baseScope,
    filters: tableState.filters,
    sortConfig: tableState.sortConfig,
    pageLimit,
    predicates,
    liveDataVersion: baseLiveDataVersion,
    selectRows,
  });

  const metricQuery = useTypedResourceQuery<TypedQueryPayload, unknown>({
    enabled: Boolean(metricOverlay) && queryEnabled && isMetricSort,
    clusterId,
    domain: metricOverlay?.domain ?? domain,
    label: metricOverlay?.label ?? `${label} Metrics`,
    baseScope,
    filters: tableState.filters,
    sortConfig: tableState.sortConfig,
    pageLimit,
    predicates,
    liveDataVersion: `${liveDataVersion}|${metricLiveDataVersion}`,
    selectRows: (payload) => (metricOverlay ? metricOverlay.selectRows(payload) : []),
  });

  const metricRowKeys = useMemo(
    () =>
      rowKeysPredicateValue(
        metricQuery.rows.map((row) => metricOverlay?.getMetricRowKey(row) ?? '')
      ),
    [metricOverlay, metricQuery.rows]
  );
  const baseHydrationPredicates = useMemo(
    () => (metricRowKeys ? { rowKeys: metricRowKeys } : undefined),
    [metricRowKeys]
  );
  const baseHydrationQuery = useTypedResourceQuery<TPayload, TRow>({
    enabled: queryEnabled && isMetricSort && Boolean(metricRowKeys),
    clusterId,
    domain,
    label,
    baseScope,
    filters: EMPTY_QUERY_FILTERS,
    sortConfig: { key: 'name', direction: 'asc' },
    pageLimit,
    predicates: baseHydrationPredicates,
    liveDataVersion,
    selectRows,
  });

  const baseRowKeys = useMemo(
    () =>
      rowKeysPredicateValue(baseQuery.rows.map((row) => metricOverlay?.getBaseRowKey(row) ?? '')),
    [baseQuery.rows, metricOverlay]
  );
  const metricOverlayPredicates = useMemo(
    () => (baseRowKeys ? { rowKeys: baseRowKeys } : undefined),
    [baseRowKeys]
  );
  const metricOverlayQuery = useTypedResourceQuery<TypedQueryPayload, unknown>({
    enabled: Boolean(metricOverlay) && queryEnabled && !isMetricSort && Boolean(baseRowKeys),
    clusterId,
    domain: metricOverlay?.domain ?? domain,
    label: metricOverlay?.label ?? `${label} Metrics`,
    baseScope,
    filters: EMPTY_QUERY_FILTERS,
    sortConfig: { key: 'name', direction: 'asc' },
    pageLimit,
    predicates: metricOverlayPredicates,
    liveDataVersion: metricLiveDataVersion,
    selectRows: (payload) => (metricOverlay ? metricOverlay.selectRows(payload) : []),
  });

  const metricRows = isMetricSort ? metricQuery.rows : metricOverlayQuery.rows;
  const metricRowsByKey = useMemo(() => {
    const map = new Map<string, unknown>();
    if (!metricOverlay) {
      return map;
    }
    metricRows.forEach((row) => {
      map.set(metricOverlay.getMetricRowKey(row), row);
    });
    return map;
  }, [metricOverlay, metricRows]);

  const baseRowsByKey = useMemo(() => {
    const map = new Map<string, TRow>();
    if (!metricOverlay) {
      return map;
    }
    baseHydrationQuery.rows.forEach((row) => {
      map.set(metricOverlay.getBaseRowKey(row), row);
    });
    return map;
  }, [baseHydrationQuery.rows, metricOverlay]);

  const metricMatchStandardRows = isMetricSort ? baseHydrationQuery.rows : baseQuery.rows;
  const metricMatchLoaded = isMetricSort
    ? metricQuery.loaded &&
      (metricRows.length === 0 || (Boolean(baseHydrationPredicates) && baseHydrationQuery.loaded))
    : baseQuery.loaded && metricOverlayQuery.loaded;
  const visibleUnmatchedMetricRowKeys = useMemo(() => {
    if (!metricOverlay || !metricMatchLoaded || metricRows.length === 0) {
      return [];
    }
    return unmatchedMetricRowKeys(
      metricMatchStandardRows,
      metricRows,
      metricOverlay.getBaseRowKey,
      metricOverlay.getMetricRowKey
    );
  }, [metricMatchLoaded, metricMatchStandardRows, metricOverlay, metricRows]);

  const metricMismatchLogSignatureRef = useRef('');
  useEffect(() => {
    if (!metricOverlay || visibleUnmatchedMetricRowKeys.length === 0) {
      metricMismatchLogSignatureRef.current = '';
      return;
    }
    const signature = `${domain}|${metricOverlay.domain}|${liveScope}|${visibleUnmatchedMetricRowKeys.join(
      '|'
    )}`;
    if (metricMismatchLogSignatureRef.current === signature) {
      return;
    }
    metricMismatchLogSignatureRef.current = signature;
    logMetricRowMismatch({
      baseDomain: domain,
      metricDomain: metricOverlay.domain,
      label,
      scope: liveScope,
      source: 'renderedRows',
      rowKeys: visibleUnmatchedMetricRowKeys,
    });
  }, [domain, label, liveScope, metricOverlay, visibleUnmatchedMetricRowKeys]);

  const mergedRows = useMemo(() => {
    if (!metricOverlay) {
      return baseQuery.rows;
    }
    if (isMetricSort) {
      return metricRows.flatMap((metricRow) => {
        const baseRow = baseRowsByKey.get(metricOverlay.getMetricRowKey(metricRow));
        return baseRow ? [metricOverlay.mergeMetric(baseRow, metricRow)] : [];
      });
    }
    return baseQuery.rows.map((row) =>
      metricOverlay.mergeMetric(row, metricRowsByKey.get(metricOverlay.getBaseRowKey(row)))
    );
  }, [baseQuery.rows, baseRowsByKey, isMetricSort, metricOverlay, metricRows, metricRowsByKey]);

  const fetchAllMergedRows = useCallback(async (): Promise<TRow[]> => {
    if (!metricOverlay) {
      return baseQuery.fetchAllRows();
    }
    if (!isMetricSort) {
      const allBaseRows = await baseQuery.fetchAllRows();
      const allMetricRows = await fetchRowsByRowKeys(
        metricOverlayQuery.fetchAllRows,
        allBaseRows.map((row) => metricOverlay.getBaseRowKey(row))
      );
      const metricsByKey = new Map<string, unknown>();
      allMetricRows.forEach((metricRow) => {
        metricsByKey.set(metricOverlay.getMetricRowKey(metricRow), metricRow);
      });
      logMetricRowMismatch({
        baseDomain: domain,
        metricDomain: metricOverlay.domain,
        label,
        scope: liveScope,
        source: 'fetchAllRows',
        rowKeys: unmatchedMetricRowKeys(
          allBaseRows,
          allMetricRows,
          metricOverlay.getBaseRowKey,
          metricOverlay.getMetricRowKey
        ),
      });
      return allBaseRows.map((row) =>
        metricOverlay.mergeMetric(row, metricsByKey.get(metricOverlay.getBaseRowKey(row)))
      );
    }

    const allMetricRows = await metricQuery.fetchAllRows();
    const allBaseRows = await fetchRowsByRowKeys(
      baseHydrationQuery.fetchAllRows,
      allMetricRows.map((metricRow) => metricOverlay.getMetricRowKey(metricRow))
    );
    const baseRowsByMetricKey = new Map<string, TRow>();
    allBaseRows.forEach((row) => {
      baseRowsByMetricKey.set(metricOverlay.getBaseRowKey(row), row);
    });
    logMetricRowMismatch({
      baseDomain: domain,
      metricDomain: metricOverlay.domain,
      label,
      scope: liveScope,
      source: 'fetchAllRows',
      rowKeys: unmatchedMetricRowKeys(
        allBaseRows,
        allMetricRows,
        metricOverlay.getBaseRowKey,
        metricOverlay.getMetricRowKey
      ),
    });
    return allMetricRows.flatMap((metricRow) => {
      const baseRow = baseRowsByMetricKey.get(metricOverlay.getMetricRowKey(metricRow));
      return baseRow ? [metricOverlay.mergeMetric(baseRow, metricRow)] : [];
    });
  }, [
    baseHydrationQuery.fetchAllRows,
    baseQuery,
    domain,
    isMetricSort,
    label,
    liveScope,
    metricOverlay,
    metricOverlayQuery.fetchAllRows,
    metricQuery,
  ]);

  const query: UseTypedResourceQueryResult<TRow, TPayload> = useMemo(() => {
    if (!metricOverlay) {
      return baseQuery;
    }
    if (!isMetricSort) {
      return {
        ...baseQuery,
        rows: mergedRows,
        fetchAllRows: fetchAllMergedRows,
      };
    }
    const unhydratedMetricRowCount = Math.max(0, metricRows.length - mergedRows.length);
    return {
      ...baseQuery,
      rows: mergedRows,
      payload: baseHydrationQuery.payload ?? baseQuery.payload,
      loading: metricQuery.loading || (metricQuery.rows.length > 0 && baseHydrationQuery.loading),
      loaded: metricQuery.loaded && (metricQuery.rows.length === 0 || baseHydrationQuery.loaded),
      error: metricQuery.error ?? baseHydrationQuery.error ?? baseQuery.error,
      continueToken: metricQuery.continueToken,
      hasPrevious: metricQuery.hasPrevious,
      isRequestingMore: metricQuery.isRequestingMore || baseHydrationQuery.isRequestingMore,
      loadMore: metricQuery.loadMore,
      loadPrevious: metricQuery.loadPrevious,
      pageIndex: metricQuery.pageIndex,
      pageSize: metricQuery.pageSize,
      totalCount: Math.max(0, metricQuery.totalCount - unhydratedMetricRowCount),
      totalIsExact: metricQuery.totalIsExact,
      filterOptions: metricQuery.filterOptions,
      kindVocabulary: metricQuery.kindVocabulary,
      dynamic: metricQuery.dynamic,
      fetchAllRows: fetchAllMergedRows,
    };
  }, [
    baseHydrationQuery.error,
    baseHydrationQuery.isRequestingMore,
    baseHydrationQuery.loaded,
    baseHydrationQuery.loading,
    baseHydrationQuery.payload,
    baseQuery,
    fetchAllMergedRows,
    isMetricSort,
    mergedRows,
    metricOverlay,
    metricQuery,
    metricRows.length,
  ]);

  const metricPayload = useMemo(() => {
    if (!metricOverlay) {
      return null;
    }
    const payload = (isMetricSort ? metricQuery.payload : metricOverlayQuery.payload) ?? null;
    if (!metricOverlay?.selectMetricPayload) {
      return payload;
    }
    return metricOverlay.selectMetricPayload(payload);
  }, [isMetricSort, metricOverlay, metricOverlayQuery.payload, metricQuery.payload]);

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
    metricPayload,
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
  metricPayload,
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
  metricPayload?: unknown | null;
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
    metricPayload,
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
  metricOverlay,
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
    metricOverlay,
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
    metricPayload: lifecycle.metricPayload,
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
  metricOverlay,
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
    metricOverlay,
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
    metricPayload: lifecycle.metricPayload,
  });
}
