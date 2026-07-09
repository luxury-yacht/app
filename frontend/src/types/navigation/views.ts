/**
 * frontend/src/types/navigation/views.ts
 *
 * Navigation view vocabularies. The unions are derived from the `as const`
 * arrays so the runtime membership sets and the types cannot drift, and
 * stringly boundaries (persisted favorites, DOM datasets) can validate via
 * the parse helpers instead of blind-casting.
 */

export const VIEW_TYPES = ['namespace', 'cluster', 'overview', 'settings', 'about'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const NAMESPACE_VIEW_TYPES = [
  'browse',
  'map',
  'workloads',
  'pods',
  'config',
  'network',
  'rbac',
  'storage',
  'autoscaling',
  'quotas',
  'custom',
  'helm',
  'events',
] as const;
export type NamespaceViewType = (typeof NAMESPACE_VIEW_TYPES)[number];

export const CLUSTER_VIEW_TYPES = [
  'nodes',
  'rbac',
  'storage',
  'config',
  'crds',
  'custom',
  'events',
  'browse',
] as const;
export type ClusterViewType = (typeof CLUSTER_VIEW_TYPES)[number];

const namespaceViewTypeSet: ReadonlySet<string> = new Set(NAMESPACE_VIEW_TYPES);
const clusterViewTypeSet: ReadonlySet<string> = new Set(CLUSTER_VIEW_TYPES);

/**
 * Coerce a raw string (persisted favorite, DOM dataset) into the union, or
 * undefined when it is not a member — callers fall back to their default
 * instead of navigating to a view that does not exist.
 */
export const parseNamespaceViewType = (
  raw: string | null | undefined
): NamespaceViewType | undefined =>
  raw && namespaceViewTypeSet.has(raw) ? (raw as NamespaceViewType) : undefined;

export const parseClusterViewType = (
  raw: string | null | undefined
): ClusterViewType | undefined =>
  raw && clusterViewTypeSet.has(raw) ? (raw as ClusterViewType) : undefined;
