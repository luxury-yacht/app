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

export const STALE_THRESHOLD_MS = 45_000;
export const CLUSTER_SCOPE = '__cluster__';

const OVERVIEW_FEATURES = ['Cluster overview'] as const;

const CLUSTER_FEATURE_MAP: Record<ClusterViewType, readonly string[]> = {
  nodes: ['Nodes table', 'Node actions (cordon/drain)', 'Node actions', 'Namespace workloads'],
  rbac: ['Cluster RBAC'],
  storage: ['Storage view', 'Storage actions'],
  config: ['Cluster config'],
  crds: ['Cluster CRDs'],
  custom: ['Cluster custom resources'],
  events: ['Cluster events'],
  browse: ['Browse catalog'],
};

const NAMESPACE_FEATURE_MAP: Record<NamespaceViewType, readonly string[]> = {
  objects: ['Namespace objects catalog'],
  pods: ['Namespace pods'],
  workloads: ['Namespace workloads'],
  config: ['Namespace config'],
  network: ['Namespace network'],
  rbac: ['Namespace RBAC'],
  storage: ['Namespace storage'],
  autoscaling: ['Namespace autoscaling'],
  quotas: ['Namespace quotas'],
  custom: [],
  helm: [],
  events: ['Namespace events'],
};

export const getScopedFeaturesForView = (
  viewType: ViewType,
  clusterTab: ClusterViewType | null,
  namespaceTab: NamespaceViewType
): readonly string[] => {
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
  'node-maintenance': CLUSTER_REFRESHERS.nodeMaintenance,
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
  'object-logs': SYSTEM_REFRESHERS.objectLogs,
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
  'cluster-events': 'events',
  'namespace-events': 'events',
  catalog: 'catalog',
  'object-logs': 'object-logs',
};

export const PRIORITY_DOMAINS: RefreshDomain[] = [
  'namespaces',
  'nodes',
  'node-maintenance',
  'cluster-overview',
  'catalog',
  'namespace-workloads',
];
