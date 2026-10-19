/**
 * frontend/src/modules/browse/utils/browseUtils.ts
 *
 * Shared utility functions for the Browse components.
 * Handles catalog scope building, normalization, and item management.
 */

import { parseClusterScope } from '@/core/refresh/clusterScope';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type { CatalogItem } from '@/core/refresh/types';
import { compareUtf16Strings } from '@/shared/utils/sort';
import { structuralShareResourceRows } from '@/shared/utils/structuralShareResourceRows';

/**
 * Parses a continue token from an unknown value.
 * Returns null if the value is not a valid non-empty string.
 */
export const parseContinueToken = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

/**
 * Deduplicates catalog items by UID, keeping the last occurrence.
 * Items without a UID are kept as-is.
 */
const dedupeByUID = (incoming: CatalogItem[]): CatalogItem[] => {
  if (incoming.length === 0) {
    return [];
  }

  const indexByUid = new Map<string, number>();
  const items: CatalogItem[] = [];

  for (const item of incoming) {
    const uid = item.ref.uid;
    if (!uid) {
      items.push(item);
      continue;
    }

    const existingIndex = indexByUid.get(uid);
    if (existingIndex === null || existingIndex === undefined) {
      indexByUid.set(uid, items.length);
      items.push(item);
      continue;
    }

    // Replace in place to keep a stable ordering while ensuring unique keys.
    items[existingIndex] = item;
  }

  return items;
};

/**
 * Result of upserting items by UID.
 */
export type UpsertResult = {
  nextItems: CatalogItem[];
  changed: boolean;
};

/**
 * Reconciles a full replacement catalog snapshot against the current list.
 * Reuses existing item references when UID/resourceVersion are unchanged,
 * while still reflecting additions, deletions, reordering, and updates.
 */
export const reconcileByUID = (current: CatalogItem[], incoming: CatalogItem[]): UpsertResult => {
  const dedupedIncoming = dedupeByUID(incoming);
  if (dedupedIncoming.length === 0) {
    return current.length === 0
      ? { nextItems: current, changed: false }
      : { nextItems: [], changed: true };
  }

  const nextItems = structuralShareResourceRows(current, dedupedIncoming, 'row-and-ref');
  return nextItems === current
    ? { nextItems: current, changed: false }
    : { nextItems, changed: true };
};

/**
 * Filters catalog items to keep only cluster-scoped items (not namespace-scoped).
 */
export const filterClusterScopedItems = (items: CatalogItem[]): CatalogItem[] => {
  return items.filter((item) => item.scope === 'Cluster');
};

/**
 * Filters catalog items to keep only namespace-scoped items (not cluster-scoped).
 */
export const filterNamespaceScopedItems = (items: CatalogItem[]): CatalogItem[] => {
  return items.filter((item) => item.scope === 'Namespace');
};

/**
 * Parameters for building a catalog scope query string.
 */
export interface BuildCatalogScopeParams {
  resourceFamily?: string;
  limit: number;
  resourceScope?: 'cluster' | 'namespace';
  scopeNamespaces?: string[];
  search: string;
  kinds: string[];
  namespaces: string[];
  apiGroups?: string[];
  sort?: string;
  sortDirection?: string;
  continueToken?: string | null;
  /** Numbered page jump: 0-based start rank; mutually exclusive with continueToken. */
  startRank?: number | null;
  customOnly?: boolean;
  matchNone?: boolean;
}

/**
 * Builds a catalog scope query string from the given parameters.
 * Multi-value params are sorted to keep the scope string stable across renders.
 */
