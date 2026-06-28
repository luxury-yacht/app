/**
 * frontend/src/shared/resources/resourceDescriptorSelectors.ts
 *
 * Shared descriptor helpers for refresh-backed resource views: cluster
 * filtering, metadata extraction, and stable row identity builders.
 */

import {
  buildHelmReleaseRowKey,
  buildKindedNamespacedRowKey,
  buildVersionedNamespacedRowKey,
} from '@shared/utils/resourceRowIdentity';

export const filterRowsForCluster = <T extends { clusterId?: string | null }>(
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

export const selectClusterRows = <T extends { clusterId?: string | null }>(
  items: T[] | null | undefined,
  clusterId?: string | null
): T[] | null => {
  if (!items) {
    return null;
  }
  return filterRowsForCluster(items, clusterId);
};

export const resourceKindsMeta = (payload?: { kinds?: string[] } | null) => ({
  kinds: payload?.kinds ?? [],
});

export const namespacedKindRowIdentity = (
  item: { clusterId?: string | null; namespace: string; kind: string; name: string },
  clusterId?: string | null
): string =>
  buildKindedNamespacedRowKey(item.clusterId ?? clusterId, item.namespace, item.kind, item.name);

export const versionedNamespacedRowIdentity = (
  item: {
    clusterId?: string | null;
    namespace: string;
    group: string;
    version: string;
    kind: string;
    name: string;
  },
  clusterId?: string | null
): string =>
  buildVersionedNamespacedRowKey(
    item.clusterId ?? clusterId,
    item.namespace,
    item.group,
    item.version,
    item.kind,
    item.name
  );

export const helmReleaseRowIdentity = (
  release: { clusterId?: string | null; namespace: string; name: string },
  clusterId?: string | null
): string =>
  buildHelmReleaseRowKey(release.clusterId ?? clusterId, release.namespace, release.name);

export const namespaceEventResourceRowIdentity = (
  item: {
    clusterId?: string | null;
    objectNamespace?: string | null;
    namespace?: string | null;
    uid?: string | null;
    name?: string | null;
    object?: string | null;
    source?: string | null;
    reason?: string | null;
    type?: string | null;
  },
  clusterId?: string | null
): string =>
  `${item.clusterId ?? clusterId ?? ''}::${item.objectNamespace ?? item.namespace ?? ''}::${
    item.uid ||
    item.name ||
    `${item.object ?? ''}:${item.source ?? ''}:${item.reason ?? ''}:${item.type ?? ''}`
  }`;

export const parseAutoscalingTarget = (
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
