/**
 * frontend/src/core/capabilities/index.test.ts
 *
 * Pins the public barrel surface of the permission/capability system.
 */

import { describe, expect, it } from 'vitest';

import {
  CLUSTER_CAPABILITIES,
  getPermissionKey,
  queryClusterPermissions,
  queryKindPermissions,
  queryNamespacePermissions,
  queryNamespacesPermissions,
  setActivePermissionCluster,
  useCapabilities,
  useCapabilityDiagnostics,
  useUserPermission,
  useUserPermissions,
} from './index';
import { CLUSTER_CAPABILITIES as RawClusterCapabilities } from './catalog';
import {
  getPermissionKey as rawGetPermissionKey,
  queryClusterPermissions as rawQueryClusterPermissions,
  queryKindPermissions as rawQueryKindPermissions,
  queryNamespacePermissions as rawQueryNamespacePermissions,
  queryNamespacesPermissions as rawQueryNamespacesPermissions,
  setActivePermissionCluster as rawSetActivePermissionCluster,
} from './permissionStore';
import {
  useCapabilities as rawUseCapabilities,
  useCapabilityDiagnostics as rawUseCapabilityDiagnostics,
  useUserPermission as rawUseUserPermission,
  useUserPermissions as rawUseUserPermissions,
} from './hooks';

describe('core/capabilities index exports', () => {
  it('re-exports catalog and hook utilities', () => {
    expect(CLUSTER_CAPABILITIES).toBe(RawClusterCapabilities);
    expect(useCapabilities).toBe(rawUseCapabilities);
    expect(useCapabilityDiagnostics).toBe(rawUseCapabilityDiagnostics);
    expect(useUserPermissions).toBe(rawUseUserPermissions);
    expect(useUserPermission).toBe(rawUseUserPermission);
  });

  it('re-exports permission store functions', () => {
    expect(setActivePermissionCluster).toBe(rawSetActivePermissionCluster);
    expect(getPermissionKey).toBe(rawGetPermissionKey);
    expect(queryNamespacePermissions).toBe(rawQueryNamespacePermissions);
    expect(queryNamespacesPermissions).toBe(rawQueryNamespacesPermissions);
    expect(queryClusterPermissions).toBe(rawQueryClusterPermissions);
    expect(queryKindPermissions).toBe(rawQueryKindPermissions);
  });
});
