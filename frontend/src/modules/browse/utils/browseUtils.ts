/**
 * frontend/src/modules/browse/utils/browseUtils.ts
 *
 * Shared utility functions for the Browse components.
 * Handles catalog scope building, normalization, and item management.
 */

import type { CatalogItem } from '@/core/refresh/types';
import { buildClusterScope } from '@/core/refresh/clusterScope';

/**
 * Parses a continue token from an unknown value.
 * Returns null if the value is not a valid non-empty string.
 */
export const parseContinueToken = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

/**
 * Splits a cluster-prefixed scope string into its prefix and scope parts.
 * The delimiter is '|' (e.g., "cluster-1|limit=200" -> { prefix: "cluster-1", scope: "limit=200" }).
 */
export const splitClusterScope = (value: string): { prefix: string; scope: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { prefix: '', scope: '' };
  }
  const delimiterIndex = trimmed.indexOf('|');
  if (delimiterIndex <= 0) {
    return { prefix: '', scope: trimmed };
  }
  return {
    prefix: trimmed.slice(0, delimiterIndex).trim(),
    scope: trimmed.slice(delimiterIndex + 1).trim(),
  };
};

/**
 * Rebuilds a UID-to-index map from an array of catalog items.
 */
export const rebuildIndexByUID = (items: CatalogItem[]): Map<string, number> => {
  const next = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.uid) {
      next.set(item.uid, index);
    }
  });
  return next;
};

/**
 * Result of deduplication by UID.
 */
export type DedupeResult = {
  items: CatalogItem[];
  indexByUid: Map<string, number>;
};

/**
 * Deduplicates catalog items by UID, keeping the last occurrence.
 * Items without a UID are kept as-is.
 */
export const dedupeByUID = (incoming: CatalogItem[]): DedupeResult => {
  if (incoming.length === 0) {
    return { items: [], indexByUid: new Map() };
  }

  const indexByUid = new Map<string, number>();
  const items: CatalogItem[] = [];

  for (const item of incoming) {
    const uid = item.uid;
    if (!uid) {
      items.push(item);
      continue;
    }

    const existingIndex = indexByUid.get(uid);
    if (existingIndex == null) {
      indexByUid.set(uid, items.length);
      items.push(item);
      continue;
    }

    // Replace in place to keep a stable ordering while ensuring unique keys.
    items[existingIndex] = item;
  }

  return { items, indexByUid };
};

/**
 * Result of upserting items by UID.
 */
export type UpsertResult = {
  nextItems: CatalogItem[];
  changed: boolean;
};

/**
 * Upserts incoming items into the current list by UID.
 * Updates existing items if their resourceVersion differs, appends new items.
 */
export const upsertByUID = (
  current: CatalogItem[],
  indexByUid: Map<string, number>,
  incoming: CatalogItem[]
): UpsertResult => {
  if (incoming.length === 0) {
    return { nextItems: current, changed: false };
  }

  let changed = false;
  let nextItems = current;

  const ensureWritable = () => {
    if (changed) {
      return;
    }
    changed = true;
    nextItems = current.slice();
  };

  for (const item of incoming) {
    const uid = item.uid;
    if (!uid) {
      continue;
    }

    const index = indexByUid.get(uid);
    if (index == null) {
      ensureWritable();
      indexByUid.set(uid, nextItems.length);
      nextItems.push(item);
      continue;
    }

    const existing = nextItems[index];
    if (existing?.resourceVersion === item.resourceVersion) {
      continue;
    }

    ensureWritable();
    nextItems[index] = item;
  }

  return { nextItems, changed };
};

/**
 * Filters catalog items to keep only those matching the specified clusterId.
 * If clusterId is null/undefined, keeps items without a clusterId.
 */
export const filterCatalogItems = (
  items: CatalogItem[],
  clusterId?: string | null
): CatalogItem[] => {
  if (!clusterId) {
    return items.filter((item) => !item.clusterId);
  }
  return items.filter((item) => item.clusterId === clusterId);
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
  limit: number;
  search: string;
  kinds: string[];
  namespaces: string[];
  continueToken?: string | null;
}

/**
 * Builds a catalog scope query string from the given parameters.
 * Multi-value params are sorted to keep the scope string stable across renders.
 */
export const buildCatalogScope = (params: BuildCatalogScopeParams): string => {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit));

  const search = params.search.trim();
  if (search.length > 0) {
    query.set('search', search);
  }

  // Sort multi-value params to keep the scope string stable across renders/hydration.
  // This avoids accidental refresh loops caused by reordered equivalent arrays.
  params.kinds
    .map((kind) => kind.trim())
    .filter(Boolean)
    .sort()
    .forEach((kind) => query.append('kind', kind));

  params.namespaces
    .map((namespace) => namespace.trim())
    .filter(Boolean)
    .sort()
    .forEach((namespace) => {
      // GridTable uses '' as the synthetic "cluster-scoped" namespace option.
      // The backend catalog already understands cluster scope when namespace is omitted.
      query.append('namespace', namespace);
    });

  const continueToken = params.continueToken?.trim();
  if (continueToken) {
    query.set('continue', continueToken);
  }

  return query.toString();
};

/**
 * Normalizes a catalog scope string by parsing and rebuilding it.
 * This ensures consistent parameter ordering for comparison.
 *
 * @param raw - The raw scope string from the backend or internal state
 * @param fallbackLimit - Default limit if not specified in the scope
 * @param pinnedNamespaces - Namespaces to pin (used for namespace-scoped views)
 * @param clusterId - The cluster ID to prefix the scope with
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
  const cleaned = raw.trim().replace(/^\?/, '');
  const { prefix, scope } = splitClusterScope(cleaned);
  const trimmed = scope.trim().replace(/^\?/, '');
  if (!trimmed) {
    return null;
  }

  try {
    const params = new URLSearchParams(trimmed);
    const limitRaw = params.get('limit');
    const limit =
      limitRaw && Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0
        ? Number(limitRaw)
        : fallbackLimit;
    const search = params.get('search') ?? '';
    const continueToken = params.get('continue');
    const kinds = params.getAll('kind');
    // Use pinned namespaces if provided, otherwise use namespaces from the scope.
    const namespaces = pinnedNamespaces.length > 0 ? pinnedNamespaces : params.getAll('namespace');

    const normalized = buildCatalogScope({
      limit,
      search,
      kinds,
      namespaces,
      continueToken,
    });
    if (prefix) {
      return `${prefix}|${normalized}`;
    }
    return buildClusterScope(clusterId ?? undefined, normalized);
  } catch {
    if (prefix) {
      return `${prefix}|${trimmed}`;
    }
    return buildClusterScope(clusterId ?? undefined, trimmed);
  }
};
