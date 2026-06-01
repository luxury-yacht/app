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
import {
  resourceKindsMeta,
  selectClusterRows,
} from '@shared/resources/resourceDescriptorSelectors';

export interface ClusterResourceDescriptor<K extends RefreshDomain = RefreshDomain, T = unknown[]> {
  resourceKey: ClusterViewType;
  domain: K;
  scopeKind: 'cluster' | 'cluster-events';
  fallback: T;
  select: (payload: any | null, clusterId?: string | null) => T | null;
  meta?: (payload: any | null) => unknown;
}

export const clusterResourceDescriptors = {
  rbac: {
    resourceKey: 'rbac',
    domain: 'cluster-rbac',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => selectClusterRows(payload?.resources, clusterId),
    meta: resourceKindsMeta,
  },
  storage: {
    resourceKey: 'storage',
    domain: 'cluster-storage',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => selectClusterRows(payload?.volumes, clusterId),
  },
  config: {
    resourceKey: 'config',
    domain: 'cluster-config',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => selectClusterRows(payload?.resources, clusterId),
    meta: resourceKindsMeta,
  },
  crds: {
    resourceKey: 'crds',
    domain: 'cluster-crds',
    scopeKind: 'cluster',
    fallback: [],
    select: (payload, clusterId) => selectClusterRows(payload?.definitions, clusterId),
  },
  events: {
    resourceKey: 'events',
    domain: 'cluster-events',
    scopeKind: 'cluster-events',
    fallback: [],
    select: (payload, clusterId) => selectClusterRows(payload?.events, clusterId),
  },
} satisfies Partial<Record<ClusterViewType, ClusterResourceDescriptor>>;
