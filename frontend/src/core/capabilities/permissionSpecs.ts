/**
 * Static permission spec lists for the SSRR permission system.
 *
 * Feature strings are kept in sync with the diagnostics panel config
 * (diagnosticsPanelConfig.ts NAMESPACE_FEATURE_MAP / CLUSTER_FEATURE_MAP)
 * and the capability catalog (catalog.ts CLUSTER_CAPABILITIES).
 */

import type { PermissionSpec } from './permissionTypes';

export interface PermissionSpecList {
  feature: string;
  specs: PermissionSpec[];
}

// ---------------------------------------------------------------------------
// Namespace-scoped permission spec lists
// ---------------------------------------------------------------------------

export const WORKLOAD_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace workloads',
  specs: [
    { kind: 'Deployment', verb: 'list' },
    { kind: 'Deployment', verb: 'patch' },
    { kind: 'Deployment', verb: 'delete' },
    { kind: 'Deployment', verb: 'update', subresource: 'scale' },
    { kind: 'StatefulSet', verb: 'list' },
    { kind: 'StatefulSet', verb: 'patch' },
    { kind: 'StatefulSet', verb: 'delete' },
    { kind: 'StatefulSet', verb: 'update', subresource: 'scale' },
    { kind: 'ReplicaSet', verb: 'update', subresource: 'scale' },
    { kind: 'DaemonSet', verb: 'list' },
    { kind: 'DaemonSet', verb: 'patch' },
    { kind: 'DaemonSet', verb: 'delete' },
    { kind: 'Job', verb: 'list' },
    { kind: 'Job', verb: 'delete' },
    { kind: 'CronJob', verb: 'list' },
    { kind: 'CronJob', verb: 'delete' },
    { kind: 'Pod', verb: 'list' },
    { kind: 'Pod', verb: 'delete' },
    { kind: 'Pod', verb: 'get', subresource: 'log' },
    { kind: 'Pod', verb: 'create', subresource: 'portforward' },
  ],
};

export const CONFIG_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace config',
  specs: [
    { kind: 'ConfigMap', verb: 'list' },
    { kind: 'ConfigMap', verb: 'delete' },
    { kind: 'Secret', verb: 'list' },
    { kind: 'Secret', verb: 'delete' },
  ],
};

export const NETWORK_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace network',
  specs: [
    { kind: 'Service', verb: 'list' },
    { kind: 'Service', verb: 'delete' },
    { kind: 'Ingress', verb: 'list' },
    { kind: 'Ingress', verb: 'delete' },
    { kind: 'NetworkPolicy', verb: 'list' },
    { kind: 'NetworkPolicy', verb: 'delete' },
    { kind: 'EndpointSlice', verb: 'list' },
    { kind: 'EndpointSlice', verb: 'delete' },
  ],
};

export const RBAC_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace RBAC',
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
  feature: 'Namespace storage',
  specs: [
    { kind: 'PersistentVolumeClaim', verb: 'list' },
    { kind: 'PersistentVolumeClaim', verb: 'delete' },
  ],
};

export const AUTOSCALING_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace autoscaling',
  specs: [
    { kind: 'HorizontalPodAutoscaler', verb: 'list' },
    { kind: 'HorizontalPodAutoscaler', verb: 'delete' },
  ],
};

export const QUOTA_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace quotas',
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
  feature: 'Namespace events',
  specs: [{ kind: 'Event', verb: 'list' }],
};

/** All namespace-scoped permission spec lists combined. */
export const ALL_NAMESPACE_PERMISSIONS: PermissionSpecList[] = [
  WORKLOAD_PERMISSIONS,
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
 * Feature strings match CLUSTER_FEATURE_MAP in diagnosticsPanelConfig.ts.
 */
export const CLUSTER_PERMISSIONS: PermissionSpecList[] = [
  {
    feature: 'Cluster overview',
    specs: [
      { kind: 'Namespace', verb: 'list' },
      { kind: 'Namespace', verb: 'update' },
      { kind: 'Namespace', verb: 'create' },
      { kind: 'Namespace', verb: 'delete' },
    ],
  },
  {
    feature: 'Nodes table',
    specs: [
      { kind: 'Node', verb: 'list' },
      { kind: 'Node', verb: 'get' },
    ],
  },
  {
    feature: 'Node actions',
    specs: [
      { kind: 'Node', verb: 'update' },
      { kind: 'Node', verb: 'delete' },
    ],
  },
  {
    feature: 'Node actions (cordon/drain)',
    specs: [{ kind: 'Node', verb: 'patch' }],
  },
  {
    feature: 'Storage view',
    specs: [
      { kind: 'PersistentVolume', verb: 'list' },
      { kind: 'PersistentVolume', verb: 'update' },
    ],
  },
  {
    feature: 'Storage actions',
    specs: [{ kind: 'PersistentVolume', verb: 'delete' }],
  },
  {
    feature: 'Cluster config',
    specs: [
      { kind: 'StorageClass', verb: 'list' },
      { kind: 'StorageClass', verb: 'update' },
      { kind: 'StorageClass', verb: 'delete' },
      { kind: 'IngressClass', verb: 'list' },
      { kind: 'IngressClass', verb: 'update' },
      { kind: 'IngressClass', verb: 'delete' },
      { kind: 'MutatingWebhookConfiguration', verb: 'list' },
      { kind: 'MutatingWebhookConfiguration', verb: 'update' },
      { kind: 'MutatingWebhookConfiguration', verb: 'delete' },
      { kind: 'ValidatingWebhookConfiguration', verb: 'list' },
      { kind: 'ValidatingWebhookConfiguration', verb: 'update' },
      { kind: 'ValidatingWebhookConfiguration', verb: 'delete' },
    ],
  },
  {
    feature: 'Cluster RBAC',
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
    feature: 'Cluster CRDs',
    specs: [
      { kind: 'CustomResourceDefinition', verb: 'list' },
      { kind: 'CustomResourceDefinition', verb: 'update' },
      { kind: 'CustomResourceDefinition', verb: 'delete' },
    ],
  },
  {
    feature: 'Cluster events',
    specs: [{ kind: 'Event', verb: 'list' }],
  },
];
