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
  buildHelmReleaseRowKey,
  buildKindedNamespacedRowKey,
  buildVersionedNamespacedRowKey,
} from '@shared/utils/resourceRowIdentity';

export interface NamespaceResourceDescriptor<T = any[]> {
  resourceKey: NamespaceRefresherKey;
  domain: RefreshDomain;
  fallback: T;
  select: (payload: any, clusterId?: string | null) => T;
  meta?: (payload: any) => unknown;
  rowIdentity?: (item: any, clusterId?: string | null) => string;
}

const filterByClusterId = <T extends { clusterId?: string | null }>(
  items: T[] | null | undefined,
  clusterId?: string | null
): T[] => {
  if (!items || items.length === 0) {
    return [];
  }
  if (!clusterId) {
    return items.filter((item) => !item.clusterId);
  }
  return items.filter((item) => item.clusterId === clusterId);
};

const kindsMeta = (payload?: { kinds?: string[] }) => ({ kinds: payload?.kinds ?? [] });

const resourceRowIdentity = (item: any, clusterId?: string | null) =>
  buildKindedNamespacedRowKey(item.clusterId ?? clusterId, item.namespace, item.kind, item.name);

const parseAutoscalingTarget = (
  target?: string | null,
  apiVersion?: string | null
): { kind: string; name: string; apiVersion?: string } | undefined => {
  if (!target) {
    return undefined;
  }

  const [kindPart, ...nameParts] = target.split('/');
  if (!kindPart || nameParts.length === 0) {
    return undefined;
  }

  return {
    kind: kindPart,
    name: nameParts.join('/'),
    apiVersion: apiVersion ?? undefined,
  };
};

export const namespaceResourceDescriptors = {
  workloads: {
    resourceKey: 'workloads',
    domain: 'namespace-workloads',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.workloads, clusterId),
    meta: kindsMeta,
    rowIdentity: resourceRowIdentity,
  },
  config: {
    resourceKey: 'config',
    domain: 'namespace-config',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.resources, clusterId),
    meta: kindsMeta,
  },
  network: {
    resourceKey: 'network',
    domain: 'namespace-network',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.resources, clusterId),
    meta: kindsMeta,
  },
  rbac: {
    resourceKey: 'rbac',
    domain: 'namespace-rbac',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.resources, clusterId),
    meta: kindsMeta,
  },
  storage: {
    resourceKey: 'storage',
    domain: 'namespace-storage',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.resources, clusterId),
  },
  autoscaling: {
    resourceKey: 'autoscaling',
    domain: 'namespace-autoscaling',
    fallback: [],
    select: (payload: NamespaceAutoscalingSnapshotPayload | undefined, clusterId) =>
      filterByClusterId(payload?.resources, clusterId).map((item: NamespaceAutoscalingSummary) => {
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
      }),
    meta: kindsMeta,
    rowIdentity: resourceRowIdentity,
  },
  quotas: {
    resourceKey: 'quotas',
    domain: 'namespace-quotas',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.resources, clusterId),
    meta: kindsMeta,
  },
  events: {
    resourceKey: 'events',
    domain: 'namespace-events',
    fallback: [],
    select: (payload, clusterId) => filterByClusterId(payload?.events, clusterId),
    rowIdentity: (item, clusterId) =>
      `${item.clusterId ?? clusterId ?? ''}::${item.objectNamespace ?? item.namespace ?? ''}::${item.uid || item.name || `${item.object ?? ''}:${item.source ?? ''}:${item.reason ?? ''}:${item.type ?? ''}`}`,
  },
  custom: {
    resourceKey: 'custom',
    domain: 'namespace-custom',
    fallback: [],
    select: (payload: NamespaceCustomSnapshotPayload | undefined, clusterId) =>
      filterByClusterId(payload?.resources, clusterId).map((item: NamespaceCustomSummary) => ({
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
    meta: kindsMeta,
    rowIdentity: (item, clusterId) =>
      buildVersionedNamespacedRowKey(
        item.clusterId ?? clusterId,
        item.namespace,
        item.apiGroup,
        item.apiVersion,
        item.kind,
        item.name
      ),
  },
  helm: {
    resourceKey: 'helm',
    domain: 'namespace-helm',
    fallback: [],
    select: (payload: NamespaceHelmSnapshotPayload | undefined, clusterId) =>
      filterByClusterId(payload?.releases, clusterId).map((release: NamespaceHelmSummary) => ({
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
    rowIdentity: (release, clusterId) =>
      buildHelmReleaseRowKey(release.clusterId ?? clusterId, release.namespace, release.name),
  },
} satisfies Partial<Record<NamespaceRefresherKey, NamespaceResourceDescriptor>>;
