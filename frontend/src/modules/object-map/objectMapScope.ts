/**
 * frontend/src/modules/object-map/objectMapScope.ts
 *
 * Scope-string builder for the object-map refresh domain. Mirrors the
 * backend parser at backend/refresh/object_scope.go and accepts optional
 * maxDepth/maxNodes overrides so a future toolbar can request larger
 * graphs without touching the modal wrapper.
 */

import { buildClusterScope, buildObjectScope } from '@core/refresh/clusterScope';

const CLUSTER_SCOPE_TOKEN = '__cluster__';

// Backend defaults from snapshot/object_map.go — kept here so the modal
// can tell the user what they're getting without round-tripping a request.
export const OBJECT_MAP_DEFAULT_DEPTH = 4;
export const OBJECT_MAP_DEFAULT_NODES = 250;
export const OBJECT_MAP_MAX_DEPTH = 12;
export const OBJECT_MAP_MAX_NODES = 1000;

export interface ObjectMapSeed {
  clusterId: string;
  group?: string | null;
  version: string;
  kind: string;
  name: string;
  namespace?: string | null;
}

export interface ObjectMapScopeOptions {
  maxDepth?: number;
  maxNodes?: number;
}

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

const formatQueryString = (options: ObjectMapScopeOptions): string => {
  const params = new URLSearchParams();
  if (typeof options.maxDepth === 'number') {
    params.set('maxDepth', String(clamp(Math.floor(options.maxDepth), 0, OBJECT_MAP_MAX_DEPTH)));
  }
  if (typeof options.maxNodes === 'number') {
    params.set('maxNodes', String(clamp(Math.floor(options.maxNodes), 1, OBJECT_MAP_MAX_NODES)));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
};

/**
 * Build the cluster-prefixed scope string for the object-map refresh
 * domain. Returns null when the seed is missing required identity fields
 * — the caller should use the constants/INACTIVE_SCOPE sentinel until a
 * full seed becomes available.
 */
export const buildObjectMapScope = (
  seed: ObjectMapSeed,
  options: ObjectMapScopeOptions = {}
): string | null => {
  const clusterId = seed.clusterId.trim();
  if (!clusterId) {
    return null;
  }
  const kind = seed.kind.trim();
  const version = seed.version.trim();
  const name = seed.name.trim();
  if (!kind || !version || !name) {
    return null;
  }

  const namespace = seed.namespace?.trim() || CLUSTER_SCOPE_TOKEN;
  const objectScope = buildObjectScope({
    namespace,
    group: seed.group ?? '',
    version,
    kind,
    name,
  });
  return buildClusterScope(clusterId, `${objectScope}${formatQueryString(options)}`);
};
