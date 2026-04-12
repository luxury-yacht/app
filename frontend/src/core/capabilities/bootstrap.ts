/**
 * frontend/src/core/capabilities/bootstrap.ts
 *
 * Thin delegation layer that preserves the public API surface for the
 * permission system while delegating to the new permissionStore.
 */

import { useSyncExternalStore } from 'react';

import {
  getPermissionKey as storeGetPermissionKey,
  getUserPermissionMap,
  initializePermissionStore,
  queryNamespacePermissions,
  resetPermissionStore,
  setCurrentClusterId,
  subscribeUserPermissions,
} from './permissionStore';
import type { PermissionKey, PermissionMap, PermissionStatus } from './permissionTypes';

// Re-export the new PermissionStatus type for consumers that import it from bootstrap.
export type { PermissionStatus };

export const DEFAULT_CAPABILITY_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public API — same signatures as before, delegating to the new store
// ---------------------------------------------------------------------------

export const getPermissionKey = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null,
  clusterId?: string | null,
  group?: string | null,
  version?: string | null
): PermissionKey =>
  storeGetPermissionKey(resourceKind, verb, namespace, subresource, clusterId, group, version);

export { subscribeUserPermissions, getUserPermissionMap };

export const useUserPermissions = (): PermissionMap =>
  useSyncExternalStore(subscribeUserPermissions, getUserPermissionMap, getUserPermissionMap);

export const useUserPermission = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null,
  clusterId?: string | null,
  group?: string | null,
  version?: string | null
): PermissionStatus | undefined => {
  const map = useUserPermissions();
  const key = getPermissionKey(
    resourceKind,
    verb,
    namespace,
    subresource,
    clusterId,
    group,
    version
  );
  return map.get(key);
};

export const getUserPermission = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null,
  clusterId?: string | null,
  group?: string | null,
  version?: string | null
): PermissionStatus | undefined => {
  const key = getPermissionKey(
    resourceKind,
    verb,
    namespace,
    subresource,
    clusterId,
    group,
    version
  );
  return getUserPermissionMap().get(key);
};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let initialized = false;

export const initializeUserPermissionsBootstrap = (clusterId?: string | null): void => {
  const cid = clusterId?.trim() || '';
  setCurrentClusterId(cid);

  if (initialized) {
    // Cluster changed — re-query cluster permissions.
    initializePermissionStore(cid);
    return;
  }

  initializePermissionStore(cid);
  initialized = true;
};

// ---------------------------------------------------------------------------
// Backward-compat shims (used by consumers being migrated in Plan 3)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use queryNamespacePermissions from permissionStore instead.
 * Kept temporarily for consumers not yet migrated.
 */
export const evaluateNamespacePermissions = (
  namespace: string,
  options: { force?: boolean; clusterId?: string | null } = {}
): void => {
  queryNamespacePermissions(namespace, options.clusterId ?? null);
};

/**
 * @deprecated No longer needed — permission specs are static lists.
 * Kept as a no-op for consumers not yet migrated.
 */
export const registerNamespaceCapabilityDefinitions = (
  _namespace: string | null,
  _definitions: unknown[],
  _options?: unknown
): void => {
  // No-op: the new store uses static permission spec lists.
};

/**
 * @deprecated No longer needed — ad-hoc capabilities go through useCapabilities directly.
 * Kept as a no-op for consumers not yet migrated.
 */
export const registerAdHocCapabilities = (_descriptors: unknown[]): void => {
  // No-op: useCapabilities now calls QueryPermissions directly.
};

// ---------------------------------------------------------------------------
// Test support
// ---------------------------------------------------------------------------

/** @internal Used by bootstrap.test.ts via dynamic import */
export const __resetCapabilitiesStateForTests = (): void => {
  resetPermissionStore();
  initialized = false;
};
