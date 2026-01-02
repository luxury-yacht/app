/**
 * frontend/src/core/refresh/clusterScope.test.ts
 *
 * Test suite for clusterScope helpers.
 * Covers multi-cluster prefix encoding and decoding behaviors.
 */

import { describe, expect, it } from 'vitest';

import {
  buildClusterScope,
  buildClusterScopeList,
  parseClusterScope,
  stripClusterScope,
} from './clusterScope';

describe('clusterScope helpers', () => {
  it('prefixes scope with a single cluster id when missing', () => {
    // Single-cluster scopes should preserve the plain cluster prefix format.
    expect(buildClusterScope('cluster-a', 'namespace:default')).toBe('cluster-a|namespace:default');
  });

  it('preserves existing cluster prefixes when present', () => {
    // If a cluster is already encoded, do not re-prefix with a different id.
    expect(buildClusterScope('cluster-b', 'cluster-a|namespace:default')).toBe(
      'cluster-a|namespace:default'
    );
  });

  it('strips cluster prefixes from scoped values', () => {
    // Diagnostics should render the scope portion without the cluster id.
    expect(stripClusterScope('cluster-a|namespace:default')).toBe('namespace:default');
    expect(stripClusterScope('namespace:default')).toBe('namespace:default');
  });

  it('builds multi-cluster scopes with a cluster list prefix', () => {
    // Cluster lists should dedupe ids and preserve ordering.
    const scope = buildClusterScopeList(['cluster-a', 'cluster-a', ' cluster-b '], 'limit=25');
    expect(scope).toBe('clusters=cluster-a,cluster-b|limit=25');
  });

  it('keeps single-cluster lists in the short prefix form', () => {
    // Single-cluster lists should still use the short prefix form.
    expect(buildClusterScopeList(['cluster-a'], 'limit=50')).toBe('cluster-a|limit=50');
    expect(buildClusterScopeList(['cluster-a'], '')).toBe('cluster-a|');
  });

  it('does not re-prefix scopes that already include a cluster', () => {
    // When scopes already include a cluster id, keep them untouched.
    expect(buildClusterScopeList(['cluster-b'], 'cluster-a|namespace:default')).toBe(
      'cluster-a|namespace:default'
    );
  });

  it('parses single-cluster scopes with a delimiter', () => {
    const parsed = parseClusterScope('cluster-a|namespace:default');
    expect(parsed).toEqual({
      clusterId: 'cluster-a',
      scope: 'namespace:default',
      isMultiCluster: false,
    });
  });

  it('parses multi-cluster scopes and reports multi-cluster state', () => {
    const parsed = parseClusterScope('clusters=cluster-a,cluster-b|namespace:default');
    expect(parsed).toEqual({
      clusterId: '',
      scope: 'namespace:default',
      isMultiCluster: true,
    });
  });

  it('parses single-cluster lists as a single cluster', () => {
    const parsed = parseClusterScope('clusters=cluster-a|');
    expect(parsed).toEqual({
      clusterId: 'cluster-a',
      scope: '',
      isMultiCluster: false,
    });
  });
});
