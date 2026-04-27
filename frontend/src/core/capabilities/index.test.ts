/**
 * frontend/src/core/capabilities/index.test.ts
 *
 * Test suite for index.
 * Covers key behaviors and edge cases for index.
 */

import { describe, expect, it } from 'vitest';

import {
  CLUSTER_CAPABILITIES,
  getPermissionKey,
  getUserPermission,
  getUserPermissionMap,
  initializeUserPermissionsBootstrap,
  subscribeUserPermissions,
  useCapabilities,
  useCapabilityDiagnostics,
  useUserPermission,
  useUserPermissions,
  useCapabilityDiagnostics as useCapabilityDiagnosticsReexport,
} from './index';
import { CLUSTER_CAPABILITIES as RawClusterCapabilities } from './catalog';
import {
  getPermissionKey as rawGetPermissionKey,
  getUserPermission as rawGetUserPermission,
  getUserPermissionMap as rawGetUserPermissionMap,
  initializeUserPermissionsBootstrap as rawInitBootstrap,
  subscribeUserPermissions as rawSubscribePermissions,
  useUserPermission as rawUseUserPermission,
  useUserPermissions as rawUseUserPermissions,
} from './bootstrap';
import {
  useCapabilities as rawUseCapabilities,
  useCapabilityDiagnostics as rawUseCapabilityDiagnostics,
} from './hooks';

describe('core/capabilities index exports', () => {
  it('re-exports catalog and hook utilities', () => {
    expect(CLUSTER_CAPABILITIES).toBe(RawClusterCapabilities);
    expect(useCapabilities).toBe(rawUseCapabilities);
    expect(useCapabilityDiagnostics).toBe(rawUseCapabilityDiagnostics);
    expect(useCapabilityDiagnosticsReexport).toBe(rawUseCapabilityDiagnostics);
  });

  it('re-exports bootstrap helpers', () => {
    expect(initializeUserPermissionsBootstrap).toBe(rawInitBootstrap);
    expect(subscribeUserPermissions).toBe(rawSubscribePermissions);
    expect(useUserPermissions).toBe(rawUseUserPermissions);
    expect(useUserPermission).toBe(rawUseUserPermission);
    expect(getUserPermission).toBe(rawGetUserPermission);
    expect(getUserPermissionMap).toBe(rawGetUserPermissionMap);
    expect(getPermissionKey).toBe(rawGetPermissionKey);
  });
});
