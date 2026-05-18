/**
 * Static permission spec lists for the SSRR permission system.
 *
 * Feature keys are kept in sync with the diagnostics panel config
 * and the capability catalog.
 */

import type { PermissionSpec } from './permissionTypes';
import { PERMISSION_FEATURES, type PermissionFeatureKey } from './permissionFeatures';

export interface PermissionSpecList {
  feature: PermissionFeatureKey;
  specs: PermissionSpec[];
}

// ---------------------------------------------------------------------------
// Namespace-scoped permission spec lists
// ---------------------------------------------------------------------------

export const WORKLOAD_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespaceWorkloads,
  specs: [
    { kind: 'Deployment', verb: 'list' },
    { kind: 'Deployment', verb: 'patch' },
    { kind: 'Deployment', verb: 'update' },
    { kind: 'Deployment', verb: 'delete' },
    { kind: 'Deployment', verb: 'update', subresource: 'scale' },
    { kind: 'StatefulSet', verb: 'list' },
    { kind: 'StatefulSet', verb: 'patch' },
    { kind: 'StatefulSet', verb: 'update' },
    { kind: 'StatefulSet', verb: 'delete' },
    { kind: 'StatefulSet', verb: 'update', subresource: 'scale' },
    { kind: 'ReplicaSet', verb: 'update', subresource: 'scale' },
    { kind: 'DaemonSet', verb: 'list' },
    { kind: 'DaemonSet', verb: 'patch' },
    { kind: 'DaemonSet', verb: 'update' },
    { kind: 'DaemonSet', verb: 'delete' },
    { kind: 'Job', verb: 'list' },
    { kind: 'Job', verb: 'create' },
    { kind: 'Job', verb: 'delete' },
    { kind: 'CronJob', verb: 'list' },
    { kind: 'CronJob', verb: 'patch' },
    { kind: 'CronJob', verb: 'delete' },
  ],
};

export const POD_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespacePods,
  specs: [
    { kind: 'Pod', verb: 'list' },
    { kind: 'Pod', verb: 'delete' },
    { kind: 'Pod', verb: 'get', subresource: 'log' },
    { kind: 'Pod', verb: 'create', subresource: 'portforward' },
  ],
};

export const CONFIG_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespaceConfig,
  specs: [
    { kind: 'ConfigMap', verb: 'list' },
    { kind: 'ConfigMap', verb: 'delete' },
    { kind: 'Secret', verb: 'list' },
    { kind: 'Secret', verb: 'delete' },
  ],
};

export const NETWORK_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespaceNetwork,
  specs: [
    { kind: 'Service', verb: 'list' },
    { kind: 'Service', verb: 'delete' },
    { kind: 'Ingress', verb: 'list' },
    { kind: 'Ingress', verb: 'delete' },
    { kind: 'NetworkPolicy', verb: 'list' },
    { kind: 'NetworkPolicy', verb: 'delete' },
    { kind: 'EndpointSlice', verb: 'list' },
    { kind: 'EndpointSlice', verb: 'delete' },
    { kind: 'Gateway', verb: 'list' },
    { kind: 'Gateway', verb: 'delete' },
    { kind: 'HTTPRoute', verb: 'list' },
    { kind: 'HTTPRoute', verb: 'delete' },
    { kind: 'GRPCRoute', verb: 'list' },
    { kind: 'GRPCRoute', verb: 'delete' },
    { kind: 'TLSRoute', verb: 'list' },
    { kind: 'TLSRoute', verb: 'delete' },
    { kind: 'ListenerSet', verb: 'list' },
    { kind: 'ListenerSet', verb: 'delete' },
    { kind: 'BackendTLSPolicy', verb: 'list' },
    { kind: 'BackendTLSPolicy', verb: 'delete' },
    { kind: 'ReferenceGrant', verb: 'list' },
    { kind: 'ReferenceGrant', verb: 'delete' },
  ],
};

export const RBAC_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespaceRBAC,
  specs: [
    { kind: 'Role', verb: 'list' },
    { kind: 'Role', verb: 'delete' },
    { kind: 'RoleBinding', verb: 'list' },
    { kind: 'RoleBinding', verb: 'delete' },
    { kind: 'ServiceAccount', verb: 'list' },
    { kind: 'ServiceAccount', verb: 'delete' },
  ],
};

export const STORAGE_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespaceStorage,
  specs: [
    { kind: 'PersistentVolumeClaim', verb: 'list' },
    { kind: 'PersistentVolumeClaim', verb: 'delete' },
  ],
};

export const AUTOSCALING_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespaceAutoscaling,
  specs: [
    { kind: 'HorizontalPodAutoscaler', verb: 'list' },
    { kind: 'HorizontalPodAutoscaler', verb: 'delete' },
  ],
};

