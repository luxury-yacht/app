import { describe, expect, it } from 'vitest';

import {
  initialRefresherRuntimeState,
  transitionRefresherRuntimeState,
} from './refresherRuntimeState';

const execution = (id: number) => ({
  id,
  controller: new AbortController(),
  promise: Promise.resolve({ successCount: 0, failures: [] }),
  invocation: 'automatic' as const,
});

describe('transitionRefresherRuntimeState', () => {
  it('covers transitionRefresherRuntimeState scenarios', async () => {
    for (const [enabled, intent] of [
      [true, 'enabled'],
      [false, 'disabled'],
    ] as const) {
      // Scenarios: initializes enabled=%s with %s intent and idle owned state
      expect(initialRefresherRuntimeState(enabled)).toEqual({
        intent: { status: intent },
        timing: { status: 'idle' },
        execution: { status: 'idle' },
      });
    }

    for (const type of ['paused', 'disabled'] as const) {
      // Scenarios: %s intent preserves owned timer handles until the caller clears them
      let state = transitionRefresherRuntimeState(initialRefresherRuntimeState(true), {
        type: 'idle',
        intervalTimer: 17,
      });
      state = transitionRefresherRuntimeState(state, {
        type: 'cooldown-started',
        cooldownTimer: 23,
      });

      const transitioned = transitionRefresherRuntimeState(state, { type });

      expect(transitioned.intent).toEqual({ status: type });
      expect(transitioned.timing).toEqual({
        status: 'cooldown',
        cooldownTimer: 23,
        intervalTimer: 17,
      });
    }

    {
      // Scenario: enables without changing timing or execution ownership
      let state = transitionRefresherRuntimeState(initialRefresherRuntimeState(false), {
        type: 'idle',
        intervalTimer: 17,
      });
      state = transitionRefresherRuntimeState(state, {
        type: 'refresh-started',
        execution: execution(1),
      });

      const enabled = transitionRefresherRuntimeState(state, { type: 'enabled' });

      expect(enabled.intent).toEqual({ status: 'enabled' });
      expect(enabled.timing).toBe(state.timing);
      expect(enabled.execution).toBe(state.execution);
    }

    {
      // Scenario: replaces and clears interval timing without changing intent or execution
      let state = transitionRefresherRuntimeState(initialRefresherRuntimeState(true), {
        type: 'refresh-started',
        execution: execution(1),
      });
      state = transitionRefresherRuntimeState(state, { type: 'idle', intervalTimer: 17 });

      const replaced = transitionRefresherRuntimeState(state, {
        type: 'interval-replaced',
        intervalTimer: 19,
      });
      const cleared = transitionRefresherRuntimeState(replaced, { type: 'idle' });

      expect(replaced.timing).toEqual({ status: 'idle', intervalTimer: 19 });
      expect(cleared.timing).toEqual({ status: 'idle' });
      expect(cleared.intent).toBe(state.intent);
      expect(cleared.execution).toBe(state.execution);
    }

    {
      // Scenario: finishes only the execution that owns the completion id
      const running = transitionRefresherRuntimeState(initialRefresherRuntimeState(true), {
        type: 'refresh-started',
        execution: execution(2),
      });

      const stale = transitionRefresherRuntimeState(running, {
        type: 'refresh-finished',
        executionId: 1,
      });
      const finished = transitionRefresherRuntimeState(running, {
        type: 'refresh-finished',
        executionId: 2,
      });

      expect(stale).toBe(running);
      expect(finished.execution).toEqual({ status: 'idle' });
      expect(finished.intent).toBe(running.intent);
      expect(finished.timing).toBe(running.timing);
    }

    {
      // Scenario: finishes only the cooldown that owns the timer and retains the interval
      let state = transitionRefresherRuntimeState(initialRefresherRuntimeState(true), {
        type: 'idle',
        intervalTimer: 17,
      });
      state = transitionRefresherRuntimeState(state, {
        type: 'cooldown-started',
        cooldownTimer: 23,
      });

      const stale = transitionRefresherRuntimeState(state, {
        type: 'cooldown-finished',
        cooldownTimer: 29,
      });
      const finished = transitionRefresherRuntimeState(state, {
        type: 'cooldown-finished',
        cooldownTimer: 23,
      });

      expect(stale).toBe(state);
      expect(finished.timing).toEqual({ status: 'idle', intervalTimer: 17 });
      expect(finished.intent).toBe(state.intent);
      expect(finished.execution).toBe(state.execution);
    }

    {
      // Scenario: keeps pause intent and ignores a stale execution completion
      const first = execution(1);
      const replacement = { ...first, id: 2, controller: new AbortController() };
      let state = transitionRefresherRuntimeState(initialRefresherRuntimeState(true), {
        type: 'refresh-started',
        execution: first,
      });
      state = transitionRefresherRuntimeState(state, { type: 'paused' });
      state = transitionRefresherRuntimeState(state, {
        type: 'refresh-started',
        execution: replacement,
      });

      const afterStaleCompletion = transitionRefresherRuntimeState(state, {
        type: 'refresh-finished',
        executionId: first.id,
      });
      expect(afterStaleCompletion).toBe(state);
      expect(afterStaleCompletion.intent).toEqual({ status: 'paused' });
      expect(afterStaleCompletion.execution).toEqual({ status: 'running', ...replacement });
    }
  });
});
