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

export const initializeUserPermissionsBootstrap = (
  clusterId?: string | null,
  options: { ready?: boolean } = {}
): void => {
  const cid = clusterId?.trim() || '';
  const ready = options.ready ?? true;
  setCurrentClusterId(cid);

  if (!cid) {
    resetPermissionStore();
    return;
  }

  if (!ready) {
    // Defer querying until the cluster can answer, but keep existing
    // permission state: a not-ready ACTIVE cluster must not invalidate
    // other clusters' (or other namespaces') entries, and one-shot
    // consumers such as open object panels have no re-query path after
    // a wipe. Stale-allowed is safe — the backend re-validates every
    // action — and the store re-queries on the cluster:lifecycle ready
    // event and the periodic TTL refresh.
    return;
  }

  initializePermissionStore(cid);
};

// ---------------------------------------------------------------------------
// Test support
// ---------------------------------------------------------------------------

/** @internal Used by bootstrap.test.ts via dynamic import */
export const __resetCapabilitiesStateForTests = (): void => {
  resetPermissionStore();
};
