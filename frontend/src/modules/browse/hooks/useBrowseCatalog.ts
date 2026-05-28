/**
 * frontend/src/modules/browse/hooks/useBrowseCatalog.ts
 *
 * Hook for managing catalog data in the Browse components.
 * Handles domain management, pagination, and scope synchronization.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRefreshDomain, useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { eventBus } from '@/core/events';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { getMaxTableRows } from '@/core/settings/appPreferences';
import { getScopedDomainState } from '@/core/refresh/store';
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
  /** Current filter state */
  filters: BrowseFilters;
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
  /** Whether a "load more" request is in progress */
  isRequestingMore: boolean;
  /** Handler to load the next page of items */
  handleLoadMore: () => void;
  /** Filter options derived from the catalog snapshot */
  filterOptions: BrowseFilterOptions;
  /** Total count of items matching the current query (before pagination) */
  totalCount: number;
}

/**
 * Hook that manages catalog data for Browse components.
 * Handles domain lifecycle, pagination, and scope synchronization.
 */
export function useBrowseCatalog({
  clusterId,
  pinnedNamespaces,
  clusterScopedOnly = false,
  filters,
  diagnosticLabel,
}: UseBrowseCatalogOptions): UseBrowseCatalogResult {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [pageLimit, setPageLimit] = useState<number>(() => getMaxTableRows());
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();

  const collectionRef = useRef(emptyBrowseCatalogCollection());
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    return eventBus.on('settings:max-table-rows', (value) => {
      setPageLimit(value);
    });
  }, []);

  // Track available namespaces from the catalog snapshot.
  // Used to query all namespaces when no filter is selected in all-namespaces mode.
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const plan = useMemo(
    () =>
      buildBrowseCatalogPlan({
        clusterId,
        clusterScopedOnly,
        pinnedNamespaces,
        filters,
        availableNamespaces,
        pageLimit,
      }),
    [availableNamespaces, clusterId, clusterScopedOnly, filters, pageLimit, pinnedNamespaces]
  );
  const { catalogScope, metadataScope, metadataUsesActiveScope } = plan;

  // Read scoped state for the current catalog scope.
  const domain = useRefreshScopedDomain('catalog', catalogScope);
  const metadataDomain = useRefreshScopedDomain(
    'catalog',
    metadataUsesActiveScope ? catalogScope : metadataScope
  );
  useCatalogDiagnostics(domain, diagnosticLabel);

  useScopedRefreshDomainLifecycle({
    domain: 'catalog',
    scope: catalogScope,
    enabled: true,
  });
  useScopedRefreshDomainLifecycle({
    domain: metadataUsesActiveScope ? null : 'catalog',
    scope: metadataUsesActiveScope ? null : metadataScope,
    enabled: true,
  });

  // Apply query scope and refresh page 0 when the query changes
  const previousScopeIdentityRef = useRef(plan.scopeIdentityKey);
  useEffect(() => {
    const scopeIdentityChanged = previousScopeIdentityRef.current !== plan.scopeIdentityKey;
    previousScopeIdentityRef.current = plan.scopeIdentityKey;

    // Reset pagination state on query change.
    setIsRequestingMore(false);
    setContinueToken(null);
    // Preserve the current dataset while filter-only queries refresh so the
    // filter bar/dropdowns stay mounted and open menus don't lose their scroll
    // position. We still clear eagerly when the structural scope changes
    // (cluster/namespace mode) or before the first load.
    if (scopeIdentityChanged || !hasLoadedOnceRef.current) {
      collectionRef.current = emptyBrowseCatalogCollection();
      setItems([]);
    }

    void requestRefreshDomain({
      domain: 'catalog',
      scope: catalogScope,
      reason: 'startup',
    });
    if (!metadataUsesActiveScope) {
      void requestRefreshDomain({
        domain: 'catalog',
        scope: metadataScope,
        reason: 'startup',
      });
    }
  }, [catalogScope, metadataScope, metadataUsesActiveScope, plan.scopeIdentityKey]);

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
    setTotalCount(next.totalCount);
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

  // Load more handler.
  // Fetches the next page using a paginated scope and applies that exact
  // scoped result locally. The refresh store remains scoped by the request that
  // produced the data; Browse owns assembly of base query + loaded pages.
  const catalogScopeRef = useRef(catalogScope);
  catalogScopeRef.current = catalogScope;

  const handleLoadMore = useCallback(() => {
    if (!continueToken || isRequestingMore) {
      return;
    }
    setIsRequestingMore(true);

    const normalizedScope = buildBrowseCatalogPageScope(
      plan,
      { clusterId, filters, pageLimit, pinnedNamespaces },
      continueToken
    );
    // Enable the paginated scope and fetch it directly.
    refreshOrchestrator.setScopedDomainEnabled('catalog', normalizedScope, true);
    const baseScopeAtRequest = catalogScopeRef.current;
    void (async () => {
      try {
        const result = await requestRefreshDomain({
          domain: 'catalog',
          scope: normalizedScope,
          reason: 'user',
        });
        if (result.status !== 'executed' || catalogScopeRef.current !== baseScopeAtRequest) {
          return;
        }

        const pageResult = getScopedDomainState('catalog', normalizedScope);
        const payload = pageResult.data as CatalogSnapshotPayload | null;
        if (!payload || (pageResult.status !== 'ready' && pageResult.status !== 'updating')) {
          return;
        }

        const currentLength = collectionRef.current.items.length;
        const next = applyCatalogPage(collectionRef.current, payload);
        collectionRef.current = { items: next.items, indexByUid: next.indexByUid };
        if (next.changed || currentLength === 0) {
          setItems(next.items);
        }
        setContinueToken(next.continueToken);
        setTotalCount(next.totalCount);
        if (!hasLoadedOnceRef.current) {
          hasLoadedOnceRef.current = true;
          setHasLoadedOnce(true);
        }
      } catch (error) {
        console.error('Failed to load additional catalog page', error);
      } finally {
        refreshOrchestrator.setScopedDomainEnabled('catalog', normalizedScope, false);
        if (catalogScopeRef.current === baseScopeAtRequest) {
          setIsRequestingMore(false);
        }
      }
    })();
  }, [continueToken, isRequestingMore, pageLimit, filters, plan, pinnedNamespaces, clusterId]);

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
    isRequestingMore,
    handleLoadMore,
    filterOptions,
    totalCount,
  };
}
