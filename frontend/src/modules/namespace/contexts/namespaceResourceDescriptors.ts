/**
 * frontend/src/modules/namespace/contexts/namespaceResourceDescriptors.ts
 *
 * Defines the descriptor table that maps namespace resource families to their
 * refresh domains, payload selectors, row identity keys, and metadata builders.
 */

import type { NamespaceRefresherKey } from '@/core/refresh/refresherTypes';
import type {
  NamespaceAutoscalingSnapshotPayload,
  NamespaceAutoscalingSummary,
  NamespaceCustomSnapshotPayload,
  NamespaceCustomSummary,
  NamespaceHelmSnapshotPayload,
  NamespaceHelmSummary,
  RefreshDomain,
} from '@/core/refresh/types';
import {
  filterRowsForCluster,
  helmReleaseRowIdentity,
  namespacedKindRowIdentity,
  namespaceEventResourceRowIdentity,
  parseAutoscalingTarget,
  resourceKindsMeta,
  versionedNamespacedRowIdentity,
} from '@shared/resources/resourceDescriptorSelectors';

export interface NamespaceResourceDescriptor<T = any[]> {
  resourceKey: NamespaceRefresherKey;
  domain: RefreshDomain;
  fallback: T;
  select: (payload: any, clusterId?: string | null) => T;
  meta?: (payload: any) => unknown;
  rowIdentity?: (item: any, clusterId?: string | null) => string;
}

export const namespaceResourceDescriptors = {
  workloads: {
    resourceKey: 'workloads',
    domain: 'namespace-workloads',
    fallback: [],
    select: (payload, clusterId) => filterRowsForCluster(payload?.workloads, clusterId),
    meta: resourceKindsMeta,
    rowIdentity: namespacedKindRowIdentity,
  },
  config: {
    resourceKey: 'config',
    domain: 'namespace-config',
    fallback: [],
    select: (payload, clusterId) => filterRowsForCluster(payload?.resources, clusterId),
    meta: resourceKindsMeta,
  },
  network: {
    resourceKey: 'network',
    domain: 'namespace-network',
    fallback: [],
    select: (payload, clusterId) => filterRowsForCluster(payload?.resources, clusterId),
    meta: resourceKindsMeta,
  },
  rbac: {
    resourceKey: 'rbac',
    domain: 'namespace-rbac',
    fallback: [],
    select: (payload, clusterId) => filterRowsForCluster(payload?.resources, clusterId),
    meta: resourceKindsMeta,
  },
  storage: {
    resourceKey: 'storage',
    domain: 'namespace-storage',
    fallback: [],
    select: (payload, clusterId) => filterRowsForCluster(payload?.resources, clusterId),
  },
  autoscaling: {
    resourceKey: 'autoscaling',
    domain: 'namespace-autoscaling',
    fallback: [],
    select: (payload: NamespaceAutoscalingSnapshotPayload | undefined, clusterId) =>
      filterRowsForCluster(payload?.resources, clusterId).map(
        (item: NamespaceAutoscalingSummary) => {
          const scaleTargetRef = parseAutoscalingTarget(item.target, item.targetApiVersion);
          return {
            kind: item.kind,
            kindAlias: item.kind,
            name: item.name,
            namespace: item.namespace,
            clusterId: item.clusterId,
            clusterName: item.clusterName,
            scaleTargetRef,
            target: item.target,
            min: item.min,
            max: item.max,
            current: item.current,
            minReplicas: item.min,
            maxReplicas: item.max,
            currentReplicas: item.current,
            age: item.age,
          };
        }
      ),
    meta: resourceKindsMeta,
    rowIdentity: namespacedKindRowIdentity,
  },
  quotas: {
    resourceKey: 'quotas',
    domain: 'namespace-quotas',
    fallback: [],
    select: (payload, clusterId) => filterRowsForCluster(payload?.resources, clusterId),
    meta: resourceKindsMeta,
  },
  events: {
    resourceKey: 'events',
    domain: 'namespace-events',
    fallback: [],
    select: (payload, clusterId) => filterRowsForCluster(payload?.events, clusterId),
    rowIdentity: namespaceEventResourceRowIdentity,
  },
  custom: {
    resourceKey: 'custom',
    domain: 'namespace-custom',
    fallback: [],
    select: (payload: NamespaceCustomSnapshotPayload | undefined, clusterId) =>
      filterRowsForCluster(payload?.resources, clusterId).map((item: NamespaceCustomSummary) => ({
        kind: item.kind,
        kindAlias: item.kind,
        name: item.name,
        namespace: item.namespace,
        apiGroup: item.apiGroup,
        apiVersion: item.apiVersion,
        crdName: item.crdName,
        age: item.age,
        clusterId: item.clusterId,
        clusterName: item.clusterName,
        labels: item.labels,
        annotations: item.annotations,
      })),
    meta: resourceKindsMeta,
    rowIdentity: versionedNamespacedRowIdentity,
  },
  helm: {
    resourceKey: 'helm',
    domain: 'namespace-helm',
    fallback: [],
    select: (payload: NamespaceHelmSnapshotPayload | undefined, clusterId) =>
      filterRowsForCluster(payload?.releases, clusterId).map((release: NamespaceHelmSummary) => ({
        kind: 'HelmRelease',
        name: release.name,
        namespace: release.namespace,
        clusterId: release.clusterId,
        clusterName: release.clusterName,
        chart: release.chart,
        appVersion: release.appVersion,
        status: release.status,
        revision: release.revision,
        updated: release.updated,
        description: release.description,
        age: release.age,
      })),
    rowIdentity: helmReleaseRowIdentity,
  },
} satisfies Partial<Record<NamespaceRefresherKey, NamespaceResourceDescriptor>>;
