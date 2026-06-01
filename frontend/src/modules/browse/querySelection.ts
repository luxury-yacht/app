import type { QuerySelectionDescriptor } from '@/core/refresh/types';
import type { BrowseCatalogQueryDescriptor } from './hooks/useBrowseCatalog';

export interface CatalogQuerySelectionDescriptor extends QuerySelectionDescriptor {
  scope: string;
  customOnly: boolean;
}

export function catalogSelectionFromBrowseQuery(
  query: BrowseCatalogQueryDescriptor,
  table = 'browse'
): CatalogQuerySelectionDescriptor {
  return {
    clusterId: query.clusterId,
    table,
    namespaces: query.namespaces,
    kinds: query.kinds,
    search: query.search,
    sortField: query.sortField,
    sortDirection: query.sortDirection,
    customOnly: query.customOnly,
    querySignature: query.scope,
    scope: query.scope,
  };
}
