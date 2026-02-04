/**
 * frontend/src/modules/browse/hooks/useBrowseCatalog.ts
 *
 * Hook for managing catalog data in the Browse components.
 * Handles domain management, pagination, and scope synchronization.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
import { useCatalogDiagnostics } from '@/core/refresh/diagnostics/useCatalogDiagnostics';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import {
  buildCatalogScope,
  dedupeByUID,
  filterCatalogItems,
  filterClusterScopedItems,
  filterNamespaceScopedItems,
  normalizeCatalogScope,
  parseContinueToken,
  rebuildIndexByUID,
  upsertByUID,
} from '@modules/browse/utils/browseUtils';

const DEFAULT_LIMIT = 200;

type PageRequestMode = 'reset' | 'append' | null;

/**
 * Filter state for the Browse table.
 */
export interface BrowseFilters {
  search: string;
  kinds: string[];
  namespaces: string[];
}

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
 * Filter options derived from the catalog snapshot.
 */
export interface BrowseFilterOptions {
  kinds: string[];
  namespaces: string[];
  isNamespaceScoped: boolean;
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
  const domain = useRefreshDomain('catalog');
  useCatalogDiagnostics(domain, diagnosticLabel);

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const requestModeRef = useRef<PageRequestMode>(null);
  const lastAppliedScopeRef = useRef<string>('');
  const itemsRef = useRef<CatalogItem[]>([]);
  const indexByUidRef = useRef<Map<string, number>>(new Map());

  const pageLimit = DEFAULT_LIMIT;
  const isNamespaceScoped = pinnedNamespaces.length > 0;

