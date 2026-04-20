/**
 * frontend/src/core/capabilities/permissionStore.test.ts
 *
 * Test suite for getPermissionKey and makePermissionStatus.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetForTests,
  getPermissionKey,
  makePermissionStatus,
  resetPermissionStore,
  subscribeUserPermissions,
} from './permissionStore';
import type { PermissionEntry } from './permissionTypes';

afterEach(() => {
  __resetForTests();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getPermissionKey
// ---------------------------------------------------------------------------

describe('getPermissionKey', () => {
  it('auto-resolves built-in GVK for kind-only callers so the key matches the spec-emit path', () => {
    // Deployment is apps/v1 — the builtin lookup table populates the
    // group/version segment even when the caller doesn't pass them
    // explicitly. This keeps the kind-only-objects rule intact for
    // built-ins without forcing every lookup site to pass GVK.
    const key = getPermissionKey('Deployment', 'delete', 'default', null, 'cluster-1');
    expect(key).toBe('cluster-1|apps/v1|deployment|delete|default|');
  });

  it('auto-resolves Node to core/v1 and uses "cluster" for null namespace', () => {
    const key = getPermissionKey('Node', 'list', null, null, 'cluster-1');
    expect(key).toBe('cluster-1|/v1|node|list|cluster|');
  });

  it('includes subresource in the key with the resolved built-in GVK', () => {
    const key = getPermissionKey('Deployment', 'update', 'default', 'scale', 'cluster-1');
    expect(key).toBe('cluster-1|apps/v1|deployment|update|default|scale');
  });

  it('honours explicit group and version for CRDs so colliding kinds get distinct keys', () => {
    const ack = getPermissionKey(
      'DBInstance',
      'get',
      'default',
      null,
      'cluster-1',
      'rds.services.k8s.aws',
      'v1alpha1'
    );
    const documentdb = getPermissionKey(
      'DBInstance',
      'get',
      'default',
      null,
      'cluster-1',
      'documentdb.services.k8s.aws',
      'v1alpha1'
    );
    expect(ack).toBe('cluster-1|rds.services.k8s.aws/v1alpha1|dbinstance|get|default|');
    expect(documentdb).toBe(
      'cluster-1|documentdb.services.k8s.aws/v1alpha1|dbinstance|get|default|'
    );
    expect(ack).not.toBe(documentdb);
  });

  it('leaves the GVK segment empty when the kind is not a built-in and no GVK was supplied', () => {
    // The lookup table doesn't contain "DBInstance" so auto-resolve
    // yields nothing; the key falls back to an empty group/version
    // segment. In practice every CRD caller should pass explicit
    // group/version (see the test above), but the fallback is
    // preserved so incomplete callers fail at the backend guard
    // rather than producing a collision-prone auto-resolve.
    const key = getPermissionKey('DBInstance', 'get', 'default', null, 'cluster-1');
    expect(key).toBe('cluster-1|/|dbinstance|get|default|');
  });

  // Regression for the "Node get/list shows false while Nodes view still
  // works" bug. The static CLUSTER_PERMISSIONS specs in permissionSpecs.ts
  // emit kind-only entries; consumers at ClusterResourcesManager and
  // ClusterResourcesContext look up permissions via useUserPermission
  // without group/version. Both paths must produce the same key so the
  // lookup side can find the entry written by the spec-emit side.
  //
  // Before the auto-resolve fix, the spec-emit path stored entries under
  // `cluster-1|/v1|node|list|cluster|` (because the tightened backend
  // sent apps/v1 back in the response, and the response's clusterId was
  // mapped via a fresh key) while the lookup side built
  // `cluster-1|/|node|list|cluster|` — mismatch → "missing permission".
  it('kind-only lookups for built-in Node list match the spec-emit key shape', () => {
    const specEmit = getPermissionKey(
      'Node',
      'list',
      null,
      null,
      'cluster-1',
      '',
      'v1' // builtinKindGroupVersions populates this at spec-emit time
    );
    const lookup = getPermissionKey('Node', 'list', null, null, 'cluster-1');
    expect(lookup).toBe(specEmit);
    expect(lookup).toBe('cluster-1|/v1|node|list|cluster|');
  });
});

// ---------------------------------------------------------------------------
// makePermissionStatus
// ---------------------------------------------------------------------------

describe('makePermissionStatus', () => {
  it('builds ready status from a definitive ssrr entry', () => {
    const entry: PermissionEntry = {
      allowed: true,
      source: 'ssrr',
      reason: null,
      descriptor: {
        clusterId: 'cluster-1',
        group: 'apps',
        version: 'v1',
        resourceKind: 'Deployment',
        verb: 'get',
        namespace: 'default',
        subresource: null,
      },
      feature: 'workloads',
    };

    const status = makePermissionStatus('cluster-1|deployment|get|default|', entry);

    expect(status.pending).toBe(false);
    expect(status.entry.status).toBe('ready');
    expect(status.error).toBeNull();
    expect(status.source).toBe('ssrr');
    expect(status.allowed).toBe(true);
  });

  it('builds error status when source is "error"', () => {
    const entry: PermissionEntry = {
      allowed: false,
      source: 'error',
      reason: 'cluster unreachable',
      descriptor: {
        clusterId: 'cluster-1',
        group: null,
        version: null,
        resourceKind: 'Pod',
        verb: 'list',
        namespace: 'kube-system',
        subresource: null,
      },
    };

    const status = makePermissionStatus('cluster-1|pod|list|kube-system|', entry);

    expect(status.pending).toBe(false);
    expect(status.entry.status).toBe('error');
    expect(status.error).toBe('cluster unreachable');
    expect(status.allowed).toBe(false);
  });
});

describe('permission store notifications', () => {
  it('notifies permission subscribers asynchronously', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeUserPermissions(listener);

    resetPermissionStore();

    expect(listener).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    vi.useRealTimers();
  });

  it('coalesces multiple synchronous permission-store writes into one notification tick', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeUserPermissions(listener);

    resetPermissionStore();
    resetPermissionStore();

    expect(listener).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    vi.useRealTimers();
  });
});
