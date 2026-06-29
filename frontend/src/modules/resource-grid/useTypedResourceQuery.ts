import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRefreshDomainState } from '@/core/data-access';
import type {
  GridTableFilterState,
  GridTableFilterOptions,
} from '@shared/components/tables/GridTable';
import type { SortConfig } from '@hooks/useTableSort';
import { DEFAULT_TABLE_PAGE_SIZE } from '@shared/components/tables/pageSizeOptions';
import type { RefreshDomain, ResourceQueryDynamicRef } from '@/core/refresh/types';
import { walkQueryCursorPages } from './cursorPageWalk';
import {
  buildTypedResourceQueryScope,
  filterOptionsFromTypedPayload,
  typedResourceQueryLifecycleIdentity,
  type TypedQueryPayload,
} from './typedResourceQueryScope';
export type { TypedQueryPayload } from './typedResourceQueryScope';

export interface UseTypedResourceQueryParams<TPayload extends TypedQueryPayload, TRow> {
  enabled: boolean;
  clusterId?: string | null;
  domain: RefreshDomain;
  label: string;
  baseScope?: string;
  filters: GridTableFilterState;
  sortConfig: SortConfig | null;
  pageLimit?: number;
  predicates?: Record<string, string | null | undefined>;
  liveDataVersion?: string | null;
  selectRows: (payload: TPayload) => TRow[];
}

export interface FetchTypedResourceRowsOptions {
  filters?: GridTableFilterState;
  sortConfig?: SortConfig | null;
  pageLimit?: number;
  predicates?: Record<string, string | null | undefined>;
  baseScope?: string;
  label?: string;
}

export interface UseTypedResourceQueryResult<TRow, TPayload = unknown> {
  rows: TRow[];
  /**
   * The last successfully applied page payload. Rows are extracted via
   * selectRows; payload-level metadata (e.g. the pods metrics meta, scoped to
   * the QUERIED cluster) rides here for consumers that need it.
   */
  payload: TPayload | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  continueToken: string | null;
  hasPrevious: boolean;
  isRequestingMore: boolean;
  loadMore: () => void;
  loadPrevious: () => void;
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  totalIsExact: boolean;
  filterOptions: Partial<GridTableFilterOptions>;
  /**
   * The backend-published closed kind set for this family (the Kinds dropdown
   * option list). Rides the applied payload's capabilities, so it survives
   * filter refetches whose facets collapse to the selection; null before the
   * first page applies or after a hard reset.
   */
  kindVocabulary: string[] | null;
  dynamic: ResourceQueryDynamicRef | null;
  /** Fetch every matching row (all pages) for the current filters/sort — used by export. */
  fetchAllRows: (options?: FetchTypedResourceRowsOptions) => Promise<TRow[]>;
}

// Each export page requests the backend's max page size to minimise round-trips.
const EXPORT_PAGE_LIMIT = 1000;
// Matches Browse: a full backend page build per keystroke is pure waste (the
// out-of-order identity guard already prevents wrong rows).
const SEARCH_DEBOUNCE_MS = 250;
// A warm-up (the backend executed but its caches were not ready, so the scoped
// state carried no payload yet) is transient. The identity-driven retry only
// fires when `liveDataVersion` changes — which it never does for an EMPTY domain
// (no rows ⇒ a constant data identity), so a first-view warm-up would otherwise
// spin forever. This timer re-attempts the warm-up on its own and stops the
// instant a payload applies (or the query errors / is disabled).
const WARMUP_RETRY_MS = 1000;

