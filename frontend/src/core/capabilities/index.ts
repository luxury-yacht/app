/**
 * frontend/src/core/capabilities/index.ts
 *
 * Public API for the permission/capability system.
 * Exports the SSRR-backed permission store and compatibility shims.
 */

export type {
  CapabilityStatus,
  CapabilityDescriptor,
  NormalizedCapabilityDescriptor,
  CapabilityState,
} from './types';

// New types.
export type {
  PermissionSpec,
  PermissionEntry,
  PermissionQueryDiagnostics,
  PermissionKey,
  PermissionMap,
} from './permissionTypes';
export type { PermissionStatus } from './bootstrap';

// Hooks.
export { useCapabilities, useCapabilityDiagnostics } from './hooks';

// Bootstrap — public API surface (same signatures, delegates to new store).
export {
  initializeUserPermissionsBootstrap,
  subscribeUserPermissions,
  useUserPermissions,
  useUserPermission,
  getUserPermission,
  getUserPermissionMap,
  getPermissionKey,
} from './bootstrap';

// New store — direct access for consumers that need it.
export {
  queryNamespacePermissions,
  queryNamespacesPermissions,
  queryClusterPermissions,
  queryKindPermissions,
  initializePermissionStore,
  resetPermissionStore,
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

export { CLUSTER_CAPABILITIES } from './catalog';
