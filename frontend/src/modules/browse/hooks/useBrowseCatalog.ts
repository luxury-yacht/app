/**
 * frontend/src/modules/browse/hooks/useBrowseCatalog.ts
 *
 * Manages Browse catalog state through scoped refresh domains, including
 * catalog paging, metadata scope synchronization, filter scopes, and manual
 * refresh behavior.
 */

import { walkQueryCursorPages } from '@modules/resource-grid/cursorPageWalk';
import {
  TABLE_PAGE_SIZE_OPTIONS,
  type TablePageSize,
} from '@shared/components/tables/pageSizeOptions';
import { useStableSelectedValue } from '@shared/hooks/useStableSelectedValue';
import { errorHandler } from '@utils/errorHandler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DataRequestReason,
  requestRefreshDomainState,
  useRefreshDomainHandle,
} from '@/core/data-access';
import { useCatalogDiagnostics } from '@/core/refresh/diagnostics/useCatalogDiagnostics';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { useDefaultTablePageSize } from '@/hooks/useDefaultTablePageSize';
import {
  acceptsCatalogSnapshotScope,
  applyCatalogBaseline,
  applyCatalogPage,
  type BrowseFilterOptions,
  type BrowseFilters,
  buildBrowseCatalogPageScope,
  buildBrowseCatalogPlan,
  deriveBrowseFilterOptions,
  emptyBrowseCatalogCollection,
  filterBrowseCatalogItems,
  namespacesChanged,
} from './browseCatalogData';

export type { BrowseFilterOptions, BrowseFilters } from './browseCatalogData';

const BROWSE_SEARCH_DEBOUNCE_MS = 250;

const browseCatalogSortDescriptor = (
  sort?: { key: string; direction: 'asc' | 'desc' | null } | null
): { sortField: string; sortDirection: string } => {
  const key = sort?.key?.trim();
  const direction = sort?.direction;
  if (!key || !direction || (key === 'kind' && direction === 'asc')) {
    return { sortField: '', sortDirection: '' };
  }
  return { sortField: key, sortDirection: direction };
};

const normalizeInitialPageLimit = (value: number, fallback: TablePageSize): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(TABLE_PAGE_SIZE_OPTIONS[TABLE_PAGE_SIZE_OPTIONS.length - 1], value));
};

const isRenderableCatalogPayload = (payload: CatalogSnapshotPayload): boolean =>
  payload.isFinal !== false || (payload.items?.length ?? 0) > 0;

/**
 * Options for the useBrowseCatalog hook.
 */
export interface UseBrowseCatalogOptions {
  /** Enables catalog scope lifecycle and startup refresh once owning state is ready. */
  enabled?: boolean;
  /** Cluster ID to filter items by */
  clusterId: string | null | undefined;
  /** Namespaces to pin (empty for cluster scope, single item for namespace scope) */
  pinnedNamespaces: string[];
  /** When true, only show cluster-scoped objects (not namespace-scoped) */
  clusterScopedOnly?: boolean;
  /** When true, only show custom-resource catalog rows */
  customOnly?: boolean;
  /** Current filter state */
  filters: BrowseFilters;
  /** Current backend-owned sort state */
  sort?: { key: string; direction: 'asc' | 'desc' | null } | null;
  /**
   * Controlled backend cursor page size, normally the persisted table page
   * size. The hook holds no page-size state of its own: `setPageLimit`
   * delegates to `onPageLimitChange`, and the accepted value flows back in
   * through this prop.
   */
  pageLimit?: number;
  /** Persists accepted page-size changes through the owning table state. */
  onPageLimitChange?: (value: TablePageSize) => void;
  /** Diagnostic label for logging */
  diagnosticLabel: string;
}

/** Pagination state shared by the catalog footer and the views' GridTable spread. */
export interface BrowseCatalogPagination {
  pageIndex: number;
  pageLimit: number;
  pageLimitOptions: readonly TablePageSize[];
  setPageLimit: (value: TablePageSize) => void;
  totalCount: number;
  totalIsExact: boolean;
  previousToken: string | null;
  continueToken: string | null;
  queryPending: boolean;
  hasMore: boolean;
  hasPrevious: boolean;
  isRequestingMore: boolean;
  onRequestMore: () => void;
  onRequestPrevious: () => void;
  /** Numbered page jump (1-based); no-ops while totals are approximate. */
  onJumpToPage: (page: number) => void;
}

