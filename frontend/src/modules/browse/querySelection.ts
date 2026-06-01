import type { QuerySelectionDescriptor } from '@/core/refresh/types';
import type { BrowseCatalogQueryDescriptor } from './hooks/useBrowseCatalog';

export interface CatalogQuerySelectionDescriptor extends QuerySelectionDescriptor {
  scope: string;
  customOnly: boolean;
  hasUserNamespaceScope: boolean;
}

export function catalogSelectionFromBrowseQuery(
  query: BrowseCatalogQueryDescriptor,
  table = 'browse'
): CatalogQuerySelectionDescriptor {
  return {
    clusterId: query.clusterId,
    table,
    namespaces: query.namespaces,
    hasUserNamespaceScope: query.hasUserNamespaceScope,
    kinds: query.kinds,
    search: query.search,
    sortField: query.sortField,
    sortDirection: query.sortDirection,
    customOnly: query.customOnly,
    scope: query.scope,
  };
}

export function backendSelectionFromCatalogSelection(
  selection: CatalogQuerySelectionDescriptor
): QuerySelectionDescriptor {
  const {
    scope: _scope,
    hasUserNamespaceScope: _hasUserNamespaceScope,
    ...backendSelection
  } = selection;
  return backendSelection;
}
