/**
 * Canonical metadata for the global, cluster, and namespace views exposed by the app shell.
 *
 * Keep this module React-free: refresh infrastructure, persistence boundaries,
 * and UI navigation all consume the same vocabulary.
 */

export type ViewScope = 'global' | 'cluster' | 'namespace';

interface ViewDescriptor<Scope extends ViewScope, Id extends string> {
  readonly scope: Scope;
  readonly id: Id;
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly refresher: string | null;
  readonly supportsAllNamespaces?: boolean;
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

export const CLUSTER_VIEW_DESCRIPTORS = [
  {
    scope: 'cluster',
    id: 'attention',
    label: 'Attention',
    description: 'Review cluster objects that currently need operator attention',
    keywords: ['attention', 'cluster', 'health', 'failures', 'warnings', 'restarts', 'unready'],
    refresher: 'cluster-attention',
  },
  {
    scope: 'cluster',
    id: 'namespaces',
    label: 'Namespaces',
    description: 'Compare health, workloads, events, utilization, and quotas across namespaces',
    keywords: ['namespaces', 'cluster', 'health', 'workloads', 'events', 'utilization', 'quotas'],
    refresher: null,
  },
  {
    scope: 'cluster',
    id: 'browse',
    label: 'Browse',
    description: 'Inspect the inventory of all catalogued Kubernetes objects',
    keywords: ['browse', 'inventory', 'cluster', 'catalog', 'objects'],
    refresher: 'catalog',
  },
  {
    scope: 'cluster',
    id: 'events',
    label: 'Events',
    description: 'Review cluster events associated with recent changes and operations',
    keywords: ['events', 'change', 'changes', 'cluster', 'logs', 'history'],
    refresher: 'cluster-events',
  },
  {
    scope: 'cluster',
    id: 'nodes',
    label: 'Nodes',
    description: 'Inspect node health, scheduling, and capacity',
    keywords: ['nodes', 'capacity', 'cluster', 'servers', 'machines'],
    refresher: 'cluster-nodes',
  },
  {
    scope: 'cluster',
    id: 'config',
    label: 'Config',
    description: 'View cluster configuration resources',
    keywords: ['config', 'cluster', 'ingress', 'classes'],
    refresher: 'cluster-config',
  },
  {
    scope: 'cluster',
    id: 'storage',
    label: 'Storage',
    description: 'View persistent volumes and storage classes',
    keywords: ['storage', 'cluster', 'volumes', 'pvs', 'persistent', 'classes'],
    refresher: 'cluster-storage',
  },
  {
    scope: 'cluster',
    id: 'crds',
    label: 'CRDs',
    description: 'View custom resource definitions',
    keywords: ['crds', 'cluster', 'custom', 'resources', 'definitions'],
    refresher: 'cluster-crds',
  },
  {
    scope: 'cluster',
    id: 'custom',
    label: 'Custom',
    description: 'View cluster-scoped custom resources',
    keywords: ['custom', 'cluster', 'custom resources', 'crs'],
    refresher: null,
  },
  {
    scope: 'cluster',
    id: 'rbac',
    label: 'RBAC',
    description: 'View cluster RBAC resources',
    keywords: ['rbac', 'cluster', 'security', 'roles', 'bindings', 'admission'],
    refresher: 'cluster-rbac',
  },
] as const satisfies readonly ViewDescriptor<'cluster', string>[];

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
  const descriptors: readonly RegisteredViewDescriptor[] =
    scope === 'global'
      ? GLOBAL_VIEW_DESCRIPTORS
      : scope === 'cluster'
        ? CLUSTER_VIEW_DESCRIPTORS
        : NAMESPACE_VIEW_DESCRIPTORS;
  return descriptors.find((descriptor) => descriptor.id === id);
};
