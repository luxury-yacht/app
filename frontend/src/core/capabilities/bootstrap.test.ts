/**
 * frontend/src/core/capabilities/bootstrap.test.ts
 *
 * Test suite for bootstrap.
 * Covers the thin delegation layer that preserves the public API surface
 * while delegating to the new permissionStore.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock permissionStore — bootstrap delegates all real work here.
const mockInitializePermissionStore = vi.fn();
const mockQueryNamespacePermissions = vi.fn();
const mockResetPermissionStore = vi.fn();
const mockSetCurrentClusterId = vi.fn();
const mockGetPermissionKey = vi.fn(
  (
    resourceKind: string,
    verb: string,
    namespace?: string | null,
    subresource?: string | null,
    clusterId?: string | null
  ) => {
    const cid = (clusterId || '').toLowerCase();
    const rk = resourceKind.toLowerCase();
    const v = verb.toLowerCase();
    const ns = namespace ? namespace.toLowerCase() : 'cluster';
    const sub = subresource ? subresource.toLowerCase() : '';
    return `${cid}|${rk}|${v}|${ns}|${sub}`;
  }
);

const permissionListeners = new Set<() => void>();
let permissionMap = new Map<string, unknown>();

const mockSubscribeUserPermissions = vi.fn((listener: () => void) => {
  permissionListeners.add(listener);
  return () => {
    permissionListeners.delete(listener);
  };
});
const mockGetUserPermissionMap = vi.fn(() => permissionMap);

vi.mock('./permissionStore', () => ({
  initializePermissionStore: (...args: unknown[]) => mockInitializePermissionStore(...args),
  queryNamespacePermissions: (...args: unknown[]) => mockQueryNamespacePermissions(...args),
  resetPermissionStore: () => mockResetPermissionStore(),
  setCurrentClusterId: (...args: unknown[]) => mockSetCurrentClusterId(...args),
  getPermissionKey: (...args: unknown[]) =>
    mockGetPermissionKey(...(args as [string, string, string?, string?, string?])),
  subscribeUserPermissions: (...args: unknown[]) =>
    mockSubscribeUserPermissions(...(args as [() => void])),
  getUserPermissionMap: () => mockGetUserPermissionMap(),
}));

const loadBootstrap = async () => {
  const module = await import('./bootstrap');
  module.__resetCapabilitiesStateForTests();
  return module;
};

beforeEach(() => {
  mockInitializePermissionStore.mockClear();
  mockQueryNamespacePermissions.mockClear();
  mockResetPermissionStore.mockClear();
  mockSetCurrentClusterId.mockClear();
  mockGetPermissionKey.mockClear();
  mockSubscribeUserPermissions.mockClear();
  mockGetUserPermissionMap.mockClear();
  permissionListeners.clear();
  permissionMap = new Map();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('capabilities bootstrap helpers', () => {
  it('getPermissionKey delegates to permissionStore and produces the correct format', async () => {
    const bootstrap = await loadBootstrap();

    const key = bootstrap.getPermissionKey('Deployment', 'patch', 'default', null, 'cluster-1');
    expect(mockGetPermissionKey).toHaveBeenCalledWith(
      'Deployment',
      'patch',
      'default',
      null,
      'cluster-1'
    );
    expect(key).toBe('cluster-1|deployment|patch|default|');
  });

  it('getPermissionKey handles null namespace as "cluster"', async () => {
    const bootstrap = await loadBootstrap();

    const key = bootstrap.getPermissionKey('Namespace', 'list', null, null, 'c1');
    expect(key).toBe('c1|namespace|list|cluster|');
  });

  it('initializeUserPermissionsBootstrap calls setCurrentClusterId and initializePermissionStore', async () => {
    const bootstrap = await loadBootstrap();

    bootstrap.initializeUserPermissionsBootstrap('my-cluster');

    expect(mockSetCurrentClusterId).toHaveBeenCalledWith('my-cluster');
    expect(mockInitializePermissionStore).toHaveBeenCalledWith('my-cluster');
  });

  it('initializeUserPermissionsBootstrap trims the clusterId', async () => {
    const bootstrap = await loadBootstrap();

    bootstrap.initializeUserPermissionsBootstrap('  my-cluster  ');

    expect(mockSetCurrentClusterId).toHaveBeenCalledWith('my-cluster');
    expect(mockInitializePermissionStore).toHaveBeenCalledWith('my-cluster');
  });

  it('initializeUserPermissionsBootstrap calls initializePermissionStore on subsequent calls', async () => {
    const bootstrap = await loadBootstrap();

    bootstrap.initializeUserPermissionsBootstrap('cluster-a');
    expect(mockInitializePermissionStore).toHaveBeenCalledTimes(1);

    mockInitializePermissionStore.mockClear();
    bootstrap.initializeUserPermissionsBootstrap('cluster-b');
    // Re-initializes for the new cluster.
    expect(mockInitializePermissionStore).toHaveBeenCalledWith('cluster-b');
  });

  it('evaluateNamespacePermissions delegates to queryNamespacePermissions', async () => {
    const bootstrap = await loadBootstrap();

    bootstrap.evaluateNamespacePermissions('metrics', { clusterId: 'cluster-1' });

    expect(mockQueryNamespacePermissions).toHaveBeenCalledWith('metrics', 'cluster-1');
  });

  it('evaluateNamespacePermissions passes null clusterId when not provided', async () => {
    const bootstrap = await loadBootstrap();

    bootstrap.evaluateNamespacePermissions('default');

    expect(mockQueryNamespacePermissions).toHaveBeenCalledWith('default', null);
  });

  it('registerNamespaceCapabilityDefinitions is a no-op', async () => {
    const bootstrap = await loadBootstrap();

    // Should not throw and should not call any store functions.
    bootstrap.registerNamespaceCapabilityDefinitions('default', [
      {
        id: 'test',
        scope: 'namespace',
        descriptor: { id: 'test', resourceKind: 'Pod', verb: 'get' },
      },
    ] as any);

    expect(mockInitializePermissionStore).not.toHaveBeenCalled();
    expect(mockQueryNamespacePermissions).not.toHaveBeenCalled();
  });

  it('registerAdHocCapabilities is a no-op', async () => {
    const bootstrap = await loadBootstrap();

    // Should not throw and should not call any store functions.
    bootstrap.registerAdHocCapabilities([
      { id: 'adhoc:test', resourceKind: 'Pod', verb: 'get', namespace: 'default' },
    ] as any);

    expect(mockInitializePermissionStore).not.toHaveBeenCalled();
    expect(mockQueryNamespacePermissions).not.toHaveBeenCalled();
  });

  it('__resetCapabilitiesStateForTests calls resetPermissionStore', async () => {
    const bootstrap = await loadBootstrap();

    mockResetPermissionStore.mockClear();
    bootstrap.__resetCapabilitiesStateForTests();

    expect(mockResetPermissionStore).toHaveBeenCalledTimes(1);
  });
});
