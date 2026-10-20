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
  },
  {
    scope: 'global',
    id: 'global-namespaces',
    label: 'Namespaces',
    description:
      'Compare namespace health, workloads, events, utilization, and quotas across open clusters',
    keywords: ['global-namespaces', 'namespaces', 'global', 'clusters', 'compare', 'health'],
  },
] as const satisfies readonly ViewDescriptor<'global', string>[];

export const SIDEBAR_VIEW_GROUPS = [
  { id: 'resources', label: 'Resources' },
  { id: 'extensions', label: 'Extensions' },
] as const;

export type SidebarViewGroupId = (typeof SIDEBAR_VIEW_GROUPS)[number]['id'];

interface GroupedViewDefinition<Scope extends 'cluster' | 'namespace'>
  extends ViewDescriptor<Scope, string> {
  readonly sidebarGroup: 'primary' | SidebarViewGroupId;
}

export const CLUSTER_VIEW_DESCRIPTORS = [
  {
    scope: 'cluster',
    sidebarGroup: 'primary',
    id: 'attention',
    label: 'Attention',
    description: 'Review cluster objects that currently need operator attention',
    keywords: ['attention', 'cluster', 'health', 'failures', 'warnings', 'restarts', 'unready'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'primary',
    id: 'browse',
    label: 'Browse',
    description: 'Inspect the inventory of all catalogued Kubernetes objects',
    keywords: ['browse', 'inventory', 'cluster', 'catalog', 'objects'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'primary',
    id: 'events',
    label: 'Events',
    description: 'Review cluster events associated with recent changes and operations',
    keywords: ['events', 'change', 'changes', 'cluster', 'logs', 'history'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'primary',
    id: 'identities',
    label: 'Identities',
    description: 'View users and groups referenced by RBAC bindings',
    keywords: ['identities', 'users', 'groups', 'access', 'subjects'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'config',
    label: 'Config',
    description: 'View cluster configuration resources',
    keywords: ['config', 'cluster', 'ingress', 'classes'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'namespaces',
    label: 'Namespaces',
    description: 'Compare health, workloads, events, utilization, and quotas across namespaces',
    keywords: ['namespaces', 'cluster', 'health', 'workloads', 'events', 'utilization', 'quotas'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'nodes',
    label: 'Nodes',
    description: 'Inspect node health, scheduling, and capacity',
    keywords: ['nodes', 'capacity', 'cluster', 'servers', 'machines'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'rbac',
    label: 'RBAC',
    description: 'View cluster RBAC resources',
    keywords: ['rbac', 'cluster', 'security', 'roles', 'bindings', 'admission'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'resources',
    id: 'storage',
    label: 'Storage',
    description: 'View persistent volumes and storage classes',
    keywords: ['storage', 'cluster', 'volumes', 'pvs', 'persistent', 'classes'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'crds',
    label: 'CRDs',
    description: 'View custom resource definitions',
    keywords: ['crds', 'cluster', 'custom', 'resources', 'definitions'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'custom',
    label: 'Custom Resources',
    description: 'View cluster-scoped custom resources',
    keywords: ['custom', 'cluster', 'custom resources', 'crs'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'cert-manager',
    resourceFamily: 'cert-manager',
    label: 'Cert Manager',
    description: 'View cert-manager resources',
    keywords: ['cert-manager', 'certificates', 'issuers'],
  },
  {
    scope: 'cluster',
    sidebarGroup: 'extensions',
    id: 'external-secrets',
    resourceFamily: 'external-secrets',
    label: 'External Secrets',
    description: 'View External Secrets resources',
    keywords: ['external-secrets', 'external secrets', 'secret stores'],
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
  },
] as const satisfies readonly GroupedViewDefinition<'cluster'>[];

export const NAMESPACE_VIEW_DESCRIPTORS = [
  {
    scope: 'namespace',
    sidebarGroup: 'primary',
    id: 'browse',
    supportsAllNamespaces: true,
    label: 'Browse',
    description: 'Inspect the inventory of catalogued Kubernetes objects in this namespace',
    keywords: ['browse', 'inventory', 'namespace', 'catalog', 'objects'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'primary',
    id: 'events',
    supportsAllNamespaces: true,
    label: 'Events',
    description: 'Review namespace events associated with recent changes and operations',
    keywords: ['events', 'change', 'changes', 'namespace', 'logs', 'history'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'primary',
    id: 'map',
    supportsAllNamespaces: false,
    label: 'Map',
    description: 'Map relationships between objects in this namespace',
    keywords: ['map', 'namespace', 'topology', 'relationships', 'objects'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'resources',
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
  },
  {
    scope: 'namespace',
    sidebarGroup: 'resources',
    id: 'pods',
    supportsAllNamespaces: true,
    label: 'Pods',
    description: 'View and filter pods by namespace, owner, and node',
    keywords: ['pods', 'namespace', 'containers', 'owner', 'node'],
    // The pods table holds its own query lease; manual refresh reaches it
    // through the orchestrator's pods-table views.
  },
  {
    scope: 'namespace',
    sidebarGroup: 'resources',
    id: 'autoscaling',
    supportsAllNamespaces: true,
    label: 'Autoscaling',
    description: 'View horizontal pod autoscalers',
    keywords: ['autoscaling', 'namespace', 'hpa', 'scaling'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'resources',
    id: 'config',
    supportsAllNamespaces: true,
    label: 'Config',
    description: 'View configmaps and secrets',
    keywords: ['config', 'namespace', 'configmaps', 'secrets'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'resources',
    id: 'network',
    supportsAllNamespaces: true,
    label: 'Network',
    description: 'View services and ingresses',
    keywords: ['network', 'namespace', 'services', 'ingress'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'resources',
    id: 'quotas',
    supportsAllNamespaces: true,
    label: 'Quotas',
    description: 'View resource quotas and limits',
    keywords: ['quotas', 'namespace', 'limits', 'resources'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'resources',
    id: 'rbac',
    supportsAllNamespaces: true,
    label: 'RBAC',
    description: 'View roles and bindings',
    keywords: ['rbac', 'namespace', 'security', 'roles', 'bindings'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'resources',
    id: 'storage',
    supportsAllNamespaces: true,
    label: 'Storage',
    description: 'View persistent volume claims',
    keywords: ['storage', 'namespace', 'pvcs', 'claims'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'extensions',
    id: 'custom',
    supportsAllNamespaces: true,
    label: 'Custom Resources',
    description: 'View custom resources',
    keywords: ['custom', 'namespace', 'resources', 'crs'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'extensions',
    id: 'argocd',
    resourceFamily: 'argocd',
    supportsAllNamespaces: true,
    label: 'Argo CD',
    description: 'View Argo CD applications, application sets, and projects',
    keywords: ['argocd', 'argo cd', 'gitops', 'applications', 'applicationsets', 'appprojects'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'extensions',
    id: 'cert-manager',
    resourceFamily: 'cert-manager',
    label: 'Cert Manager',
    description: 'View cert-manager resources',
    keywords: ['cert-manager', 'certificates', 'issuers'],
    supportsAllNamespaces: true,
  },
  {
    scope: 'namespace',
    sidebarGroup: 'extensions',
    id: 'external-secrets',
    resourceFamily: 'external-secrets',
    label: 'External Secrets',
    description: 'View External Secrets resources',
    keywords: ['external-secrets', 'external secrets', 'secret stores'],
    supportsAllNamespaces: true,
  },
  {
    scope: 'namespace',
    sidebarGroup: 'extensions',
    id: 'helm',
    supportsAllNamespaces: true,
    label: 'Helm',
    description: 'View Helm releases',
    keywords: ['helm', 'namespace', 'charts', 'releases'],
  },
  {
    scope: 'namespace',
    sidebarGroup: 'extensions',
    id: 'prometheus',
    resourceFamily: 'prometheus',
    label: 'Prometheus Operator',
    description: 'View Prometheus Operator resources',
    keywords: ['prometheus', 'prometheus operator', 'monitors', 'rules', 'alertmanager'],
    supportsAllNamespaces: true,
  },
] as const satisfies readonly GroupedViewDefinition<'namespace'>[];

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
