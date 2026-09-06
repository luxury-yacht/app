import type { SortConfig } from '@hooks/useTableSort';
import { ALL_MULTISELECT_FILTER } from '@shared/components/dropdowns/multiSelectFilterSelection';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable';
import { DEFAULT_TABLE_PAGE_SIZE } from '@shared/components/tables/pageSizeOptions';
import {
  type ResourceRowSharingMode,
  structuralShareResourceRows,
} from '@shared/utils/structuralShareResourceRows';
import { errorHandler } from '@utils/errorHandler';
import type { SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRefreshDomainState } from '@/core/data-access';
import type {
  CanonicalResourceRef,
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

const REF_ONLY_SHARING_DOMAINS = new Set<RefreshDomain>([
  'cluster-events',
  'namespace-events',
  'nodes',
  'object-events',
  'pods',
  'namespace-workloads',
]);

const queryRowSharingMode = (domain: RefreshDomain): ResourceRowSharingMode =>
  REF_ONLY_SHARING_DOMAINS.has(domain) ? 'ref-only' : 'row-and-ref';

interface CanonicalQueryRow {
  ref: CanonicalResourceRef;
}

interface PendingNavigation {
  direction: 'next' | 'previous';
  revertToken: string | null;
}

const isCanonicalQueryRow = (row: unknown): row is CanonicalQueryRow => {
  if (!row || typeof row !== 'object') {
    return false;
  }
  const ref = (row as { ref?: Partial<CanonicalResourceRef> }).ref;
  return Boolean(
    ref &&
      typeof ref.clusterId === 'string' &&
      typeof ref.group === 'string' &&
      typeof ref.version === 'string' &&
      typeof ref.kind === 'string' &&
      typeof ref.resource === 'string' &&
      typeof ref.name === 'string'
  );
};

const resolveAppliedRows = <TRow>(
  incomingRows: TRow[],
  previousPage: { identity: string; rows: TRow[] } | null,
  pageIdentity: string,
  domain: RefreshDomain
): TRow[] => {
  const canShare =
    previousPage?.identity === pageIdentity &&
    previousPage.rows.every(isCanonicalQueryRow) &&
    incomingRows.every(isCanonicalQueryRow);
  if (!canShare) {
    return incomingRows;
  }
  const sharedRows = structuralShareResourceRows(
    previousPage.rows as unknown as CanonicalQueryRow[],
    incomingRows as unknown as CanonicalQueryRow[],
    queryRowSharingMode(domain)
  ) as TRow[];
  if (sharedRows !== incomingRows) {
    incomingRows.splice(0, incomingRows.length, ...sharedRows);
  }
  return sharedRows;
};

interface PayloadNavigationPlan {
  pageIndex: number | null;
  pageDelta: number;
  clearPendingNavigation: boolean;
  consumeStartRank: boolean;
  adoptSelfCursor: boolean;
}

const buildPayloadNavigationPlan = (
  payload: TypedQueryPayload,
  pendingNavigation: PendingNavigation | null,
  pageLimit: number
): PayloadNavigationPlan => {
  if (typeof payload.pageStartRank === 'number') {
    return {
      pageIndex: Math.floor(payload.pageStartRank / pageLimit) + 1,
      pageDelta: 0,
      clearPendingNavigation: true,
      consumeStartRank: !payload.anchor,
      adoptSelfCursor: !payload.anchor,
    };
  }
  if (!pendingNavigation) {
    return {
      pageIndex: null,
      pageDelta: 0,
      clearPendingNavigation: false,
      consumeStartRank: false,
      adoptSelfCursor: false,
    };
  }
  return {
    pageIndex: null,
    pageDelta: pendingNavigation.direction === 'next' ? 1 : -1,
    clearPendingNavigation: true,
    consumeStartRank: false,
    adoptSelfCursor: false,
  };
};

interface TypedQueryRequestCallbacks<TPayload> {
  isActive: () => boolean;
  isCurrent: () => boolean;
  onWarmup: () => void;
  onPermissionDenied: (message: string) => void;
  onCursorInvalid: () => void;
  onPayload: (payload: TPayload) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
}

interface TypedQueryRequestOptions<TPayload> {
  domain: RefreshDomain;
  scope: string;
  label: string;
  callbacks: TypedQueryRequestCallbacks<TPayload>;
}

type TypedQueryRequestResult = Awaited<ReturnType<typeof requestRefreshDomainState>>;

const dispatchTypedQueryResult = <TPayload extends TypedQueryPayload>(
  result: TypedQueryRequestResult,
  callbacks: TypedQueryRequestCallbacks<TPayload>
): void => {
  if (result.status !== 'executed') {
    callbacks.onWarmup();
    return;
  }
  if (result.data?.permissionDenied) {
    callbacks.onPermissionDenied(result.data.error ?? 'Insufficient permissions');
    return;
  }
  if (result.data?.status === 'error') {
    callbacks.onError(new Error(result.data.error ?? 'Snapshot request failed'));
    return;
  }
  const payload = result.data?.data as TPayload | null | undefined;
  if (!payload) {
    callbacks.onWarmup();
    return;
  }
  if (payload.cursorInvalid) {
    callbacks.onCursorInvalid();
    return;
  }
  callbacks.onPayload(payload);
};

const executeTypedQueryRequest = async <TPayload extends TypedQueryPayload>({
  domain,
  scope,
  label,
  callbacks,
}: TypedQueryRequestOptions<TPayload>): Promise<void> => {
  try {
    const result = await requestRefreshDomainState({
      domain,
      scope,
      reason: 'user',
      label,
      cleanup: true,
      preserveState: false,
    });
    if (!callbacks.isCurrent()) {
      return;
    }
    dispatchTypedQueryResult(result, callbacks);
  } catch (error) {
    if (callbacks.isCurrent()) {
      callbacks.onError(error);
    }
  } finally {
    if (callbacks.isActive()) {
      callbacks.onSettled();
    }
  }
};

interface NavigationActions {
  setPageIndex: (value: SetStateAction<number>) => void;
  clearPendingNavigation: () => void;
  consumeStartRank: () => void;
  adoptSelfCursor: () => void;
}

const applyPayloadNavigation = (plan: PayloadNavigationPlan, actions: NavigationActions): void => {
  if (plan.pageIndex !== null) {
    actions.setPageIndex(plan.pageIndex);
  } else if (plan.pageDelta !== 0) {
    actions.setPageIndex((current) => Math.max(1, current + plan.pageDelta));
  }
  if (plan.clearPendingNavigation) {
    actions.clearPendingNavigation();
  }
  if (plan.consumeStartRank) {
    actions.consumeStartRank();
  }
  if (plan.adoptSelfCursor) {
    actions.adoptSelfCursor();
  }
};

interface AnchorLandingActions {
  setAnchorResult: (result: ResourceQueryAnchorResult) => void;
  disarmAnchor: () => void;
  adoptSelfCursor: () => void;
  clearAnchorIntent: () => void;
}

const applyAnchorLanding = (
  anchor: ResourceQueryAnchorResult | undefined,
  actions: AnchorLandingActions
): void => {
  if (!anchor) {
    return;
  }
  actions.setAnchorResult(anchor);
  actions.disarmAnchor();
  if (anchor.found) {
    actions.adoptSelfCursor();
  } else {
    actions.clearAnchorIntent();
  }
};

interface ResolvedFetchRowsOptions {
  filters: GridTableFilterState;
  sortConfig: SortConfig | null;
  pageLimit: number;
  predicates: Record<string, string | null | undefined> | undefined;
  baseScope: string | undefined;
  label: string;
}

const resolveFetchRowsOptions = (
  options: FetchTypedResourceRowsOptions,
  defaults: ResolvedFetchRowsOptions
): ResolvedFetchRowsOptions => ({
  filters: options.filters ?? defaults.filters,
  sortConfig: options.sortConfig === undefined ? defaults.sortConfig : options.sortConfig,
  predicates: options.predicates ?? defaults.predicates,
  baseScope: options.baseScope ?? defaults.baseScope,
  label: options.label ?? defaults.label,
  pageLimit: options.pageLimit ?? EXPORT_PAGE_LIMIT,
});

const warnForChangedExportRows = (changed: boolean, domain: RefreshDomain): void => {
  if (!changed) {
    return;
  }
  errorHandler.warn(
    'Some rows changed while the export was being gathered, so the result reflects a mix of before and after states.',
    { title: 'Export', context: { source: 'resource-export', domain } }
  );
};

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
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  // Hold selectRows in a ref so applyPayload (and therefore the fetch effect)
  // stays stable even if a caller passes an unmemoized selector. Without this an
  // inline selectRows would re-run the fetch every render.
  const selectRowsRef = useRef(selectRows);
  selectRowsRef.current = selectRows;
  const sharedPageRef = useRef<{ identity: string; rows: TRow[] } | null>(null);
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

  const applyPayload = useCallback(
    (incomingPayload: TPayload, pageIdentity: string) => {
      const incomingRows = selectRowsRef.current(incomingPayload);
      const nextRows = resolveAppliedRows(
        incomingRows,
        sharedPageRef.current,
        pageIdentity,
        domain
      );
      sharedPageRef.current = { identity: pageIdentity, rows: nextRows };
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
      const navigation = buildPayloadNavigationPlan(
        incomingPayload,
        pendingNavigationRef.current,
        pageLimitRef.current
      );
      applyPayloadNavigation(navigation, {
        setPageIndex,
        clearPendingNavigation: () => {
          pendingNavigationRef.current = null;
        },
        consumeStartRank: () => setStartRankIntent(null),
        adoptSelfCursor: () => setRequestToken(incomingPayload.self || null),
      });
      applyAnchorLanding(incomingPayload.anchor, {
        setAnchorResult,
        disarmAnchor: () => setAnchorArmed(false),
        adoptSelfCursor: () => setRequestToken(incomingPayload.self || null),
        clearAnchorIntent: () => setAnchorIntent(null),
      });
      setLoaded(true);
    },
    [domain]
  );

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

    void executeTypedQueryRequest<TPayload>({
      domain,
      scope,
      label,
      callbacks: {
        isActive: () => !cancelled,
        isCurrent: () => !cancelled && queryIdentityRef.current === identityAtRequest,
        onWarmup: () => {
          revertFailedNavigation();
          scheduleWarmupRetry();
        },
        onPermissionDenied: (message) => {
          revertFailedNavigation();
          setError(message);
          setLoaded(true);
        },
        onCursorInvalid: () => {
          setRequestToken(null);
          setContinueToken(null);
          setPreviousToken(null);
          setStartRankIntent(null);
          pendingNavigationRef.current = null;
          if (anchorIntentRef.current) {
            setAnchorArmed(true);
          } else {
            setPageIndex(1);
          }
        },
        onPayload: (responsePayload) => {
          applyPayload(responsePayload, scope);
        },
        onError: (caught) => {
          revertFailedNavigation();
          setError(caught instanceof Error ? caught.message : String(caught));
          setLoaded(true);
        },
        onSettled: () => {
          setLoading(false);
          setIsRequestingMore(false);
        },
      },
    });

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
      const resolvedOptions = resolveFetchRowsOptions(options, {
        filters: effectiveFilters,
        sortConfig,
        predicates,
        baseScope,
        label,
        pageLimit: EXPORT_PAGE_LIMIT,
      });
      // Each page uses the export max page size; the shared walk owns the loop,
      // page guard, failure semantics (failed/empty pages REJECT), and the
      // cross-page consistency guard.
      const walk = await walkQueryCursorPages<TRow>(resolvedOptions.label, async (cursor, page) => {
        const exportScope = buildTypedResourceQueryScope(clusterId, {
          baseScope: resolvedOptions.baseScope,
          filters: resolvedOptions.filters,
          sortConfig: resolvedOptions.sortConfig,
          pageLimit: resolvedOptions.pageLimit,
          predicates: resolvedOptions.predicates,
          continueToken: cursor,
        });
        if (!exportScope) {
          return null;
        }
        const result = await requestRefreshDomainState({
          domain,
          scope: exportScope,
          reason: 'user',
          label: resolvedOptions.label,
          cleanup: true,
          preserveState: false,
        });
        if (result.status !== 'executed') {
          throw new Error(
            `${resolvedOptions.label} export failed: page ${page + 1} request was blocked`
          );
        }
        const exportPayload = result.data?.data as TPayload | null | undefined;
        if (!exportPayload) {
          throw new Error(
            `${resolvedOptions.label} export failed: page ${page + 1} returned no data`
          );
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
      warnForChangedExportRows(walk.dataChangedDuringWalk, domain);
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
