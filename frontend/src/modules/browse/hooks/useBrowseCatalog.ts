/**
 * frontend/src/modules/browse/hooks/useBrowseCatalog.ts
 *
 * Manages Browse catalog state through scoped refresh domains, including
 * catalog paging, metadata scope synchronization, filter scopes, and manual
 * refresh behavior.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRefreshDomainState, useRefreshDomainHandle } from '@/core/data-access';
import { useCatalogDiagnostics } from '@/core/refresh/diagnostics/useCatalogDiagnostics';
import { walkQueryCursorPages } from '@modules/resource-grid/cursorPageWalk';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import {
  acceptsCatalogSnapshotScope,
  applyCatalogBaseline,
  applyCatalogPage,
  buildBrowseCatalogPageScope,
  buildBrowseCatalogPlan,
  deriveBrowseFilterOptions,
  emptyBrowseCatalogCollection,
  filterBrowseCatalogItems,
  namespacesChanged,
  type BrowseFilterOptions,
  type BrowseFilters,
} from './browseCatalogData';
import { useStableSelectedValue } from '@shared/hooks/useStableSelectedValue';
import { useDefaultTablePageSize } from '@/hooks/useDefaultTablePageSize';
import {
  TABLE_PAGE_SIZE_OPTIONS,
  type TablePageSize,
} from '@shared/components/tables/pageSizeOptions';
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
  /** Total count of items matching the current query (before pagination) */
  totalCount: number;
  /** In-scope count before filters — the "of M" in "showing N of M items due to filters". */
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
    catalogScope,
    enabled,
    metadataScope,
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
    (token: string | null, direction: 'next' | 'previous' | 'current') => {
      if (!token || isRequestingMore) {
        return;
      }
      setIsRequestingMore(true);

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
        token
      );
      const baseScopeAtRequest = catalogScopeRef.current;
      void (async () => {
        try {
          const result = await requestRefreshDomainState({
            domain: 'catalog',
            scope: normalizedScope,
            reason: 'user',
          });
          if (result.status !== 'executed' || catalogScopeRef.current !== baseScopeAtRequest) {
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
          const nextPageIndex =
            direction === 'next'
              ? pageIndexRef.current + 1
              : direction === 'previous'
                ? Math.max(1, pageIndexRef.current - 1)
                : pageIndexRef.current;
          pageIndexRef.current = nextPageIndex;
          currentPageTokenRef.current = nextPageIndex > 1 ? token : null;
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
          if (catalogScopeRef.current === baseScopeAtRequest) {
            setIsRequestingMore(false);
          }
        }
      })();
    },
    [
      isRequestingMore,
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

  const handleLoadMore = useCallback(() => {
    requestPage(continueToken, 'next');
  }, [continueToken, requestPage]);

  const handleLoadPrevious = useCallback(() => {
    requestPage(previousToken, 'previous');
  }, [previousToken, requestPage]);

  const refreshCurrentQuery = useCallback(() => {
    const currentPageToken = currentPageTokenRef.current;
    if (currentPageToken) {
      requestPage(currentPageToken, 'current');
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
  const filterOptions = useMemo<BrowseFilterOptions>(() => {
    const payload = (
      metadataUsesActiveScope ? domain.data : (metadataDomain.data ?? domain.data)
    ) as CatalogSnapshotPayload | null;
    if (!payload && lastFilterOptionsRef.current) {
      return lastFilterOptionsRef.current;
    }
    const derived = deriveBrowseFilterOptions({
      payload,
      clusterScopedOnly,
      isNamespaceScoped: plan.isNamespaceScoped,
    });
    lastFilterOptionsRef.current = derived;
    return derived;
  }, [clusterScopedOnly, domain.data, metadataDomain.data, metadataUsesActiveScope, plan]);

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
    const collected = await walkQueryCursorPages<CatalogItem>('Catalog', async (cursor, page) => {
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
      return { items: applied.items, continueToken: applied.continueToken || null };
    });
    return filterBrowseCatalogItems(collected, clusterScopedOnly);
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
    }),
    [
      continueToken,
      handleLoadMore,
      handleLoadPrevious,
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
