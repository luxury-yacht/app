/**
 * frontend/src/shared/resources/resourceDescriptorSelectors.test.ts
 *
 * Verifies shared resource descriptor helpers used by cluster and namespace
 * contexts for cluster filtering, metadata, and stable row identity.
 */

import { describe, expect, it } from 'vitest';
import {
  filterRowsForCluster,
  helmReleaseRowIdentity,
  namespacedKindRowIdentity,
  namespaceEventResourceRowIdentity,
  parseAutoscalingTarget,
  resourceKindsMeta,
  selectClusterRows,
  versionedNamespacedRowIdentity,
} from './resourceDescriptorSelectors';

describe('resourceDescriptorSelectors', () => {
  it('filters rows to the selected cluster and preserves legacy unclustered rows without one', () => {
    const rows = [{ name: 'legacy' }, { name: 'alpha', clusterId: 'cluster-a' }];

    expect(filterRowsForCluster(rows, 'cluster-a')).toEqual([
      { name: 'alpha', clusterId: 'cluster-a' },
    ]);
    expect(filterRowsForCluster(rows, null)).toEqual([{ name: 'legacy' }]);
    expect(selectClusterRows(undefined, 'cluster-a')).toBeNull();
  });

  it('builds stable descriptor row identities with cluster id included', () => {
    expect(
      namespacedKindRowIdentity({
        clusterId: 'cluster-a',
        namespace: 'default',
        kind: 'Deployment',
        name: 'api',
      })
    ).toBe('cluster-a::default::Deployment::api');

    expect(
      versionedNamespacedRowIdentity({
        clusterId: 'cluster-a',
        namespace: 'default',
        group: 'example.com',
        version: 'v1',
        kind: 'Widget',
        name: 'api',
      })
    ).toBe('cluster-a::default::example.com::v1::Widget::api');

    expect(
      helmReleaseRowIdentity({ clusterId: 'cluster-a', namespace: 'default', name: 'api' })
    ).toBe('cluster-a::default::api');
  });

  it('builds namespace Event identities from UID first and display fallback second', () => {
    expect(
      namespaceEventResourceRowIdentity({
        clusterId: 'cluster-a',
        objectNamespace: 'default',
        uid: 'event-uid',
        object: 'Pod/api',
      })
    ).toBe('cluster-a::default::event-uid');

    expect(
      namespaceEventResourceRowIdentity({
        clusterId: 'cluster-a',
        namespace: 'default',
        object: 'Pod/api',
        source: 'kubelet',
        reason: 'FailedMount',
        type: 'Warning',
      })
    ).toBe('cluster-a::default::Pod/api:kubelet:FailedMount:Warning');
  });

  it('parses autoscaling targets and exposes kinds metadata', () => {
    expect(parseAutoscalingTarget('Deployment/api', 'apps/v1')).toEqual({
      kind: 'Deployment',
      name: 'api',
      apiVersion: 'apps/v1',
    });
    expect(parseAutoscalingTarget('Deployment')).toBeUndefined();
    expect(resourceKindsMeta({ kinds: ['Deployment'] })).toEqual({ kinds: ['Deployment'] });
    expect(resourceKindsMeta(null)).toEqual({ kinds: [] });
  });
});
