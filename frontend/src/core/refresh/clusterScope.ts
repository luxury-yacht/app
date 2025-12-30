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
  if (!raw) {
    return '';
  }
  const { clusterId: existingClusterId } = splitClusterScope(raw);
  if (existingClusterId) {
    return raw;
  }
  const id = (clusterId ?? '').trim();
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
