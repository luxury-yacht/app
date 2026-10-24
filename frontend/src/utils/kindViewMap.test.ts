/**
 * frontend/src/utils/kindViewMap.test.ts
 *
 * Where Alt+click on an object goes, by its API group, kind, and scope: the
 * built-in view that lists it (each view's refresh domain declares its kinds in
 * backend/refresh/snapshot), its resource family's view, the Custom view for any
 * other custom resource, or Browse for a built-in kind that no view lists.
 */

import type {
  CLUSTER_VIEW_DESCRIPTORS,
  NAMESPACE_VIEW_DESCRIPTORS,
} from '@core/navigation/viewRegistry';
import type { KindFacets } from '@shared/kinds/kindFacets';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { getViewForKind } from './kindViewMap';

type ViewListDomain = Extract<
  (typeof NAMESPACE_VIEW_DESCRIPTORS)[number] | (typeof CLUSTER_VIEW_DESCRIPTORS)[number],
  { listDomain: string }
>['listDomain'];
type KindListDomain = Exclude<KindFacets['listDomain'], 'none'>;

describe('getViewForKind', () => {
  // A kind's list domain without a view would send Alt+click nowhere; this
  // fails to compile when the backend adds a list domain no view declares.
  it('has a view for every kind list domain', () => {
    expectTypeOf<Exclude<KindListDomain, ViewListDomain>>().toBeNever();
  });

  it.each([
    ['', 'Pod', 'pods'],
    ['apps', 'Deployment', 'workloads'],
    ['', 'ConfigMap', 'config'],
    ['', 'Service', 'network'],
    ['rbac.authorization.k8s.io', 'Role', 'rbac'],
    ['', 'PersistentVolumeClaim', 'storage'],
    ['autoscaling', 'HorizontalPodAutoscaler', 'autoscaling'],
    ['', 'ResourceQuota', 'quotas'],
    // namespace_quotas.go lists PodDisruptionBudgets.
    ['policy', 'PodDisruptionBudget', 'quotas'],
    ['helm.sh', 'HelmRelease', 'helm'],
    ['', 'Event', 'events'],
  ])('sends namespaced %s/%s to the %s view', (group, kind, tab) => {
    expect(getViewForKind(kind, group, 'team-a')).toEqual({ viewType: 'namespace', tab });
  });

  it.each([
    ['', 'Node', 'nodes'],
    ['rbac.authorization.k8s.io', 'ClusterRole', 'rbac'],
    ['', 'PersistentVolume', 'storage'],
    ['', 'Namespace', 'namespaces'],
    ['apiextensions.k8s.io', 'CustomResourceDefinition', 'crds'],
    // cluster_config.go lists storage classes, ingress classes, and webhooks.
    ['storage.k8s.io', 'StorageClass', 'config'],
    ['networking.k8s.io', 'IngressClass', 'config'],
    ['admissionregistration.k8s.io', 'MutatingWebhookConfiguration', 'config'],
  ])('sends cluster-scoped %s/%s to the %s view', (group, kind, tab) => {
    expect(getViewForKind(kind, group, '')).toEqual({ viewType: 'cluster', tab });
  });

  it('sends a custom resource to its Custom view, even when it shares a built-in kind name', () => {
    expect(getViewForKind('Deployment', 'operators.example.io', 'team-a')).toEqual({
      viewType: 'namespace',
      tab: 'custom',
    });
    expect(getViewForKind('VerticalPodAutoscaler', 'autoscaling.k8s.io', 'team-a')).toEqual({
      viewType: 'namespace',
      tab: 'custom',
    });
    expect(getViewForKind('Widget', 'example.com', '')).toEqual({
      viewType: 'cluster',
      tab: 'custom',
    });
  });

  it('sends a built-in kind that no view lists to Browse', () => {
    expect(getViewForKind('Lease', 'coordination.k8s.io', 'kube-system')).toEqual({
      viewType: 'namespace',
      tab: 'browse',
    });
    // namespace-workloads has no ReplicaSet rows, so the Workloads view cannot show one.
    expect(getViewForKind('ReplicaSet', 'apps', 'team-a')).toEqual({
      viewType: 'namespace',
      tab: 'browse',
    });
    // The cluster Browse table's view id is "browse" (BrowseView.tsx).
    expect(getViewForKind('CSIDriver', 'storage.k8s.io', '')).toEqual({
      viewType: 'cluster',
      tab: 'browse',
      destinationViewId: 'browse',
    });
  });

  it('matches the kind in any case', () => {
    expect(getViewForKind('node', '', '')).toEqual(getViewForKind('Node', '', ''));
    expect(getViewForKind('configmap', '', 'team-a')).toEqual(
      getViewForKind('ConfigMap', '', 'team-a')
    );
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
    expect(getViewForKind('NodePool', 'unrelated.io', '')).toEqual({
      viewType: 'cluster',
      tab: 'custom',
    });
  });

  it('routes only namespaced Argo CD objects into the Argo CD view', () => {
    for (const kind of ['Application', 'ApplicationSet', 'AppProject']) {
      expect(getViewForKind(kind, 'argoproj.io', 'team-a')).toEqual({
        viewType: 'namespace',
        tab: 'argocd',
      });
      expect(getViewForKind(kind, 'other.io', 'team-a')).toEqual({
        viewType: 'namespace',
        tab: 'custom',
      });
    }
    expect(getViewForKind('Workflow', 'argoproj.io', 'team-a')).toEqual({
      viewType: 'namespace',
      tab: 'custom',
    });
  });
});
