/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts
 *
 * UI component for diagnosticsPanelConfig.
 * Handles rendering and interactions for the shared components.
 */

import type { RefreshDomain } from '../../types';
import {
  CLUSTER_REFRESHERS,
  NAMESPACE_REFRESHERS,
  SYSTEM_REFRESHERS,
  type RefresherName,
} from '../../refresherTypes';
import type { ClusterViewType, NamespaceViewType, ViewType } from '@/types/navigation/views';
import {
  PERMISSION_FEATURES,
  type PermissionFeatureKey,
} from '@/core/capabilities/permissionFeatures';

export const STALE_THRESHOLD_MS = 45_000;
export const CLUSTER_SCOPE = '__cluster__';

const OVERVIEW_FEATURES = [PERMISSION_FEATURES.clusterOverview] as const;

const CLUSTER_FEATURE_MAP: Record<ClusterViewType, readonly PermissionFeatureKey[]> = {
  nodes: [PERMISSION_FEATURES.clusterNodes, PERMISSION_FEATURES.nodeActions],
  rbac: [PERMISSION_FEATURES.clusterRBAC],
  storage: [PERMISSION_FEATURES.storageView, PERMISSION_FEATURES.storageActions],
  config: [PERMISSION_FEATURES.clusterConfig],
  crds: [PERMISSION_FEATURES.clusterCRDs],
  custom: [PERMISSION_FEATURES.clusterCustom],
  events: [PERMISSION_FEATURES.clusterEvents],
  browse: [], // Empty = show all cluster-scoped permissions (browse spans all resource types).
};

const NAMESPACE_FEATURE_MAP: Record<NamespaceViewType, readonly PermissionFeatureKey[]> = {
  browse: [], // Empty = show all namespace-scoped permissions (browse spans all resource types).
  map: [PERMISSION_FEATURES.objectMapResources],
  pods: [PERMISSION_FEATURES.namespacePods],
  workloads: [PERMISSION_FEATURES.namespaceWorkloads],
  config: [PERMISSION_FEATURES.namespaceConfig],
  network: [PERMISSION_FEATURES.namespaceNetwork],
  rbac: [PERMISSION_FEATURES.namespaceRBAC],
  storage: [PERMISSION_FEATURES.namespaceStorage],
  autoscaling: [PERMISSION_FEATURES.namespaceAutoscaling],
  quotas: [PERMISSION_FEATURES.namespaceQuotas],
  custom: [PERMISSION_FEATURES.namespaceCustom],
  helm: [PERMISSION_FEATURES.namespaceHelm],
  events: [PERMISSION_FEATURES.namespaceEvents],
};

export const getScopedFeaturesForView = (
  viewType: ViewType,
  clusterTab: ClusterViewType | null,
  namespaceTab: NamespaceViewType
): readonly PermissionFeatureKey[] => {
  if (viewType === 'overview') {
    return OVERVIEW_FEATURES;
  }
  if (viewType === 'cluster') {
    return clusterTab ? (CLUSTER_FEATURE_MAP[clusterTab] ?? []) : [];
  }
  if (viewType === 'namespace') {
    return NAMESPACE_FEATURE_MAP[namespaceTab] ?? [];
  }
  return [];
};

export const DOMAIN_REFRESHER_MAP: Partial<Record<RefreshDomain, RefresherName>> = {
  namespaces: SYSTEM_REFRESHERS.namespaces,
  'cluster-overview': SYSTEM_REFRESHERS.clusterOverview,
  nodes: CLUSTER_REFRESHERS.nodes,
  'object-maintenance': SYSTEM_REFRESHERS.objectMaintenance,
  pods: SYSTEM_REFRESHERS.unifiedPods,
  'cluster-config': CLUSTER_REFRESHERS.config,
  'cluster-crds': CLUSTER_REFRESHERS.crds,
  'cluster-custom': CLUSTER_REFRESHERS.custom,
  'cluster-events': CLUSTER_REFRESHERS.events,
  catalog: CLUSTER_REFRESHERS.browse,
  'catalog-diff': CLUSTER_REFRESHERS.catalogDiff,
  'cluster-rbac': CLUSTER_REFRESHERS.rbac,
  'cluster-storage': CLUSTER_REFRESHERS.storage,
  'namespace-workloads': NAMESPACE_REFRESHERS.workloads,
  'namespace-autoscaling': NAMESPACE_REFRESHERS.autoscaling,
  'namespace-config': NAMESPACE_REFRESHERS.config,
  'namespace-custom': NAMESPACE_REFRESHERS.custom,
  'namespace-helm': NAMESPACE_REFRESHERS.helm,
  'namespace-events': NAMESPACE_REFRESHERS.events,
  'namespace-network': NAMESPACE_REFRESHERS.network,
  'namespace-quotas': NAMESPACE_REFRESHERS.quotas,
  'namespace-rbac': NAMESPACE_REFRESHERS.rbac,
  'namespace-storage': NAMESPACE_REFRESHERS.storage,
  'container-logs': SYSTEM_REFRESHERS.containerLogs,
  'object-map': SYSTEM_REFRESHERS.objectMap,
};

// Stream telemetry names for diagnostics (only set for stream-backed domains).
export const DOMAIN_STREAM_MAP: Partial<Record<RefreshDomain, string>> = {
  pods: 'resources',
  'namespace-workloads': 'resources',
  'namespace-config': 'resources',
  'namespace-network': 'resources',
  'namespace-rbac': 'resources',
  'namespace-custom': 'resources',
  'namespace-helm': 'resources',
  'namespace-autoscaling': 'resources',
  'namespace-quotas': 'resources',
  'namespace-storage': 'resources',
  nodes: 'resources',
  'cluster-rbac': 'resources',
  'cluster-storage': 'resources',
  'cluster-config': 'resources',
  'cluster-crds': 'resources',
  'cluster-custom': 'resources',
  'cluster-events': 'events',
  'namespace-events': 'events',
  catalog: 'catalog',
  'container-logs': 'container-logs',
};

export const PRIORITY_DOMAINS: RefreshDomain[] = [
  'namespaces',
  'nodes',
  'object-maintenance',
  'cluster-overview',
  'catalog',
  'namespace-workloads',
];
