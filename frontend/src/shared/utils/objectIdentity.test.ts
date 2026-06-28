import { describe, expect, it } from 'vitest';

import {
  buildCanonicalObjectRowKey,
  buildObjectReference,
  buildRelatedObjectReference,
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  buildRequiredRelatedObjectReference,
  buildSyntheticObjectReference,
} from './objectIdentity';

describe('objectIdentity', () => {
  it('builds a canonical object reference for built-in kinds', () => {
    expect(
      buildObjectReference({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
      })
    ).toEqual({
      kind: 'Pod',
      kindAlias: undefined,
      name: 'api',
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
      clusterName: undefined,
      group: '',
      version: 'v1',
      resource: undefined,
      uid: undefined,
    });
  });

  it('preserves explicit group/version for custom resources', () => {
    expect(
      buildObjectReference({
        kind: 'DBInstance',
        name: 'db-a',
        namespace: 'ops',
        clusterId: 'alpha:ctx',
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
      })
    ).toEqual(
      expect.objectContaining({
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
      })
    );
  });

  it('builds canonical row keys from GVKNN identity', () => {
    expect(
      buildCanonicalObjectRowKey({
        kind: 'DBInstance',
        name: 'db-a',
        namespace: 'ops',
        clusterId: 'alpha:ctx',
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
      })
    ).toBe('alpha:ctx|rds.services.k8s.aws/v1alpha1/DBInstance/ops/db-a');
  });

  it('requires clusterId for strict object references', () => {
    expect(() =>
      buildRequiredObjectReference({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
      })
    ).toThrow(/clusterId/);
  });

  it('uses a fallback clusterId for strict object references', () => {
    expect(
      buildRequiredObjectReference(
        {
          kind: 'Pod',
          name: 'api',
          namespace: 'team-a',
        },
        { fallbackClusterId: 'alpha:ctx' }
      )
    ).toEqual(
      expect.objectContaining({
        kind: 'Pod',
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
      })
    );
  });

  it('builds strict canonical row keys with a required clusterId', () => {
    expect(
      buildRequiredCanonicalObjectRowKey({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
      })
    ).toBe('alpha:ctx|/v1/Pod/team-a/api');
  });

  it('throws when a custom resource omits version', () => {
    expect(() =>
      buildObjectReference({
        kind: 'DBInstance',
        name: 'db-a',
        namespace: 'ops',
        clusterId: 'alpha:ctx',
      })
    ).toThrow(/missing version/);
  });

  it('throws when a custom resource has version but omits group', () => {
    expect(() =>
      buildObjectReference({
        kind: 'DBInstance',
        name: 'db-a',
        namespace: 'ops',
        clusterId: 'alpha:ctx',
        version: 'v1alpha1',
      })
    ).toThrow(/missing group/);
  });

  it('carries non-identity extras through real object references', () => {
    expect(
      buildObjectReference(
        {
          kind: 'Pod',
          name: 'api',
          namespace: 'team-a',
          clusterId: 'alpha:ctx',
        },
        { portForwardAvailable: true }
      )
    ).toEqual(
      expect.objectContaining({
        kind: 'Pod',
        group: '',
        version: 'v1',
        portForwardAvailable: true,
      })
    );
  });

  it('builds related-object references from explicit apiVersion', () => {
    expect(
      buildRelatedObjectReference({
        kind: 'HorizontalPodAutoscaler',
        name: 'web',
        namespace: 'apps',
        clusterId: 'alpha:ctx',
        apiVersion: 'autoscaling/v2',
      })
    ).toEqual(
      expect.objectContaining({
        group: 'autoscaling',
        version: 'v2',
      })
    );
  });

  it('falls back to built-in GVK when related-object apiVersion is omitted', () => {
    expect(
      buildRelatedObjectReference({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
      })
    ).toEqual(
      expect.objectContaining({
        group: '',
        version: 'v1',
      })
    );
  });

  it('requires clusterId for strict related-object references', () => {
    expect(() =>
      buildRequiredRelatedObjectReference({
        kind: 'Deployment',
        name: 'api',
        namespace: 'team-a',
      })
    ).toThrow(/clusterId/);
  });

  it('uses fallback clusterId and explicit apiVersion for strict related-object references', () => {
    expect(
      buildRequiredRelatedObjectReference(
        {
          kind: 'DBInstance',
          name: 'db-a',
          namespace: 'ops',
          apiVersion: 'rds.services.k8s.aws/v1alpha1',
        },
        { fallbackClusterId: 'alpha:ctx' }
      )
    ).toEqual(
      expect.objectContaining({
        kind: 'DBInstance',
        clusterId: 'alpha:ctx',
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
      })
    );
  });

  it('builds Helm synthetic references with canonical identity', () => {
    expect(
      buildSyntheticObjectReference(
        {
          kind: 'HelmRelease',
          name: 'demo',
          namespace: 'default',
          clusterId: 'alpha:ctx',
        },
        { status: 'deployed' }
      )
    ).toEqual({
      group: 'helm.sh',
      version: 'v3',
      kind: 'HelmRelease',
      resource: undefined,
      name: 'demo',
      uid: undefined,
      namespace: 'default',
      clusterId: 'alpha:ctx',
      clusterName: undefined,
      status: 'deployed',
    });
  });
});
