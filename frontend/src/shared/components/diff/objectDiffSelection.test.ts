import { describe, expect, it } from 'vitest';

import { buildObjectDiffSelection } from './objectDiffSelection';

describe('buildObjectDiffSelection', () => {
  it('preserves the shared object identity backbone for generic diff workflows', () => {
    expect(
      buildObjectDiffSelection({
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        namespace: 'apps',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'api',
        resource: 'deployments',
        uid: 'deploy-uid',
      })
    ).toEqual({
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
      namespace: 'apps',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      name: 'api',
      resource: 'deployments',
      uid: 'deploy-uid',
    });
  });

  it('returns null when the selection cannot participate in diff workflows', () => {
    expect(
      buildObjectDiffSelection({
        kind: 'Deployment',
        name: 'api',
        namespace: 'apps',
      })
    ).toBeNull();
  });
});
