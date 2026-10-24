/**
 * frontend/src/core/capabilities/index.ts
 *
 * Public API for the permission/capability system, backed by the
 * SSRR-based permission store.
 */

// Hooks.
export {
  useCapabilities,
  useCapabilityDiagnostics,
  useUserPermission,
  useUserPermissions,
} from './hooks';
export {
  PERMISSION_FEATURES,
  type PermissionFeatureKey,
  permissionFeatureLabel,
} from './permissionFeatures';
// Permission spec lists.
export {
  ALL_NAMESPACE_PERMISSIONS,
  CLUSTER_PERMISSIONS,
  NODE_SHELL_PERMISSIONS,
  type PermissionSpecList,
  POD_PERMISSIONS,
} from './permissionSpecs';
// Permission store.
export {
  getPermissionKey,
  type PermissionCheck,
  queryNamespacePermissions,
  queryNamespacesPermissions,
  queryPermissionChecks,
  setActivePermissionCluster,
} from './permissionStore';
export type {
  PermissionMap,
  PermissionQueryDiagnostics,
  PermissionStatus,
} from './permissionTypes';
export type { CapabilityDescriptor } from './types';
