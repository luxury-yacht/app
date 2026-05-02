import { describe, expect, it } from 'vitest';
import { buildObjectMapScope, OBJECT_MAP_MAX_DEPTH, OBJECT_MAP_MAX_NODES } from './objectMapScope';

describe('buildObjectMapScope', () => {
  it('encodes a namespaced object with default depth/nodes (no query string)', () => {
    const scope = buildObjectMapScope({
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      name: 'web',
      namespace: 'default',
    });
    expect(scope).toBe('cluster-a|default:apps/v1:Deployment:web');
  });

  it('encodes a core/v1 object with the leading-slash form the backend expects', () => {
    const scope = buildObjectMapScope({
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Service',
      name: 'web',
      namespace: 'default',
    });
    expect(scope).toBe('cluster-a|default:/v1:Service:web');
  });

  it('uses the cluster-scope sentinel when namespace is empty', () => {
    const scope = buildObjectMapScope({
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Node',
      name: 'node-1',
    });
    expect(scope).toBe('cluster-a|__cluster__:/v1:Node:node-1');
  });

  it('appends maxDepth and maxNodes when provided', () => {
    const scope = buildObjectMapScope(
      {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Service',
        name: 'web',
        namespace: 'default',
      },
      { maxDepth: 6, maxNodes: 500 }
    );
    expect(scope).toBe('cluster-a|default:/v1:Service:web?maxDepth=6&maxNodes=500');
  });

  it('clamps maxDepth and maxNodes to the backend caps', () => {
    const scope = buildObjectMapScope(
      {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Service',
        name: 'web',
        namespace: 'default',
      },
      { maxDepth: 99, maxNodes: 99999 }
    );
    expect(scope).toBe(
      `cluster-a|default:/v1:Service:web?maxDepth=${OBJECT_MAP_MAX_DEPTH}&maxNodes=${OBJECT_MAP_MAX_NODES}`
    );
  });

  it('returns null when required identity fields are missing', () => {
    expect(
      buildObjectMapScope({ clusterId: '', version: 'v1', kind: 'Pod', name: 'p' })
    ).toBeNull();
    expect(buildObjectMapScope({ clusterId: 'c', version: '', kind: 'Pod', name: 'p' })).toBeNull();
    expect(buildObjectMapScope({ clusterId: 'c', version: 'v1', kind: '', name: 'p' })).toBeNull();
    expect(
      buildObjectMapScope({ clusterId: 'c', version: 'v1', kind: 'Pod', name: '' })
    ).toBeNull();
  });
});
