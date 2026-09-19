export type RefreshInvocation = 'automatic' | 'foreground' | 'manual';
export type RefresherTimer = number | ReturnType<typeof globalThis.setTimeout>;

export type RefreshExecutionSummary = {
  successCount: number;
  failures: Error[];
};

export type RefresherExecution = {
  id: number;
  controller: AbortController;
  promise: Promise<RefreshExecutionSummary>;
  invocation: RefreshInvocation;
};

export type RefresherIntentState =
  | { status: 'disabled' }
  | { status: 'paused' }
  | { status: 'enabled' };

export type RefresherTimingState =
  | { status: 'idle'; intervalTimer?: RefresherTimer }
  | { status: 'cooldown'; cooldownTimer: RefresherTimer; intervalTimer?: RefresherTimer };

export type RefresherExecutionState =
  | { status: 'idle' }
  | ({ status: 'running' } & RefresherExecution);

export type RefresherRuntimeState = {
  intent: RefresherIntentState;
  timing: RefresherTimingState;
  execution: RefresherExecutionState;
};

export type RefresherRuntimeEvent =
  | { type: 'enabled' }
  | { type: 'disabled' }
  | { type: 'paused' }
  | { type: 'idle'; intervalTimer?: RefresherTimer }
  | { type: 'interval-replaced'; intervalTimer: RefresherTimer }
  | { type: 'refresh-started'; execution: RefresherExecution }
  | { type: 'refresh-finished'; executionId: number }
  | { type: 'cooldown-started'; cooldownTimer: RefresherTimer }
  | { type: 'cooldown-finished'; cooldownTimer: RefresherTimer };

export const initialRefresherRuntimeState = (enabled: boolean): RefresherRuntimeState => ({
  intent: enabled ? { status: 'enabled' } : { status: 'disabled' },
  timing: { status: 'idle' },
  execution: { status: 'idle' },
});

const intervalTimerFor = (timing: RefresherTimingState): RefresherTimer | undefined =>
  timing.intervalTimer;

const enableRefresher = (state: RefresherRuntimeState): RefresherRuntimeState =>
  state.intent.status !== 'enabled' ? { ...state, intent: { status: 'enabled' } } : state;

const disableRefresher = (state: RefresherRuntimeState): RefresherRuntimeState =>
  state.intent.status === 'disabled' ? state : { ...state, intent: { status: 'disabled' } };

const pauseRefresher = (state: RefresherRuntimeState): RefresherRuntimeState =>
  state.intent.status === 'disabled' || state.intent.status === 'paused'
    ? state
    : { ...state, intent: { status: 'paused' } };

const idleRefresher = (
  state: RefresherRuntimeState,
  event: Extract<RefresherRuntimeEvent, { type: 'idle' }>
): RefresherRuntimeState => ({
  ...state,
  timing: {
    status: 'idle',
    ...(event.intervalTimer !== undefined ? { intervalTimer: event.intervalTimer } : {}),
  },
});

const replaceInterval = (
  state: RefresherRuntimeState,
  event: Extract<RefresherRuntimeEvent, { type: 'interval-replaced' }>
): RefresherRuntimeState => ({
  ...state,
  timing: { ...state.timing, intervalTimer: event.intervalTimer },
});

const startRefresh = (
  state: RefresherRuntimeState,
  event: Extract<RefresherRuntimeEvent, { type: 'refresh-started' }>
): RefresherRuntimeState => ({
  ...state,
  execution: { status: 'running', ...event.execution },
});

const finishRefresh = (
  state: RefresherRuntimeState,
  event: Extract<RefresherRuntimeEvent, { type: 'refresh-finished' }>
): RefresherRuntimeState =>
  state.execution.status !== 'running' || state.execution.id !== event.executionId
    ? state
    : { ...state, execution: { status: 'idle' } };

const startCooldown = (
  state: RefresherRuntimeState,
  event: Extract<RefresherRuntimeEvent, { type: 'cooldown-started' }>
): RefresherRuntimeState => {
  const intervalTimer = intervalTimerFor(state.timing);
  return {
    ...state,
    timing: {
      status: 'cooldown',
      cooldownTimer: event.cooldownTimer,
      ...(intervalTimer !== undefined ? { intervalTimer } : {}),
    },
  };
};

const finishCooldown = (
  state: RefresherRuntimeState,
  event: Extract<RefresherRuntimeEvent, { type: 'cooldown-finished' }>
): RefresherRuntimeState => {
  if (state.timing.status !== 'cooldown' || state.timing.cooldownTimer !== event.cooldownTimer) {
    return state;
  }
  return {
    ...state,
    timing: {
      status: 'idle',
      ...(state.timing.intervalTimer !== undefined
        ? { intervalTimer: state.timing.intervalTimer }
        : {}),
    },
  };
};

export const transitionRefresherRuntimeState = (
  state: RefresherRuntimeState,
  event: RefresherRuntimeEvent
): RefresherRuntimeState => {
  switch (event.type) {
    case 'enabled':
      return enableRefresher(state);
    case 'disabled':
      return disableRefresher(state);
    case 'paused':
      return pauseRefresher(state);
    case 'idle':
      return idleRefresher(state, event);
    case 'interval-replaced':
      return replaceInterval(state, event);
    case 'refresh-started':
      return startRefresh(state, event);
    case 'refresh-finished':
      return finishRefresh(state, event);
    case 'cooldown-started':
      return startCooldown(state, event);
    case 'cooldown-finished':
      return finishCooldown(state, event);
  }
};

export const isRefresherEnabled = (state: RefresherRuntimeState): boolean =>
  state.intent.status !== 'disabled';

export const refresherIntervalTimer = (state: RefresherRuntimeState): RefresherTimer | undefined =>
  intervalTimerFor(state.timing);

export const refresherCooldownTimer = (state: RefresherRuntimeState): RefresherTimer | undefined =>
  state.timing.status === 'cooldown' ? state.timing.cooldownTimer : undefined;
