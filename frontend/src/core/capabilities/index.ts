/**
 * frontend/src/core/capabilities/index.ts
 *
 * Public API for the permission/capability system.
 * Exports both the new SSRR-backed store and backward-compatible shims.
 */

// Old types — still used by some consumers during migration.
export type {
  CapabilityStatus,
  CapabilityDescriptor,
  NormalizedCapabilityDescriptor,
  CapabilityEntry,
  CapabilityResult,
  CapabilityState,
  CapabilityNamespaceDiagnostics,
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
  DEFAULT_CAPABILITY_TTL_MS,
  // Backward-compat shims (no-ops or delegates, removed in Plan 3):
  evaluateNamespacePermissions,
  registerNamespaceCapabilityDefinitions,
  registerAdHocCapabilities,
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

// Old catalog — kept for any direct consumers during migration.
export { CLUSTER_CAPABILITIES } from './catalog';

// actionPlanner.ts removed — was dead code (never called from components).

// Old store — kept for any direct consumers during migration.
export {
  ensureCapabilityEntries,
  requestCapabilities,
  snapshotEntries,
  subscribe as subscribeCapabilities,
  subscribeDiagnostics as subscribeOldDiagnostics,
  getCapabilityDiagnosticsSnapshot,
  resetCapabilityStore,
} from './store';

export { computeCapabilityState } from './utils';
