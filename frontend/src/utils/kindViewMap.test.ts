/**
 * frontend/src/utils/kindViewMap.test.ts
 *
 * Tests for kindViewMap utility — verifies that Kubernetes resource kinds
 * map to the correct view destinations.
 */

import { describe, expect, it } from 'vitest';
import { getViewForKind, isNamespaceScopedKind } from './kindViewMap';

describe('getViewForKind', () => {
  // Namespace-scoped kinds
  const namespaceKindCases: Array<[string, string, string, string?]> = [
    ['Pod', 'namespace', 'workloads', 'namespace-pods'],
    ['pod', 'namespace', 'workloads', 'namespace-pods'],
    ['POD', 'namespace', 'workloads', 'namespace-pods'],
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
  ];
  it('covers getViewForKind scenarios', async () => {
    for (const [kind, expectedViewType, expectedTab, destinationViewId] of namespaceKindCases) {
      // Scenarios: maps %s to %s/%s
      const result = getViewForKind(kind);
      expect(result).toEqual({
        viewType: expectedViewType,
        tab: expectedTab,
        ...(destinationViewId ? { destinationViewId } : {}),
      });
    }

    for (const [kind, expectedViewType, expectedTab] of [
      ['Node', 'cluster', 'nodes'],
      ['ClusterRole', 'cluster', 'rbac'],
      ['ClusterRoleBinding', 'cluster', 'rbac'],
      ['PersistentVolume', 'cluster', 'storage'],
      ['PV', 'cluster', 'storage'],
      ['StorageClass', 'cluster', 'storage'],
      ['Namespace', 'cluster', 'config'],
      ['CustomResourceDefinition', 'cluster', 'crds'],
      ['CRD', 'cluster', 'crds'],
    ]) {
      // Scenarios: maps %s to %s/%s
      const result = getViewForKind(kind);
      expect(result).toEqual({ viewType: expectedViewType, tab: expectedTab });
    }
    // Scenario: returns null for unknown kinds
    expect(getViewForKind('UnknownKind')).toBeNull();
    expect(getViewForKind('FooBar')).toBeNull();
    expect(getViewForKind('')).toBeNull();
    // Scenario: is case-insensitive
    expect(getViewForKind('pod')).toEqual(getViewForKind('Pod'));
    expect(getViewForKind('NODE')).toEqual(getViewForKind('node'));
    expect(getViewForKind('configmap')).toEqual(getViewForKind('ConfigMap'));
  });
});

describe('isNamespaceScopedKind', () => {
  it('covers isNamespaceScopedKind scenarios', async () => {
    // Scenario: returns true for namespace-scoped kinds
    expect(isNamespaceScopedKind('Pod')).toBe(true);
    expect(isNamespaceScopedKind('Deployment')).toBe(true);
    expect(isNamespaceScopedKind('ConfigMap')).toBe(true);
    expect(isNamespaceScopedKind('Service')).toBe(true);
    // Scenario: returns false for cluster-scoped kinds
    expect(isNamespaceScopedKind('Node')).toBe(false);
    expect(isNamespaceScopedKind('ClusterRole')).toBe(false);
    expect(isNamespaceScopedKind('PersistentVolume')).toBe(false);
    expect(isNamespaceScopedKind('Namespace')).toBe(false);
    // Scenario: returns false for unknown kinds
    expect(isNamespaceScopedKind('UnknownKind')).toBe(false);
  });
});
