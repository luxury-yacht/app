/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Maintenance/drainProgress.test.ts
 */

import { describe, expect, it } from 'vitest';
import type { NodeMaintenanceDrainEvent, NodeMaintenanceDrainJob } from '@/core/refresh/types';
import { deriveDrainProgress, parsePlanCount } from './drainProgress';

const baseOptions = {
  ignoreDaemonSets: true,
  deleteEmptyDirData: true,
  force: false,
  disableEviction: false,
  skipWaitForPodsToTerminate: false,
};

const job = (
  overrides: Partial<NodeMaintenanceDrainJob> & { events?: NodeMaintenanceDrainEvent[] }
): NodeMaintenanceDrainJob => ({
  clusterId: 'test-cluster',
  id: 'job',
  nodeName: 'node-1',
  status: 'running',
  startedAt: 1000,
  options: baseOptions,
  events: [],
  ...overrides,
});

const evt = (over: Partial<NodeMaintenanceDrainEvent>): NodeMaintenanceDrainEvent => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  timestamp: 0,
  kind: 'info',
  ...over,
});

describe('parsePlanCount', () => {
  it('parses Evicting and Deleting messages', () => {
    expect(parsePlanCount('Evicting 12 pods')).toBe(12);
    expect(parsePlanCount('Deleting 1 pod')).toBe(1);
  });

  it('returns undefined when the message is missing or unrecognised', () => {
    expect(parsePlanCount(undefined)).toBeUndefined();
    expect(parsePlanCount('something else')).toBeUndefined();
  });
});

describe('deriveDrainProgress', () => {
  it('rolls pod events up into per-pod rows ordered in-progress, failed, done', () => {
    const result = deriveDrainProgress(
      job({
        events: [
          evt({ phase: 'plan', message: 'Evicting 3 pods', timestamp: 1100 }),
          evt({
            phase: 'evicting',
            kind: 'pod',
            podNamespace: 'ns',
            podName: 'a',
            timestamp: 1200,
          }),
          evt({
            phase: 'evicted',
            kind: 'pod',
            podNamespace: 'ns',
            podName: 'a',
            timestamp: 1300,
          }),
          evt({
            phase: 'evicting',
            kind: 'pod',
            podNamespace: 'ns',
            podName: 'b',
            timestamp: 1400,
          }),
          evt({
            phase: 'evict-error',
            kind: 'error',
            podNamespace: 'ns',
            podName: 'c',
            message: 'PDB blocked',
            timestamp: 1450,
          }),
        ],
      })
    );

    expect(result.totalPlanned).toBe(3);
    expect(result.totalSeen).toBe(3);
    expect(result.done).toBe(1);
    expect(result.inProgress).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.pods.map((p) => `${p.name}:${p.status}`)).toEqual([
      'b:in-progress',
      'c:failed',
      'a:done',
    ]);
    expect(result.hasError).toBe(true);
    expect(result.errorMessage).toBe('PDB blocked');
    expect(result.lastActivity).toBe(1450);
  });

  it('marks phase as cordoning, planning, evicting, waiting based on event order', () => {
    expect(
      deriveDrainProgress(job({ events: [evt({ phase: 'cordon', message: 'Cordoning' })] })).phase
    ).toBe('cordoning');

    expect(
      deriveDrainProgress(
        job({
          events: [evt({ phase: 'cordon' }), evt({ phase: 'plan', message: 'Evicting 2 pods' })],
        })
      ).phase
    ).toBe('planning');

    expect(
      deriveDrainProgress(
        job({
          events: [evt({ phase: 'plan', message: 'Evicting 2 pods' }), evt({ phase: 'wait' })],
        })
      ).phase
    ).toBe('waiting');
  });

  it('forces phase=completed for terminal jobs even without a wait-complete event', () => {
    const result = deriveDrainProgress(
      job({
        status: 'succeeded',
        completedAt: 2000,
        events: [evt({ phase: 'plan', message: 'Evicting 2 pods' })],
      })
    );
    expect(result.phase).toBe('completed');
  });

  it('falls back to totalSeen when the plan event is absent', () => {
    const result = deriveDrainProgress(
      job({
        events: [
          evt({
            phase: 'evicted',
            kind: 'pod',
            podNamespace: 'ns',
            podName: 'a',
          }),
        ],
      })
    );
    expect(result.totalPlanned).toBeUndefined();
    expect(result.totalSeen).toBe(1);
    expect(result.done).toBe(1);
  });

  it('treats failed job status as hasError even with no error events', () => {
    const result = deriveDrainProgress(job({ status: 'failed', message: 'timeout', events: [] }));
    expect(result.hasError).toBe(true);
    expect(result.errorMessage).toBe('timeout');
  });

  it('copies the timeoutSeconds option through for UI display', () => {
    const result = deriveDrainProgress(job({ options: { ...baseOptions, timeoutSeconds: 300 } }));
    expect(result.timeoutSeconds).toBe(300);
  });
});
