import { describe, expect, it } from 'vitest';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';
import {
  buildDrainJobPresentation,
  buildDrainOptionsPayload,
  hasPositiveDrainOption,
  normalizeGraceSeconds,
  normalizeTimeoutSeconds,
  resolveDrainCancelPermissionReason,
  resolveDrainStartLabel,
  resolveDrainStartPermissionReason,
} from './drainNodeModalModel';

const allowed = { allowed: true, pending: false };
const denied = { allowed: false, pending: false };
const pending = { allowed: false, pending: true };

const buildJob = (
  id: string,
  status: NodeMaintenanceDrainJob['status']
): NodeMaintenanceDrainJob => ({
  clusterId: 'cluster-1',
  id,
  nodeName: 'node-a',
  status,
  startedAt: 1_700_000_000_000,
  options: {
    ignoreDaemonSets: true,
    deleteEmptyDirData: true,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  },
  events: [],
});

describe('drainNodeModalModel', () => {
  it('covers drainNodeModalModel scenarios', async () => {
    // Scenario: normalizes finite and non-finite numeric options
    expect(normalizeGraceSeconds(Number.NaN)).toBe(30);
    expect(normalizeGraceSeconds(0)).toBe(1);
    expect(normalizeGraceSeconds(901.9)).toBe(900);
    expect(normalizeTimeoutSeconds(Number.POSITIVE_INFINITY)).toBe(300);
    expect(normalizeTimeoutSeconds(0)).toBe(1);
    expect(normalizeTimeoutSeconds(9.8)).toBe(9);
    expect(hasPositiveDrainOption(undefined)).toBe(false);
    expect(hasPositiveDrainOption(null)).toBe(false);
    expect(hasPositiveDrainOption(1)).toBe(true);
    // Scenario: builds a normalized backend payload and omits disabled numeric options
    expect(
      buildDrainOptionsPayload({
        ignoreDaemonSets: true,
        deleteEmptyDirData: false,
        force: true,
        disableEviction: false,
        skipWaitForPodsToTerminate: true,
        gracePeriodSeconds: 1_200,
        timeoutSeconds: 4.9,
      })
    ).toEqual({
      ignoreDaemonSets: true,
      deleteEmptyDirData: false,
      force: true,
      disableEviction: false,
      skipWaitForPodsToTerminate: true,
      gracePeriodSeconds: 900,
      timeoutSeconds: 4,
    });
    expect(
      buildDrainOptionsPayload({
        ignoreDaemonSets: true,
        deleteEmptyDirData: true,
        force: false,
        disableEviction: false,
        skipWaitForPodsToTerminate: false,
        timeoutSeconds: 0,
      })
    ).not.toHaveProperty('timeoutSeconds');
    // Scenario: resolves node and selected pod permission explanations
    expect(resolveDrainStartPermissionReason(undefined, false)).toBeNull();
    expect(
      resolveDrainStartPermissionReason(
        { nodeMutation: pending, podEvictionCreate: allowed, podDelete: allowed },
        false
      )
    ).toBe('Checking Node maintenance permissions…');
    expect(
      resolveDrainStartPermissionReason(
        { nodeMutation: denied, podEvictionCreate: allowed, podDelete: allowed },
        false
      )
    ).toContain('get and patch this Node');
    expect(
      resolveDrainStartPermissionReason(
        { nodeMutation: allowed, podEvictionCreate: null, podDelete: allowed },
        false
      )
    ).toBe('Checking Pod eviction permission…');
    expect(
      resolveDrainStartPermissionReason(
        { nodeMutation: allowed, podEvictionCreate: denied, podDelete: allowed },
        false
      )
    ).toContain('create Pod evictions');
    expect(
      resolveDrainStartPermissionReason(
        { nodeMutation: allowed, podEvictionCreate: allowed, podDelete: denied },
        true
      )
    ).toContain('delete Pods');
    expect(
      resolveDrainStartPermissionReason(
        { nodeMutation: allowed, podEvictionCreate: allowed, podDelete: allowed },
        true
      )
    ).toBeNull();
    // Scenario: resolves cancel permission explanations
    expect(resolveDrainCancelPermissionReason(undefined)).toBeNull();
    expect(
      resolveDrainCancelPermissionReason({
        nodeMutation: pending,
        podEvictionCreate: allowed,
        podDelete: allowed,
      })
    ).toBe('Checking Node maintenance permissions…');
    expect(
      resolveDrainCancelPermissionReason({
        nodeMutation: denied,
        podEvictionCreate: allowed,
        podDelete: allowed,
      })
    ).toContain('canceling a drain');
    expect(
      resolveDrainCancelPermissionReason({
        nodeMutation: allowed,
        podEvictionCreate: allowed,
        podDelete: allowed,
      })
    ).toBeNull();

    {
      // Scenario: selects active, recent, retry, and earlier drain presentation
      expect(buildDrainJobPresentation([])).toEqual({
        activeDrainJob: null,
        primaryDrainJob: null,
        earlierDrains: [],
        isRetry: false,
        closeLabel: 'Cancel',
      });
      const failed = buildJob('failed', 'failed');
      const running = buildJob('running', 'running');
      const older = buildJob('older', 'succeeded');
      expect(buildDrainJobPresentation([failed, older])).toMatchObject({
        primaryDrainJob: failed,
        earlierDrains: [older],
        isRetry: true,
        closeLabel: 'Close',
      });
      expect(buildDrainJobPresentation([failed, running, older])).toMatchObject({
        activeDrainJob: running,
        primaryDrainJob: running,
        earlierDrains: [failed, older],
        isRetry: false,
      });
      expect(resolveDrainStartLabel(true, false)).toBe('Starting…');
      expect(resolveDrainStartLabel(false, true)).toBe('Retry');
      expect(resolveDrainStartLabel(false, false)).toBe('Drain');
    }
  });
});
