/**
 * frontend/src/core/refresh/clusterScope.ts
 *
 * Helpers for encoding and decoding cluster-prefixed refresh scopes.
 */

const CLUSTER_SCOPE_DELIMITER = '|';

const CLUSTER_SCOPE_LIST_PREFIX = 'clusters=';

const splitClusterScope = (value: string): { clusterId: string; scope: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { clusterId: '', scope: '' };
  }
  const delimiterIndex = trimmed.indexOf(CLUSTER_SCOPE_DELIMITER);
  if (delimiterIndex <= 0) {
    return { clusterId: '', scope: trimmed };
  }
  return {
    clusterId: trimmed.slice(0, delimiterIndex).trim(),
    scope: trimmed.slice(delimiterIndex + 1).trim(),
  };
};

// buildClusterScope prefixes scope with cluster identity for stable keying.
export const buildClusterScope = (clusterId: string | undefined, scope?: string | null): string => {
  const raw = (scope ?? '').trim();
  const { clusterId: existingClusterId } = splitClusterScope(raw);
  if (existingClusterId) {
    return raw;
  }
  const id = (clusterId ?? '').trim();
  if (!raw) {
    return id ? `${id}${CLUSTER_SCOPE_DELIMITER}` : '';
  }
  if (!id) {
    return raw;
  }
  return `${id}${CLUSTER_SCOPE_DELIMITER}${raw}`;
};

// stripClusterScope removes the cluster prefix from a scope string when present.
export const stripClusterScope = (scope?: string | null): string => {
  if (!scope) {
    return '';
  }
  return splitClusterScope(scope).scope;
};

export const parseClusterScope = (
  value?: string | null
): { clusterId: string; scope: string; isMultiCluster: boolean } => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return { clusterId: '', scope: '', isMultiCluster: false };
  }
  const { clusterId, scope } = splitClusterScope(trimmed);
  if (!clusterId) {
    return { clusterId: '', scope, isMultiCluster: false };
  }
  if (!clusterId.startsWith(CLUSTER_SCOPE_LIST_PREFIX)) {
    return { clusterId, scope, isMultiCluster: false };
  }
  const rawList = clusterId.slice(CLUSTER_SCOPE_LIST_PREFIX.length);
  const ids = rawList
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 1) {
    return { clusterId: ids[0], scope, isMultiCluster: false };
  }
  return { clusterId: '', scope, isMultiCluster: true };
};

const normalizeClusterIds = (clusterIds: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  clusterIds.forEach((id) => {
    const trimmed = (id ?? '').trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    cleaned.push(trimmed);
  });
  return cleaned;
};

const parseClusterIdList = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const rawList = trimmed.startsWith(CLUSTER_SCOPE_LIST_PREFIX)
    ? trimmed.slice(CLUSTER_SCOPE_LIST_PREFIX.length)
    : trimmed;
  return normalizeClusterIds(rawList.split(','));
};

// parseClusterScopeList extracts the cluster list from a scope prefix.
export const parseClusterScopeList = (
  value?: string | null
): { clusterIds: string[]; scope: string; isMultiCluster: boolean } => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return { clusterIds: [], scope: '', isMultiCluster: false };
  }
  const { clusterId, scope } = splitClusterScope(trimmed);
  if (!clusterId) {
    return { clusterIds: [], scope, isMultiCluster: false };
  }
  const clusterIds = parseClusterIdList(clusterId);
  if (clusterIds.length <= 1) {
    return { clusterIds, scope, isMultiCluster: false };
  }
  return { clusterIds, scope, isMultiCluster: true };
};

// buildClusterScopeList prefixes scope with a list of cluster IDs for multi-cluster refreshes.
export const buildClusterScopeList = (
  clusterIds: Array<string | null | undefined>,
  scope?: string | null
): string => {
  const raw = (scope ?? '').trim();
  if (raw) {
    const { clusterId: existingClusterId } = splitClusterScope(raw);
    if (existingClusterId) {
      return raw;
    }
  }

  const ids = normalizeClusterIds(clusterIds);
  if (ids.length === 0) {
    return raw;
  }

  const clusterToken = ids.length === 1 ? ids[0] : `${CLUSTER_SCOPE_LIST_PREFIX}${ids.join(',')}`;

  if (!raw) {
    return `${clusterToken}${CLUSTER_SCOPE_DELIMITER}`;
  }

  return `${clusterToken}${CLUSTER_SCOPE_DELIMITER}${raw}`;
};
