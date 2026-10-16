/**
 * frontend/src/modules/object-map/objectMapScope.test.ts
 *
 * Tests the namespace-level object-map scope contract.
 */

import { describe, expect, it } from 'vitest';
import { buildNamespaceObjectMapScope, OBJECT_MAP_MAX_NODES } from './objectMapScope';

describe('buildNamespaceObjectMapScope', () => {
  it('encodes a cluster-prefixed namespace map scope', () => {
    expect(buildNamespaceObjectMapScope('cluster-a', 'default', { maxNodes: 1000 })).toBe(
      'cluster-a|namespace:default?maxNodes=1000'
    );
  });

  it('clamps maxNodes to the backend cap', () => {
    expect(buildNamespaceObjectMapScope('cluster-a', 'default', { maxNodes: 5000 })).toBe(
      `cluster-a|namespace:default?maxNodes=${OBJECT_MAP_MAX_NODES}`
    );
  });

  it('returns null for namespace map scopes without cluster or namespace', () => {
    expect(buildNamespaceObjectMapScope('', 'default')).toBeNull();
    expect(buildNamespaceObjectMapScope('cluster-a', '')).toBeNull();
  });
});