/**
 * Result of the useBrowseCatalog hook.
 */
export interface UseBrowseCatalogResult {
  /** The filtered and deduplicated catalog items */
  items: CatalogItem[];
  /** Fetch EVERY matching catalog item (all pages) for the current query — used by export. */
  fetchAllRows: () => Promise<CatalogItem[]>;
  /** Whether the catalog is currently loading */
  loading: boolean;
  /** Whether the catalog has loaded at least once */
  hasLoadedOnce: boolean;
  /** Catalog failure: the scoped domain's error, or a failed page navigation. */
  error: string | null;
  /** The continue token for pagination (null if no more pages) */
  continueToken: string | null;
  /** The previous token for pagination (null on the first page) */
  previousToken: string | null;
  /** Whether a "load more" request is in progress */
  isRequestingMore: boolean;
  /** One-based cursor page index for the current backend page */
  pageIndex: number;
  /** Handler to load the next page of items */
  handleLoadMore: () => void;
  /** Handler to load the previous page of items */
  handleLoadPrevious: () => void;
  /** Filter options derived from the catalog snapshot */
  filterOptions: BrowseFilterOptions;
  /** True once catalog metadata has resolved for the current scope. */
  filterOptionsResolved: boolean;
  /** Total count of items matching the current query (before pagination) */
  totalCount: number;
  /** In-scope count before filters — the "of M" in "Showing N of M items". */
  unfilteredTotal: number;
  /** Whether totalCount is exact for the current backend query */
  totalIsExact: boolean;
  /** Current backend cursor page size */
  pageLimit: number;
  /** Supported backend cursor page sizes */
  pageLimitOptions: readonly TablePageSize[];
  /** Updates the backend cursor page size */
  setPageLimit: (value: TablePageSize) => void;
  /**
   * The assembled pagination state for the catalog footer and GridTable spread
   * (`{...pagination}`) — built once here so the three catalog-backed views
   * cannot drift on the assembly.
   */
  pagination: BrowseCatalogPagination;
  /** Refreshes the current query scope without changing filters or page size. */
  refresh: () => void;
  /** Exact debounced backend query descriptor currently used by this table. */
  queryDescriptor: BrowseCatalogQueryDescriptor;
  /** True while persisted search text is ahead of the active backend query. */
  queryPending: boolean;
}

export interface BrowseCatalogQueryDescriptor {
  clusterId: string;
  namespaces: string[];
  hasUserNamespaceScope: boolean;
  kinds: string[];
  apiGroups: string[];
  search: string;
  sortField: string;
  sortDirection: string;
  scope: string;
  customOnly: boolean;
}

/**
 * Hook that manages catalog data for Browse components.
 * Handles domain lifecycle, pagination, and scope synchronization.
 */
