/**
 * frontend/src/core/refresh/store.test.ts
 *
 * Tests for refresh store state updates.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getDomainState,
  getRefreshState,
  getScopedDomainEntries,
  getScopedDomainState,
  getScopedDomainStates,
  incrementDroppedAutoRefresh,
  markPendingRequest,
  resetAllScopedDomainStates,
  resetDomainState,
  resetScopedDomainState,
  setDomainState,
  setScopedDomainState,
  subscribe,
} from './store';

describe('refresh store helpers', () => {
  afterEach(() => {
    resetDomainState('cluster-config');
    resetAllScopedDomainStates('namespace-config');
    const { pendingRequests } = getRefreshState();
    if (pendingRequests !== 0) {
      markPendingRequest(-pendingRequests);
    }
  });

  it('notifies subscribers when domain state changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    setDomainState('cluster-config', (previous) => ({
      ...previous,
      status: 'ready',
      data: { resources: [] },
    }));

    expect(listener).toHaveBeenCalled();
    unsubscribe();

    const state = getDomainState('cluster-config');
    expect(state.status).toBe('ready');
    expect(state.data).toEqual({ resources: [] });
  });

  it('skips notifications when domain state updater returns the existing reference', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const before = getDomainState('cluster-config');

    setDomainState('cluster-config', () => before);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('tracks scoped domain snapshots independently', () => {
    setScopedDomainState('namespace-config', 'team-a', (previous) => ({
      ...previous,
      status: 'ready',
      scope: 'team-a',
      data: { resources: [] },
    }));

    const scopedState = getScopedDomainState('namespace-config', 'team-a');
    expect(scopedState.status).toBe('ready');
    expect(scopedState.scope).toBe('team-a');
    expect(scopedState.data).toEqual({ resources: [] });

    resetScopedDomainState('namespace-config', 'team-a');
    const resetState = getScopedDomainState('namespace-config', 'team-a');
    expect(resetState.status).toBe('idle');
    expect(resetState.data).toBeNull();
  });

  it('retains other scoped entries when one scope is reset', () => {
    setScopedDomainState('namespace-config', 'team-a', (previous) => ({
      ...previous,
      status: 'ready',
      scope: 'team-a',
      data: { resources: [] },
    }));
    setScopedDomainState('namespace-config', 'team-b', (previous) => ({
      ...previous,
      status: 'ready',
      scope: 'team-b',
      data: { resources: [] },
    }));

    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    listener.mockReset();

    resetScopedDomainState('namespace-config', 'team-a');

    expect(listener).toHaveBeenCalled();
    const remaining = getScopedDomainEntries('namespace-config');
    expect(remaining).toHaveLength(1);
    expect(remaining[0][0]).toBe('team-b');
    expect(getScopedDomainState('namespace-config', 'team-b').status).toBe('ready');
    unsubscribe();
  });

  it('is a no-op when resetting an unknown scoped entry', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    resetScopedDomainState('namespace-config', 'missing');

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('exposes scoped state maps and entry arrays for consumers', () => {
    const baselineEntries = getScopedDomainEntries('namespace-config');
    const baselineStates = getScopedDomainStates('namespace-config');
    expect(baselineEntries).toBe(getScopedDomainEntries('namespace-config'));
    expect(baselineStates).toBe(getScopedDomainStates('namespace-config'));
    expect(Array.isArray(baselineEntries)).toBe(true);
    expect(Object.keys(baselineStates)).toHaveLength(0);

    setScopedDomainState('namespace-config', 'team-a', (previous) => ({
      ...previous,
      status: 'ready',
      scope: 'team-a',
      data: { resources: [] },
    }));

    const entries = getScopedDomainEntries('namespace-config');
    const states = getScopedDomainStates('namespace-config');
    expect(entries).toHaveLength(1);
    expect(entries[0][0]).toBe('team-a');
    expect(states['team-a']?.status).toBe('ready');
  });

  it('removes all scoped snapshots and entries when resetAllScopedDomainStates is invoked', () => {
    setScopedDomainState('namespace-config', 'team-a', (previous) => ({
      ...previous,
      status: 'ready',
      scope: 'team-a',
      data: { resources: [] },
    }));
    setScopedDomainState('namespace-config', 'team-b', (previous) => ({
      ...previous,
      status: 'ready',
      scope: 'team-b',
      data: { resources: [] },
    }));

    resetAllScopedDomainStates('namespace-config');

    expect(getScopedDomainEntries('namespace-config')).toHaveLength(0);
    expect(Object.keys(getScopedDomainStates('namespace-config'))).toHaveLength(0);
    expect(getScopedDomainState('namespace-config', 'team-a').status).toBe('idle');
    expect(getScopedDomainState('namespace-config', 'team-b').status).toBe('idle');
  });

  it('increments dropped auto refresh counters safely', () => {
    const before = getDomainState('cluster-config').droppedAutoRefreshes;
    incrementDroppedAutoRefresh('cluster-config');
    expect(getDomainState('cluster-config').droppedAutoRefreshes).toBe(before + 1);
  });

  it('never allows pending request counters to drop below zero', () => {
    markPendingRequest(2);
    expect(getRefreshState().pendingRequests).toBe(2);

    markPendingRequest(-5);
    expect(getRefreshState().pendingRequests).toBe(0);
  });
});
