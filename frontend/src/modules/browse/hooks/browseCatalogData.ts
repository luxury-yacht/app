import {
  buildCatalogScope,
  filterClusterScopedItems,
  filterNamespaceScopedItems,
  normalizeCatalogScope,
  parseContinueToken,
  rebuildIndexByUID,
  reconcileByUID,
  splitClusterScope,
} from '@modules/browse/utils/browseUtils';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { compareUtf16Strings } from '@/shared/utils/sort';

export interface BrowseFilters {
  search: string;
  kinds: string[];
  namespaces: string[];
}

export interface BrowseFilterOptions {
  kinds: string[];
  namespaces: string[];
  isNamespaceScoped: boolean;
  partialDataLabel?: string;
}

export interface BrowseCatalogPlanInput {
  clusterId: string | null | undefined;
  clusterScopedOnly: boolean;
  customOnly?: boolean;
  pinnedNamespaces: string[];
  filters: BrowseFilters;
  sort?: { key: string; direction: 'asc' | 'desc' | null } | null;
  availableNamespaces: string[];
  pageLimit: number;
}

export interface BrowseCatalogPlan {
  resourceScope: 'cluster' | 'namespace';
  scopeNamespaces: string[];
  isNamespaceScoped: boolean;
  hasUserNamespaceScope: boolean;
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
  previousToken: string | null;
  totalCount: number;
  unfilteredTotal: number;
  totalIsExact: boolean;
}

export const emptyBrowseCatalogCollection = (): BrowseCatalogCollection => ({
  items: [],
  indexByUid: new Map(),
});

export const buildBrowseCatalogPlan = ({
  clusterId,
  clusterScopedOnly,
  customOnly = false,
  pinnedNamespaces,
  filters,
  sort,
  availableNamespaces,
  pageLimit,
}: BrowseCatalogPlanInput): BrowseCatalogPlan => {
  const isNamespaceScoped = pinnedNamespaces.length > 0;
  const resourceScope = clusterScopedOnly ? 'cluster' : 'namespace';
  const scopeNamespaces = isNamespaceScoped ? pinnedNamespaces : [];
  const sortScope = catalogSortScope(sort);
  const selectedNamespaces = filters.namespaces ?? [];
  const hasUserNamespaceScope = isNamespaceScoped || selectedNamespaces.length > 0;
  const namespacesToQuery = clusterScopedOnly
    ? ['cluster']
    : isNamespaceScoped
      ? pinnedNamespaces
      : selectedNamespaces.length > 0
        ? selectedNamespaces
        : availableNamespaces;

  const baseScope = buildCatalogScope({
    limit: pageLimit,
    resourceScope,
    scopeNamespaces,
    search: filters.search ?? '',
    kinds: filters.kinds ?? [],
    namespaces: namespacesToQuery,
    sort: sortScope.sort,
    sortDirection: sortScope.sortDirection,
    customOnly,
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
    resourceScope,
    scopeNamespaces,
    search: '',
    kinds: [],
    namespaces: metadataNamespaces,
    customOnly,
  });
  const metadataScope =
    normalizeCatalogScope(metadataBaseScope, 1, pinnedNamespaces, clusterId) ??
    buildClusterScope(clusterId ?? undefined, metadataBaseScope);

  return {
    resourceScope,
    scopeNamespaces,
    isNamespaceScoped,
    hasUserNamespaceScope,
    namespacesToQuery,
    catalogScope,
    metadataScope,
    metadataUsesActiveScope: metadataScope === catalogScope,
    scopeIdentityKey: JSON.stringify({
      clusterId: clusterId ?? '',
      clusterScopedOnly,
      customOnly,
      pinnedNamespaces: pinnedNamespaces.map((ns) => ns.trim()).sort(compareUtf16Strings),
    }),
  };
};

export const buildBrowseCatalogPageScope = (
  plan: BrowseCatalogPlan,
  input: Pick<
    BrowseCatalogPlanInput,
    'clusterId' | 'filters' | 'sort' | 'pageLimit' | 'pinnedNamespaces'
  > & { customOnly?: boolean },
  continueToken: string,
  startRank?: number
): string => {
  const pageScope = buildCatalogScope({
    limit: input.pageLimit,
    resourceScope: plan.resourceScope,
    scopeNamespaces: plan.scopeNamespaces,
    search: input.filters.search ?? '',
    kinds: input.filters.kinds ?? [],
    namespaces: plan.namespacesToQuery,
    sort: catalogSortScope(input.sort).sort,
    sortDirection: catalogSortScope(input.sort).sortDirection,
    continueToken,
    startRank,
    customOnly: input.customOnly ?? false,
  });
  return (
    normalizeCatalogScope(pageScope, input.pageLimit, input.pinnedNamespaces, input.clusterId) ??
    buildClusterScope(input.clusterId ?? undefined, pageScope)
  );
};

const catalogSortScope = (
  sort?: { key: string; direction: 'asc' | 'desc' | null } | null
): { sort?: string; sortDirection?: string } => {
  const key = sort?.key?.trim();
  const direction = sort?.direction;
  if (!key || !direction || (key === 'kind' && direction === 'asc')) {
    return {};
  }
  return { sort: key, sortDirection: direction };
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
    previousToken: parseContinueToken(payload.previous),
    totalCount: payload.total ?? 0,
    unfilteredTotal: payload.unfilteredTotal ?? payload.total ?? 0,
    totalIsExact: payload.totalIsExact !== false,
  };
};

export const applyCatalogPage = (
  _collection: BrowseCatalogCollection,
  payload: CatalogSnapshotPayload
): BrowseCatalogApplyResult => {
  const nextItems = payload.items ?? [];
  return {
    items: nextItems,
    indexByUid: rebuildIndexByUID(nextItems),
    changed: true,
    continueToken: parseContinueToken(payload.continue),
    previousToken: parseContinueToken(payload.previous),
    totalCount: payload.total ?? 0,
    unfilteredTotal: payload.unfilteredTotal ?? payload.total ?? 0,
    totalIsExact: payload.totalIsExact !== false,
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

  const issueLabel = payload?.issues?.length
    ? payload.issues.map((issue) => `${issue.kind}: ${issue.message}`).join('\n')
    : undefined;
  const facetsLabel =
    payload?.facetsExact === false
      ? 'Facet options are approximate because catalog metadata is incomplete.'
      : undefined;
  const totalLabel =
    payload?.totalIsExact === false
      ? 'The total result count is approximate because the catalog metadata budget was exceeded.'
      : undefined;

  return {
    kinds: filteredKinds.map((kind) => kind.kind).sort(),
    namespaces: isNamespaceScoped ? [] : (payload?.namespaces ?? []).slice().sort(),
    isNamespaceScoped,
    partialDataLabel: [issueLabel, facetsLabel, totalLabel].filter(Boolean).join('\n') || undefined,
  };
};

export const namespacesChanged = (left: string[], right: string[]): boolean =>
  left.length !== right.length || left.some((namespace, index) => namespace !== right[index]);
