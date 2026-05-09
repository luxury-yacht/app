/**
 * frontend/src/modules/namespace/components/podsFilterSignals.test.ts
 *
 * Test suite for podsFilterSignals.
 * Verifies cluster-specific storage key generation for pods unhealthy filter.
 */
import { describe, expect, it } from 'vitest';
import { getPodsUnhealthyStorageKey, parsePodsFilterRequest } from './podsFilterSignals';

describe('podsFilterSignals', () => {
  it('generates cluster-specific storage keys', () => {
    const keyA = getPodsUnhealthyStorageKey('cluster-a');
    const keyB = getPodsUnhealthyStorageKey('cluster-b');

    expect(keyA).toBe('pods:unhealthy-filter-scope:cluster-a');
    expect(keyB).toBe('pods:unhealthy-filter-scope:cluster-b');
    expect(keyA).not.toBe(keyB);
  });

  it('parses legacy unhealthy filter requests', () => {
    expect(parsePodsFilterRequest('team-a')).toEqual({
      scope: 'team-a',
      filter: 'unhealthy',
    });
  });

  it('parses typed pod filter requests', () => {
    expect(parsePodsFilterRequest('{"scope":"team-a","filter":"restarts"}')).toEqual({
      scope: 'team-a',
      filter: 'restarts',
    });
  });
});
