/**
 * frontend/src/core/capabilities/bootstrap.ts
 *
 * Thin delegation layer for the permission store.
 */

import { useSyncExternalStore } from 'react';

import {
  getPermissionKey as storeGetPermissionKey,
  getUserPermissionMap,
  initializePermissionStore,
  resetPermissionStore,
  setCurrentClusterId,
  subscribeUserPermissions,
} from './permissionStore';
import type { PermissionKey, PermissionMap, PermissionStatus } from './permissionTypes';

export type { PermissionStatus };

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
// Test support
// ---------------------------------------------------------------------------

/** @internal Used by bootstrap.test.ts via dynamic import */
export const __resetCapabilitiesStateForTests = (): void => {
  resetPermissionStore();
  initialized = false;
};
