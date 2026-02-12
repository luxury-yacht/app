/**
 * frontend/src/core/refresh/refresherTypes.ts
 *
 * Type definitions for refresherTypes.
 * Defines shared interfaces and payload shapes for the core layer.
 */

import type { ClusterViewType, NamespaceViewType } from '@/types/navigation/views';

const NAMESPACE_REFRESHERS = {
  workloads: 'workloads',
  config: 'config',
  network: 'network',
  rbac: 'rbac',
  storage: 'storage',
  events: 'events',
  quotas: 'quotas',
  autoscaling: 'autoscaling',
  custom: 'custom',
  helm: 'helm',
} as const;

const CLUSTER_REFRESHERS = {
  nodes: 'cluster-nodes',
  rbac: 'cluster-rbac',
  storage: 'cluster-storage',
  config: 'cluster-config',
  crds: 'cluster-crds',
  custom: 'cluster-custom',
  events: 'cluster-events',
  browse: 'catalog',
  catalogDiff: 'catalog-diff',
} as const;

const SYSTEM_REFRESHERS = {
  namespaces: 'namespaces',
  clusterOverview: 'cluster-overview',
  unifiedPods: 'unified-pods',
  objectDetails: 'object-details',
  objectEvents: 'object-events',
  objectYaml: 'object-yaml',
  objectHelmManifest: 'object-helm-manifest',
  objectHelmValues: 'object-helm-values',
  objectLogs: 'object-logs',
  objectMaintenance: 'object-maintenance',
} as const;

type ValueOf<T> = T[keyof T];

type NamespaceRefreshersRecord = typeof NAMESPACE_REFRESHERS;
type ClusterRefreshersRecord = typeof CLUSTER_REFRESHERS;
type SystemRefreshersRecord = typeof SYSTEM_REFRESHERS;

export type NamespaceRefresherKey = keyof NamespaceRefreshersRecord;

export type NamespaceRefresherName = ValueOf<NamespaceRefreshersRecord>;
export type ClusterRefresherName = ValueOf<ClusterRefreshersRecord>;
export type SystemRefresherName = ValueOf<SystemRefreshersRecord>;

export type ObjectDetailsRefresherName = `object-${string}`;
export type ObjectEventsRefresherName = `object-${string}-events`;
export type ObjectYamlRefresherName = 'object-yaml';
export type ObjectHelmManifestRefresherName = 'object-helm-manifest';
export type ObjectHelmValuesRefresherName = 'object-helm-values';
export type ObjectRefresherName =
  | ObjectDetailsRefresherName
  | ObjectEventsRefresherName
  | ObjectYamlRefresherName
  | ObjectHelmManifestRefresherName
  | ObjectHelmValuesRefresherName;

export type StaticRefresherName =
  | NamespaceRefresherName
  | ClusterRefresherName
  | SystemRefresherName;

export type RefresherName = StaticRefresherName | ObjectRefresherName;

export const namespaceViewToRefresher: Record<NamespaceViewType, NamespaceRefresherName | null> = {
  browse: null,
  pods: null,
  workloads: NAMESPACE_REFRESHERS.workloads,
  config: NAMESPACE_REFRESHERS.config,
  network: NAMESPACE_REFRESHERS.network,
  rbac: NAMESPACE_REFRESHERS.rbac,
  storage: NAMESPACE_REFRESHERS.storage,
  autoscaling: NAMESPACE_REFRESHERS.autoscaling,
  quotas: NAMESPACE_REFRESHERS.quotas,
  custom: NAMESPACE_REFRESHERS.custom,
  helm: NAMESPACE_REFRESHERS.helm,
  events: NAMESPACE_REFRESHERS.events,
};

export const clusterViewToRefresher: Record<ClusterViewType, ClusterRefresherName | null> = {
  nodes: CLUSTER_REFRESHERS.nodes,
  rbac: CLUSTER_REFRESHERS.rbac,
  storage: CLUSTER_REFRESHERS.storage,
  config: CLUSTER_REFRESHERS.config,
  crds: CLUSTER_REFRESHERS.crds,
  custom: CLUSTER_REFRESHERS.custom,
  events: CLUSTER_REFRESHERS.events,
  browse: CLUSTER_REFRESHERS.browse,
};

export { NAMESPACE_REFRESHERS, CLUSTER_REFRESHERS, SYSTEM_REFRESHERS };
