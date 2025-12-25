/**
 * frontend/src/core/capabilities/index.ts
 *
 * Exports for capability management including hooks, bootstrap, action planner,
 * catalog definitions, and store functions.
 */

export type {
  CapabilityStatus,
  CapabilityDescriptor,
  NormalizedCapabilityDescriptor,
  CapabilityEntry,
  CapabilityResult,
  CapabilityState,
  CapabilityNamespaceDiagnostics,
} from './types';
export { useCapabilities, useCapabilityDiagnostics } from './hooks';
export {
  initializeUserPermissionsBootstrap,
  subscribeUserPermissions,
  useUserPermissions,
  useUserPermission,
  getUserPermission,
  getUserPermissionMap,
  registerAdHocCapabilities,
  getPermissionKey,
  evaluateNamespacePermissions,
  registerNamespaceCapabilityDefinitions,
  DEFAULT_CAPABILITY_TTL_MS,
  type PermissionStatus,
} from './bootstrap';
export {
  ensureNamespaceActionCapabilities,
  type CapabilityActionId,
  type RestartableOwnerKind,
} from './actionPlanner';
export { CLUSTER_CAPABILITIES } from './catalog';
export {
  ensureCapabilityEntries,
  requestCapabilities,
  snapshotEntries,
  subscribe as subscribeCapabilities,
  subscribeDiagnostics,
  getCapabilityDiagnosticsSnapshot,
  resetCapabilityStore,
} from './store';
export { computeCapabilityState } from './utils';
