/**
 * frontend/src/shared/utils/resourceRowIdentity.ts
 *
 * Builds stable row keys for Kubernetes resource payloads. These helpers keep
 * cluster, namespace, GVK, and name identity formulas consistent across
 * refresh streams, snapshot merging, and table row stabilization.
 */

const valueOrEmpty = (value: string | null | undefined): string => value ?? '';

export const buildKindedNamespacedRowKey = (
  clusterId: string | null | undefined,
  namespace: string | null | undefined,
  kind: string | null | undefined,
  name: string | null | undefined
): string =>
  `${valueOrEmpty(clusterId)}::${valueOrEmpty(namespace)}::${valueOrEmpty(kind)}::${valueOrEmpty(name)}`;

export const buildVersionedNamespacedRowKey = (
  clusterId: string | null | undefined,
  namespace: string | null | undefined,
  group: string | null | undefined,
  version: string | null | undefined,
  kind: string | null | undefined,
  name: string | null | undefined
): string =>
  `${valueOrEmpty(clusterId)}::${valueOrEmpty(namespace)}::${valueOrEmpty(group)}::${valueOrEmpty(version)}::${valueOrEmpty(kind)}::${valueOrEmpty(name)}`;

export const buildHelmReleaseRowKey = (
  clusterId: string | null | undefined,
  namespace: string | null | undefined,
  name: string | null | undefined
): string => `${valueOrEmpty(clusterId)}::${valueOrEmpty(namespace)}::${valueOrEmpty(name)}`;

export const buildClusterNameRowKey = (
  clusterId: string | null | undefined,
  name: string | null | undefined
): string => `${valueOrEmpty(clusterId)}::${valueOrEmpty(name)}`;

export const buildCatalogResourceRowKey = (
  clusterId: string | null | undefined,
  group: string | null | undefined,
  version: string | null | undefined,
  resource: string | null | undefined,
  namespace: string | null | undefined,
  name: string | null | undefined
): string =>
  `${valueOrEmpty(clusterId)}::${valueOrEmpty(group)}::${valueOrEmpty(version)}::${valueOrEmpty(resource)}::${valueOrEmpty(namespace)}::${valueOrEmpty(name)}`;
