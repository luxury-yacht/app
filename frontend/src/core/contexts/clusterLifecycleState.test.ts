/**
 * frontend/src/core/contexts/clusterLifecycleState.test.ts
 *
 * Parse contract for the closed ClusterLifecycleState union: known states pass
 * through, absence ('' / null / undefined) is undefined WITHOUT a warning (the
 * wire uses '' for "no previous state"), and unknown values are dropped with a
 * once-per-value warning.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLUSTER_LIFECYCLE_STATES,
  type ClusterLifecycleState,
  parseClusterLifecycleState,
} from './clusterLifecycleState';

describe('parseClusterLifecycleState', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes every known state through unchanged', () => {
    const known: ClusterLifecycleState[] = [
      'connecting',
      'auth_failed',
      'connected',
      'loading',
      'loading_slow',
      'ready',
      'disconnected',
      'reconnecting',
    ];
    for (const state of known) {
      expect(parseClusterLifecycleState(state)).toBe(state);
    }
    // The runtime set and the union must not drift.
    expect([...CLUSTER_LIFECYCLE_STATES].sort()).toEqual([...known].sort());
  });

  it('treats absence as undefined without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseClusterLifecycleState('')).toBeUndefined();
    expect(parseClusterLifecycleState(undefined)).toBeUndefined();
    expect(parseClusterLifecycleState(null)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops unknown states with a once-per-value warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parseClusterLifecycleState('parse-test-bogus-a')).toBeUndefined();
    expect(parseClusterLifecycleState('parse-test-bogus-a')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    expect(parseClusterLifecycleState('parse-test-bogus-b')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
