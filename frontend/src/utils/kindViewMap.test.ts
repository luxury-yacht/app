/**
 * frontend/src/utils/kindViewMap.test.ts
 *
 * Tests for kindViewMap utility — verifies that Kubernetes resource kinds
 * map to the correct view destinations.
 */

import { describe, it, expect } from 'vitest';
import { getViewForKind, isNamespaceScopedKind } from './kindViewMap';

describe('getViewForKind', () => {
  // Namespace-scoped kinds
  it.each([
    ['Pod', 'namespace', 'pods'],
    ['pod', 'namespace', 'pods'],
    ['POD', 'namespace', 'pods'],
    ['Deployment', 'namespace', 'workloads'],
    ['StatefulSet', 'namespace', 'workloads'],
    ['DaemonSet', 'namespace', 'workloads'],
    ['Job', 'namespace', 'workloads'],
    ['CronJob', 'namespace', 'workloads'],
    ['ReplicaSet', 'namespace', 'workloads'],
    ['ConfigMap', 'namespace', 'config'],
    ['Secret', 'namespace', 'config'],
    ['Service', 'namespace', 'network'],
    ['Ingress', 'namespace', 'network'],
    ['EndpointSlice', 'namespace', 'network'],
    ['NetworkPolicy', 'namespace', 'network'],
    ['Role', 'namespace', 'rbac'],
    ['RoleBinding', 'namespace', 'rbac'],
    ['ServiceAccount', 'namespace', 'rbac'],
    ['PersistentVolumeClaim', 'namespace', 'storage'],
    ['PVC', 'namespace', 'storage'],
    ['HorizontalPodAutoscaler', 'namespace', 'autoscaling'],
    ['HPA', 'namespace', 'autoscaling'],
    ['VerticalPodAutoscaler', 'namespace', 'autoscaling'],
    ['VPA', 'namespace', 'autoscaling'],
    ['PodDisruptionBudget', 'namespace', 'autoscaling'],
    ['PDB', 'namespace', 'autoscaling'],
    ['ResourceQuota', 'namespace', 'quotas'],
    ['LimitRange', 'namespace', 'quotas'],
    ['HelmRelease', 'namespace', 'helm'],
    ['Event', 'namespace', 'events'],
  ])('maps %s to %s/%s', (kind, expectedViewType, expectedTab) => {
    const result = getViewForKind(kind);
    expect(result).toEqual({ viewType: expectedViewType, tab: expectedTab });
  });

  // Cluster-scoped kinds
  it.each([
    ['Node', 'cluster', 'nodes'],
    ['ClusterRole', 'cluster', 'rbac'],
    ['ClusterRoleBinding', 'cluster', 'rbac'],
    ['PersistentVolume', 'cluster', 'storage'],
    ['PV', 'cluster', 'storage'],
    ['StorageClass', 'cluster', 'storage'],
    ['Namespace', 'cluster', 'config'],
    ['CustomResourceDefinition', 'cluster', 'crds'],
    ['CRD', 'cluster', 'crds'],
  ])('maps %s to %s/%s', (kind, expectedViewType, expectedTab) => {
    const result = getViewForKind(kind);
    expect(result).toEqual({ viewType: expectedViewType, tab: expectedTab });
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

describe('isNamespaceScopedKind', () => {
  it('returns true for namespace-scoped kinds', () => {
    expect(isNamespaceScopedKind('Pod')).toBe(true);
    expect(isNamespaceScopedKind('Deployment')).toBe(true);
    expect(isNamespaceScopedKind('ConfigMap')).toBe(true);
    expect(isNamespaceScopedKind('Service')).toBe(true);
  });

  it('returns false for cluster-scoped kinds', () => {
    expect(isNamespaceScopedKind('Node')).toBe(false);
    expect(isNamespaceScopedKind('ClusterRole')).toBe(false);
    expect(isNamespaceScopedKind('PersistentVolume')).toBe(false);
    expect(isNamespaceScopedKind('Namespace')).toBe(false);
  });

  it('returns false for unknown kinds', () => {
    expect(isNamespaceScopedKind('UnknownKind')).toBe(false);
  });
});
