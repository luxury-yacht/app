/**
 * frontend/src/core/refresh/clusterScope.ts
 *
 * Helpers for encoding and decoding cluster-prefixed refresh scopes.
 */

const CLUSTER_SCOPE_DELIMITER = '|';

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