export const buildCatalogScope = (params: BuildCatalogScopeParams): string => {
  const query = new URLSearchParams();
  if (params.resourceFamily) {
    query.set('resourceFamily', params.resourceFamily);
  }
  query.set('limit', String(params.limit));
  if (params.customOnly) {
    query.set('customOnly', 'true');
  }
  if (params.matchNone) {
    query.set('matchNone', 'true');
  }
  if (params.resourceScope) {
    query.set('resourceScope', params.resourceScope);
  }
  const sort = params.sort?.trim();
  if (sort) {
    query.set('sort', sort);
  }
  const sortDirection = params.sortDirection?.trim();
  if (sortDirection) {
    query.set('sortDirection', sortDirection);
  }

  const search = params.search.trim();
  if (search.length > 0) {
    query.set('search', search);
  }

  // Sort multi-value params to keep the scope string stable across renders/hydration.
  // This avoids accidental refresh loops caused by reordered equivalent arrays.
  const facets = [
    ['kind', params.kinds],
    ['apiGroup', params.apiGroups ?? []],
    ['namespace', params.namespaces],
    ['scopeNamespace', params.scopeNamespaces ?? []],
  ] as const;
  for (const [key, values] of facets) {
    values
      .map((value) => value.trim())
      .filter(Boolean)
      .sort(compareUtf16Strings)
      .forEach((value) => {
        query.append(key, value);
      });
  }

  appendCatalogPageAddress(query, params);

  return query.toString();
};

const appendCatalogPageAddress = (
  query: URLSearchParams,
  params: BuildCatalogScopeParams
): void => {
  const continueToken = params.continueToken?.trim();
  if (continueToken) {
    query.set('continue', continueToken);
  } else if (typeof params.startRank === 'number' && params.startRank >= 0) {
    query.set('startRank', String(params.startRank));
  }
};

/**
 * Normalizes a catalog scope by rebuilding its query with stable parameter
 * ordering, so requested and backend-reported scopes compare equal.
 *
 * @param raw - A catalog query, or a complete catalog scope
 * @param fallbackLimit - Default limit if not specified in the scope
 * @param pinnedNamespaces - Namespaces to pin (used for namespace-scoped views)
 * @param clusterId - The cluster for a bare query
 */
export const normalizeCatalogScope = (
  raw: string | null | undefined,
  fallbackLimit: number,
  pinnedNamespaces: string[],
  clusterId?: string | null
): string | null => {
  // The refresh subsystem may surface `snapshot.scope` (as reported by the backend) rather than
  // the exact scope string we requested. Normalize both sides so Browse doesn't ignore valid
  // snapshots due to parameter ordering differences.
  if (!raw) {
    return null;
  }
  const parsed = parseClusterScope(raw);
  const targetClusterId = parsed.clusterId || clusterId?.trim();
  const query = parsed.scope;
  if (!query || !targetClusterId) {
    return null;
  }
  return buildRefreshScope('catalog', {
    clusterId: targetClusterId,
    selector: CLUSTER_SELECTOR,
    query: buildCatalogScope(
      catalogScopeParameters(new URLSearchParams(query), pinnedNamespaces, fallbackLimit)
    ),
  });
};

const positiveLimit = (value: string | null, fallback: number): number =>
  value && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

const catalogScopeParameters = (
  params: URLSearchParams,
  pinnedNamespaces: string[],
  fallbackLimit: number
): BuildCatalogScopeParams => {
  const limit = positiveLimit(params.get('limit'), fallbackLimit);
  const search = params.get('search') ?? '';
  const sort = params.get('sort') ?? undefined;
  const sortDirection = params.get('sortDirection') ?? undefined;
  const continueToken = params.get('continue');
  // startRank must survive normalization or numbered jumps silently break
  // (this function rebuilds the scope from the params it knows about).
  const startRankRaw = params.get('startRank');
  const startRank =
    startRankRaw !== null && Number.isFinite(Number(startRankRaw))
      ? Number(startRankRaw)
      : undefined;
  const customOnly = params.get('customOnly') === 'true';
  const matchNone = params.get('matchNone') === 'true';
  const resourceScope = params.get('resourceScope');
  const kinds = params.getAll('kind');
  const apiGroups = params.getAll('apiGroup');
  // Use pinned namespaces if provided, otherwise use namespaces from the scope.
  const namespaces = pinnedNamespaces.length > 0 ? pinnedNamespaces : params.getAll('namespace');
  const scopeNamespaces =
    pinnedNamespaces.length > 0 ? pinnedNamespaces : params.getAll('scopeNamespace');

  return {
    resourceFamily: params.get('resourceFamily') ?? undefined,
    limit,
    resourceScope:
      resourceScope === 'cluster' || resourceScope === 'namespace' ? resourceScope : undefined,
    scopeNamespaces,
    search,
    kinds,
    namespaces,
    apiGroups,
    sort,
    sortDirection,
    continueToken,
    startRank,
    customOnly,
    matchNone,
  };
};
