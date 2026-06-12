/**
 * frontend/src/core/capabilities/index.ts
 *
 * Public API for the permission/capability system, backed by the
 * SSRR-based permission store.
 */

export type {
  CapabilityStatus,
  CapabilityDescriptor,
  NormalizedCapabilityDescriptor,
  CapabilityState,
} from './types';

export type {
  PermissionSpec,
  PermissionEntry,
  PermissionQueryDiagnostics,
  PermissionKey,
  PermissionMap,
  PermissionStatus,
} from './permissionTypes';

// Hooks.
export {
  useCapabilities,
  useCapabilityDiagnostics,
  useUserPermissions,
  useUserPermission,
} from './hooks';

// Permission store.
export {
  setActivePermissionCluster,
  getPermissionKey,
  queryNamespacePermissions,
  queryNamespacesPermissions,
  queryClusterPermissions,
  queryKindPermissions,
} from './permissionStore';

// Permission spec lists.
export {
  AUTOSCALING_PERMISSIONS,
  ALL_NAMESPACE_PERMISSIONS,
  CLUSTER_PERMISSIONS,
  CONFIG_PERMISSIONS,
  EVENT_PERMISSIONS,
  NETWORK_PERMISSIONS,
  POD_PERMISSIONS,
  QUOTA_PERMISSIONS,
  RBAC_PERMISSIONS,
  STORAGE_PERMISSIONS,
  WORKLOAD_PERMISSIONS,
  type PermissionSpecList,
} from './permissionSpecs';

export {
  PERMISSION_FEATURES,
  PERMISSION_FEATURE_LABELS,
  permissionFeatureLabel,
  type PermissionFeatureKey,
} from './permissionFeatures';

export { CLUSTER_CAPABILITIES } from './catalog';
