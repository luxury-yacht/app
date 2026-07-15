import type { ResourceGridPersistence } from '@modules/resource-grid/resourceGridTableTypes';
import { hasExplicitNoneResourceQueryFilter } from '@modules/resource-grid/typedResourceQueryScope';
import { filterSelectionValues } from '@shared/components/dropdowns/multiSelectFilterSelection';
import { useCallback } from 'react';
import type { CatalogBackedCustomResourceRow } from './customCatalogRowAdapter';
import { useBrowseCatalog } from './useBrowseCatalog';
import {
  hydrateCustomCatalogRows,
  useHydratedCustomCatalogRows,
} from './useHydratedCustomCatalogRows';

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
    pagination,
    fetchAllRows: fetchAllCatalogItems,
  } = useBrowseCatalog({
    enabled: persistence.hydrated,
    clusterId,
    pinnedNamespaces,
    clusterScopedOnly,
    customOnly: true,
    filters: {
      search: persistence.filters.search ?? '',
      kinds: filterSelectionValues(persistence.filters.kinds),
      namespaces: filterSelectionValues(persistence.filters.namespaces),
      matchNone: hasExplicitNoneResourceQueryFilter(persistence.filters),
    },
    sort: persistence.sortConfig,
    pageLimit: persistence.pageSize ?? undefined,
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
    // Assembled once in useBrowseCatalog; the views' `{...pagination}` spread
    // and the catalog footer both read this object.
    pagination,
  };
}
