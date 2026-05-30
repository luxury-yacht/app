/**
 * frontend/src/modules/cluster/contexts/clusterResourceDescriptors.ts
 *
 * Defines the descriptor table that maps cluster resource views to refresh
 * domains, payload selectors, and metadata builders. ClusterResourcesContext
 * uses these descriptors so resource inventory facts are not embedded in the
 * provider implementation.
 */

import type { ClusterViewType } from '@/types/navigation/views';
import type { RefreshDomain } from '@/core/refresh/types';

export interface ClusterResourceDescriptor<K extends RefreshDomain = RefreshDomain, T = unknown[]> {
  resourceKey: ClusterViewType;
  domain: K;
  scopeKind: 'cluster' | 'cluster-events';
  fallback: T;
  select: (payload: any | null, clusterId?: string | null) => T | null;
  meta?: (payload: any | null) => unknown;
}

const filterByClusterId = <T extends { clusterId?: string | null }>(
  items: T[] | null | undefined,
  clusterId: string | null | undefined
): T[] | null => {
  if (!items) {
    return null;
  }
  if (!clusterId) {
    return items.filter((item) => !item.clusterId);
  }
  return items.filter((item) => item.clusterId === clusterId);
};

const kindsMeta = (payload?: { kinds?: string[] } | null) => ({ kinds: payload?.kinds ?? [] });

export const clusterResourceDescriptors = {
  rbac: {
    resourceKey: 'rbac',
    domain: 'cluster-rbac',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.resources, clusterId),
    meta: kindsMeta,
  },
  storage: {
    resourceKey: 'storage',
    domain: 'cluster-storage',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.volumes, clusterId),
  },
  config: {
    resourceKey: 'config',
    domain: 'cluster-config',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.resources, clusterId),
    meta: kindsMeta,
  },
  crds: {
    resourceKey: 'crds',
    domain: 'cluster-crds',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.definitions, clusterId),
  },
  custom: {
    resourceKey: 'custom',
    domain: 'cluster-custom',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.resources, clusterId),
    meta: kindsMeta,
  },
  events: {
    resourceKey: 'events',
    domain: 'cluster-events',
    scopeKind: 'cluster-events',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.events, clusterId),
  },
} satisfies Partial<Record<ClusterViewType, ClusterResourceDescriptor>>;