export const QUOTA_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespaceQuotas,
  specs: [
    { kind: 'ResourceQuota', verb: 'list' },
    { kind: 'ResourceQuota', verb: 'delete' },
    { kind: 'LimitRange', verb: 'list' },
    { kind: 'LimitRange', verb: 'delete' },
    { kind: 'PodDisruptionBudget', verb: 'list' },
    { kind: 'PodDisruptionBudget', verb: 'delete' },
  ],
};

export const EVENT_PERMISSIONS: PermissionSpecList = {
  feature: PERMISSION_FEATURES.namespaceEvents,
  specs: [{ kind: 'Event', verb: 'list' }],
};

/** All namespace-scoped permission spec lists combined. */
export const ALL_NAMESPACE_PERMISSIONS: PermissionSpecList[] = [
  WORKLOAD_PERMISSIONS,
  POD_PERMISSIONS,
  CONFIG_PERMISSIONS,
  NETWORK_PERMISSIONS,
  RBAC_PERMISSIONS,
  STORAGE_PERMISSIONS,
  AUTOSCALING_PERMISSIONS,
  QUOTA_PERMISSIONS,
  EVENT_PERMISSIONS,
];

// ---------------------------------------------------------------------------
// Cluster-scoped permission spec lists
// ---------------------------------------------------------------------------

/**
 * Cluster permissions mirror the verbs from CLUSTER_CAPABILITIES in catalog.ts.
 * Feature keys match CLUSTER_FEATURE_MAP in diagnosticsPanelConfig.ts.
 */
export const CLUSTER_PERMISSIONS: PermissionSpecList[] = [
  {
    feature: PERMISSION_FEATURES.clusterOverview,
    specs: [
      { kind: 'Namespace', verb: 'list' },
      { kind: 'Namespace', verb: 'update' },
      { kind: 'Namespace', verb: 'create' },
      { kind: 'Namespace', verb: 'delete' },
    ],
  },
  {
    feature: PERMISSION_FEATURES.clusterNodes,
    specs: [
      { kind: 'Node', verb: 'list' },
      { kind: 'Node', verb: 'get' },
    ],
  },
  {
    feature: PERMISSION_FEATURES.nodeActions,
    specs: [
      { kind: 'Node', verb: 'update' },
      { kind: 'Node', verb: 'delete' },
      { kind: 'Node', verb: 'get' },
      { kind: 'Node', verb: 'patch' },
      { kind: 'Pod', verb: 'create', subresource: 'eviction' },
      { kind: 'Pod', verb: 'delete' },
    ],
  },
  {
    feature: PERMISSION_FEATURES.storageView,
    specs: [
      { kind: 'PersistentVolume', verb: 'list' },
      { kind: 'PersistentVolume', verb: 'update' },
    ],
  },
  {
    feature: PERMISSION_FEATURES.storageActions,
    specs: [{ kind: 'PersistentVolume', verb: 'delete' }],
  },
  {
    feature: PERMISSION_FEATURES.clusterConfig,
    specs: [
      { kind: 'StorageClass', verb: 'list' },
      { kind: 'StorageClass', verb: 'update' },
      { kind: 'StorageClass', verb: 'delete' },
      { kind: 'IngressClass', verb: 'list' },
      { kind: 'IngressClass', verb: 'update' },
      { kind: 'IngressClass', verb: 'delete' },
      { kind: 'GatewayClass', verb: 'list' },
      { kind: 'GatewayClass', verb: 'update' },
      { kind: 'GatewayClass', verb: 'delete' },
      { kind: 'MutatingWebhookConfiguration', verb: 'list' },
      { kind: 'MutatingWebhookConfiguration', verb: 'update' },
      { kind: 'MutatingWebhookConfiguration', verb: 'delete' },
      { kind: 'ValidatingWebhookConfiguration', verb: 'list' },
      { kind: 'ValidatingWebhookConfiguration', verb: 'update' },
      { kind: 'ValidatingWebhookConfiguration', verb: 'delete' },
    ],
  },
  {
    feature: PERMISSION_FEATURES.clusterRBAC,
    specs: [
      { kind: 'ClusterRole', verb: 'list' },
      { kind: 'ClusterRole', verb: 'update' },
      { kind: 'ClusterRole', verb: 'delete' },
      { kind: 'ClusterRoleBinding', verb: 'list' },
      { kind: 'ClusterRoleBinding', verb: 'update' },
      { kind: 'ClusterRoleBinding', verb: 'delete' },
    ],
  },
  {
    feature: PERMISSION_FEATURES.clusterCRDs,
    specs: [
      { kind: 'CustomResourceDefinition', verb: 'list' },
      { kind: 'CustomResourceDefinition', verb: 'update' },
      { kind: 'CustomResourceDefinition', verb: 'delete' },
    ],
  },
  {
    feature: PERMISSION_FEATURES.clusterEvents,
    specs: [{ kind: 'Event', verb: 'list' }],
  },
];