  // Track available namespaces from the catalog snapshot.
  // Used to query all namespaces when no filter is selected in all-namespaces mode.
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);

  // Determine namespaces to query:
  // - Cluster scope: empty (to get cluster-scoped objects)
  // - Namespace scope: use pinned namespaces
  // - All-namespaces with filter: use selected filter namespaces
  // - All-namespaces without filter: use all available namespaces (or empty for initial load)
  const namespacesToQuery = useMemo(() => {
    // Cluster scope: don't send any namespaces to get cluster-scoped objects
    if (clusterScopedOnly) {
      return [];
    }
    // Namespace scope: use the pinned namespace
    if (isNamespaceScoped) {
      return pinnedNamespaces;
    }
    // All-namespaces scope: use selected filter or all available namespaces
    const selectedNamespaces = filters.namespaces ?? [];
    if (selectedNamespaces.length > 0) {
      return selectedNamespaces;
    }
    // No filter selected in all-namespaces mode - use all available namespaces
    return availableNamespaces;
  }, [clusterScopedOnly, isNamespaceScoped, pinnedNamespaces, filters.namespaces, availableNamespaces]);

  // Build the base scope string from filters and namespaces
  const baseScope = useMemo(
    () =>
      buildCatalogScope({
        limit: pageLimit,
        search: filters.search ?? '',
        kinds: filters.kinds ?? [],
        namespaces: namespacesToQuery,
      }),
    [pageLimit, filters.search, filters.kinds, namespacesToQuery]
  );

  // Enable catalog domain on mount, disable on unmount
  useEffect(() => {
    refreshOrchestrator.setDomainEnabled('catalog', true);
    return () => {
      refreshOrchestrator.setDomainEnabled('catalog', false);
    };
  }, []);

  // Apply query scope and refresh page 0 when the query changes
  useEffect(() => {
    const normalizedScope =
      normalizeCatalogScope(baseScope, pageLimit, pinnedNamespaces, clusterId) ??
      buildClusterScope(clusterId ?? undefined, baseScope);

    // Reset pagination state on query change
    requestModeRef.current = 'reset';
    setIsRequestingMore(false);
    setContinueToken(null);
    // Keep current items until the new snapshot arrives to avoid focus loss in filters

    refreshOrchestrator.setDomainScope('catalog', normalizedScope);
    lastAppliedScopeRef.current = normalizedScope;
    void refreshOrchestrator.triggerManualRefresh('catalog', { suppressSpinner: true });
  }, [baseScope, pageLimit, pinnedNamespaces, clusterId]);

  // Apply incoming snapshots to local pagination state
  useEffect(() => {
    if (!domain.data || !domain.scope) {
      return;
    }
    // The refresh store updates `domain.scope` when a fetch begins, but intentionally keeps
    // `domain.data` until a new snapshot lands. Only apply snapshots once the domain is
    // `ready` so we don't mistakenly treat stale data as belonging to the new scope (which
    // can cause scope thrash, broken pagination, and virtual-scroll update loops).
    if (domain.status !== 'ready') {
      return;
    }
    const normalizedIncoming =
      normalizeCatalogScope(domain.scope, pageLimit, pinnedNamespaces, clusterId) ?? domain.scope;
    if (normalizedIncoming !== lastAppliedScopeRef.current) {
      return;
    }

    const payload = domain.data as CatalogSnapshotPayload;
    const mode = requestModeRef.current;
    requestModeRef.current = null;

    if (mode === 'append') {
      const { nextItems, changed } = upsertByUID(
        itemsRef.current,
        indexByUidRef.current,
        payload.items ?? []
      );
      if (changed) {
        itemsRef.current = nextItems;
        setItems(nextItems);
      }
    } else {
      const { items: nextItems, indexByUid } = dedupeByUID(payload.items ?? []);
      itemsRef.current = nextItems;
      indexByUidRef.current = indexByUid.size ? indexByUid : rebuildIndexByUID(nextItems);
      setItems(nextItems);
    }

    setContinueToken(parseContinueToken(payload.continue));
    setIsRequestingMore(false);

    // After a load-more request, restore the base scope so subsequent manual refreshes
    // refresh the first page for the current query rather than a paginated continuation.
    if (mode === 'append') {
      const normalizedBaseScope =
        normalizeCatalogScope(baseScope, pageLimit, pinnedNamespaces, clusterId) ??
        buildClusterScope(clusterId ?? undefined, baseScope);
      refreshOrchestrator.setDomainScope('catalog', normalizedBaseScope);
      lastAppliedScopeRef.current = normalizedBaseScope;
    }
  }, [domain.data, domain.scope, domain.status, baseScope, pageLimit, pinnedNamespaces, clusterId]);

  // Handle first load
  useEffect(() => {
    if (hasLoadedOnce || !domain.data) {
      return;
    }
    setHasLoadedOnce(true);
  }, [domain.data, hasLoadedOnce]);

  // Load more handler
  const handleLoadMore = useCallback(() => {
    if (!continueToken || isRequestingMore) {
      return;
    }
    requestModeRef.current = 'append';
    setIsRequestingMore(true);

    const pageScope = buildCatalogScope({
      limit: pageLimit,
      search: filters.search ?? '',
      kinds: filters.kinds ?? [],
      namespaces: namespacesToQuery,
      continueToken,
    });

    const normalizedScope =
      normalizeCatalogScope(pageScope, pageLimit, pinnedNamespaces, clusterId) ??
      buildClusterScope(clusterId ?? undefined, pageScope);
    refreshOrchestrator.setDomainScope('catalog', normalizedScope);
    lastAppliedScopeRef.current = normalizedScope;
    void refreshOrchestrator.triggerManualRefresh('catalog', { suppressSpinner: true });
  }, [
    continueToken,
    isRequestingMore,
    pageLimit,
    filters.search,
    filters.kinds,
    namespacesToQuery,
    pinnedNamespaces,
    clusterId,
  ]);

  // Filter items by cluster and by scope
  const filteredItems = useMemo(() => {
    let result = filterCatalogItems(items, clusterId);
    if (clusterScopedOnly) {
      result = filterClusterScopedItems(result);
    } else {
      // For namespace and all-namespaces scopes, filter to namespace-scoped items only
      result = filterNamespaceScopedItems(result);
    }
    return result;
  }, [items, clusterId, clusterScopedOnly]);

  // Derive filter options from the catalog snapshot
  const filterOptions = useMemo<BrowseFilterOptions>(() => {
    const payload = domain.data as CatalogSnapshotPayload | null;
    const kindInfos = payload?.kinds ?? [];

    // Filter kinds based on scope:
    // - Cluster scope: only cluster-scoped kinds
    // - Namespace/All-namespaces scope: only namespace-scoped kinds
    const filteredKinds = clusterScopedOnly
      ? kindInfos.filter((k) => !k.namespaced)
      : kindInfos.filter((k) => k.namespaced);

    const kinds = filteredKinds.map((k) => k.kind).sort();

    return {
      kinds,
      namespaces: isNamespaceScoped ? [] : (payload?.namespaces ?? []).slice().sort(),
      isNamespaceScoped,
    };
  }, [domain.data, isNamespaceScoped, clusterScopedOnly]);

  // Update available namespaces when the snapshot includes them.
  // This enables querying all namespaces when no filter is selected in all-namespaces mode.
  useEffect(() => {
    const snapshotNamespaces = filterOptions.namespaces;
    if (snapshotNamespaces.length > 0 && !isNamespaceScoped) {
      // Only update if the list has actually changed to avoid infinite loops
      setAvailableNamespaces((prev) => {
        if (prev.length === snapshotNamespaces.length && prev.every((ns, i) => ns === snapshotNamespaces[i])) {
          return prev;
        }
        return snapshotNamespaces;
      });
    }
  }, [filterOptions.namespaces, isNamespaceScoped]);

  // Compute loading state
  const loading =
    domain.status === 'loading' ||
    domain.status === 'initialising' ||
    (items.length === 0 && !domain.data);

  return {
    items: filteredItems,
    loading,
    hasLoadedOnce,
    continueToken,
    isRequestingMore,
    handleLoadMore,
    filterOptions,
  };
}
