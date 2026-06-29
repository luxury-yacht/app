import { describe, expect, it } from 'vitest';

import { resolveResourceMetricsScope } from './scope';

describe('resolveResourceMetricsScope', () => {
  it('routes Pod metrics to the cluster-prefixed namespace pod metrics scope', () => {
    expect(
      resolveResourceMetricsScope({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'team-a',
        name: 'api-7c9d',
      })
    ).toMatchObject({
      kind: 'domain',
      source: 'pods',
      domain: 'pods-metrics',
      scope: 'cluster-a|namespace:team-a',
      baseDomain: 'pods',
      baseScope: 'cluster-a|namespace:team-a',
    });
  });

  it('routes Deployment metrics to namespace-workloads metrics in the object cluster', () => {
    expect(
      resolveResourceMetricsScope({
        clusterId: 'cluster-b',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'team-b',
        name: 'api',
      })
    ).toMatchObject({
      kind: 'domain',
      source: 'namespace-workloads',
      domain: 'namespace-workloads-metrics',
      scope: 'cluster-b|namespace:team-b',
      baseDomain: 'namespace-workloads',
      baseScope: 'cluster-b|namespace:team-b',
    });
  });

  it('routes Node metrics to the cluster nodes scope', () => {
    expect(
      resolveResourceMetricsScope({
        clusterId: 'cluster-c',
        group: '',
        version: 'v1',
        kind: 'Node',
        name: 'ip-10-0-0-1',
      })
    ).toMatchObject({
      kind: 'domain',
      source: 'nodes',
      domain: 'nodes-metrics',
      scope: 'cluster-c|',
      baseDomain: 'nodes',
      baseScope: 'cluster-c|',
    });
  });

  it('keeps ReplicaSet as a detail DTO exception instead of routing through pods workload scope', () => {
    expect(
      resolveResourceMetricsScope({
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'ReplicaSet',
        namespace: 'team-a',
        name: 'api-7c9d',
      })
    ).toEqual({
      kind: 'detail-exception',
      source: 'detail-replicaset',
      reason: 'replicaset-owner-collapse',
    });
  });

  it('returns an invalid resolution when clusterId is missing', () => {
    const resolved = resolveResourceMetricsScope({
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api-7c9d',
    });

    expect(resolved).toMatchObject({
      kind: 'invalid',
      error: expect.stringContaining('clusterId'),
    });
  });
});
