/**
 * frontend/src/core/refresh/clusterScope.test.ts
 *
 * Covers decoding of the refresh-scope cluster prefix that every scope router
 * relies on to pick its cluster.
 */

import { describe, expect, it } from 'vitest';

import { parseClusterScope } from './clusterScope';

describe('parseClusterScope', () => {
  it('splits the cluster id from the tail at the first delimiter', () => {
    expect(parseClusterScope('cluster-a|namespace:default')).toEqual({
      clusterId: 'cluster-a',
      scope: 'namespace:default',
    });
  });

  // Cluster ids are "<kubeconfig file>:<context>"; either part may contain a
  // comma, which must not split one cluster into several.
  it('keeps a comma-containing cluster id whole', () => {
    expect(parseClusterScope('prod,eu.yaml:ctx|')).toEqual({
      clusterId: 'prod,eu.yaml:ctx',
      scope: '',
    });
  });

  it('reports no cluster for an unprefixed scope', () => {
    expect(parseClusterScope('namespace:default')).toEqual({
      clusterId: '',
      scope: 'namespace:default',
    });
    expect(parseClusterScope('|namespace:default')).toEqual({
      clusterId: '',
      scope: '|namespace:default',
    });
    expect(parseClusterScope(undefined)).toEqual({ clusterId: '', scope: '' });
  });
});
