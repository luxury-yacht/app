import { describe, expect, it, vi } from 'vitest';

import { initialMetricsDemandState, transitionMetricsDemandState } from './metricsDemandState';

describe('transitionMetricsDemandState', () => {
  it('covers transitionMetricsDemandState scenarios', async () => {
    {
      // Scenario: allows one request or retry and ignores stale outcomes
      let state = transitionMetricsDemandState(initialMetricsDemandState(), {
        type: 'request-started',
        key: 'cluster-a',
      });
      const stale = transitionMetricsDemandState(state, {
        type: 'request-succeeded',
        key: 'cluster-b',
      });
      expect(stale).toBe(state);

      const timer = setTimeout(vi.fn(), 1_000) as unknown as ReturnType<typeof setTimeout>;
      state = transitionMetricsDemandState(state, {
        type: 'retry-scheduled',
        key: 'cluster-a',
        timer,
        maxDelayMs: 30_000,
      });

      expect(state).toMatchObject({
        status: 'waiting-retry',
        appliedKey: '',
        retryKey: 'cluster-a',
        retryDelayMs: 2_000,
      });
      expect(transitionMetricsDemandState(state, { type: 'retry-fired', key: 'cluster-b' })).toBe(
        state
      );
      clearTimeout(timer);
    }

    {
      // Scenario: abandons only the request that still owns the demand update
      const requesting = transitionMetricsDemandState(initialMetricsDemandState(250), {
        type: 'request-started',
        key: 'cluster-a',
      });

      expect(
        transitionMetricsDemandState(requesting, {
          type: 'request-abandoned',
          key: 'cluster-b',
        })
      ).toBe(requesting);
      expect(
        transitionMetricsDemandState(requesting, {
          type: 'request-abandoned',
          key: 'cluster-a',
          initialDelayMs: 500,
        })
      ).toEqual({ status: 'idle', appliedKey: '', retryDelayMs: 500 });
    }

    {
      // Scenario: does not let a stale request schedule a retry
      const requesting = transitionMetricsDemandState(initialMetricsDemandState(), {
        type: 'request-started',
        key: 'cluster-a',
      });
      const timer = setTimeout(vi.fn(), 1_000) as unknown as ReturnType<typeof setTimeout>;

      expect(
        transitionMetricsDemandState(requesting, {
          type: 'retry-scheduled',
          key: 'cluster-b',
          timer,
          maxDelayMs: 30_000,
        })
      ).toBe(requesting);

      clearTimeout(timer);
    }
  });
});
