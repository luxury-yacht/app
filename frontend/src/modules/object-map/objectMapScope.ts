/**
 * frontend/src/modules/object-map/objectMapScope.ts
 *
 * Scope-string builder for namespace-level object maps. Object maps opened from
 * the object panel use the panel's object scope (getObjectPanelScopes). The
 * backend parser is parseObjectMapScope in backend/refresh/snapshot/object_map.go.
 */

import { buildRefreshScope } from '@core/refresh/scopeSelector';

export const OBJECT_MAP_MAX_NODES = 1000;

export interface ObjectMapScopeOptions {
  maxNodes?: number;
}

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

const formatQuery = (options: ObjectMapScopeOptions): string => {
  if (typeof options.maxNodes !== 'number') {
    return '';
  }
  return `maxNodes=${clamp(Math.floor(options.maxNodes), 1, OBJECT_MAP_MAX_NODES)}`;
};

export const buildNamespaceObjectMapScope = (
  clusterId: string | null | undefined,
  namespace: string | null | undefined,
  options: ObjectMapScopeOptions = {}
): string | null => {
  const id = clusterId?.trim();
  const name = namespace?.trim();
  if (!id || !name) {
    return null;
  }
  return buildRefreshScope('object-map', {
    clusterId: id,
    selector: { kind: 'namespace', namespace: name },
    query: formatQuery(options),
  });
};
