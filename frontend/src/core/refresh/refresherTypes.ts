/**
 * frontend/src/core/refresh/refresherTypes.ts
 *
 * Type definitions for refresherTypes.
 * Defines shared interfaces and payload shapes for the core layer.
 */

import {
  CLUSTER_VIEW_DESCRIPTORS,
  NAMESPACE_VIEW_DESCRIPTORS,
} from '@/core/navigation/viewRegistry';
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
  attention: 'cluster-attention',
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
  objectMap: 'object-map',
  containerLogs: 'container-logs',
  objectMaintenance: 'object-maintenance',
} as const;

type ValueOf<T> = T[keyof T];

type NamespaceRefreshersRecord = typeof NAMESPACE_REFRESHERS;
type ClusterRefreshersRecord = typeof CLUSTER_REFRESHERS;
type SystemRefreshersRecord = typeof SYSTEM_REFRESHERS;

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

export const namespaceViewToRefresher = Object.fromEntries(
  NAMESPACE_VIEW_DESCRIPTORS.map(({ id, refresher }) => [id, refresher])
) as Record<NamespaceViewType, NamespaceRefresherName | null>;

export const clusterViewToRefresher = Object.fromEntries(
  CLUSTER_VIEW_DESCRIPTORS.map(({ id, refresher }) => [id, refresher])
) as Record<ClusterViewType, ClusterRefresherName | null>;

export { CLUSTER_REFRESHERS, NAMESPACE_REFRESHERS, SYSTEM_REFRESHERS };
