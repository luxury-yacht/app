import { describe, expect, it } from 'vitest';

import { assertObjectRefHasRequiredIdentity } from './view-state';

describe('assertObjectRefHasRequiredIdentity', () => {
  it('accepts complete core built-in refs with an explicit empty group', () => {
    expect(() =>
      assertObjectRefHasRequiredIdentity({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'api',
      })
    ).not.toThrow();
  });

  it('requires the group field even when the group is empty for core built-ins', () => {
    expect(() =>
      assertObjectRefHasRequiredIdentity({
        clusterId: 'cluster-a',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'api',
      })
    ).toThrow(/missing group/);
  });

  it('rejects custom-resource refs with version but no group', () => {
    expect(() =>
      assertObjectRefHasRequiredIdentity({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1alpha1',
        kind: 'DBInstance',
        namespace: 'default',
        name: 'primary',
      })
    ).toThrow(/missing group/);
  });

  it('requires concrete object identity fields before opening a panel', () => {
    expect(() =>
      assertObjectRefHasRequiredIdentity({
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'api',
      })
    ).toThrow(/clusterId/);

    expect(() =>
      assertObjectRefHasRequiredIdentity({
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
      })
    ).toThrow(/name/);
  });

  it('requires synthetic refs to carry canonical group/version identity', () => {
    expect(() =>
      assertObjectRefHasRequiredIdentity({
        clusterId: 'cluster-a',
        kind: 'HelmRelease',
        namespace: 'default',
        name: 'demo',
      })
    ).toThrow(/missing version/);

    expect(() =>
      assertObjectRefHasRequiredIdentity({
        clusterId: 'cluster-a',
        group: 'helm.sh',
        version: 'v3',
        kind: 'HelmRelease',
        namespace: 'default',
        name: 'demo',
      })
    ).not.toThrow();
  });
});
