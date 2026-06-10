import { useCallback } from 'react';

import { useBrowseCatalog } from './useBrowseCatalog';
import {
  hydrateCustomCatalogRows,
  useHydratedCustomCatalogRows,
} from './useHydratedCustomCatalogRows';
import type { ResourceGridPersistence } from '@modules/resource-grid/resourceGridTableTypes';
import type { CatalogBackedCustomResourceRow } from './customCatalogRowAdapter';

export interface UseCatalogBackedCustomResourceRowsOptions {
  clusterId?: string | null;
  namespace?: string;
  allNamespaces?: boolean;
  clusterScopedOnly?: boolean;
  persistence: ResourceGridPersistence<CatalogBackedCustomResourceRow>;
  diagnosticLabel: string;
}

export function useCatalogBackedCustomResourceRows({
  clusterId,
  namespace,
  allNamespaces = false,
  clusterScopedOnly = false,
  persistence,
  diagnosticLabel,
}: UseCatalogBackedCustomResourceRowsOptions) {
  const pinnedNamespaces = !clusterScopedOnly && namespace && !allNamespaces ? [namespace] : [];
  const {
    items: catalogItems,
    loading,
    hasLoadedOnce,
    error,
    filterOptions,
    totalCount,
    unfilteredTotal,
    totalIsExact,
    queryPending,
    continueToken,
    previousToken,
    isRequestingMore,
    pageIndex,
    pageLimit,
    pageLimitOptions,
    handleLoadMore,
    handleLoadPrevious,
    setPageLimit,
    fetchAllRows: fetchAllCatalogItems,
  } = useBrowseCatalog({
    enabled: persistence.hydrated,
    clusterId,
    pinnedNamespaces,
    clusterScopedOnly,
    customOnly: true,
    filters: {
      search: persistence.filters.search ?? '',
      kinds: persistence.filters.kinds ?? [],
      namespaces: persistence.filters.namespaces ?? [],
    },
    sort: persistence.sortConfig,
    initialPageLimit: persistence.pageSize ?? undefined,
    onPageLimitChange: persistence.setPageSize,
    diagnosticLabel,
  });

  const rows = useHydratedCustomCatalogRows(clusterId, catalogItems);

  // Export source for the Copy/Export "all matching rows" scope: every matching catalog item
  // (all pages) hydrated into rows, so the CSV matches the columns shown on screen.
  const fetchAllRows = useCallback(
    () => fetchAllCatalogItems().then((items) => hydrateCustomCatalogRows(clusterId, items)),
    [clusterId, fetchAllCatalogItems]
  );

  return {
    rows,
    loading,
    hasLoadedOnce,
    error,
    filterOptions,
    totalCount,
    unfilteredTotal,
    totalIsExact,
    fetchAllRows,
    pagination: {
      pageIndex,
      pageLimit,
      pageLimitOptions,
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
      loadMoreLabel: 'Next page',
      previousPageLabel: 'Previous page',
      // Cursor pages REPLACE the row window; the scroll sentinel must never
      // auto-advance them (it chains pages and fires without scroll on short
      // pages). Spread targets (the views' `{...pagination}`) inherit this.
      autoLoadMore: false,
    },
  };
}
