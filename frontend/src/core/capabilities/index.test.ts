import { describe, expect, it } from 'vitest';

import {
  CLUSTER_CAPABILITIES,
  DEFAULT_CAPABILITY_TTL_MS,
  computeCapabilityState,
  ensureCapabilityEntries,
  ensureNamespaceActionCapabilities,
  evaluateNamespacePermissions,
  getCapabilityDiagnosticsSnapshot,
  getPermissionKey,
  getUserPermission,
  getUserPermissionMap,
  initializeUserPermissionsBootstrap,
  registerAdHocCapabilities,
  registerNamespaceCapabilityDefinitions,
  requestCapabilities,
  resetCapabilityStore,
  snapshotEntries,
  subscribeCapabilities,
  subscribeDiagnostics,
  subscribeUserPermissions,
  useCapabilities,
  useCapabilityDiagnostics,
  useUserPermission,
  useUserPermissions,
  useCapabilityDiagnostics as useCapabilityDiagnosticsReexport,
} from './index';
import { CLUSTER_CAPABILITIES as RawClusterCapabilities } from './catalog';
import {
  DEFAULT_CAPABILITY_TTL_MS as RAW_TTL,
  evaluateNamespacePermissions as rawEvaluateNamespacePermissions,
  getPermissionKey as rawGetPermissionKey,
  getUserPermission as rawGetUserPermission,
  getUserPermissionMap as rawGetUserPermissionMap,
  initializeUserPermissionsBootstrap as rawInitBootstrap,
  registerAdHocCapabilities as rawRegisterAdHoc,
  registerNamespaceCapabilityDefinitions as rawRegisterNamespace,
  subscribeUserPermissions as rawSubscribePermissions,
  useUserPermission as rawUseUserPermission,
  useUserPermissions as rawUseUserPermissions,
} from './bootstrap';
import {
  useCapabilities as rawUseCapabilities,
  useCapabilityDiagnostics as rawUseCapabilityDiagnostics,
} from './hooks';
import { ensureNamespaceActionCapabilities as rawEnsureNamespaceActionCapabilities } from './actionPlanner';
import {
  ensureCapabilityEntries as rawEnsureEntries,
  requestCapabilities as rawRequestCapabilities,
  snapshotEntries as rawSnapshotEntries,
  subscribe as rawSubscribe,
  subscribeDiagnostics as rawSubscribeDiagnostics,
  getCapabilityDiagnosticsSnapshot as rawGetDiagnosticsSnapshot,
  resetCapabilityStore as rawResetStore,
} from './store';
import { computeCapabilityState as rawComputeCapabilityState } from './utils';

describe('core/capabilities index exports', () => {
  it('re-exports catalog and hook utilities', () => {
    expect(CLUSTER_CAPABILITIES).toBe(RawClusterCapabilities);
    expect(useCapabilities).toBe(rawUseCapabilities);
    expect(useCapabilityDiagnostics).toBe(rawUseCapabilityDiagnostics);
    expect(useCapabilityDiagnosticsReexport).toBe(rawUseCapabilityDiagnostics);
  });

  it('re-exports bootstrap helpers', () => {
    expect(DEFAULT_CAPABILITY_TTL_MS).toBe(RAW_TTL);
    expect(initializeUserPermissionsBootstrap).toBe(rawInitBootstrap);
    expect(subscribeUserPermissions).toBe(rawSubscribePermissions);
    expect(useUserPermissions).toBe(rawUseUserPermissions);
    expect(useUserPermission).toBe(rawUseUserPermission);
    expect(getUserPermission).toBe(rawGetUserPermission);
    expect(getUserPermissionMap).toBe(rawGetUserPermissionMap);
    expect(registerAdHocCapabilities).toBe(rawRegisterAdHoc);
    expect(getPermissionKey).toBe(rawGetPermissionKey);
    expect(evaluateNamespacePermissions).toBe(rawEvaluateNamespacePermissions);
    expect(registerNamespaceCapabilityDefinitions).toBe(rawRegisterNamespace);
  });

  it('re-exports planner, store, and util helpers', () => {
    expect(ensureNamespaceActionCapabilities).toBe(rawEnsureNamespaceActionCapabilities);
    expect(ensureCapabilityEntries).toBe(rawEnsureEntries);
    expect(requestCapabilities).toBe(rawRequestCapabilities);
    expect(snapshotEntries).toBe(rawSnapshotEntries);
    expect(subscribeCapabilities).toBe(rawSubscribe);
    expect(subscribeDiagnostics).toBe(rawSubscribeDiagnostics);
    expect(getCapabilityDiagnosticsSnapshot).toBe(rawGetDiagnosticsSnapshot);
    expect(resetCapabilityStore).toBe(rawResetStore);
    expect(computeCapabilityState).toBe(rawComputeCapabilityState);
  });
});
