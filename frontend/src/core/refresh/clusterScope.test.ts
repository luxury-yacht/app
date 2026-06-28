/**
 * frontend/src/core/refresh/clusterScope.test.ts
 *
 * Test suite for clusterScope helpers.
 * Covers single-cluster prefix encoding and cluster-list decoding behaviors.
 */

import { describe, expect, it } from 'vitest';

import {
  buildObjectScope,
  buildClusterScope,
  parseClusterScopeList,
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

  it('adds a cluster prefix when scope is empty', () => {
    expect(buildClusterScope('cluster-a', '')).toBe('cluster-a|');
    expect(buildClusterScope('cluster-a', null)).toBe('cluster-a|');
    expect(buildClusterScope('', '')).toBe('');
  });

  it('strips cluster prefixes from scoped values', () => {
    // Diagnostics should render the scope portion without the cluster id.
    expect(stripClusterScope('cluster-a|namespace:default')).toBe('namespace:default');
    expect(stripClusterScope('namespace:default')).toBe('namespace:default');
  });

  it('does not re-prefix scopes that already include a cluster', () => {
    // When scopes already include a cluster id, keep them untouched.
    expect(buildClusterScope('cluster-b', 'cluster-a|namespace:default')).toBe(
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

  it('parses cluster scope lists with multiple clusters', () => {
    const parsed = parseClusterScopeList('clusters=cluster-a,cluster-b|namespace:default');
    expect(parsed).toEqual({
      clusterIds: ['cluster-a', 'cluster-b'],
      scope: 'namespace:default',
      isMultiCluster: true,
    });
  });

  it('parses single-cluster scope lists', () => {
    const parsed = parseClusterScopeList('clusters=cluster-a|');
    expect(parsed).toEqual({
      clusterIds: ['cluster-a'],
      scope: '',
      isMultiCluster: false,
    });
  });

  it('parses cluster-prefixed scopes into a single cluster list', () => {
    const parsed = parseClusterScopeList('cluster-a|namespace:default');
    expect(parsed).toEqual({
      clusterIds: ['cluster-a'],
      scope: 'namespace:default',
      isMultiCluster: false,
    });
  });

  it('returns empty cluster lists when no prefix is present', () => {
    const parsed = parseClusterScopeList('namespace:default');
    expect(parsed).toEqual({
      clusterIds: [],
      scope: 'namespace:default',
      isMultiCluster: false,
    });
  });

  it('builds object scopes with full GVK identity', () => {
    expect(
      buildObjectScope({
        namespace: 'team-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        name: 'api',
      })
    ).toBe('team-a:/v1:Pod:api');
  });

  it('rejects object scopes missing version', () => {
    expect(() =>
      buildObjectScope({
        namespace: 'team-a',
        group: '',
        kind: 'Pod',
        name: 'api',
      })
    ).toThrow(/missing version/);
  });

  it('rejects object scopes missing group', () => {
    expect(() =>
      buildObjectScope({
        namespace: 'team-a',
        version: 'v1',
        kind: 'Pod',
        name: 'api',
      })
    ).toThrow(/missing group/);
  });
});
