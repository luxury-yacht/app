/**
 * Canonical metadata for the global, cluster, and namespace views exposed by the app shell.
 *
 * Keep this module React-free: refresh infrastructure, persistence boundaries,
 * and UI navigation all consume the same vocabulary.
 */

import type { ResourceFamily } from './resourceFamilies';

export type ViewScope = 'global' | 'cluster' | 'namespace';

interface ViewDescriptor<Scope extends ViewScope, Id extends string> {
  readonly scope: Scope;
  readonly id: Id;
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly refresher: string | null;
  readonly supportsAllNamespaces?: boolean;
  readonly resourceFamily?: ResourceFamily;
}

// Global views compare data across the app's open clusters. Presentation scope
// is independent from the stable route ids used by dispatch and persistence.
export const GLOBAL_VIEW_DESCRIPTORS = [
  {
    scope: 'global',
    id: 'fleet',
    label: 'Clusters',
    description: 'Compare health, capacity, and metrics across open clusters',
    keywords: ['fleet', 'clusters', 'global', 'compare', 'health', 'capacity', 'metrics'],
    refresher: null,
  },
  {
    scope: 'global',
    id: 'global-namespaces',
    label: 'Namespaces',
    description:
      'Compare namespace health, workloads, events, utilization, and quotas across open clusters',
    keywords: ['global-namespaces', 'namespaces', 'global', 'clusters', 'compare', 'health'],
    refresher: null,
  },
] as const satisfies readonly ViewDescriptor<'global', string>[];

export const CLUSTER_SIDEBAR_GROUPS = [
  { id: 'resources', label: 'Resources' },
  { id: 'extensions', label: 'Extensions' },
] as const;

export type ClusterSidebarGroup = (typeof CLUSTER_SIDEBAR_GROUPS)[number]['id'];

interface ClusterViewDefinition extends ViewDescriptor<'cluster', string> {
  readonly sidebarGroup: 'primary' | ClusterSidebarGroup;
}

export const CLUSTER_VIEW_DESCRIPTORS = [
  {
    scope: 'cluster',
    sidebarGroup: 'primary',
    id: 'attention',
    label: 'Attention',
    description: 'Review cluster objects that currently need operator attention',
    keywords: ['attention', 'cluster', 'health', 'failures', 'warnings', 'restarts', 'unready'],
    refresher: 'cluster-attention',
  },
  {
    scope: 'cluster',
    sidebarGroup: 'primary',
    id: 'browse',
    label: 'Browse',
    description: 'Inspect the inventory of all catalogued Kubernetes objects',
    keywords: ['browse', 'inventory', 'cluster', 'catalog', 'objects'],
    refresher: 'catalog',
  },
  {
    scope: 'cluster',
    sidebarGroup: 'primary',
    id: 'events',
    label: 'Events',
    description: 'Review cluster events associated with recent changes and operations',
    keywords: ['events', 'change', 'changes', 'cluster', 'logs', 'history'],
    refresher: 'cluster-events',
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'namespaces',
    label: 'Namespaces',
    description: 'Compare health, workloads, events, utilization, and quotas across namespaces',
    keywords: ['namespaces', 'cluster', 'health', 'workloads', 'events', 'utilization', 'quotas'],
    refresher: null,
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'nodes',
    label: 'Nodes',
    description: 'Inspect node health, scheduling, and capacity',
    keywords: ['nodes', 'capacity', 'cluster', 'servers', 'machines'],
    refresher: 'cluster-nodes',
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'storage',
    label: 'Storage',
    description: 'View persistent volumes and storage classes',
    keywords: ['storage', 'cluster', 'volumes', 'pvs', 'persistent', 'classes'],
    refresher: 'cluster-storage',
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'config',
    label: 'Config',
    description: 'View cluster configuration resources',
    keywords: ['config', 'cluster', 'ingress', 'classes'],
    refresher: 'cluster-config',
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'rbac',
    label: 'RBAC',
    description: 'View cluster RBAC resources',
    keywords: ['rbac', 'cluster', 'security', 'roles', 'bindings', 'admission'],
    refresher: 'cluster-rbac',
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'crds',
    label: 'CRDs',
    description: 'View custom resource definitions',
    keywords: ['crds', 'cluster', 'custom', 'resources', 'definitions'],
    refresher: 'cluster-crds',
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'custom',
    label: 'Custom Resources',
    description: 'View cluster-scoped custom resources',
    keywords: ['custom', 'cluster', 'custom resources', 'crs'],
    refresher: null,
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'cert-manager',
    resourceFamily: 'cert-manager',
    label: 'Cert Manager',
    description: 'View cert-manager resources',
    keywords: ['cert-manager', 'certificates', 'issuers'],
    refresher: null,
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'external-secrets',
    resourceFamily: 'external-secrets',
    label: 'External Secrets',
    description: 'View External Secrets resources',
    keywords: ['external-secrets', 'external secrets', 'secret stores'],
    refresher: null,
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'karpenter',
    resourceFamily: 'karpenter',
    label: 'Karpenter',
    description: 'View Karpenter node pools, node claims, and provider node classes',
    keywords: [
      'karpenter',
      'nodepools',
      'nodeclaims',
      'nodeclasses',
      'provisioners',
      'nodeoverlays',
    ],
    refresher: null,
  },
] as const satisfies readonly ClusterViewDefinition[];

