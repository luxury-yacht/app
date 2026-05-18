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

/**
 * buildObjectScope encodes an object identity into the scope tail format
 * expected by the backend refresh-domain parseObjectScope parser. The
 * returned string does NOT include the cluster prefix — wrap it with
 * buildClusterScope when feeding it into a scoped refresh domain.
 *
 * The returned format is "namespace:group/version:kind:name". Core resources
 * use an explicit empty group, encoded as "/v1:kind:name".
 *
 * The cluster-scope sentinel "__cluster__" should be passed for the
 * namespace when the object is cluster-scoped (matches the backend's
 * clusterScopeToken constant).
 *
 * An empty group with a non-empty version encodes as "/v1:kind:name" —
 * the leading slash is load-bearing: it signals "core API" to the backend
 * parser without introducing another format.
 */
export const buildObjectScope = (args: {
  namespace: string;
  group?: string | null;
  version?: string | null;
  kind: string;
  name: string;
}): string => {
  const namespace = args.namespace.trim();
  const version = (args.version ?? '').trim();
  const kind = args.kind.trim();
  const name = args.name.trim();

  if (!version) {
    throw new Error(
      `Object scope for ${kind || 'unknown'}/${name || 'unknown'} is missing apiVersion`
    );
  }
  if (args.group === undefined || args.group === null) {
    throw new Error(
      `Object scope for ${kind || 'unknown'}/${name || 'unknown'} is missing apiGroup`
    );
  }

  const group = (args.group ?? '').trim();
  return `${namespace}:${group}/${version}:${kind}:${name}`;
};
