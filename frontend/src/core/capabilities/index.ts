/**
 * frontend/src/core/capabilities/index.ts
 *
 * Public API for the permission/capability system, backed by the
 * SSRR-based permission store.
 */

export { CLUSTER_CAPABILITIES } from './catalog';
// Hooks.
export {
  useCapabilities,
  useCapabilityDiagnostics,
  useUserPermission,
  useUserPermissions,
} from './hooks';
export {
  PERMISSION_FEATURE_LABELS,
  PERMISSION_FEATURES,
  type PermissionFeatureKey,
  permissionFeatureLabel,
} from './permissionFeatures';
// Permission spec lists.
export {
  ALL_NAMESPACE_PERMISSIONS,
  AUTOSCALING_PERMISSIONS,
  CLUSTER_PERMISSIONS,
  CONFIG_PERMISSIONS,
  EVENT_PERMISSIONS,
  NETWORK_PERMISSIONS,
  type PermissionSpecList,
  POD_PERMISSIONS,
  QUOTA_PERMISSIONS,
  RBAC_PERMISSIONS,
  STORAGE_PERMISSIONS,
  WORKLOAD_PERMISSIONS,
} from './permissionSpecs';
// Permission store.
export {
  getPermissionKey,
  queryClusterPermissions,
  queryKindPermissions,
  queryNamespacePermissions,
  queryNamespacesPermissions,
  setActivePermissionCluster,
} from './permissionStore';
export type {
  PermissionEntry,
  PermissionKey,
  PermissionMap,
  PermissionQueryDiagnostics,
  PermissionSpec,
  PermissionStatus,
} from './permissionTypes';
export type {
  CapabilityDescriptor,
  CapabilityState,
  CapabilityStatus,
  NormalizedCapabilityDescriptor,
} from './types';
