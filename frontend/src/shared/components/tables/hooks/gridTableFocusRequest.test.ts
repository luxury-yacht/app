import { describe, expect, it } from 'vitest';

import { buildGridTableFocusRequest, matchesGridTableFocusRequest } from './gridTableFocusRequest';

describe('buildGridTableFocusRequest', () => {
  it('builds a canonical row-key-backed focus request for real Kubernetes objects', () => {
    expect(
      buildGridTableFocusRequest({
        kind: 'Deployment',
        name: 'api',
        namespace: 'apps',
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
      })
    ).toEqual({
      kind: 'Deployment',
      name: 'api',
      namespace: 'apps',
      clusterId: 'cluster-a',
      rowKey: 'cluster-a|apps/v1/Deployment/apps/api',
    });
  });

  it('falls back to field-based matching for synthetic kinds without a real GVK', () => {
    expect(
      buildGridTableFocusRequest({
        kind: 'HelmRelease',
        name: 'demo',
        namespace: 'apps',
        clusterId: 'cluster-a',
      })
    ).toEqual({
      kind: 'HelmRelease',
      name: 'demo',
      namespace: 'apps',
      clusterId: 'cluster-a',
      rowKey: undefined,
    });
  });
});

describe('matchesGridTableFocusRequest', () => {
  it('prefers row-key matching when a canonical row key is available', () => {
    const request = buildGridTableFocusRequest({
      kind: 'Deployment',
      name: 'api',
      namespace: 'apps',
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
    });

    expect(request).not.toBeNull();
    expect(
      matchesGridTableFocusRequest(
        { kind: 'Deployment', name: 'wrong-name', namespace: 'apps', clusterId: 'cluster-a' },
        0,
        () => 'cluster-a|apps/v1/Deployment/apps/api',
        request!
      )
    ).toBe(true);
  });

  it('falls back to field matching when no canonical row key is available', () => {
    const request = buildGridTableFocusRequest({
      kind: 'HelmRelease',
      name: 'demo',
      namespace: 'apps',
      clusterId: 'cluster-a',
    });

    expect(request).not.toBeNull();
    expect(
      matchesGridTableFocusRequest(
        { kind: 'HelmRelease', name: 'demo', namespace: 'apps', clusterId: 'cluster-a' },
        0,
        () => 'some-synthetic-key',
        request!
      )
    ).toBe(true);
  });
});