export function useTypedResourceQuery<TPayload extends TypedQueryPayload, TRow>({
  enabled,
  clusterId,
  domain,
  label,
  baseScope,
  filters,
  sortConfig,
  pageLimit = DEFAULT_TABLE_PAGE_SIZE,
  predicates,
  liveDataVersion,
  selectRows,
}: UseTypedResourceQueryParams<TPayload, TRow>): UseTypedResourceQueryResult<TRow, TPayload> {
  // Debounce ONLY the search string (sort/kind/namespace changes apply
  // immediately). Seeded from the live value so a persisted search fires
  // without delay on mount.
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search ?? '');
  useEffect(() => {
    const nextSearch = filters.search ?? '';
    if (nextSearch === debouncedSearch) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDebouncedSearch(nextSearch);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [debouncedSearch, filters.search]);
  const effectiveFilters = useMemo(
    () =>
      (filters.search ?? '') === debouncedSearch
        ? filters
        : { ...filters, search: debouncedSearch },
    [debouncedSearch, filters]
  );

  const [rows, setRows] = useState<TRow[]>([]);
  const [payload, setPayload] = useState<TPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [previousTokens, setPreviousTokens] = useState<Array<string | null>>([]);
  const [pageIndex, setPageIndex] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalIsExact, setTotalIsExact] = useState(true);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [filterOptions, setFilterOptions] = useState<Partial<GridTableFilterOptions>>({});
  const [dynamic, setDynamic] = useState<ResourceQueryDynamicRef | null>(null);
  // Bumped by the warm-up retry timer to re-run the fetch effect when no other
  // identity input (filters, sort, liveDataVersion) has changed.
  const [warmupAttempt, setWarmupAttempt] = useState(0);
  const warmupTimerRef = useRef<number | null>(null);
  const pendingNavigationRef = useRef<{
    direction: 'next' | 'previous';
    previousPageToken?: string | null;
    /** The requestToken at click time — restored when the navigation fetch fails. */
    revertToken: string | null;
  } | null>(null);
  // Hold selectRows in a ref so applyPayload (and therefore the fetch effect)
  // stays stable even if a caller passes an unmemoized selector. Without this an
  // inline selectRows would re-run the fetch every render.
  const selectRowsRef = useRef(selectRows);
  selectRowsRef.current = selectRows;
  const queryIdentity = useMemo(
    () =>
      typedResourceQueryLifecycleIdentity({
        enabled,
        clusterId,
        domain,
        baseScope,
        filters: effectiveFilters,
        sortConfig,
        pageLimit,
        predicates,
        liveDataVersion,
      }),
    [
      baseScope,
      clusterId,
      domain,
      enabled,
      effectiveFilters,
      liveDataVersion,
      pageLimit,
      predicates,
      sortConfig,
    ]
  );
  const queryResetIdentity = useMemo(
    () =>
      typedResourceQueryLifecycleIdentity({
        enabled,
        clusterId,
        domain,
        baseScope,
        filters: effectiveFilters,
        sortConfig,
        pageLimit,
        predicates,
      }),
    [baseScope, clusterId, domain, enabled, effectiveFilters, pageLimit, predicates, sortConfig]
  );
  const queryHardResetIdentity = useMemo(
    () =>
      typedResourceQueryLifecycleIdentity({
        enabled,
        clusterId,
        domain,
        baseScope,
        filters: {
          search: '',
          kinds: [],
          namespaces: [],
          caseSensitive: false,
          includeMetadata: false,
        },
        sortConfig: null,
        pageLimit: DEFAULT_TABLE_PAGE_SIZE,
        predicates,
      }),
    [baseScope, clusterId, domain, enabled, predicates]
  );
  const queryIdentityRef = useRef(queryIdentity);
  const queryResetIdentityRef = useRef(queryResetIdentity);
  queryIdentityRef.current = queryIdentity;

  const requestTokenForScope =
    queryResetIdentityRef.current === queryResetIdentity ? requestToken : null;

  // Hard reset — cluster, domain, base scope, predicates, or enabled changed, so
  // the applied page now belongs to a DIFFERENT cluster/resource. Clear it DURING
  // render (React's "adjust state when an identity changes" pattern), not in an
  // effect: an effect-based clear first commits and PAINTS one frame of the prior
  // cluster's rows under the new cluster's identity — the cross-cluster data
  // flash. Setting state during render makes React discard this render and
  // re-render with the page cleared before it ever commits. The soft reset below
  // (cursors only) stays in an effect because it deliberately KEEPS the visible
  // rows for quiet filtering and so never flashes.
  const [appliedHardResetIdentity, setAppliedHardResetIdentity] = useState(queryHardResetIdentity);
  if (appliedHardResetIdentity !== queryHardResetIdentity) {
    setAppliedHardResetIdentity(queryHardResetIdentity);
    setRows([]);
    setPayload(null);
    setLoaded(false);
    setTotalCount(0);
    setTotalIsExact(true);
    setFilterOptions({});
    setDynamic(null);
  }

  // Soft reset — filters, sort, page size, or live-data identity changed within
  // the SAME cluster/resource. Drop the pagination cursors so the refetch restarts
  // at page 1, but keep the visible rows (quiet filtering). Safe after paint: no
  // row change, no flash.
  useEffect(() => {
    queryResetIdentityRef.current = queryResetIdentity;
    setRequestToken(null);
    setContinueToken(null);
    setPreviousTokens([]);
    setPageIndex(1);
    pendingNavigationRef.current = null;
  }, [queryResetIdentity]);

  const scope = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return buildTypedResourceQueryScope(clusterId, {
      baseScope,
      filters: effectiveFilters,
      sortConfig,
      pageLimit,
      predicates,
      continueToken: requestTokenForScope,
    });
  }, [
    baseScope,
    clusterId,
    enabled,
    effectiveFilters,
    pageLimit,
    predicates,
    requestTokenForScope,
    sortConfig,
  ]);

  const applyPayload = useCallback((payload: TPayload) => {
    const nextRows = selectRowsRef.current(payload);
    setRows(nextRows);
    setPayload(payload);
    setContinueToken(payload.continue ?? null);
    const hasTotal = typeof payload.total === 'number';
    // A missing total must never render as an exact 0 while rows are visible.
    // Fall back to the visible row count and mark the total approximate so the
    // UI shows "≈N" / no "Page N of M" rather than a false "0 of 0".
    setTotalCount(hasTotal ? (payload.total as number) : nextRows.length);
    setTotalIsExact(hasTotal ? payload.totalIsExact !== false : false);
    setFilterOptions(filterOptionsFromTypedPayload(payload));
    setDynamic(payload.dynamic ?? null);
    const pendingNavigation = pendingNavigationRef.current;
    if (pendingNavigation) {
      if (pendingNavigation.direction === 'next') {
        setPreviousTokens((current) => [...current, pendingNavigation.previousPageToken ?? null]);
        setPageIndex((current) => current + 1);
      } else {
        setPreviousTokens((current) => current.slice(0, -1));
        setPageIndex((current) => Math.max(1, current - 1));
      }
      pendingNavigationRef.current = null;
    }
    setLoaded(true);
  }, []);

  // A failed navigation fetch must restore the pre-navigation cursor. Leaving
  // the failed cursor in place latched the pagination: a retry set the SAME
  // token (no state change → no fetch, isRequestingMore stuck true) and every
  // later live refetch silently served the failed page under the current label.
  const revertFailedNavigation = useCallback(() => {
    const pending = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    if (pending) {
      setRequestToken(pending.revertToken);
    }
  }, []);

  // Re-attempt a transient warm-up on a timer so it self-heals without needing a
  // live-data identity change (which never comes for an empty domain). Only ever
  // scheduled from a warm-up branch and cleared the moment the fetch effect
  // re-runs or unmounts, so a settled (loaded) query schedules nothing.
  const scheduleWarmupRetry = useCallback(() => {
    if (warmupTimerRef.current !== null) {
      return;
    }
    warmupTimerRef.current = window.setTimeout(() => {
      warmupTimerRef.current = null;
      setWarmupAttempt((attempt) => attempt + 1);
    }, WARMUP_RETRY_MS);
  }, []);

  useEffect(() => {
    if (!enabled || !scope) {
      return;
    }
    let cancelled = false;
    const identityAtRequest = queryIdentityRef.current;

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await requestRefreshDomainState({
          domain,
          scope,
          reason: 'user',
          label,
          cleanup: true,
          preserveState: false,
        });
        if (cancelled || queryIdentityRef.current !== identityAtRequest) {
          return;
        }
        if (result.status !== 'executed') {
          // A blocked refresh (cluster still connecting, auto-refresh paused) is a
          // warm-up condition, not a failure: stay not-loaded so the table keeps its
          // loading (or paused) presentation. Schedule a self-healing retry (the
          // next live-data identity change also retries, but never comes for an
          // empty domain). Persistent causes surface through the refresh error
          // toasts — never as a fabricated table error.
          revertFailedNavigation();
          scheduleWarmupRetry();
          return;
        }
        const payload = result.data?.data as TPayload | null | undefined;
        if (!payload) {
          // Executed but the scoped state carries no payload yet (backend caches
          // still syncing) — same warm-up treatment as a blocked request.
          revertFailedNavigation();
          scheduleWarmupRetry();
          return;
        }
        if (payload.cursorInvalid) {
          setRequestToken(null);
          setContinueToken(null);
          setPreviousTokens([]);
          setPageIndex(1);
          pendingNavigationRef.current = null;
          return;
        }
        applyPayload(payload);
      } catch (caught) {
        if (!cancelled && queryIdentityRef.current === identityAtRequest) {
          revertFailedNavigation();
          setError(caught instanceof Error ? caught.message : String(caught));
          setLoaded(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsRequestingMore(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (warmupTimerRef.current !== null) {
        window.clearTimeout(warmupTimerRef.current);
        warmupTimerRef.current = null;
      }
    };
  }, [
    applyPayload,
    domain,
    enabled,
    label,
    queryIdentity,
    requestTokenForScope,
    revertFailedNavigation,
    scheduleWarmupRetry,
    scope,
    warmupAttempt,
  ]);

  const loadMore = useCallback(() => {
    if (!continueToken || isRequestingMore) {
      return;
    }
    setIsRequestingMore(true);
    pendingNavigationRef.current = {
      direction: 'next',
      previousPageToken: requestToken,
      revertToken: requestToken,
    };
    setRequestToken(continueToken);
  }, [continueToken, isRequestingMore, requestToken]);

  const loadPrevious = useCallback(() => {
    if (previousTokens.length === 0 || isRequestingMore) {
      return;
    }
    const previousToken = previousTokens[previousTokens.length - 1] ?? null;
    setIsRequestingMore(true);
    pendingNavigationRef.current = { direction: 'previous', revertToken: requestToken };
    setRequestToken(previousToken);
  }, [isRequestingMore, previousTokens, requestToken]);

  const fetchAllRows = useCallback(
    async (options: FetchTypedResourceRowsOptions = {}): Promise<TRow[]> => {
      if (!enabled || !clusterId) {
        return [];
      }
      const exportFilters = options.filters ?? effectiveFilters;
      const exportSortConfig = options.sortConfig === undefined ? sortConfig : options.sortConfig;
      const exportPredicates = options.predicates === undefined ? predicates : options.predicates;
      const exportBaseScope = options.baseScope ?? baseScope;
      const exportLabel = options.label ?? label;
      const exportPageLimit = options.pageLimit ?? EXPORT_PAGE_LIMIT;
      // Each page uses the export max page size; the shared walk owns the loop,
      // page guard, and failure semantics (failed/empty pages REJECT).
      return walkQueryCursorPages<TRow>(exportLabel, async (cursor, page) => {
        const exportScope = buildTypedResourceQueryScope(clusterId, {
          baseScope: exportBaseScope,
          filters: exportFilters,
          sortConfig: exportSortConfig,
          pageLimit: exportPageLimit,
          predicates: exportPredicates,
          continueToken: cursor,
        });
        if (!exportScope) {
          return null;
        }
        const result = await requestRefreshDomainState({
          domain,
          scope: exportScope,
          reason: 'user',
          label: exportLabel,
          cleanup: true,
          preserveState: false,
        });
        if (result.status !== 'executed') {
          throw new Error(`${exportLabel} export failed: page ${page + 1} request was blocked`);
        }
        const payload = result.data?.data as TPayload | null | undefined;
        if (!payload) {
          throw new Error(`${exportLabel} export failed: page ${page + 1} returned no data`);
        }
        return { items: selectRowsRef.current(payload), continueToken: payload.continue ?? null };
      });
    },
    [baseScope, clusterId, domain, enabled, effectiveFilters, label, predicates, sortConfig]
  );

  return {
    rows,
    payload,
    loading,
    loaded,
    error,
    continueToken,
    hasPrevious: previousTokens.length > 0,
    isRequestingMore,
    loadMore,
    loadPrevious,
    pageIndex,
    pageSize: pageLimit,
    totalCount,
    totalIsExact,
    filterOptions,
    kindVocabulary: payload?.capabilities?.kindVocabulary ?? null,
    dynamic,
    fetchAllRows,
  };
}
