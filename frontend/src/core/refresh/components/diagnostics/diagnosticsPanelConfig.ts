/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts
 *
 * Shared configuration for refresh diagnostics. It adapts the authored refresh
 * domain contract into UI metadata so DiagnosticsPanel does not maintain a
 * second list of domain behavior rules.
 */

import {
  PERMISSION_FEATURES,
  type PermissionFeatureKey,
} from '@/core/capabilities/permissionFeatures';
import { doorbellPollingContinues } from '@/core/refresh/streaming/resourceStreamDomains';
import type { ClusterViewType, NamespaceViewType, ViewType } from '@/types/navigation/views';
import {
  refreshDomainContract,
  refreshDomainDescriptors,
  type StreamTelemetryName,
} from '../../domainRegistry';
import type { RefreshDomain } from '../../types';

export { DOMAIN_REFRESHER_MAP, DOMAIN_STREAM_MAP, PRIORITY_DOMAINS } from '../../domainRegistry';

export const STALE_THRESHOLD_MS = 45_000;
export const CLUSTER_SCOPE = '__cluster__';

export const STREAM_ONLY_DOMAINS = new Set<RefreshDomain>(
  Object.entries(refreshDomainContract.domainInventory)
    .filter(([, entry]) => entry.cachePolicy === 'stream-only')
    .map(([domain]) => domain as RefreshDomain)
);

export const PAUSE_POLLING_WHEN_STREAMING_DOMAINS = new Set<RefreshDomain>(
  refreshDomainDescriptors
    .filter(
      (descriptor) =>
        descriptor.diagnosticsStream &&
        !STREAM_ONLY_DOMAINS.has(descriptor.domain) &&
        // Poll-augmented doorbell domains (cluster-overview) keep polling
        // while streaming — their doorbell's signal source is not guaranteed
        // to ever fire, so diagnostics must not report their polls as paused.
        !doorbellPollingContinues(descriptor.domain)
    )
    .map((descriptor) => descriptor.domain)
);

export const STREAM_MODE_BY_NAME: Record<StreamTelemetryName, 'streaming' | 'watch'> = {
  resources: 'streaming',
  events: 'watch',
  catalog: 'watch',
  'container-logs': 'streaming',
};

const OVERVIEW_FEATURES = [PERMISSION_FEATURES.clusterOverview] as const;

const CLUSTER_FEATURE_MAP: Record<ClusterViewType, readonly PermissionFeatureKey[]> = {
  attention: [],
  namespaces: [], // The view is backed by the permission-gated namespaces domain.
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
  workloads: [PERMISSION_FEATURES.namespaceWorkloads, PERMISSION_FEATURES.namespacePods],
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
  if (viewType === 'global') {
    // Global views aggregate independently permission-gated per-cluster scopes;
    // selected-cluster permission rows would not describe that workspace.
    return [];
  }
  if (viewType === 'cluster') {
    return clusterTab ? (CLUSTER_FEATURE_MAP[clusterTab] ?? []) : [];
  }
  if (viewType === 'namespace') {
    return NAMESPACE_FEATURE_MAP[namespaceTab] ?? [];
  }
  return [];
};