export function useBrowseCatalog({
  enabled = true,
  clusterId,
  pinnedNamespaces,
  clusterScopedOnly = false,
  customOnly = false,
  filters,
  sort,
  pageLimit: pageLimitProp,
  onPageLimitChange,
  diagnosticLabel,
}: UseBrowseCatalogOptions): UseBrowseCatalogResult {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [previousToken, setPreviousToken] = useState<string | null>(null);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [totalIsExact, setTotalIsExact] = useState(true);
  // Page-navigation failures; the scoped domain carries baseline/stream errors.
  const [pageError, setPageError] = useState<string | null>(null);
  // Last derived filter options, held across transient no-payload gaps so the
  // filter dropdowns never blank mid-interaction (see the filterOptions memo).
  const lastFilterOptionsRef = useRef<BrowseFilterOptions | null>(null);
  // Controlled page size: normalize the owner-provided value; no local mirror.
  // Views without a persisted page size fall back to the app-wide Default Page
  // Size preference (Settings ▸ Display ▸ Tables).
  const defaultTablePageSize = useDefaultTablePageSize();
  const pageLimit = useMemo(
    () => normalizeInitialPageLimit(pageLimitProp ?? defaultTablePageSize, defaultTablePageSize),
    [defaultTablePageSize, pageLimitProp]
  );
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search ?? '');
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();

  const collectionRef = useRef(emptyBrowseCatalogCollection());
  const hasLoadedOnceRef = useRef(false);
  const pageIndexRef = useRef(1);
  const currentPageTokenRef = useRef<string | null>(null);
  pageIndexRef.current = pageIndex;
  // Page-request coordination (see requestPage): a SYNC in-flight gate (state
  // is async and can double-fire), a user-only gate (quiet doorbell refetches
  // must not block user clicks), and a sequence so a user request supersedes
  // an in-flight quiet refetch — the superseded response neither applies nor
  // clears its successor's flags.
  const pageRequestInFlightRef = useRef(false);
  const userPageRequestInFlightRef = useRef(false);
  const pageRequestSeqRef = useRef(0);

  useEffect(() => {
    const nextSearch = filters.search ?? '';
    if (nextSearch === debouncedSearch) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDebouncedSearch(nextSearch);
    }, BROWSE_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [debouncedSearch, filters.search]);

  const queryFilters = useMemo<BrowseFilters>(
    () => ({
      ...filters,
      search: debouncedSearch,
    }),
    [debouncedSearch, filters]
  );

  const setPageLimit = useCallback(
    (value: TablePageSize) => {
      onPageLimitChange?.(value);
    },
    [onPageLimitChange]
  );

  // Track available namespaces from the catalog snapshot.
  // Used to query all namespaces when no filter is selected in all-namespaces mode.
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const plan = useMemo(
    () =>
      buildBrowseCatalogPlan({
        clusterId,
        clusterScopedOnly,
        customOnly,
        pinnedNamespaces,
        filters: queryFilters,
        sort,
        availableNamespaces,
        pageLimit,
      }),
    [
      pageLimit,
      availableNamespaces,
      clusterId,
      clusterScopedOnly,
      customOnly,
      queryFilters,
      sort,
      pinnedNamespaces,
    ]
  );
  const { catalogScope, metadataScope, metadataUsesActiveScope } = plan;
  const activeSort = browseCatalogSortDescriptor(sort);
  const queryPending = (filters.search ?? '') !== debouncedSearch;
  const queryDescriptor = useMemo<BrowseCatalogQueryDescriptor>(
    () => ({
      clusterId: clusterId ?? '',
      namespaces: plan.namespacesToQuery,
      hasUserNamespaceScope: plan.hasUserNamespaceScope,
      kinds: queryFilters.kinds ?? [],
      apiGroups: queryFilters.apiGroups ?? [],
      search: queryFilters.search ?? '',
      sortField: activeSort.sortField,
      sortDirection: activeSort.sortDirection,
      scope: catalogScope,
      customOnly,
    }),
    [
      activeSort.sortField,
      activeSort.sortDirection,
      catalogScope,
      clusterId,
      customOnly,
      plan.hasUserNamespaceScope,
      plan.namespacesToQuery,
      queryFilters.kinds,
      queryFilters.apiGroups,
      queryFilters.search,
    ]
  );

  // Read scoped state for the current catalog scope.
  const { state: domain, refresh: refreshCatalogScope } = useRefreshDomainHandle({
    domain: enabled ? 'catalog' : null,
    scope: catalogScope,
    enabled,
  });
  const { state: metadataDomain, refresh: refreshMetadataScope } = useRefreshDomainHandle({
    domain: enabled && !metadataUsesActiveScope ? 'catalog' : null,
    scope: metadataUsesActiveScope ? null : metadataScope,
    enabled,
  });
  useCatalogDiagnostics(domain, diagnosticLabel);

  // Apply query scope and refresh page 0 when the query changes
  const previousScopeIdentityRef = useRef(plan.scopeIdentityKey);
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const scopeIdentityChanged = previousScopeIdentityRef.current !== plan.scopeIdentityKey;
    previousScopeIdentityRef.current = plan.scopeIdentityKey;

    // Reset pagination state on query change.
    setIsRequestingMore(false);
    setPageIndex(1);
    pageIndexRef.current = 1;
    currentPageTokenRef.current = null;
    setContinueToken(null);
    setPreviousToken(null);
    setPageError(null);
    // Preserve the current dataset while filter-only queries refresh so the
    // filter bar/dropdowns stay mounted and open menus don't lose their scroll
    // position. We still clear eagerly when the structural scope changes
    // (cluster/namespace mode) or before the first load.
    if (scopeIdentityChanged || !hasLoadedOnceRef.current) {
      collectionRef.current = emptyBrowseCatalogCollection();
      setItems([]);
    }
    if (scopeIdentityChanged) {
      hasLoadedOnceRef.current = false;
      setHasLoadedOnce(false);
      lastFilterOptionsRef.current = null;
    }

    void refreshCatalogScope('startup');
    if (!metadataUsesActiveScope) {
      void refreshMetadataScope('startup');
    }
  }, [
    enabled,
    metadataUsesActiveScope,
    plan.scopeIdentityKey,
    refreshCatalogScope,
    refreshMetadataScope,
  ]);

  // Apply incoming snapshots to local pagination state
  useEffect(() => {
    if (!domain.data) {
      return;
    }
    // Skip transient states where data isn't meaningful yet.
    // Allow both 'ready' and 'updating' — the catalog stream delivers complete
    // snapshots in both states, and gating on 'ready' alone causes the view to
    // miss real-time updates delivered via SSE while status is 'updating'.
    if (domain.status !== 'ready' && domain.status !== 'updating') {
      return;
    }
    if (!acceptsCatalogSnapshotScope(domain.scope, catalogScope, pinnedNamespaces)) {
      return;
    }

    const payload = domain.data as CatalogSnapshotPayload;
    const currentLength = collectionRef.current.items.length;
    const next = applyCatalogBaseline(collectionRef.current, payload);
    if (currentPageTokenRef.current) {
      setTotalCount(next.totalCount);
      setUnfilteredTotal(next.unfilteredTotal);
      setTotalIsExact(next.totalIsExact);
      setIsRequestingMore(false);
      if (!hasLoadedOnceRef.current && isRenderableCatalogPayload(payload)) {
        hasLoadedOnceRef.current = true;
        setHasLoadedOnce(true);
      }
      return;
    }

    collectionRef.current = { items: next.items, indexByUid: next.indexByUid };
    if (next.changed || currentLength === 0) {
      setItems(next.items);
    }

    setContinueToken(next.continueToken);
    setPreviousToken(next.previousToken);
    setTotalCount(next.totalCount);
    setUnfilteredTotal(next.unfilteredTotal);
    setTotalIsExact(next.totalIsExact);
    setIsRequestingMore(false);

    if (!hasLoadedOnceRef.current && isRenderableCatalogPayload(payload)) {
      hasLoadedOnceRef.current = true;
      setHasLoadedOnce(true);
    }
  }, [domain.data, domain.scope, domain.status, catalogScope, pinnedNamespaces]);

  // Cursor-page handler. Fetches a cursor page using a paginated scope and
  // replaces the current row window. The refresh store remains scoped by the
  // request that produced the data; Browse keeps only the current page/window.
  const catalogScopeRef = useRef(catalogScope);
  catalogScopeRef.current = catalogScope;

  const requestPage = useCallback(
    (
      // A page address: a keyset token (next/previous/current) or a 0-based
      // startRank (numbered 'jump' — served by the bounded offset contract).
      address: { token?: string | null; startRank?: number },
      direction: 'next' | 'previous' | 'current' | 'jump',
      reason: DataRequestReason = 'user'
    ) => {
      const token = address.token ?? null;
      const hasStartRank = typeof address.startRank === 'number';
      if (!token && !hasStartRank) {
        return;
      }
      // Doorbell-driven current-page refetches are QUIET: they must not flip
      // the user-facing busy flag (which disables prev/next and spins the
      // footer) — on a churning cluster doorbells ring continuously, and a
      // busy window per ring means a permanently dead footer. Quiet requests
      // coalesce (skip while ANY page request is in flight); user requests
      // wait only on other USER requests and SUPERSEDE an in-flight quiet
      // refetch via the sequence guard below.
      const quiet = reason === 'stream-signal';
      if (quiet ? pageRequestInFlightRef.current : userPageRequestInFlightRef.current) {
        return;
      }
      const seq = ++pageRequestSeqRef.current;
      pageRequestInFlightRef.current = true;
      if (!quiet) {
        userPageRequestInFlightRef.current = true;
        setIsRequestingMore(true);
      }

      const normalizedScope = buildBrowseCatalogPageScope(
        plan,
        {
          clusterId,
          filters: queryFilters,
          sort,
          pageLimit,
          pinnedNamespaces,
          customOnly,
        },
        token ?? '',
        address.startRank
      );
      const baseScopeAtRequest = catalogScopeRef.current;
      void (async () => {
        try {
          const result = await requestRefreshDomainState({
            domain: 'catalog',
            scope: normalizedScope,
            reason,
          });
          if (
            pageRequestSeqRef.current !== seq ||
            result.status !== 'executed' ||
            catalogScopeRef.current !== baseScopeAtRequest
          ) {
            return;
          }

          const pageResult = result.data;
          if (!pageResult) {
            return;
          }
          const payload = pageResult.data as CatalogSnapshotPayload | null;
          if (!payload || (pageResult.status !== 'ready' && pageResult.status !== 'updating')) {
            return;
          }
          if (payload.cursorInvalid) {
            collectionRef.current = emptyBrowseCatalogCollection();
            setItems([]);
            setContinueToken(null);
            setPreviousToken(null);
            currentPageTokenRef.current = null;
            pageIndexRef.current = 1;
            setPageIndex(1);
            void refreshCatalogScope('user');
            return;
          }

          const next = applyCatalogPage(collectionRef.current, payload);
          collectionRef.current = { items: next.items, indexByUid: next.indexByUid };
          setPageError(null);
          setItems(next.items);
          setContinueToken(next.continueToken);
          setPreviousToken(next.previousToken);
          setTotalCount(next.totalCount);
          setUnfilteredTotal(next.unfilteredTotal);
          setTotalIsExact(next.totalIsExact);
          let nextPageIndex: number;
          if (direction === 'jump') {
            // Serve-time position honesty: the landing carries its exact rank,
            // and the self cursor becomes the current page's token so live
            // refetches reproduce THIS page.
            nextPageIndex =
              typeof payload.pageStartRank === 'number'
                ? Math.floor(payload.pageStartRank / pageLimit) + 1
                : 1;
            currentPageTokenRef.current = payload.self || null;
          } else {
            nextPageIndex =
              direction === 'next'
                ? pageIndexRef.current + 1
                : direction === 'previous'
                  ? Math.max(1, pageIndexRef.current - 1)
                  : pageIndexRef.current;
            currentPageTokenRef.current = nextPageIndex > 1 ? token : null;
          }
          pageIndexRef.current = nextPageIndex;
          setPageIndex(nextPageIndex);
          if (!hasLoadedOnceRef.current) {
            hasLoadedOnceRef.current = true;
            setHasLoadedOnce(true);
          }
        } catch (error) {
          console.error('Failed to load additional catalog page', error);
          if (catalogScopeRef.current === baseScopeAtRequest) {
            setPageError(error instanceof Error ? error.message : String(error));
          }
        } finally {
          // A superseded request must not clear its successor's gates.
          if (pageRequestSeqRef.current === seq) {
            pageRequestInFlightRef.current = false;
            if (!quiet) {
              userPageRequestInFlightRef.current = false;
              setIsRequestingMore(false);
            }
          }
        }
      })();
    },
    [
      pageLimit,
      queryFilters,
      sort,
      plan,
      pinnedNamespaces,
      clusterId,
      customOnly,
      refreshCatalogScope,
    ]
  );

  // Doorbell values live in signalVersions, which payload applies never touch
  // — so this only moves when the catalog doorbell rings. (Keying on the
  // folded sourceVersion turned every content-changing fetch response into
  // another "signal": an echo refetch per doorbell.)
  const catalogLiveVersion = domain.signalVersions?.catalog ?? '';
  // has-observed flag, not an empty-string sentinel: before the first doorbell
  // the value IS empty, and a falsiness check would swallow the first ring.
  const lastCatalogLiveVersionRef = useRef<{ observed: boolean; value: string }>({
    observed: false,
    value: '',
  });
  useEffect(() => {
    const previous = lastCatalogLiveVersionRef.current;
    lastCatalogLiveVersionRef.current = { observed: true, value: catalogLiveVersion };
    if (
      !enabled ||
      !catalogLiveVersion ||
      !previous.observed ||
      previous.value === catalogLiveVersion ||
      !hasLoadedOnceRef.current
    ) {
      return;
    }

    const currentPageToken = currentPageTokenRef.current;
    // These fetches are triggered BY the catalog doorbell: 'stream-signal' is
    // the one non-manual reason the skip-while-stream-healthy gate never
    // swallows. With 'background' the refetch was skipped for a loaded scope
    // while the stream was healthy — the doorbell silently did nothing.
    if (currentPageToken) {
      requestPage({ token: currentPageToken }, 'current', 'stream-signal');
    } else {
      void refreshCatalogScope('stream-signal');
    }
    if (!metadataUsesActiveScope) {
      void refreshMetadataScope('stream-signal');
    }
  }, [
    catalogLiveVersion,
    enabled,
    metadataUsesActiveScope,
    refreshCatalogScope,
    refreshMetadataScope,
    requestPage,
  ]);

  const handleLoadMore = useCallback(() => {
    requestPage({ token: continueToken }, 'next');
  }, [continueToken, requestPage]);

  const handleLoadPrevious = useCallback(() => {
    requestPage({ token: previousToken }, 'previous');
  }, [previousToken, requestPage]);

  const handleJumpToPage = useCallback(
    (page: number) => {
      // Numbered jumps are exact-total territory (approximate totals keep
      // first/prev/next only, per large-data.md); the footer control also
      // hides itself, this guard covers keyboard/programmatic calls.
      if (!totalIsExact) {
        return;
      }
      const target = Math.max(1, Math.floor(page));
      requestPage({ startRank: (target - 1) * pageLimit }, 'jump');
    },
    [pageLimit, requestPage, totalIsExact]
  );

  const refreshCurrentQuery = useCallback(() => {
    const currentPageToken = currentPageTokenRef.current;
    if (currentPageToken) {
      requestPage({ token: currentPageToken }, 'current');
      return;
    }
    void refreshCatalogScope('user');
  }, [refreshCatalogScope, requestPage]);

  // Filter items by scope (cluster-scoped vs namespace-scoped)
  // Note: Cluster isolation is handled by the backend via the scope prefix (e.g., 'cluster-1|...'),
  // so we don't need to filter by clusterId here.
  const filteredItems = useMemo(() => {
    return filterBrowseCatalogItems(items, clusterScopedOnly);
  }, [items, clusterScopedOnly]);
  const stableFilteredItems = useStableSelectedValue(filteredItems);

  // Derive filter options from the catalog snapshot. Across transient gaps —
  // a filter change swaps to a scope with no state for a frame — hold the last
  // derived options so the dropdowns never blank (an empty option list disables
  // them mid-interaction). A real payload always wins, including a genuinely
  // empty one; the ref clears on structural scope changes (see the reset
  // effect) so cluster/namespace switches never leak stale options.
  const filterOptionsPayload = (
    metadataUsesActiveScope ? domain.data : (metadataDomain.data ?? domain.data)
  ) as CatalogSnapshotPayload | null;
  const filterOptionsResolved = Boolean(filterOptionsPayload);
  const filterOptions = useMemo<BrowseFilterOptions>(() => {
    if (!filterOptionsPayload && lastFilterOptionsRef.current) {
      return lastFilterOptionsRef.current;
    }
    const derived = deriveBrowseFilterOptions({
      payload: filterOptionsPayload,
      clusterScopedOnly,
      isNamespaceScoped: plan.isNamespaceScoped,
    });
    lastFilterOptionsRef.current = derived;
    return derived;
  }, [clusterScopedOnly, filterOptionsPayload, plan.isNamespaceScoped]);

  // Update available namespaces when the snapshot includes them.
  // This enables querying all namespaces when no filter is selected in all-namespaces mode.
  useEffect(() => {
    const snapshotNamespaces = filterOptions.namespaces;
    if (snapshotNamespaces.length > 0 && !plan.isNamespaceScoped) {
      // Only update if the list has actually changed to avoid infinite loops
      setAvailableNamespaces((prev) => {
        if (!namespacesChanged(prev, snapshotNamespaces)) {
          return prev;
        }
        return snapshotNamespaces;
      });
    }
  }, [filterOptions.namespaces, plan.isNamespaceScoped]);

  // Compute loading state. Loading is reported ONLY before the first applied
  // result for the current scope (hasLoadedOnce resets on scope identity
  // changes, not on filter changes). Later refreshes — filter-driven, manual,
  // or background — stay visually silent: the table keeps the current rows (or
  // the settled "no matches" state) until the new result lands, so filtering
  // never dims the view, swaps in a spinner, or unmounts the filter input.
  const loading =
    !hasLoadedOnce &&
    (domain.status === 'loading' || domain.status === 'initialising' || items.length === 0);
  const passiveLoadingState = applyPassiveLoadingPolicy({
    loading,
    hasLoaded: hasLoadedOnce,
    hasData: items.length > 0,
    isPaused,
    isManualRefreshActive,
  });

  const fetchAllRows = useCallback(async (): Promise<CatalogItem[]> => {
    if (!enabled || !clusterId) {
      return [];
    }
    // Request the backend's max page size (config.ObjectCatalogMaxQueryLimit);
    // it caps the value anyway, so a single request can't return everything and
    // the shared walk follows the cursor. Paging below the cap multiplies the
    // number of full catalog scans per export. Each page is a clean one-off
    // catalog query for the current filters/sort; the shared walk owns the
    // loop, page guard, and failure semantics (failed/empty pages REJECT).
    const exportPageLimit = 10000;
    const walk = await walkQueryCursorPages<CatalogItem>('Catalog', async (cursor, page) => {
      const scope = buildBrowseCatalogPageScope(
        plan,
        {
          clusterId,
          filters: queryFilters,
          sort,
          pageLimit: exportPageLimit,
          pinnedNamespaces,
          customOnly,
        },
        cursor ?? ''
      );
      const result = await requestRefreshDomainState({ domain: 'catalog', scope, reason: 'user' });
      if (result.status !== 'executed') {
        throw new Error(`Catalog export failed: page ${page + 1} request was blocked`);
      }
      const payload = result.data?.data as CatalogSnapshotPayload | null;
      if (!payload) {
        throw new Error(`Catalog export failed: page ${page + 1} returned no data`);
      }
      const applied = applyCatalogPage(emptyBrowseCatalogCollection(), payload);
      // The RAW per-source clock, never the scope-folded token (differs per
      // export page by construction) — see the walk's drift guard.
      const sourceVersion =
        (result.data as { sourceVersions?: Partial<Record<string, string>> } | undefined)
          ?.sourceVersions?.object ?? null;
      return { items: applied.items, continueToken: applied.continueToken || null, sourceVersion };
    });
    if (walk.dataChangedDuringWalk) {
      // Loud, not fatal (plan P7/F2): deliver the export but say what happened.
      // A WARNING advisory (amber, auto-dismissing), not an error.
      errorHandler.warn(
        'Some rows changed while the export was being gathered, so the result reflects a mix of before and after states.',
        { title: 'Export', context: { source: 'resource-export', domain: 'catalog' } }
      );
    }
    return filterBrowseCatalogItems(walk.items, clusterScopedOnly);
  }, [
    clusterId,
    clusterScopedOnly,
    customOnly,
    enabled,
    pinnedNamespaces,
    plan,
    queryFilters,
    sort,
  ]);

  const pagination = useMemo<BrowseCatalogPagination>(
    () => ({
      pageIndex,
      pageLimit,
      pageLimitOptions: TABLE_PAGE_SIZE_OPTIONS,
      setPageLimit,
      totalCount,
      totalIsExact,
      previousToken,
      continueToken,
      queryPending,
      hasMore: Boolean(continueToken),
      hasPrevious: Boolean(previousToken),
      isRequestingMore,
      onRequestMore: handleLoadMore,
      onRequestPrevious: handleLoadPrevious,
      onJumpToPage: handleJumpToPage,
    }),
    [
      continueToken,
      handleLoadMore,
      handleLoadPrevious,
      handleJumpToPage,
      isRequestingMore,
      pageIndex,
      pageLimit,
      previousToken,
      queryPending,
      setPageLimit,
      totalCount,
      totalIsExact,
    ]
  );

  return {
    items: stableFilteredItems,
    fetchAllRows,
    loading: passiveLoadingState.loading,
    hasLoadedOnce,
    error: domain.error ?? pageError ?? null,
    continueToken,
    previousToken,
    isRequestingMore,
    pageIndex,
    handleLoadMore,
    handleLoadPrevious,
    filterOptions,
    filterOptionsResolved,
    totalCount,
    unfilteredTotal,
    totalIsExact,
    pageLimit,
    pageLimitOptions: TABLE_PAGE_SIZE_OPTIONS,
    setPageLimit,
    pagination,
    refresh: refreshCurrentQuery,
    queryDescriptor,
    queryPending,
  };
}
