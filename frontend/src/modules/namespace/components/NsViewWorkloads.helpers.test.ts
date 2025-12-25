/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.helpers.test.ts
 *
 * Tests for NsViewWorkloads.helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeWorkloadKind,
  clampReplicas,
  extractDesiredReplicas,
  buildWorkloadKey,
  parseWorkloadKeyValue,
  appendWorkloadTokens,
  type WorkloadData,
} from '@modules/namespace/components/NsViewWorkloads.helpers';

describe('NsViewWorkloads helpers', () => {
  it('normalizes workload kinds with canonical casing', () => {
    expect(normalizeWorkloadKind('deployment')).toBe('Deployment');
    expect(normalizeWorkloadKind('STATEFULSET')).toBe('StatefulSet');
    expect(normalizeWorkloadKind('daemonset')).toBe('DaemonSet');
    expect(normalizeWorkloadKind('cronjob')).toBe('CronJob');
    expect(normalizeWorkloadKind('job')).toBe('Job');
    expect(normalizeWorkloadKind('custom')).toBe('custom');
  });

  it('clamps replica values within expected bounds', () => {
    expect(clampReplicas(-5)).toBe(0);
    expect(clampReplicas(42)).toBe(42);
    expect(clampReplicas(20000)).toBe(9999);
  });

  it('parses replica counts from ready strings safely', () => {
    expect(extractDesiredReplicas(undefined)).toBe(0);
    expect(extractDesiredReplicas('')).toBe(0);
    expect(extractDesiredReplicas(' 5 ')).toBe(5);
    expect(extractDesiredReplicas('3/4')).toBe(4);
    expect(extractDesiredReplicas('ready/unknown')).toBe(0);
  });

  it('builds and parses workload keys with namespace context', () => {
    const workload: WorkloadData = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      status: 'Running',
    };

    expect(buildWorkloadKey(workload)).toBe('team-a::Deployment/api');

    expect(parseWorkloadKeyValue('team-a::StatefulSet/db', 'ignored')).toEqual({
      namespace: 'team-a',
      kind: 'StatefulSet',
      name: 'db',
    });

    expect(parseWorkloadKeyValue('Deployment/api', 'team-a')).toEqual({
      namespace: 'team-a',
      kind: 'Deployment',
      name: 'api',
    });
  });

  it('appends workload tokens for search filtering', () => {
    const tokens: string[] = [];
    appendWorkloadTokens(tokens, {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      status: 'Running',
      ready: '1/1',
      restarts: 2,
      cpuUsage: '10m',
      memUsage: '20Mi',
      age: '5m',
    });

    expect(tokens).toContain('Deployment');
    expect(tokens).toContain('api');
    expect(tokens).toContain('team-a');
    expect(tokens).toContain('Running');
    expect(tokens).toContain('1/1');
    expect(tokens).toContain('2');
    expect(tokens).toContain('10m');
    expect(tokens).toContain('20Mi');
    expect(tokens).toContain('5m');
  });
});
