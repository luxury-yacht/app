/**
 * Canonical metadata for the global, cluster, and namespace views exposed by the app shell.
 *
 * Keep this module React-free: refresh infrastructure, persistence boundaries,
 * and UI navigation all consume the same vocabulary.
 */

export type ViewScope = 'global' | 'cluster' | 'namespace';

export type ViewIntent =
  | 'applications'
  | 'compute'
  | 'configuration'
  | 'extensions'
  | 'governance'
  | 'inventory'
  | 'network'
  | 'operations'
  | 'security'
  | 'storage'
  | 'topology';

export const NAVIGATION_GROUPS = [
  {
    id: 'observe',
    label: 'Observe',
    intents: ['inventory', 'topology', 'operations'],
  },
  {
    id: 'run',
    label: 'Run',
    intents: ['compute', 'applications'],
  },
  {
    id: 'configure',
    label: 'Configure',
    intents: ['configuration', 'network', 'storage'],
  },
  {
    id: 'govern',
    label: 'Govern',
    intents: ['security', 'governance', 'extensions'],
  },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly intents: readonly ViewIntent[];
}[];

interface ViewDescriptor<Scope extends ViewScope, Id extends string> {
  readonly scope: Scope;
  readonly id: Id;
  readonly label: string;
  readonly intent: ViewIntent;
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
    intent: 'inventory',
    description: 'Compare health, capacity, and access across open clusters',
    keywords: ['fleet', 'clusters', 'global', 'compare', 'health', 'capacity', 'access'],
    refresher: null,
  },
] as const satisfies readonly ViewDescriptor<'global', string>[];

export const CLUSTER_VIEW_DESCRIPTORS = [
  {
    scope: 'cluster',
    id: 'namespaces',
    label: 'Namespaces',
    intent: 'inventory',
    description: 'Compare health, workloads, events, utilization, and quotas across namespaces',
    keywords: ['namespaces', 'cluster', 'health', 'workloads', 'events', 'utilization', 'quotas'],
    refresher: null,
  },
  {
    scope: 'cluster',
    id: 'attention',
    label: 'Needs Attention',
    intent: 'operations',
    description: 'Show unhealthy workloads across all namespaces',
    keywords: ['attention', 'cluster', 'unhealthy', 'warning', 'errors', 'workloads'],
    refresher: null,
  },
  {
    scope: 'cluster',
    id: 'browse',
    label: 'Browse',
    intent: 'inventory',
    description: 'Inspect the inventory of all catalogued Kubernetes objects',
    keywords: ['browse', 'inventory', 'cluster', 'catalog', 'objects'],
    refresher: 'catalog',
  },
  {
    scope: 'cluster',
    id: 'nodes',
    label: 'Nodes',
    intent: 'compute',
    description: 'Inspect node health, scheduling, and capacity',
    keywords: ['nodes', 'capacity', 'cluster', 'servers', 'machines'],
    refresher: 'cluster-nodes',
  },
  {
    scope: 'cluster',
    id: 'config',
    label: 'Config',
    intent: 'configuration',
    description: 'View cluster configuration resources',
    keywords: ['config', 'cluster', 'ingress', 'classes'],
    refresher: 'cluster-config',
  },
  {
    scope: 'cluster',
    id: 'crds',
    label: 'CRDs',
    intent: 'extensions',
    description: 'View custom resource definitions',
    keywords: ['crds', 'cluster', 'custom', 'resources', 'definitions'],
    refresher: 'cluster-crds',
  },
  {
    scope: 'cluster',
    id: 'custom',
    label: 'Custom',
    intent: 'extensions',
    description: 'View cluster-scoped custom resources',
    keywords: ['custom', 'cluster', 'custom resources', 'crs'],
    refresher: null,
  },
  {
    scope: 'cluster',
    id: 'events',
    label: 'Events',
    intent: 'operations',
    description: 'Review cluster events associated with recent changes and operations',
    keywords: ['events', 'change', 'changes', 'cluster', 'logs', 'history'],
    refresher: 'cluster-events',
  },
  {
    scope: 'cluster',
    id: 'rbac',
    label: 'RBAC',
    intent: 'security',
    description: 'View cluster RBAC resources',
    keywords: ['rbac', 'cluster', 'security', 'roles', 'bindings', 'admission'],
    refresher: 'cluster-rbac',
  },
  {
    scope: 'cluster',
    id: 'storage',
    label: 'Storage',
    intent: 'storage',
    description: 'View persistent volumes and storage classes',
    keywords: ['storage', 'cluster', 'volumes', 'pvs', 'persistent', 'classes'],
    refresher: 'cluster-storage',
  },
] as const satisfies readonly ViewDescriptor<'cluster', string>[];

