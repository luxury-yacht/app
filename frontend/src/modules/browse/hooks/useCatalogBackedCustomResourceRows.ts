import { useCatalogQueryCsvAction } from './useCatalogQueryCsvAction';
import { useBrowseCatalog } from './useBrowseCatalog';
import { useHydratedCustomCatalogRows } from './useHydratedCustomCatalogRows';
import type {
  ResourceGridPersistence,
  ResourceGridTableRow,
} from '@modules/resource-grid/resourceGridTableTypes';
import { catalogSelectionFromBrowseQuery } from '@modules/browse/querySelection';

export interface UseCatalogBackedCustomResourceRowsOptions<T extends ResourceGridTableRow> {
  clusterId?: string | null;
  namespace?: string;
  allNamespaces?: boolean;
  clusterScopedOnly?: boolean;
  persistence: ResourceGridPersistence<T>;
  diagnosticLabel: string;
  csvActionId: string;
  disableCsvWhenUnscoped?: boolean;
}

export function useCatalogBackedCustomResourceRows<T extends ResourceGridTableRow>({
  clusterId,
  namespace,
  allNamespaces = false,
  clusterScopedOnly = false,
  persistence,
  diagnosticLabel,
  csvActionId,
  disableCsvWhenUnscoped = false,
}: UseCatalogBackedCustomResourceRowsOptions<T>) {
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
  } = useBrowseCatalog({
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
    rows: rows as unknown as T[],
    loading,
    hasLoadedOnce,
    filterOptions,
    totalCount,
    totalIsExact,
    csvAction,
  };
}
