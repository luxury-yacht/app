/**
 * frontend/src/utils/kindViewMap.test.ts
 *
 * Tests for kindViewMap utility — verifies that Kubernetes resource kinds
 * map to the correct view destinations.
 */

import { describe, expect, it } from 'vitest';
import { getViewForKind } from './kindViewMap';

describe('getViewForKind', () => {
  // One representative per destination, plus the Pods subtable and alias path.
  const namespaceKindCases: Array<[string, string, string, string?]> = [
    ['Pod', 'namespace', 'workloads', 'namespace-pods'],
    ['Deployment', 'namespace', 'workloads'],
    ['ConfigMap', 'namespace', 'config'],
    ['Service', 'namespace', 'network'],
    ['Role', 'namespace', 'rbac'],
    ['PersistentVolumeClaim', 'namespace', 'storage'],
    ['PVC', 'namespace', 'storage'],
    ['HorizontalPodAutoscaler', 'namespace', 'autoscaling'],
    ['ResourceQuota', 'namespace', 'quotas'],
    ['HelmRelease', 'namespace', 'helm'],
    ['Event', 'namespace', 'events'],
  ];
  it.each(namespaceKindCases)(
    'maps %s to %s/%s',
    (kind, expectedViewType, expectedTab, destinationViewId) => {
      const result = getViewForKind(kind);
      expect(result).toEqual({
        viewType: expectedViewType,
        tab: expectedTab,
        ...(destinationViewId ? { destinationViewId } : {}),
      });
    }
  );

  // Cluster-scoped kinds
  it.each([
    ['Node', 'cluster', 'nodes'],
    ['ClusterRole', 'cluster', 'rbac'],
    ['PersistentVolume', 'cluster', 'storage'],
    ['Namespace', 'cluster', 'config'],
    ['CustomResourceDefinition', 'cluster', 'crds'],
  ])('maps %s to %s/%s', (kind, expectedViewType, expectedTab) => {
    const result = getViewForKind(kind);
    expect(result).toEqual({ viewType: expectedViewType, tab: expectedTab });
  });

  it('routes discovered Karpenter groups without confusing colliding kinds', () => {
    expect(getViewForKind('NodePool', 'karpenter.sh', '')).toEqual({
      viewType: 'cluster',
      tab: 'karpenter',
    });
    expect(getViewForKind('AKSNodeClass', 'karpenter.azure.com', '')).toEqual({
      viewType: 'cluster',
      tab: 'karpenter',
    });
    expect(getViewForKind('NodePool', 'unrelated.io', '')).toBeNull();
    expect(getViewForKind('NodePool', 'karpenter.sh', 'default')).toBeNull();
  });

  it('returns null for unknown kinds', () => {
    expect(getViewForKind('UnknownKind')).toBeNull();
    expect(getViewForKind('FooBar')).toBeNull();
    expect(getViewForKind('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(getViewForKind('pod')).toEqual(getViewForKind('Pod'));
    expect(getViewForKind('NODE')).toEqual(getViewForKind('node'));
    expect(getViewForKind('configmap')).toEqual(getViewForKind('ConfigMap'));
  });
});

it('routes only namespaced Argo CD objects into the Argo CD view', () => {
  for (const kind of ['Application', 'ApplicationSet', 'AppProject']) {
    expect(getViewForKind(kind, 'argoproj.io', 'team-a')).toEqual({
      viewType: 'namespace',
      tab: 'argocd',
    });
    expect(getViewForKind(kind, 'other.io', 'team-a')).toBeNull();
    expect(getViewForKind(kind, 'argoproj.io', '')).toBeNull();
  }
  expect(getViewForKind('Workflow', 'argoproj.io', 'team-a')).toBeNull();
});
