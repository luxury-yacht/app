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
export type { BrowseFilterOptions, BrowseFilters } from './browseCatalogData';

const BROWSE_SEARCH_DEBOUNCE_MS = 250;
export const BROWSE_PAGE_LIMIT_OPTIONS = [100, 250, 500, 1000] as const;
const DEFAULT_BROWSE_PAGE_LIMIT = BROWSE_PAGE_LIMIT_OPTIONS[2];
export type BrowsePageLimit = (typeof BROWSE_PAGE_LIMIT_OPTIONS)[number];

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

const normalizeInitialPageLimit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_BROWSE_PAGE_LIMIT;
  }
  return Math.max(
    1,
    Math.min(BROWSE_PAGE_LIMIT_OPTIONS[BROWSE_PAGE_LIMIT_OPTIONS.length - 1], value)
  );
};

/**
 * Options for the useBrowseCatalog hook.
 */
export interface UseBrowseCatalogOptions {
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
  /** Optional initial page size for catalog cursor pages */
  initialPageLimit?: number;
  /** Diagnostic label for logging */
  diagnosticLabel: string;
}

/**
 * Result of the useBrowseCatalog hook.
 */
export interface UseBrowseCatalogResult {
  /** The filtered and deduplicated catalog items */
  items: CatalogItem[];
  /** Whether the catalog is currently loading */
  loading: boolean;
  /** Whether the catalog has loaded at least once */
  hasLoadedOnce: boolean;
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
  /** Whether totalCount is exact for the current backend query */
  totalIsExact: boolean;
  /** Current backend cursor page size */
  pageLimit: number;
  /** Supported backend cursor page sizes */
  pageLimitOptions: readonly BrowsePageLimit[];
  /** Updates the backend cursor page size */
  setPageLimit: (value: BrowsePageLimit) => void;
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
  clusterId,
  pinnedNamespaces,
  clusterScopedOnly = false,
  customOnly = false,
  filters,
  sort,
  initialPageLimit,
  diagnosticLabel,
}: UseBrowseCatalogOptions): UseBrowseCatalogResult {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [previousToken, setPreviousToken] = useState<string | null>(null);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [totalIsExact, setTotalIsExact] = useState(true);
  const [pageLimit, setPageLimitState] = useState<number>(() =>
    normalizeInitialPageLimit(initialPageLimit ?? DEFAULT_BROWSE_PAGE_LIMIT)
  );
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search ?? '');
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();

  const collectionRef = useRef(emptyBrowseCatalogCollection());
  const hasLoadedOnceRef = useRef(false);

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

  const setPageLimit = useCallback((value: BrowsePageLimit) => {
    setPageLimitState(value);
  }, []);

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
      availableNamespaces,
      clusterId,
      clusterScopedOnly,
      customOnly,
      queryFilters,
      sort,
      pageLimit,
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
    domain: 'catalog',
    scope: catalogScope,
    enabled: true,
  });
  const { state: metadataDomain, refresh: refreshMetadataScope } = useRefreshDomainHandle({
    domain: metadataUsesActiveScope ? null : 'catalog',
    scope: metadataUsesActiveScope ? null : metadataScope,
    enabled: true,
  });
  useCatalogDiagnostics(domain, diagnosticLabel);

  // Apply query scope and refresh page 0 when the query changes
  const previousScopeIdentityRef = useRef(plan.scopeIdentityKey);
  useEffect(() => {
    const scopeIdentityChanged = previousScopeIdentityRef.current !== plan.scopeIdentityKey;
    previousScopeIdentityRef.current = plan.scopeIdentityKey;

    // Reset pagination state on query change.
    setIsRequestingMore(false);
    setPageIndex(1);
    setContinueToken(null);
    setPreviousToken(null);
    // Preserve the current dataset while filter-only queries refresh so the
    // filter bar/dropdowns stay mounted and open menus don't lose their scroll
    // position. We still clear eagerly when the structural scope changes
    // (cluster/namespace mode) or before the first load.
    if (scopeIdentityChanged || !hasLoadedOnceRef.current) {
      collectionRef.current = emptyBrowseCatalogCollection();
      setItems([]);
    }

    void refreshCatalogScope('startup');
    if (!metadataUsesActiveScope) {
      void refreshMetadataScope('startup');
    }
  }, [
    catalogScope,
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
    collectionRef.current = { items: next.items, indexByUid: next.indexByUid };
    if (next.changed || currentLength === 0) {
      setItems(next.items);
    }

    setContinueToken(next.continueToken);
    setPreviousToken(next.previousToken);
    setTotalCount(next.totalCount);
    setTotalIsExact(next.totalIsExact);
    setIsRequestingMore(false);
  }, [domain.data, domain.scope, domain.status, catalogScope, pinnedNamespaces]);

  // Handle first load
  useEffect(() => {
    if (hasLoadedOnce || !domain.data) {
      return;
    }
    hasLoadedOnceRef.current = true;
    setHasLoadedOnce(true);
  }, [domain.data, hasLoadedOnce]);

  // Cursor-page handler. Fetches a cursor page using a paginated scope and
  // replaces the current row window. The refresh store remains scoped by the
  // request that produced the data; Browse keeps only the current page/window.
  const catalogScopeRef = useRef(catalogScope);
  catalogScopeRef.current = catalogScope;

  const requestPage = useCallback(
    (token: string | null, direction: 'next' | 'previous') => {
      if (!token || isRequestingMore) {
        return;
      }
      setIsRequestingMore(true);

      const normalizedScope = buildBrowseCatalogPageScope(
        plan,
        { clusterId, filters: queryFilters, sort, pageLimit, pinnedNamespaces, customOnly },
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
            setPageIndex(1);
            void refreshCatalogScope('user');
            return;
          }

          const next = applyCatalogPage(collectionRef.current, payload);
          collectionRef.current = { items: next.items, indexByUid: next.indexByUid };
          setItems(next.items);
          setContinueToken(next.continueToken);
          setPreviousToken(next.previousToken);
          setTotalCount(next.totalCount);
          setTotalIsExact(next.totalIsExact);
          setPageIndex((current) =>
            direction === 'next' ? current + 1 : Math.max(1, current - 1)
          );
          if (!hasLoadedOnceRef.current) {
            hasLoadedOnceRef.current = true;
            setHasLoadedOnce(true);
          }
        } catch (error) {
          console.error('Failed to load additional catalog page', error);
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
    setPageIndex(1);
    void refreshCatalogScope('user');
  }, [refreshCatalogScope]);

  // Filter items by scope (cluster-scoped vs namespace-scoped)
  // Note: Cluster isolation is handled by the backend via the scope prefix (e.g., 'cluster-1|...'),
  // so we don't need to filter by clusterId here.
  const filteredItems = useMemo(() => {
    return filterBrowseCatalogItems(items, clusterScopedOnly);
  }, [items, clusterScopedOnly]);
  const stableFilteredItems = useStableSelectedValue(filteredItems);

  // Derive filter options from the catalog snapshot
  const filterOptions = useMemo<BrowseFilterOptions>(() => {
    const payload = (
      metadataUsesActiveScope ? domain.data : (metadataDomain.data ?? domain.data)
    ) as CatalogSnapshotPayload | null;
    return deriveBrowseFilterOptions({
      payload,
      clusterScopedOnly,
      isNamespaceScoped: plan.isNamespaceScoped,
    });
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

  // Compute loading state
  const loading =
    domain.status === 'loading' ||
    domain.status === 'initialising' ||
    (items.length === 0 && !domain.data);
  const passiveLoadingState = applyPassiveLoadingPolicy({
    loading,
    hasLoaded: hasLoadedOnce,
    hasData: items.length > 0,
    isPaused,
    isManualRefreshActive,
  });

  return {
    items: stableFilteredItems,
    loading: passiveLoadingState.loading,
    hasLoadedOnce,
    continueToken,
    previousToken,
    isRequestingMore,
    pageIndex,
    handleLoadMore,
    handleLoadPrevious,
    filterOptions,
    totalCount,
    totalIsExact,
    pageLimit,
    pageLimitOptions: BROWSE_PAGE_LIMIT_OPTIONS,
    setPageLimit,
    refresh: refreshCurrentQuery,
    queryDescriptor,
    queryPending,
  };
}
