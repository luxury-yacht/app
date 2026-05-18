export const PERMISSION_FEATURES = {
  clusterOverview: 'cluster.overview',
  clusterNodes: 'cluster.nodes',
  nodeActions: 'cluster.nodeActions',
  storageView: 'cluster.storageView',
  storageActions: 'cluster.storageActions',
  clusterConfig: 'cluster.config',
  clusterRBAC: 'cluster.rbac',
  clusterCRDs: 'cluster.crds',
  clusterCustom: 'cluster.custom',
  clusterEvents: 'cluster.events',
  namespacePods: 'namespace.pods',
  namespaceWorkloads: 'namespace.workloads',
  namespaceConfig: 'namespace.config',
  namespaceNetwork: 'namespace.network',
  namespaceRBAC: 'namespace.rbac',
  namespaceStorage: 'namespace.storage',
  namespaceAutoscaling: 'namespace.autoscaling',
  namespaceQuotas: 'namespace.quotas',
  namespaceCustom: 'namespace.custom',
  namespaceHelm: 'namespace.helm',
  namespaceEvents: 'namespace.events',
  objectMapResources: 'namespace.objectMap',
  other: 'other',
} as const;

export type PermissionFeatureKey = (typeof PERMISSION_FEATURES)[keyof typeof PERMISSION_FEATURES];

export const PERMISSION_FEATURE_LABELS: Record<PermissionFeatureKey, string> = {
  [PERMISSION_FEATURES.clusterOverview]: 'Cluster overview',
  [PERMISSION_FEATURES.clusterNodes]: 'Nodes table',
  [PERMISSION_FEATURES.nodeActions]: 'Node actions',
  [PERMISSION_FEATURES.storageView]: 'Storage view',
  [PERMISSION_FEATURES.storageActions]: 'Storage actions',
  [PERMISSION_FEATURES.clusterConfig]: 'Cluster config',
  [PERMISSION_FEATURES.clusterRBAC]: 'Cluster RBAC',
  [PERMISSION_FEATURES.clusterCRDs]: 'Cluster CRDs',
  [PERMISSION_FEATURES.clusterCustom]: 'Cluster custom',
  [PERMISSION_FEATURES.clusterEvents]: 'Cluster events',
  [PERMISSION_FEATURES.namespacePods]: 'Namespace pods',
  [PERMISSION_FEATURES.namespaceWorkloads]: 'Namespace workloads',
  [PERMISSION_FEATURES.namespaceConfig]: 'Namespace config',
  [PERMISSION_FEATURES.namespaceNetwork]: 'Namespace network',
  [PERMISSION_FEATURES.namespaceRBAC]: 'Namespace RBAC',
  [PERMISSION_FEATURES.namespaceStorage]: 'Namespace storage',
  [PERMISSION_FEATURES.namespaceAutoscaling]: 'Namespace autoscaling',
  [PERMISSION_FEATURES.namespaceQuotas]: 'Namespace quotas',
  [PERMISSION_FEATURES.namespaceCustom]: 'Namespace custom resources',
  [PERMISSION_FEATURES.namespaceHelm]: 'Namespace helm',
  [PERMISSION_FEATURES.namespaceEvents]: 'Namespace events',
  [PERMISSION_FEATURES.objectMapResources]: 'Object map resources',
  [PERMISSION_FEATURES.other]: 'Other',
};

export const permissionFeatureLabel = (feature: string | null | undefined): string | null => {
  if (!feature) {
    return null;
  }
  return PERMISSION_FEATURE_LABELS[feature as PermissionFeatureKey] ?? feature;
};
