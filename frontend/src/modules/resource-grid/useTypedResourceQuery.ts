import type { SortConfig } from '@hooks/useTableSort';
import { ALL_MULTISELECT_FILTER } from '@shared/components/dropdowns/multiSelectFilterSelection';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable';
import { DEFAULT_TABLE_PAGE_SIZE } from '@shared/components/tables/pageSizeOptions';

import { errorHandler } from '@utils/errorHandler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRefreshDomainState } from '@/core/data-access';
import type {
  RefreshDomain,
  ResourceQueryAnchor,
  ResourceQueryAnchorResult,
  ResourceQueryDynamicRef,
} from '@/core/refresh/types';
import { walkQueryCursorPages } from './cursorPageWalk';
import {
  buildTypedResourceQueryScope,
  filterOptionsFromTypedPayload,
  type TypedQueryPayload,
  typedResourceQueryLifecycleIdentity,
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
  /**
   * Jump to the page containing this object under the current sort+filters.
   * The intent survives sort/filter/page-size changes (they re-anchor) and is
   * cleared by manual pagination; live refetches stay page-stable via the
   * landing's self cursor.
   */
  anchorTo: (anchor: ResourceQueryAnchor) => void;
  /** How the last anchored request resolved (found+rank / filtered / not-found). */
  anchorResult: ResourceQueryAnchorResult | null;
  /**
   * Numbered page jump (1-based). Serves via the bounded startRank contract;
   * no-ops while totals are approximate (the UI hides the control then too).
   */
  jumpToPage: (page: number) => void;
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
  // Backend-minted prev cursor from the applied page (F5) — no client stack.
  const [previousToken, setPreviousToken] = useState<string | null>(null);
  // The anchor jump intent: `anchorIntent` persists across soft resets so a
  // sort/filter change re-anchors; `anchorArmed` marks the NEXT fetch as the
  // anchored one (disarmed after a landing so live refetches stay page-stable
  // on the landing's self cursor); `anchorResult` surfaces the backend's
  // found/filtered/not-found truth for the view.
  const [anchorIntent, setAnchorIntent] = useState<ResourceQueryAnchor | null>(null);
  const [anchorArmed, setAnchorArmed] = useState(false);
  const [anchorResult, setAnchorResult] = useState<ResourceQueryAnchorResult | null>(null);
  const anchorIntentRef = useRef(anchorIntent);
  anchorIntentRef.current = anchorIntent;
  // One-shot numbered-jump intent (0-based start rank). Unlike the anchor it
  // does NOT survive soft resets — page N under a different sort is a
  // different page. The landing adopts the self cursor exactly like anchors.
  const [startRankIntent, setStartRankIntent] = useState<number | null>(null);
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
          kinds: ALL_MULTISELECT_FILTER,
          namespaces: ALL_MULTISELECT_FILTER,
          clusters: ALL_MULTISELECT_FILTER,
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
    // A different cluster/resource: the jump intent belongs to the old context.
    setAnchorIntent(null);
    setAnchorArmed(false);
    setAnchorResult(null);
  }

  // Soft reset — filters, sort, or page size changed within the SAME
  // cluster/resource. (Live-data identity is deliberately NOT part of this
  // identity: a live refetch reuses the current page token so churn never
  // bounces the user off their page — the quiet-refetch contract.) Drop the
  // pagination cursors, but keep the visible rows (quiet filtering — safe
  // after paint: no row change, no flash). A held anchor intent re-arms
  // instead: the jump survives re-sorts and re-filters by re-anchoring under
  // the new order.
  useEffect(() => {
    queryResetIdentityRef.current = queryResetIdentity;
    setRequestToken(null);
    setContinueToken(null);
    setPreviousToken(null);
    pendingNavigationRef.current = null;
    setStartRankIntent(null);
    if (anchorIntentRef.current) {
      setAnchorArmed(true);
    } else {
      setPageIndex(1);
    }
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
      anchor: anchorArmed ? anchorIntent : null,
      startRank: anchorArmed ? null : startRankIntent,
    });
  }, [
    anchorArmed,
    anchorIntent,
    startRankIntent,
    baseScope,
    clusterId,
    enabled,
    effectiveFilters,
    pageLimit,
    predicates,
    requestTokenForScope,
    sortConfig,
  ]);

  const pageLimitRef = useRef(pageLimit);
  pageLimitRef.current = pageLimit;

  const applyPayload = useCallback((incomingPayload: TPayload) => {
    const nextRows = selectRowsRef.current(incomingPayload);
    setRows(nextRows);
    setPayload(incomingPayload);
    setContinueToken(incomingPayload.continue ?? null);
    setPreviousToken(incomingPayload.previous || null);
    const hasTotal = typeof incomingPayload.total === 'number';
    // A missing total must never render as an exact 0 while rows are visible.
    // Fall back to the visible row count and mark the total approximate so the
    // UI shows "≈N" / no "Page N of M" rather than a false "0 of 0".
    setTotalCount(hasTotal ? (incomingPayload.total as number) : nextRows.length);
    setTotalIsExact(hasTotal ? incomingPayload.totalIsExact !== false : false);
    setFilterOptions(filterOptionsFromTypedPayload(incomingPayload));
    setDynamic(incomingPayload.dynamic ?? null);
    if (typeof incomingPayload.pageStartRank === 'number') {
      // Serve-time position honesty: the backend counted this page's exact
      // start rank (anchored/offset landings); plain cursor pages keep the
      // client arithmetic below (the O(rank) count per cursor serve failed
      // the plan's benchmark gate — see large-data.md).
      setPageIndex(Math.floor(incomingPayload.pageStartRank / pageLimitRef.current) + 1);
      pendingNavigationRef.current = null;
      if (!incomingPayload.anchor) {
        // A numbered-jump landing: consume the one-shot intent and adopt the
        // self cursor (same page-stability mechanics as anchored landings).
        setStartRankIntent(null);
        setRequestToken(incomingPayload.self || null);
      }
    } else {
      const pendingNavigation = pendingNavigationRef.current;
      if (pendingNavigation) {
        if (pendingNavigation.direction === 'next') {
          setPageIndex((current) => current + 1);
        } else {
          setPageIndex((current) => Math.max(1, current - 1));
        }
        pendingNavigationRef.current = null;
      }
    }
    if (incomingPayload.anchor) {
      setAnchorResult(incomingPayload.anchor);
      // Disarm: the landing is done. The intent itself survives (soft resets
      // re-anchor) unless the anchor was missing — a filtered/not-found jump
      // must not keep re-firing on every sort change.
      setAnchorArmed(false);
      if (incomingPayload.anchor.found) {
        // Adopt the landing's self cursor as the page identity so live
        // refetches reproduce THIS page (page-stable, not object-stable).
        // Costs one redundant quiet refetch of the same page right now — the
        // per-Build cache and maintained stores make it cheap, and it keeps
        // the fetch machinery free of special cases.
        setRequestToken(incomingPayload.self || null);
      } else {
        setAnchorIntent(null);
      }
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
    void queryIdentity;
    void requestTokenForScope;
    void warmupAttempt;
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
        const responsePayload = result.data?.data as TPayload | null | undefined;
        if (!responsePayload) {
          if (result.data?.permissionDenied) {
            // The backend refused this domain with a typed 403 — a SETTLED
            // answer, not a warm-up: retrying cannot succeed until RBAC or
            // the namespace scope changes (which rebuilds the subsystem and
            // resets this state). Settle so the table renders the permission
            // state instead of an endless first-load spinner.
            revertFailedNavigation();
            setError(result.data.error ?? 'Insufficient permissions');
            setLoaded(true);
            return;
          }
          // Executed but the scoped state carries no payload yet (backend caches
          // still syncing) — same warm-up treatment as a blocked request.
          revertFailedNavigation();
          scheduleWarmupRetry();
          return;
        }
        if (responsePayload.cursorInvalid) {
          setRequestToken(null);
          setContinueToken(null);
          setPreviousToken(null);
          setStartRankIntent(null);
          pendingNavigationRef.current = null;
          if (anchorIntentRef.current) {
            // The page identity died under a held jump intent — retry the
            // anchor, not page 1: the object's page is still the user's goal.
            setAnchorArmed(true);
          } else {
            setPageIndex(1);
          }
          return;
        }
        applyPayload(responsePayload);
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
    revertFailedNavigation,
    scheduleWarmupRetry,
    scope,
    queryIdentity,
    requestTokenForScope,
    warmupAttempt,
  ]);

  const loadMore = useCallback(() => {
    if (!continueToken || isRequestingMore) {
      return;
    }
    setIsRequestingMore(true);
    // Manual pagination deliberately leaves the jump context behind.
    setAnchorIntent(null);
    setAnchorResult(null);
    setStartRankIntent(null);
    pendingNavigationRef.current = { direction: 'next', revertToken: requestToken };
    setRequestToken(continueToken);
  }, [continueToken, isRequestingMore, requestToken]);

  const loadPrevious = useCallback(() => {
    if (!previousToken || isRequestingMore) {
      return;
    }
    setIsRequestingMore(true);
    setAnchorIntent(null);
    setAnchorResult(null);
    setStartRankIntent(null);
    pendingNavigationRef.current = { direction: 'previous', revertToken: requestToken };
    setRequestToken(previousToken);
  }, [isRequestingMore, previousToken, requestToken]);

  const anchorTo = useCallback((anchor: ResourceQueryAnchor) => {
    setAnchorIntent(anchor);
    setAnchorArmed(true);
    setAnchorResult(null);
    setStartRankIntent(null);
    setRequestToken(null);
    setContinueToken(null);
    setPreviousToken(null);
    pendingNavigationRef.current = null;
  }, []);

  const jumpToPage = useCallback(
    (page: number) => {
      // Numbered jumps are exact-total territory (approximate totals keep
      // first/prev/next only, per large-data.md).
      if (!totalIsExact || isRequestingMore) {
        return;
      }
      const target = Math.max(1, Math.floor(page));
      setStartRankIntent((target - 1) * pageLimitRef.current);
      setAnchorIntent(null);
      setAnchorArmed(false);
      setAnchorResult(null);
      setRequestToken(null);
      setContinueToken(null);
      setPreviousToken(null);
      pendingNavigationRef.current = null;
    },
    [isRequestingMore, totalIsExact]
  );

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
      // page guard, failure semantics (failed/empty pages REJECT), and the
      // cross-page consistency guard.
      const walk = await walkQueryCursorPages<TRow>(exportLabel, async (cursor, page) => {
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
        const exportPayload = result.data?.data as TPayload | null | undefined;
        if (!exportPayload) {
          throw new Error(`${exportLabel} export failed: page ${page + 1} returned no data`);
        }
        // The RAW per-source clock, never the scope-folded token (which embeds
        // the scope string and so differs on every export page by construction).
        const sourceVersion =
          (result.data as { sourceVersions?: Partial<Record<string, string>> } | undefined)
            ?.sourceVersions?.object ?? null;
        return {
          items: selectRowsRef.current(exportPayload),
          continueToken: exportPayload.continue ?? null,
          sourceVersion,
        };
      });
      if (walk.dataChangedDuringWalk) {
        // Loud, not fatal: deliver the export but say what happened — the rows
        // reflect a mix of before/after states (near-certain on churning
        // domains, where a hard failure would make export unusable). A WARNING
        // advisory (amber, auto-dismissing), not an error.
        errorHandler.warn(
          'Some rows changed while the export was being gathered, so the result reflects a mix of before and after states.',
          { title: 'Export', context: { source: 'resource-export', domain } }
        );
      }
      return walk.items;
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
    hasPrevious: Boolean(previousToken),
    isRequestingMore,
    loadMore,
    loadPrevious,
    anchorTo,
    anchorResult,
    jumpToPage,
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
