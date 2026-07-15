/**
 * frontend/src/types/navigation/views.ts
 *
 * Navigation view vocabularies. The unions and runtime membership sets are
 * derived from the canonical registry so they cannot drift, and
 * stringly boundaries (persisted favorites, DOM datasets) can validate via
 * the parse helpers instead of blind-casting.
 */

export const VIEW_TYPES = [
  'global',
  'namespace',
  'cluster',
  'overview',
  'settings',
  'about',
] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

import {
  CLUSTER_VIEW_DESCRIPTORS,
  type ClusterViewType,
  GLOBAL_VIEW_DESCRIPTORS,
  type GlobalViewType,
  NAMESPACE_VIEW_DESCRIPTORS,
  type NamespaceViewType,
} from '@/core/navigation/viewRegistry';

export type {
  ClusterViewType,
  GlobalViewType,
  NamespaceViewType,
} from '@/core/navigation/viewRegistry';

const namespaceViewTypeSet: ReadonlySet<string> = new Set(
  NAMESPACE_VIEW_DESCRIPTORS.map(({ id }) => id)
);
const clusterViewTypeSet: ReadonlySet<string> = new Set(
  CLUSTER_VIEW_DESCRIPTORS.map(({ id }) => id)
);
const globalViewTypeSet: ReadonlySet<string> = new Set(GLOBAL_VIEW_DESCRIPTORS.map(({ id }) => id));

/**
 * Coerce a raw string (persisted favorite, DOM dataset) into the union, or
 * undefined when it is not a member — callers fall back to their default
 * instead of navigating to a view that does not exist.
 */
export const parseNamespaceViewType = (
  raw: string | null | undefined
): NamespaceViewType | undefined => {
  if (raw === 'pods') {
    return 'workloads';
  }
  return raw && namespaceViewTypeSet.has(raw) ? (raw as NamespaceViewType) : undefined;
};

export const parseClusterViewType = (
  raw: string | null | undefined
): ClusterViewType | undefined =>
  raw && clusterViewTypeSet.has(raw) ? (raw as ClusterViewType) : undefined;

export const parseGlobalViewType = (raw: string | null | undefined): GlobalViewType | undefined =>
  raw && globalViewTypeSet.has(raw) ? (raw as GlobalViewType) : undefined;
