import { useCatalogQueryCsvAction } from './useCatalogQueryCsvAction';
import { useBrowseCatalog } from './useBrowseCatalog';
import { useHydratedCustomCatalogRows } from './useHydratedCustomCatalogRows';
import type { ResourceGridPersistence } from '@modules/resource-grid/resourceGridTableTypes';
import { catalogSelectionFromBrowseQuery } from '@modules/browse/querySelection';
import type { CatalogBackedCustomResourceRow } from './customCatalogRowAdapter';

export interface UseCatalogBackedCustomResourceRowsOptions {
  clusterId?: string | null;
  namespace?: string;
  allNamespaces?: boolean;
  clusterScopedOnly?: boolean;
  persistence: ResourceGridPersistence<CatalogBackedCustomResourceRow>;
  diagnosticLabel: string;
  csvActionId: string;
  disableCsvWhenUnscoped?: boolean;
}

export function useCatalogBackedCustomResourceRows({
  clusterId,
  namespace,
  allNamespaces = false,
  clusterScopedOnly = false,
  persistence,
  diagnosticLabel,
  csvActionId,
  disableCsvWhenUnscoped = false,
}: UseCatalogBackedCustomResourceRowsOptions) {
  const pinnedNamespaces = !clusterScopedOnly && namespace && !allNamespaces ? [namespace] : [];
  const {
    items: catalogItems,
    loading,
    hasLoadedOnce,
    filterOptions,
    totalCount,
    totalIsExact,
    queryDescriptor,
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
  const csvAction = useCatalogQueryCsvAction({
    query: catalogSelectionFromBrowseQuery(queryDescriptor),
    totalCount,
    pending: queryPending,
    disableWhenUnscoped: disableCsvWhenUnscoped,
    id: csvActionId,
  });

  return {
    rows,
    loading,
    hasLoadedOnce,
    filterOptions,
    totalCount,
    totalIsExact,
    csvAction,
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
    },
  };
}