export const NAMESPACE_VIEW_DESCRIPTORS = [
  {
    scope: 'namespace',
    id: 'browse',
    supportsAllNamespaces: true,
    label: 'Browse',
    description: 'Inspect the inventory of catalogued Kubernetes objects in this namespace',
    keywords: ['browse', 'inventory', 'namespace', 'catalog', 'objects'],
    refresher: null,
  },
  {
    scope: 'namespace',
    id: 'map',
    supportsAllNamespaces: false,
    label: 'Map',
    description: 'Map relationships between objects in this namespace',
    keywords: ['map', 'namespace', 'topology', 'relationships', 'objects'],
    refresher: null,
  },
  {
    scope: 'namespace',
    id: 'events',
    supportsAllNamespaces: true,
    label: 'Events',
    description: 'Review namespace events associated with recent changes and operations',
    keywords: ['events', 'change', 'changes', 'namespace', 'logs', 'history'],
    refresher: 'events',
  },
  {
    scope: 'namespace',
    id: 'workloads',
    supportsAllNamespaces: true,
    label: 'Workloads',
    description: 'View deployments, statefulsets, daemonsets, jobs, and pods',
    keywords: [
      'workloads',
      'namespace',
      'deployments',
      'statefulsets',
      'daemonsets',
      'cronjobs',
      'jobs',
      'pods',
    ],
    refresher: 'workloads',
  },
  {
    scope: 'namespace',
    id: 'autoscaling',
    supportsAllNamespaces: true,
    label: 'Autoscaling',
    description: 'View horizontal pod autoscalers',
    keywords: ['autoscaling', 'namespace', 'hpa', 'scaling'],
    refresher: 'autoscaling',
  },
  {
    scope: 'namespace',
    id: 'helm',
    supportsAllNamespaces: true,
    label: 'Helm',
    description: 'View Helm releases',
    keywords: ['helm', 'namespace', 'charts', 'releases'],
    refresher: 'helm',
  },
  {
    scope: 'namespace',
    id: 'config',
    supportsAllNamespaces: true,
    label: 'Config',
    description: 'View configmaps and secrets',
    keywords: ['config', 'namespace', 'configmaps', 'secrets'],
    refresher: 'config',
  },
  {
    scope: 'namespace',
    id: 'network',
    supportsAllNamespaces: true,
    label: 'Network',
    description: 'View services and ingresses',
    keywords: ['network', 'namespace', 'services', 'ingress'],
    refresher: 'network',
  },
  {
    scope: 'namespace',
    id: 'storage',
    supportsAllNamespaces: true,
    label: 'Storage',
    description: 'View persistent volume claims',
    keywords: ['storage', 'namespace', 'pvcs', 'claims'],
    refresher: 'storage',
  },
  {
    scope: 'namespace',
    id: 'custom',
    supportsAllNamespaces: true,
    label: 'Custom',
    description: 'View custom resources',
    keywords: ['custom', 'namespace', 'resources', 'crs'],
    refresher: null,
  },
  {
    scope: 'namespace',
    id: 'argocd',
    resourceFamily: 'argocd',
    supportsAllNamespaces: true,
    label: 'Argo CD',
    description: 'View Argo CD applications, application sets, and projects',
    keywords: ['argocd', 'argo cd', 'gitops', 'applications', 'applicationsets', 'appprojects'],
    refresher: null,
  },
  {
    scope: 'namespace',
    id: 'cert-manager',
    resourceFamily: 'cert-manager',
    label: 'Cert Manager',
    description: 'View cert-manager resources',
    keywords: ['cert-manager', 'certificates', 'issuers'],
    refresher: null,
    supportsAllNamespaces: true,
  },
  {
    scope: 'namespace',
    id: 'external-secrets',
    resourceFamily: 'external-secrets',
    label: 'External Secrets',
    description: 'View External Secrets resources',
    keywords: ['external-secrets', 'external secrets', 'secret stores'],
    refresher: null,
    supportsAllNamespaces: true,
  },
  {
    scope: 'namespace',
    id: 'prometheus',
    resourceFamily: 'prometheus',
    label: 'Prometheus Operator',
    description: 'View Prometheus Operator resources',
    keywords: ['prometheus', 'prometheus operator', 'monitors', 'rules', 'alertmanager'],
    refresher: null,
    supportsAllNamespaces: true,
  },
  {
    scope: 'namespace',
    id: 'quotas',
    supportsAllNamespaces: true,
    label: 'Quotas',
    description: 'View resource quotas and limits',
    keywords: ['quotas', 'namespace', 'limits', 'resources'],
    refresher: 'quotas',
  },
  {
    scope: 'namespace',
    id: 'rbac',
    supportsAllNamespaces: true,
    label: 'RBAC',
    description: 'View roles and bindings',
    keywords: ['rbac', 'namespace', 'security', 'roles', 'bindings'],
    refresher: 'rbac',
  },
] as const satisfies readonly ViewDescriptor<'namespace', string>[];

export type ClusterViewDescriptor = (typeof CLUSTER_VIEW_DESCRIPTORS)[number];
export type GlobalViewDescriptor = (typeof GLOBAL_VIEW_DESCRIPTORS)[number];
export type NamespaceViewDescriptor = (typeof NAMESPACE_VIEW_DESCRIPTORS)[number];
export type GlobalViewType = GlobalViewDescriptor['id'];
export type ClusterViewType = ClusterViewDescriptor['id'];
export type NamespaceViewType = NamespaceViewDescriptor['id'];
export type RegisteredViewDescriptor =
  | GlobalViewDescriptor
  | ClusterViewDescriptor
  | NamespaceViewDescriptor;

export const getViewDescriptor = (
  scope: ViewScope,
  id: string
): RegisteredViewDescriptor | undefined => {
  let descriptors: readonly RegisteredViewDescriptor[];

  if (scope === 'global') {
    descriptors = GLOBAL_VIEW_DESCRIPTORS;
  } else if (scope === 'cluster') {
    descriptors = CLUSTER_VIEW_DESCRIPTORS;
  } else {
    descriptors = NAMESPACE_VIEW_DESCRIPTORS;
  }

  return descriptors.find((descriptor) => descriptor.id === id);
};