export const NAMESPACE_VIEW_DESCRIPTORS = [
  {
    scope: 'namespace',
    id: 'browse',
    supportsAllNamespaces: true,
    label: 'Browse',
    intent: 'inventory',
    description: 'Inspect the inventory of catalogued Kubernetes objects in this namespace',
    keywords: ['browse', 'inventory', 'namespace', 'catalog', 'objects'],
    refresher: null,
  },
  {
    scope: 'namespace',
    id: 'map',
    supportsAllNamespaces: false,
    label: 'Map',
    intent: 'topology',
    description: 'Map relationships between objects in this namespace',
    keywords: ['map', 'namespace', 'topology', 'relationships', 'objects'],
    refresher: null,
  },
  {
    scope: 'namespace',
    id: 'applications',
    supportsAllNamespaces: true,
    label: 'Applications',
    intent: 'applications',
    description: 'Group workloads by Helm, owner, and recommended application metadata',
    keywords: ['applications', 'namespace', 'helm', 'owners', 'labels', 'workloads'],
    refresher: 'applications',
  },
  {
    scope: 'namespace',
    id: 'workloads',
    supportsAllNamespaces: true,
    label: 'Workloads',
    intent: 'compute',
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
    id: 'pods',
    supportsAllNamespaces: true,
    label: 'Pods',
    intent: 'compute',
    description: 'View pods and their current status',
    keywords: ['pods', 'namespace', 'containers', 'workloads'],
    refresher: null,
  },
  {
    scope: 'namespace',
    id: 'autoscaling',
    supportsAllNamespaces: true,
    label: 'Autoscaling',
    intent: 'compute',
    description: 'View horizontal pod autoscalers',
    keywords: ['autoscaling', 'namespace', 'hpa', 'scaling'],
    refresher: 'autoscaling',
  },
  {
    scope: 'namespace',
    id: 'config',
    supportsAllNamespaces: true,
    label: 'Config',
    intent: 'configuration',
    description: 'View configmaps and secrets',
    keywords: ['config', 'namespace', 'configmaps', 'secrets'],
    refresher: 'config',
  },
  {
    scope: 'namespace',
    id: 'custom',
    supportsAllNamespaces: true,
    label: 'Custom',
    intent: 'extensions',
    description: 'View custom resources',
    keywords: ['custom', 'namespace', 'resources', 'crs'],
    refresher: null,
  },
  {
    scope: 'namespace',
    id: 'events',
    supportsAllNamespaces: true,
    label: 'Events',
    intent: 'operations',
    description: 'Review namespace events associated with recent changes and operations',
    keywords: ['events', 'change', 'changes', 'namespace', 'logs', 'history'],
    refresher: 'events',
  },
  {
    scope: 'namespace',
    id: 'helm',
    supportsAllNamespaces: true,
    label: 'Helm',
    intent: 'applications',
    description: 'View Helm releases',
    keywords: ['helm', 'namespace', 'charts', 'releases'],
    refresher: 'helm',
  },
  {
    scope: 'namespace',
    id: 'network',
    supportsAllNamespaces: true,
    label: 'Network',
    intent: 'network',
    description: 'View services and ingresses',
    keywords: ['network', 'namespace', 'services', 'ingress'],
    refresher: 'network',
  },
  {
    scope: 'namespace',
    id: 'quotas',
    supportsAllNamespaces: true,
    label: 'Quotas',
    intent: 'governance',
    description: 'View resource quotas and limits',
    keywords: ['quotas', 'namespace', 'limits', 'resources'],
    refresher: 'quotas',
  },
  {
    scope: 'namespace',
    id: 'rbac',
    supportsAllNamespaces: true,
    label: 'RBAC',
    intent: 'security',
    description: 'View roles and bindings',
    keywords: ['rbac', 'namespace', 'security', 'roles', 'bindings'],
    refresher: 'rbac',
  },
  {
    scope: 'namespace',
    id: 'storage',
    supportsAllNamespaces: true,
    label: 'Storage',
    intent: 'storage',
    description: 'View persistent volume claims',
    keywords: ['storage', 'namespace', 'pvcs', 'claims'],
    refresher: 'storage',
  },
] as const satisfies readonly ViewDescriptor<'namespace', string>[];

export type ClusterViewDescriptor = (typeof CLUSTER_VIEW_DESCRIPTORS)[number];
export type GlobalViewDescriptor = (typeof GLOBAL_VIEW_DESCRIPTORS)[number];
export type NamespaceViewDescriptor = (typeof NAMESPACE_VIEW_DESCRIPTORS)[number];
export type GlobalViewType = GlobalViewDescriptor['id'];
// Global views currently retain their stable cluster-route ids so saved
// favorites and table state continue to resolve after the presentation move.
export type ClusterViewType = ClusterViewDescriptor['id'] | GlobalViewType;
export type NamespaceViewType = NamespaceViewDescriptor['id'];
export type RegisteredViewDescriptor =
  | GlobalViewDescriptor
  | ClusterViewDescriptor
  | NamespaceViewDescriptor;

export const CLUSTER_ROUTE_VIEW_DESCRIPTORS = [
  ...GLOBAL_VIEW_DESCRIPTORS,
  ...CLUSTER_VIEW_DESCRIPTORS,
] as const;

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

export const groupViewDescriptors = <Descriptor extends { readonly intent: ViewIntent }>(
  descriptors: readonly Descriptor[]
): Array<{
  id: (typeof NAVIGATION_GROUPS)[number]['id'];
  label: string;
  views: Descriptor[];
}> =>
  NAVIGATION_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    views: descriptors.filter((descriptor) =>
      (group.intents as readonly ViewIntent[]).includes(descriptor.intent)
    ),
  })).filter((group) => group.views.length > 0);
