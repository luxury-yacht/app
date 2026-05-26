import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import {
  buildCatalogScope,
  filterClusterScopedItems,
  filterNamespaceScopedItems,
  normalizeCatalogScope,
  parseContinueToken,
  reconcileByUID,
  rebuildIndexByUID,
  splitClusterScope,
  upsertByUID,
} from '@modules/browse/utils/browseUtils';

export interface BrowseFilters {
  search: string;
  kinds: string[];
  namespaces: string[];
}

export interface BrowseFilterOptions {
  kinds: string[];
  namespaces: string[];
  isNamespaceScoped: boolean;
}

export interface BrowseCatalogPlanInput {
  clusterId: string | null | undefined;
  clusterScopedOnly: boolean;
  pinnedNamespaces: string[];
  filters: BrowseFilters;
  availableNamespaces: string[];
  pageLimit: number;
}

export interface BrowseCatalogPlan {
  isNamespaceScoped: boolean;
  namespacesToQuery: string[];
  catalogScope: string;
  metadataScope: string;
  metadataUsesActiveScope: boolean;
  scopeIdentityKey: string;
}

export interface BrowseCatalogCollection {
  items: CatalogItem[];
  indexByUid: Map<string, number>;
}

export interface BrowseCatalogApplyResult extends BrowseCatalogCollection {
  changed: boolean;
  continueToken: string | null;
  totalCount: number;
}

export const emptyBrowseCatalogCollection = (): BrowseCatalogCollection => ({
  items: [],
  indexByUid: new Map(),
});

export const buildBrowseCatalogPlan = ({
  clusterId,
  clusterScopedOnly,
  pinnedNamespaces,
  filters,
  availableNamespaces,
  pageLimit,
}: BrowseCatalogPlanInput): BrowseCatalogPlan => {
  const isNamespaceScoped = pinnedNamespaces.length > 0;
  const selectedNamespaces = filters.namespaces ?? [];
  const namespacesToQuery = clusterScopedOnly
    ? ['cluster']
    : isNamespaceScoped
      ? pinnedNamespaces
      : selectedNamespaces.length > 0
        ? selectedNamespaces
        : availableNamespaces;

  const baseScope = buildCatalogScope({
    limit: pageLimit,
    search: filters.search ?? '',
    kinds: filters.kinds ?? [],
    namespaces: namespacesToQuery,
  });
  const catalogScope =
    normalizeCatalogScope(baseScope, pageLimit, pinnedNamespaces, clusterId) ??
    buildClusterScope(clusterId ?? undefined, baseScope);

  const metadataNamespaces = clusterScopedOnly
    ? ['cluster']
    : isNamespaceScoped
      ? pinnedNamespaces
      : [];
  const metadataBaseScope = buildCatalogScope({
    limit: 1,
    search: '',
    kinds: [],
    namespaces: metadataNamespaces,
  });
  const metadataScope =
    normalizeCatalogScope(metadataBaseScope, 1, pinnedNamespaces, clusterId) ??
    buildClusterScope(clusterId ?? undefined, metadataBaseScope);

  return {
    isNamespaceScoped,
    namespacesToQuery,
    catalogScope,
    metadataScope,
    metadataUsesActiveScope: metadataScope === catalogScope,
    scopeIdentityKey: JSON.stringify({
      clusterId: clusterId ?? '',
      clusterScopedOnly,
      pinnedNamespaces: pinnedNamespaces.map((ns) => ns.trim()).sort(),
    }),
  };
};

export const buildBrowseCatalogPageScope = (
  plan: BrowseCatalogPlan,
  input: Pick<BrowseCatalogPlanInput, 'clusterId' | 'filters' | 'pageLimit' | 'pinnedNamespaces'>,
  continueToken: string
): string => {
  const pageScope = buildCatalogScope({
    limit: input.pageLimit,
    search: input.filters.search ?? '',
    kinds: input.filters.kinds ?? [],
    namespaces: plan.namespacesToQuery,
    continueToken,
  });
  return (
    normalizeCatalogScope(pageScope, input.pageLimit, input.pinnedNamespaces, input.clusterId) ??
    buildClusterScope(input.clusterId ?? undefined, pageScope)
  );
};

export const acceptsCatalogSnapshotScope = (
  scope: string | undefined,
  fallbackScope: string,
  pinnedNamespaces: string[]
): boolean => {
  if (pinnedNamespaces.length === 0) {
    return true;
  }
  const incomingScopeParams = new URLSearchParams(
    splitClusterScope(scope ?? fallbackScope).scope.replace(/^\?/, '')
  );
  const incomingNamespaces = incomingScopeParams.getAll('namespace').sort();
  const expectedNamespaces = pinnedNamespaces.slice().sort();
  return (
    incomingNamespaces.length === expectedNamespaces.length &&
    incomingNamespaces.every((ns, index) => ns === expectedNamespaces[index])
  );
};

export const applyCatalogBaseline = (
  collection: BrowseCatalogCollection,
  payload: CatalogSnapshotPayload
): BrowseCatalogApplyResult => {
  const { nextItems, changed } = reconcileByUID(collection.items, payload.items ?? []);
  return {
    items: changed || collection.items.length === 0 ? nextItems : collection.items,
    indexByUid: rebuildIndexByUID(nextItems),
    changed,
    continueToken: parseContinueToken(payload.continue),
    totalCount: payload.total ?? 0,
  };
};

export const applyCatalogPage = (
  collection: BrowseCatalogCollection,
  payload: CatalogSnapshotPayload
): BrowseCatalogApplyResult => {
  const { nextItems, changed } = upsertByUID(
    collection.items,
    collection.indexByUid,
    payload.items ?? []
  );
  return {
    items: changed || collection.items.length === 0 ? nextItems : collection.items,
    indexByUid: rebuildIndexByUID(nextItems),
    changed,
    continueToken: parseContinueToken(payload.continue),
    totalCount: payload.total ?? 0,
  };
};

export const filterBrowseCatalogItems = (
  items: CatalogItem[],
  clusterScopedOnly: boolean
): CatalogItem[] =>
  clusterScopedOnly ? filterClusterScopedItems(items) : filterNamespaceScopedItems(items);

export const deriveBrowseFilterOptions = ({
  payload,
  clusterScopedOnly,
  isNamespaceScoped,
}: {
  payload: CatalogSnapshotPayload | null;
  clusterScopedOnly: boolean;
  isNamespaceScoped: boolean;
}): BrowseFilterOptions => {
  const kindInfos = payload?.kinds ?? [];
  const filteredKinds = clusterScopedOnly
    ? kindInfos.filter((kind) => !kind.namespaced)
    : kindInfos.filter((kind) => kind.namespaced);

  return {
    kinds: filteredKinds.map((kind) => kind.kind).sort(),
    namespaces: isNamespaceScoped ? [] : (payload?.namespaces ?? []).slice().sort(),
    isNamespaceScoped,
  };
};

export const namespacesChanged = (left: string[], right: string[]): boolean =>
  left.length !== right.length || left.some((namespace, index) => namespace !== right[index]);
