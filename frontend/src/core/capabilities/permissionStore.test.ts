/**
 * frontend/src/core/capabilities/permissionStore.test.ts
 *
 * Test suite for getPermissionKey and makePermissionStatus.
 */

import { describe, expect, it } from 'vitest';

import { getPermissionKey, makePermissionStatus } from './permissionStore';
import type { PermissionEntry } from './permissionTypes';

// ---------------------------------------------------------------------------
// getPermissionKey
// ---------------------------------------------------------------------------

describe('getPermissionKey', () => {
  it('builds a pipe-delimited lowercase key with empty group/version segment for kind-only callers', () => {
    const key = getPermissionKey('Deployment', 'delete', 'default', null, 'cluster-1');
    expect(key).toBe('cluster-1|/|deployment|delete|default|');
  });

  it('uses "cluster" for null namespace', () => {
    const key = getPermissionKey('Node', 'list', null, null, 'cluster-1');
    expect(key).toBe('cluster-1|/|node|list|cluster|');
  });

  it('includes subresource in the key', () => {
    const key = getPermissionKey('Deployment', 'update', 'default', 'scale', 'cluster-1');
    expect(key).toBe('cluster-1|/|deployment|update|default|scale');
  });

  it('includes group and version when supplied so colliding kinds get distinct keys', () => {
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
