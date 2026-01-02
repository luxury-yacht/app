/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.test.ts
 *
 * Test suite for resource stream helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  mergeNodeMetricsRow,
  mergePodMetricsRow,
  mergeWorkloadMetricsRow,
  normalizeResourceScope,
  sortNodeRows,
  sortPodRows,
  sortWorkloadRows,
} from './resourceStreamManager';

describe('resourceStreamManager helpers', () => {
  it('normalizes pod scopes', () => {
    expect(normalizeResourceScope('pods', 'namespace:default')).toBe('namespace:default');
    expect(normalizeResourceScope('pods', 'namespace:*')).toBe('namespace:all');
    expect(normalizeResourceScope('pods', 'node:node-a')).toBe('node:node-a');
    expect(normalizeResourceScope('pods', 'workload:default:Deployment:web')).toBe(
      'workload:default:Deployment:web'
    );
  });

  it('normalizes namespace workload scopes', () => {
    expect(normalizeResourceScope('namespace-workloads', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-workloads', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes node scopes', () => {
    expect(normalizeResourceScope('nodes', '')).toBe('');
    expect(normalizeResourceScope('nodes', 'cluster')).toBe('');
    expect(() => normalizeResourceScope('nodes', 'namespace:default')).toThrow();
  });

  it('preserves pod metrics when requested', () => {
    const existing = {
      name: 'pod-a',
      namespace: 'default',
      node: 'node-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '1m',
      ownerKind: 'Deployment',
      ownerName: 'web',
      cpuRequest: '10m',
      cpuLimit: '20m',
      cpuUsage: '50m',
      memRequest: '10Mi',
      memLimit: '20Mi',
      memUsage: '40Mi',
    };
    const incoming = { ...existing, cpuUsage: '5m', memUsage: '8Mi' };
    const merged = mergePodMetricsRow(existing, incoming, true);
    expect(merged.cpuUsage).toBe('50m');
    expect(merged.memUsage).toBe('40Mi');
  });

  it('merges workload metrics when requested', () => {
    const existing = {
      kind: 'Deployment',
      name: 'web',
      namespace: 'default',
      ready: '1/1',
      status: 'Healthy',
      restarts: 0,
      age: '1m',
      cpuUsage: '60m',
      memUsage: '40Mi',
    };
    const incoming = { ...existing, cpuUsage: '5m', memUsage: '8Mi' };
    const merged = mergeWorkloadMetricsRow(existing, incoming, true);
    expect(merged.cpuUsage).toBe('60m');
    expect(merged.memUsage).toBe('40Mi');
  });

  it('merges node metrics when requested', () => {
    const existing = {
      name: 'node-a',
      status: 'Ready',
      roles: 'worker',
      age: '1d',
      version: 'v1.30.0',
      cpuCapacity: '2',
      cpuAllocatable: '2',
      cpuRequests: '0',
      cpuLimits: '0',
      cpuUsage: '200m',
      memoryCapacity: '1Gi',
      memoryAllocatable: '1Gi',
      memRequests: '0',
      memLimits: '0',
      memoryUsage: '200Mi',
      pods: '1/10',
      podsCapacity: '10',
      podsAllocatable: '10',
      restarts: 0,
      kind: 'Node',
      cpu: '2',
      memory: '1Gi',
      unschedulable: false,
    };
    const incoming = { ...existing, cpuUsage: '10m', memoryUsage: '5Mi' };
    const merged = mergeNodeMetricsRow(existing, incoming, true);
    expect(merged.cpuUsage).toBe('200m');
    expect(merged.memoryUsage).toBe('200Mi');
  });

  it('sorts pod rows by namespace and name', () => {
    const rows = [
      { name: 'b', namespace: 'ns-b' },
      { name: 'a', namespace: 'ns-b' },
      { name: 'c', namespace: 'ns-a' },
    ] as Array<{ name: string; namespace: string }>;
    sortPodRows(rows as any);
    expect(rows.map((row) => `${row.namespace}/${row.name}`)).toEqual([
      'ns-a/c',
      'ns-b/a',
      'ns-b/b',
    ]);
  });

  it('sorts workload rows by kind, name, namespace, and status', () => {
    const rows = [
      { kind: 'StatefulSet', name: 'b', namespace: 'ns-a', status: 'Healthy' },
      { kind: 'Deployment', name: 'a', namespace: 'ns-b', status: 'Healthy' },
      { kind: 'Deployment', name: 'a', namespace: 'ns-a', status: 'Pending' },
    ] as Array<{ kind: string; name: string; namespace: string; status: string }>;
    sortWorkloadRows(rows as any);
    expect(rows.map((row) => `${row.kind}/${row.name}/${row.namespace}/${row.status}`)).toEqual([
      'Deployment/a/ns-a/Pending',
      'Deployment/a/ns-b/Healthy',
      'StatefulSet/b/ns-a/Healthy',
    ]);
  });

  it('sorts node rows by name', () => {
    const rows = [{ name: 'node-b' }, { name: 'node-a' }];
    sortNodeRows(rows as any);
    expect(rows.map((row) => row.name)).toEqual(['node-a', 'node-b']);
  });
});
