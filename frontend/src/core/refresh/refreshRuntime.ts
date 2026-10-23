import type { AppEvents } from '@/core/events';
import type { RefreshIntent } from './refreshIntent';
import type { RefreshDomain } from './types';

export type InFlightRequest = {
  controller: AbortController;
  // Kept so a foreground activation that aborts this fetch can replay it with
  // its original intent once the cluster serves again.
  intent: RefreshIntent;
  coalesce?: boolean;
  requestId: number;
  cleanup?: () => void;
  completion?: Promise<void>;
  contextVersion: number;
  domain: RefreshDomain;
  scope?: string;
};

export type ScopedFetchState =
  | { status: 'idle' }
  | {
      status: 'fetching';
      request: InFlightRequest;
      // A stream signal proves the active response predates a change. Any
      // number of signals coalesce into one trailing fetch after this request.
      trailingStreamSignal: boolean;
    };

export type ScopedFetchEvent =
  | { type: 'fetch-started'; request: InFlightRequest }
  | { type: 'stream-signal-received' }
  | { type: 'fetch-settled'; requestId: number }
  | { type: 'fetch-cancelled'; requestId: number };

export type TrackedInFlightRequest = InFlightRequest & {
  trailingStreamSignal: boolean;
};

export const transitionScopedFetchState = (
  state: ScopedFetchState,
  event: ScopedFetchEvent
): ScopedFetchState => {
  switch (event.type) {
    case 'fetch-started':
      return {
        status: 'fetching',
        request: event.request,
        trailingStreamSignal: false,
      };
    case 'stream-signal-received':
      if (state.status === 'idle' || state.trailingStreamSignal) {
        return state;
      }
      return { ...state, trailingStreamSignal: true };
    case 'fetch-settled':
    case 'fetch-cancelled':
      if (state.status === 'idle' || state.request.requestId !== event.requestId) {
        return state;
      }
      return { status: 'idle' };
  }
};

export type RefreshDemand = 'query' | 'snapshot';

type ScopedDemandCounts = Record<RefreshDemand, number>;

// A scope is enabled only while leases hold it. A reset requested while a
// holder still shows the scope's data waits for the last release
// (`resetOnRelease`) instead of wiping rows another consumer is rendering.
export type ScopedActivationState =
  | { status: 'untracked' }
  | { status: 'disabled' }
  | { status: 'enabled'; demands: ScopedDemandCounts; resetOnRelease: boolean };

export type ScopedActivationEvent =
  | { type: 'disabled' }
  | { type: 'lease-acquired'; demand: RefreshDemand }
  | { type: 'lease-released'; demand: RefreshDemand }
  | { type: 'reset-requested' };

const NO_SCOPED_DEMAND: ScopedDemandCounts = { query: 0, snapshot: 0 };

const totalDemand = (demands: ScopedDemandCounts): number => demands.query + demands.snapshot;

const demandsFor = (state: ScopedActivationState): ScopedDemandCounts =>
  state.status === 'enabled' ? state.demands : NO_SCOPED_DEMAND;

const disableScope = (state: ScopedActivationState): ScopedActivationState => {
  if (state.status === 'disabled') {
    return state;
  }
  if (state.status === 'enabled' && totalDemand(state.demands) > 0) {
    return state;
  }
  return { status: 'disabled' };
};

const acquireScopeLease = (
  state: ScopedActivationState,
  event: Extract<ScopedActivationEvent, { type: 'lease-acquired' }>
): ScopedActivationState => {
  const demands = demandsFor(state);
  const nextDemands = {
    ...demands,
    [event.demand]: demands[event.demand] + 1,
  };
  return {
    status: 'enabled',
    demands: nextDemands,
    resetOnRelease: state.status === 'enabled' && state.resetOnRelease,
  };
};

const releaseScopeLease = (
  state: ScopedActivationState,
  event: Extract<ScopedActivationEvent, { type: 'lease-released' }>
): ScopedActivationState => {
  if (state.status !== 'enabled' || state.demands[event.demand] === 0) {
    return state;
  }
  const nextDemands = {
    ...state.demands,
    [event.demand]: state.demands[event.demand] - 1,
  };
  return { ...state, demands: nextDemands };
};

const requestResetOnRelease = (state: ScopedActivationState): ScopedActivationState =>
  state.status === 'enabled' && totalDemand(state.demands) > 0 && !state.resetOnRelease
    ? { ...state, resetOnRelease: true }
    : state;

export const transitionScopedActivationState = (
  state: ScopedActivationState,
  event: ScopedActivationEvent
): ScopedActivationState => {
  switch (event.type) {
    case 'disabled':
      return disableScope(state);
    case 'lease-acquired':
      return acquireScopeLease(state, event);
    case 'lease-released':
      return releaseScopeLease(state, event);
    case 'reset-requested':
      return requestResetOnRelease(state);
  }
};

// Reads held until the scope's cluster serves. Merged requests keep every
// intent, so the replay can apply the pause rule to each.
export type PendingClusterReadinessRequest = {
  coalesce?: boolean;
  domain: RefreshDomain;
  scope: string;
  intents: readonly RefreshIntent[];
  queryReconcile: boolean;
};

export type ScopedReadinessState =
  | { status: 'ready' }
  | { status: 'waiting'; request: PendingClusterReadinessRequest };

export type ScopedReadinessEvent =
  | { type: 'request-deferred'; request: PendingClusterReadinessRequest }
  | { type: 'cluster-ready' };

export const transitionScopedReadinessState = (
  state: ScopedReadinessState,
  event: ScopedReadinessEvent
): ScopedReadinessState => {
  switch (event.type) {
    case 'request-deferred':
      if (state.status === 'ready') {
        return { status: 'waiting', request: event.request };
      }
      return {
        status: 'waiting',
        request: {
          ...state.request,
          ...(state.request.coalesce || event.request.coalesce ? { coalesce: true } : {}),
          intents: Array.from(new Set([...state.request.intents, ...event.request.intents])),
          queryReconcile: state.request.queryReconcile || event.request.queryReconcile,
        },
      };
    case 'cluster-ready':
      return state.status === 'ready' ? state : { status: 'ready' };
  }
};

export type ScopedPermissionState =
  | { status: 'unknown' }
  | { status: 'allowed' }
  | { status: 'denied' };

export type ScopedPermissionEvent =
  | { type: 'permission-allowed' }
  | { type: 'permission-denied' }
  | { type: 'permission-epoch-reset' };

const SCOPED_PERMISSION_STATUS_BY_EVENT: Record<
  ScopedPermissionEvent['type'],
  ScopedPermissionState['status']
> = {
  'permission-allowed': 'allowed',
  'permission-denied': 'denied',
  'permission-epoch-reset': 'unknown',
};

export const transitionScopedPermissionState = (
  state: ScopedPermissionState,
  event: ScopedPermissionEvent
): ScopedPermissionState => {
  const status = SCOPED_PERMISSION_STATUS_BY_EVENT[event.type];
  return state.status === status ? state : { status };
};

export type ClusterAuthState = { status: 'available' } | { status: 'failed' };
export type ClusterAuthEvent = { type: 'auth-failed' } | { type: 'auth-recovered' };

export const transitionClusterAuthState = (
  state: ClusterAuthState,
  event: ClusterAuthEvent
): ClusterAuthState => {
  const status = event.type === 'auth-failed' ? 'failed' : 'available';
  return state.status === status ? state : { status };
};

type StreamStartTask = Promise<void>;
type StreamInitializationState = { status: 'idle' } | { status: 'scheduled'; task: Promise<void> };
type StreamConnectionState =
  | { status: 'inactive' }
  | { status: 'starting'; task: StreamStartTask; cancellationRequested: boolean }
  | { status: 'active'; cancellationRequested: boolean };
type StreamHealthState =
  | { status: 'unknown' }
  | { status: 'known'; payload: AppEvents['refresh:resource-stream-health'] };
// A failed start waits for its backed-off retry here. `failures` counts
// consecutive failed starts, so each retry waits longer; a start that
// succeeds, or a stop, resets it. The orchestrator owns the timer.
type StreamStartRetryState =
  | { status: 'idle'; failures: number }
  | { status: 'scheduled'; failures: number; timer: ReturnType<typeof setTimeout> };

export type ScopedStreamState = {
  policy: 'allowed' | 'blocked';
  initialization: StreamInitializationState;
  connection: StreamConnectionState;
  health: StreamHealthState;
  startRetry: StreamStartRetryState;
};

export type ScopedStreamEvent =
  | { type: 'stream-blocked' }
  | { type: 'stream-block-cleared' }
  | { type: 'initialization-scheduled'; task: Promise<void> }
  | { type: 'initialization-cleared'; task?: Promise<void> }
  | { type: 'start-began'; task: StreamStartTask }
  | { type: 'start-cancelled' }
  | { type: 'start-cancellation-cleared' }
  | { type: 'start-finished'; task: StreamStartTask }
  | { type: 'start-failed'; task: StreamStartTask }
  | { type: 'stream-stopped' }
  | { type: 'health-received'; payload: AppEvents['refresh:resource-stream-health'] }
  | { type: 'health-cleared' }
  | { type: 'async-cleared' }
  | { type: 'all-cleared'; reset: boolean }
  | { type: 'transient-reset' }
  | { type: 'start-retry-scheduled'; timer: ReturnType<typeof setTimeout> }
  | { type: 'start-retry-taken' }
  | { type: 'start-retry-reset' };

const inactiveStreamState = (): ScopedStreamState => ({
  policy: 'allowed',
  initialization: { status: 'idle' },
  connection: { status: 'inactive' },
  health: { status: 'unknown' },
  startRetry: { status: 'idle', failures: 0 },
});

const blockStream = (state: ScopedStreamState): ScopedStreamState =>
  state.policy === 'blocked' && state.initialization.status === 'idle'
    ? state
    : {
        ...state,
        policy: 'blocked',
        initialization: { status: 'idle' },
      };

const clearStreamBlock = (state: ScopedStreamState): ScopedStreamState =>
  state.policy === 'allowed' ? state : { ...state, policy: 'allowed' };

const scheduleStreamInitialization = (
  state: ScopedStreamState,
  event: Extract<ScopedStreamEvent, { type: 'initialization-scheduled' }>
): ScopedStreamState => ({
  ...state,
  initialization: { status: 'scheduled', task: event.task },
});

const clearStreamInitialization = (
  state: ScopedStreamState,
  event: Extract<ScopedStreamEvent, { type: 'initialization-cleared' }>
): ScopedStreamState => {
  if (
    state.initialization.status === 'idle' ||
    (event.task !== undefined && state.initialization.task !== event.task)
  ) {
    return state;
  }
  return { ...state, initialization: { status: 'idle' } };
};

const beginStreamStart = (
  state: ScopedStreamState,
  event: Extract<ScopedStreamEvent, { type: 'start-began' }>
): ScopedStreamState => {
  if (state.policy === 'blocked') {
    return state;
  }
  return {
    ...state,
    connection: {
      status: 'starting',
      task: event.task,
      cancellationRequested: false,
    },
  };
};

const requestStreamCancellation = (state: ScopedStreamState): ScopedStreamState => {
  if (state.connection.status === 'inactive' || state.connection.cancellationRequested) {
    return state;
  }
  return {
    ...state,
    connection: { ...state.connection, cancellationRequested: true },
  };
};

const clearStreamCancellation = (state: ScopedStreamState): ScopedStreamState => {
  if (state.connection.status === 'inactive' || !state.connection.cancellationRequested) {
    return state;
  }
  return {
    ...state,
    connection: { ...state.connection, cancellationRequested: false },
  };
};

const finishStreamStart = (
  state: ScopedStreamState,
  event: Extract<ScopedStreamEvent, { type: 'start-finished' }>
): ScopedStreamState => {
  if (
    state.connection.status !== 'starting' ||
    state.connection.task !== event.task ||
    state.connection.cancellationRequested
  ) {
    return state;
  }
  return {
    ...state,
    connection: { status: 'active', cancellationRequested: false },
  };
};

const failStreamStart = (
  state: ScopedStreamState,
  event: Extract<ScopedStreamEvent, { type: 'start-failed' }>
): ScopedStreamState => {
  if (state.connection.status !== 'starting' || state.connection.task !== event.task) {
    return state;
  }
  return { ...state, connection: { status: 'inactive' } };
};

const stopActiveStream = (state: ScopedStreamState): ScopedStreamState =>
  state.connection.status === 'active' ? { ...state, connection: { status: 'inactive' } } : state;

const receiveStreamHealth = (
  state: ScopedStreamState,
  event: Extract<ScopedStreamEvent, { type: 'health-received' }>
): ScopedStreamState => ({
  ...state,
  health: { status: 'known', payload: event.payload },
});

const clearStreamHealth = (state: ScopedStreamState): ScopedStreamState =>
  state.health.status === 'unknown' ? state : { ...state, health: { status: 'unknown' } };

const clearAsyncConnection = (connection: StreamConnectionState): StreamConnectionState => {
  if (connection.status === 'starting') {
    return { status: 'inactive' };
  }
  if (connection.status === 'active') {
    return { ...connection, cancellationRequested: false };
  }
  return connection;
};

const clearAsyncStreamState = (state: ScopedStreamState): ScopedStreamState => ({
  ...state,
  initialization: { status: 'idle' },
  connection: clearAsyncConnection(state.connection),
});

const clearAllStreamState = (
  state: ScopedStreamState,
  event: Extract<ScopedStreamEvent, { type: 'all-cleared' }>
): ScopedStreamState => ({
  ...state,
  initialization: event.reset ? { status: 'idle' } : state.initialization,
  connection: { status: 'inactive' },
});

const resetTransientStreamState = (state: ScopedStreamState): ScopedStreamState => ({
  policy: 'allowed',
  initialization: { status: 'idle' },
  connection:
    state.connection.status === 'active'
      ? { ...state.connection, cancellationRequested: false }
      : { status: 'inactive' },
  health: { status: 'unknown' },
  startRetry: state.startRetry,
});

const scheduleStartRetry = (
  state: ScopedStreamState,
  event: Extract<ScopedStreamEvent, { type: 'start-retry-scheduled' }>
): ScopedStreamState => ({
  ...state,
  startRetry: { status: 'scheduled', failures: state.startRetry.failures + 1, timer: event.timer },
});

const takeStartRetry = (state: ScopedStreamState): ScopedStreamState =>
  state.startRetry.status === 'idle'
    ? state
    : { ...state, startRetry: { status: 'idle', failures: state.startRetry.failures } };

const resetStartRetry = (state: ScopedStreamState): ScopedStreamState =>
  state.startRetry.status === 'idle' && state.startRetry.failures === 0
    ? state
    : { ...state, startRetry: { status: 'idle', failures: 0 } };

export const transitionScopedStreamState = (
  state: ScopedStreamState,
  event: ScopedStreamEvent
): ScopedStreamState => {
  switch (event.type) {
    case 'stream-blocked':
      return blockStream(state);
    case 'stream-block-cleared':
      return clearStreamBlock(state);
    case 'initialization-scheduled':
      return scheduleStreamInitialization(state, event);
    case 'initialization-cleared':
      return clearStreamInitialization(state, event);
    case 'start-began':
      return beginStreamStart(state, event);
    case 'start-cancelled':
      return requestStreamCancellation(state);
    case 'start-cancellation-cleared':
      return clearStreamCancellation(state);
    case 'start-finished':
      return finishStreamStart(state, event);
    case 'start-failed':
      return failStreamStart(state, event);
    case 'stream-stopped':
      return stopActiveStream(state);
    case 'health-received':
      return receiveStreamHealth(state, event);
    case 'health-cleared':
      return clearStreamHealth(state);
    case 'async-cleared':
      return clearAsyncStreamState(state);
    case 'all-cleared':
      return clearAllStreamState(state, event);
    case 'transient-reset':
      return resetTransientStreamState(state);
    case 'start-retry-scheduled':
      return scheduleStartRetry(state, event);
    case 'start-retry-taken':
      return takeStartRetry(state);
    case 'start-retry-reset':
      return resetStartRetry(state);
  }
};

// The scope's next scheduled poll. The orchestrator owns the timer; the record
// holds its handle so release, pause, and teardown can cancel it.
export type ScopedPollingState =
  | { status: 'idle' }
  | { status: 'scheduled'; timer: ReturnType<typeof setTimeout> };

type ScopedRefreshState = {
  domain: RefreshDomain;
  scope?: string;
  reconciliation: { status: 'clean' } | { status: 'pending'; failures: number; retryAt: number };
  activation: ScopedActivationState;
  polling: ScopedPollingState;
  fetch: ScopedFetchState;
  readiness: ScopedReadinessState;
  permission: ScopedPermissionState;
  stream: ScopedStreamState;
};

type StreamingFetchMode = 'snapshot' | 'skip';

export type StreamingFetchDecision = {
  mode: StreamingFetchMode;
  // True only when this fetch runs BECAUSE the stream that should have kept the
  // scope fresh is not delivering. That is the stream-down fallback, and it is
  // the one branch worth counting: every other snapshot has its own reason
  // (manual, no stream, first page, or a doorbell asking for the fetch).
  fallback: boolean;
};

type StreamingFetchDecisionInput = {
  domain: RefreshDomain;
  scope: string;
  shouldStream: boolean;
  isManual: boolean;
  // A fetch triggered BY a stream signal (doorbell). It must never be skipped
  // for stream health — the signal is the stream announcing changed data.
  streamSignal?: boolean;
  streamingHealthy: boolean;
  /**
   * Whether the scope already holds an applied snapshot. A scope with no data yet
   * (a brand-new filter/page/scope) must fetch its first page regardless of stream
   * health: the notify-only stream carries change signals, not the new query's
   * initial snapshot. Skipping is only safe once the scope has data the stream keeps
   * fresh.
   */
  hasData: boolean;
};

export const makeInFlightKey = (domain: RefreshDomain, scope?: string) =>
  `${domain}::${scope ?? '*'}`;

export type RuntimeScopeStateChange = {
  previous: boolean | undefined;
  changed: boolean;
};

export class ClusterRefreshRuntime {
  readonly clusterId: string;
  private readonly scopedStates = new Map<string, ScopedRefreshState>();
  private authState: ClusterAuthState = { status: 'available' };
  constructor(clusterId: string) {
    this.clusterId = clusterId;
  }

  private getScopeState(domain: RefreshDomain, scope?: string): ScopedRefreshState {
    return (
      this.scopedStates.get(makeInFlightKey(domain, scope)) ?? {
        domain,
        scope,
        reconciliation: { status: 'clean' },
        activation: { status: 'untracked' },
        polling: { status: 'idle' },
        fetch: { status: 'idle' },
        readiness: { status: 'ready' },
        permission: { status: 'unknown' },
        stream: inactiveStreamState(),
      }
    );
  }

  private storeScopeState(state: ScopedRefreshState): void {
    const key = makeInFlightKey(state.domain, state.scope);
    if (
      state.reconciliation.status === 'clean' &&
      state.activation.status === 'untracked' &&
      state.polling.status === 'idle' &&
      state.fetch.status === 'idle' &&
      state.readiness.status === 'ready' &&
      state.permission.status === 'unknown' &&
      state.stream.policy === 'allowed' &&
      state.stream.initialization.status === 'idle' &&
      state.stream.connection.status === 'inactive' &&
      state.stream.health.status === 'unknown'
    ) {
      this.scopedStates.delete(key);
      return;
    }
    this.scopedStates.set(key, state);
  }

  private applyActivationEvent(
    domain: RefreshDomain,
    scope: string,
    event: ScopedActivationEvent
  ): { previous: ScopedActivationState; next: ScopedActivationState } {
    const state = this.getScopeState(domain, scope);
    const next = transitionScopedActivationState(state.activation, event);
    if (next !== state.activation) {
      this.storeScopeState({ ...state, activation: next });
    }
    return { previous: state.activation, next };
  }

  deleteDomain(domain: RefreshDomain): void {
    Array.from(this.scopedStates.entries()).forEach(([key, state]) => {
      if (state.domain === domain) {
        this.scopedStates.delete(key);
      }
    });
  }

  getKnownScopes(domain: RefreshDomain): string[] {
    return Array.from(this.scopedStates.values())
      .filter(
        (state) =>
          state.domain === domain &&
          state.scope !== undefined &&
          state.activation.status !== 'untracked'
      )
      .map((state) => state.scope as string);
  }

  getEnabledScopes(domain: RefreshDomain): string[] {
    return Array.from(this.scopedStates.values())
      .filter(
        (state) =>
          state.domain === domain &&
          state.scope !== undefined &&
          state.activation.status === 'enabled'
      )
      .map((state) => state.scope as string);
  }

  hasEnabledScopedSources(domain: RefreshDomain): boolean {
    return Array.from(this.scopedStates.values()).some(
      (state) => state.domain === domain && state.activation.status === 'enabled'
    );
  }

  isScopedDomainEnabled(domain: RefreshDomain, scope: string): boolean {
    const status = this.getScopeState(domain, scope).activation.status;
    return status === 'untracked' || status === 'enabled';
  }

  // Disables a scope no lease holds; a held scope stays enabled.
  disableScopedDomain(domain: RefreshDomain, scope: string): RuntimeScopeStateChange {
    const { previous, next } = this.applyActivationEvent(domain, scope, { type: 'disabled' });
    const previousEnabled =
      previous.status === 'untracked' ? undefined : previous.status === 'enabled';
    const nextEnabled = next.status === 'enabled';
    return { previous: previousEnabled, changed: previousEnabled !== nextEnabled };
  }

  getScopedLeaseCount(domain: RefreshDomain, scope: string, demand?: RefreshDemand): number {
    const counts = demandsFor(this.getScopeState(domain, scope).activation);
    return demand ? counts[demand] : counts.query + counts.snapshot;
  }

  hasScopedLease(domain: RefreshDomain, scope: string): boolean {
    return this.getScopedLeaseCount(domain, scope) > 0;
  }

  hasScopedDemand(domain: RefreshDomain, scope: string, demand: RefreshDemand): boolean {
    return this.getScopedLeaseCount(domain, scope, demand) > 0;
  }

  // Add one lease holder for (domain, scope). `firstLease` is true when this is
  // the only holder, signalling the caller to actually enable the scope.
  acquireScopedLease(
    domain: RefreshDomain,
    scope: string,
    demand: RefreshDemand = 'snapshot'
  ): { count: number; firstLease: boolean; activationChanged: boolean } {
    const before = this.getScopeState(domain, scope).activation;
    const previousTotal = totalDemand(demandsFor(before));
    const { next } = this.applyActivationEvent(domain, scope, {
      type: 'lease-acquired',
      demand,
    });
    const nextTotal = totalDemand(demandsFor(next));
    return {
      count: nextTotal,
      firstLease: previousTotal === 0,
      activationChanged: before.status !== 'enabled' && next.status === 'enabled',
    };
  }

  // Remove one lease holder for (domain, scope). `lastLease` is true when the
  // final holder released, signalling the caller to actually disable the scope.
  releaseScopedLease(
    domain: RefreshDomain,
    scope: string,
    demand: RefreshDemand = 'snapshot'
  ): { count: number; lastLease: boolean; hadLease: boolean; resetOnRelease: boolean } {
    const before = this.getScopeState(domain, scope).activation;
    const counts = demandsFor(before);
    if (counts[demand] <= 0) {
      return { count: 0, lastLease: false, hadLease: false, resetOnRelease: false };
    }
    const previousTotal = totalDemand(counts);
    const { next } = this.applyActivationEvent(domain, scope, {
      type: 'lease-released',
      demand,
    });
    const nextTotal = totalDemand(demandsFor(next));
    const resetOnRelease = before.status === 'enabled' && before.resetOnRelease;
    if (nextTotal === 0) {
      return { count: 0, lastLease: previousTotal === 1, hadLease: true, resetOnRelease };
    }
    return { count: nextTotal, lastLease: false, hadLease: true, resetOnRelease: false };
  }

  // Defers a reset of a scope some holder still shows until its last release.
  // Returns false when no lease holds the scope, so the caller resets now.
  deferResetUntilReleased(domain: RefreshDomain, scope: string): boolean {
    if (!this.hasScopedLease(domain, scope)) {
      return false;
    }
    this.applyActivationEvent(domain, scope, { type: 'reset-requested' });
    return true;
  }

  // Scopes some consumer leases right now, across domains.
  getLeasedScopes(): Array<{ domain: RefreshDomain; scope: string }> {
    return Array.from(this.scopedStates.values()).flatMap((state) =>
      state.scope !== undefined && totalDemand(demandsFor(state.activation)) > 0
        ? [{ domain: state.domain, scope: state.scope }]
        : []
    );
  }

  setPollTimer(domain: RefreshDomain, scope: string, timer: ReturnType<typeof setTimeout>): void {
    const state = this.getScopeState(domain, scope);
    this.storeScopeState({ ...state, polling: { status: 'scheduled', timer } });
  }

  // Forgets the scope's scheduled poll and hands back its timer to cancel.
  takePollTimer(domain: RefreshDomain, scope: string): ReturnType<typeof setTimeout> | undefined {
    const state = this.getScopeState(domain, scope);
    if (state.polling.status !== 'scheduled') {
      return undefined;
    }
    this.storeScopeState({ ...state, polling: { status: 'idle' } });
    return state.polling.timer;
  }

  isPollScheduled(domain: RefreshDomain, scope: string): boolean {
    return this.getScopeState(domain, scope).polling.status === 'scheduled';
  }

  // Forgets every scheduled poll and hands back the timers to cancel.
  takeAllPollTimers(): Array<ReturnType<typeof setTimeout>> {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    Array.from(this.scopedStates.values()).forEach((state) => {
      if (state.polling.status === 'scheduled' && state.scope !== undefined) {
        timers.push(state.polling.timer);
        this.storeScopeState({ ...state, polling: { status: 'idle' } });
      }
    });
    return timers;
  }

  forEachEnabledScope(domain: RefreshDomain, callback: (scope: string) => void): void {
    this.getEnabledScopes(domain).forEach(callback);
  }

  forEachScopedDomain(callback: (domain: RefreshDomain, scope: string) => void): void {
    this.scopedStates.forEach((state) => {
      if (state.scope !== undefined && state.activation.status !== 'untracked') {
        callback(state.domain, state.scope);
      }
    });
  }

  deferUntilClusterReady(request: PendingClusterReadinessRequest): void {
    const state = this.getScopeState(request.domain, request.scope);
    const readiness = transitionScopedReadinessState(state.readiness, {
      type: 'request-deferred',
      request,
    });
    this.storeScopeState({ ...state, readiness });
  }

  takeDeferredReadinessRequests(): PendingClusterReadinessRequest[] {
    const requests: PendingClusterReadinessRequest[] = [];
    Array.from(this.scopedStates.values()).forEach((state) => {
      if (state.readiness.status !== 'waiting') {
        return;
      }
      requests.push(state.readiness.request);
      this.storeScopeState({
        ...state,
        readiness: transitionScopedReadinessState(state.readiness, { type: 'cluster-ready' }),
      });
    });
    return requests;
  }

  getDeferredReadinessRequests(): PendingClusterReadinessRequest[] {
    return Array.from(this.scopedStates.values()).flatMap((state) =>
      state.readiness.status === 'waiting' ? [state.readiness.request] : []
    );
  }

  needsReconciliation(domain: RefreshDomain, scope: string): boolean {
    return this.getScopeState(domain, scope).reconciliation.status === 'pending';
  }

  canRetryReconciliation(domain: RefreshDomain, scope: string, now = Date.now()): boolean {
    const pending = this.getScopeState(domain, scope).reconciliation;
    return pending.status === 'clean' || pending.retryAt <= now;
  }

  markReconciliationFailed(domain: RefreshDomain, scope: string): void {
    const state = this.getScopeState(domain, scope);
    const failures =
      state.reconciliation.status === 'pending' ? state.reconciliation.failures + 1 : 1;
    const delay = failures === 1 ? 0 : Math.min(60_000, 1000 * 2 ** Math.min(failures - 2, 6));
    this.storeScopeState({
      ...state,
      reconciliation: { status: 'pending', failures, retryAt: Date.now() + delay },
    });
  }

  // A signal held back while auto-refresh was off: the next allowed read
  // reconciles the scope, with no failure backoff.
  markReconciliationPending(domain: RefreshDomain, scope: string): void {
    const state = this.getScopeState(domain, scope);
    if (state.reconciliation.status === 'pending') {
      return;
    }
    this.storeScopeState({
      ...state,
      reconciliation: { status: 'pending', failures: 0, retryAt: Date.now() },
    });
  }

  markReconciled(domain: RefreshDomain, scope: string): void {
    const state = this.getScopeState(domain, scope);
    this.storeScopeState({ ...state, reconciliation: { status: 'clean' } });
  }

  isPermissionDenied(domain: RefreshDomain, scope: string): boolean {
    return this.getScopeState(domain, scope).permission.status === 'denied';
  }

  markPermissionDenied(domain: RefreshDomain, scope: string): void {
    this.applyPermissionEvent(domain, scope, { type: 'permission-denied' });
  }

  markPermissionAllowed(domain: RefreshDomain, scope: string): void {
    this.applyPermissionEvent(domain, scope, { type: 'permission-allowed' });
  }

  resetPermissionEpoch(): Array<{ domain: RefreshDomain; scope: string }> {
    const reset: Array<{ domain: RefreshDomain; scope: string }> = [];
    Array.from(this.scopedStates.values()).forEach((state) => {
      if (state.scope === undefined || state.permission.status === 'unknown') {
        return;
      }
      reset.push({ domain: state.domain, scope: state.scope });
      this.storeScopeState({
        ...state,
        permission: transitionScopedPermissionState(state.permission, {
          type: 'permission-epoch-reset',
        }),
      });
    });
    return reset;
  }

  private applyPermissionEvent(
    domain: RefreshDomain,
    scope: string,
    event: ScopedPermissionEvent
  ): void {
    const state = this.getScopeState(domain, scope);
    const permission = transitionScopedPermissionState(state.permission, event);
    if (permission !== state.permission) {
      this.storeScopeState({ ...state, permission });
    }
  }

  isAuthAvailable(): boolean {
    return this.authState.status === 'available';
  }

  markAuthFailed(): boolean {
    return this.applyAuthEvent({ type: 'auth-failed' });
  }

  markAuthRecovered(): boolean {
    return this.applyAuthEvent({ type: 'auth-recovered' });
  }

  private applyAuthEvent(event: ClusterAuthEvent): boolean {
    const next = transitionClusterAuthState(this.authState, event);
    if (next === this.authState) {
      return false;
    }
    this.authState = next;
    return true;
  }

  private getFetchState(domain: RefreshDomain, scope?: string): ScopedFetchState {
    return this.getScopeState(domain, scope).fetch;
  }

  private applyFetchEvent(
    domain: RefreshDomain,
    scope: string | undefined,
    event: ScopedFetchEvent
  ): ScopedFetchState {
    const state = this.getScopeState(domain, scope);
    const next = transitionScopedFetchState(state.fetch, event);
    if (next !== state.fetch) {
      this.storeScopeState({ ...state, fetch: next });
    }
    return next;
  }

  private trackedRequest(state: ScopedFetchState): TrackedInFlightRequest | undefined {
    if (state.status === 'idle') {
      return undefined;
    }
    return {
      ...state.request,
      trailingStreamSignal: state.trailingStreamSignal,
    };
  }

  getInFlight(domain: RefreshDomain, scope?: string): TrackedInFlightRequest | undefined {
    return this.trackedRequest(this.getFetchState(domain, scope));
  }

  setInFlight(request: InFlightRequest): string {
    const key = makeInFlightKey(request.domain, request.scope);
    this.applyFetchEvent(request.domain, request.scope, { type: 'fetch-started', request });
    return key;
  }

  latchTrailingStreamSignal(domain: RefreshDomain, scope?: string): void {
    this.applyFetchEvent(domain, scope, { type: 'stream-signal-received' });
  }

  settleInFlight(
    domain: RefreshDomain,
    scope: string | undefined,
    requestId: number
  ): TrackedInFlightRequest | undefined {
    const previous = this.getFetchState(domain, scope);
    const tracked = this.trackedRequest(previous);
    const next = this.applyFetchEvent(domain, scope, { type: 'fetch-settled', requestId });
    return next === previous ? undefined : tracked;
  }

  teardownInFlight(
    key: string,
    request: Pick<InFlightRequest, 'requestId'>
  ): TrackedInFlightRequest | undefined {
    const state = this.scopedStates.get(key);
    if (!state) {
      return undefined;
    }
    const previous = state.fetch;
    const tracked = this.trackedRequest(previous);
    const next = this.applyFetchEvent(state.domain, state.scope, {
      type: 'fetch-cancelled',
      requestId: request.requestId,
    });
    if (next === previous || !tracked) {
      return undefined;
    }
    tracked.controller.abort();
    tracked.cleanup?.();
    return tracked;
  }

  forEachInFlight(callback: (request: TrackedInFlightRequest, key: string) => void): void {
    Array.from(this.scopedStates.entries()).forEach(([key, state]) => {
      const request = this.trackedRequest(state.fetch);
      if (request) {
        callback(request, key);
      }
    });
  }

  isStreamingBlocked(domain: RefreshDomain, scope: string): boolean {
    return this.getScopeState(domain, scope).stream.policy === 'blocked';
  }

  blockStreaming(domain: RefreshDomain, scope: string): boolean {
    const state = this.getScopeState(domain, scope);
    if (state.stream.policy === 'blocked') {
      return false;
    }
    this.storeScopeState({
      ...state,
      stream: transitionScopedStreamState(state.stream, { type: 'stream-blocked' }),
    });
    return true;
  }

  clearBlockedStreaming(): void {
    this.forEachStreamState((state) => {
      this.applyStreamEvent(state.domain, state.scope, { type: 'stream-block-cleared' });
    });
  }

  isStreamingActive(domain: RefreshDomain, scope: string): boolean {
    return this.getScopeState(domain, scope).stream.connection.status === 'active';
  }

  hasPendingStreaming(domain: RefreshDomain, scope: string): boolean {
    return this.getScopeState(domain, scope).stream.connection.status === 'starting';
  }

  isStreamingStartingOrActive(domain: RefreshDomain, scope: string): boolean {
    return this.getScopeState(domain, scope).stream.connection.status !== 'inactive';
  }

  getStreamingScopes(): Array<{ domain: RefreshDomain; scope: string }> {
    return Array.from(this.scopedStates.values()).flatMap((state) =>
      state.stream.connection.status === 'inactive' || state.scope === undefined
        ? []
        : [{ domain: state.domain, scope: state.scope }]
    );
  }

  hasStreamingBookkeeping(domain: RefreshDomain, scope: string): boolean {
    const stream = this.getScopeState(domain, scope).stream;
    return stream.connection.status !== 'inactive' || stream.initialization.status === 'scheduled';
  }

  hasStreamingReady(domain: RefreshDomain, scope: string): boolean {
    return this.getScopeState(domain, scope).stream.initialization.status === 'scheduled';
  }

  setStreamingReady(domain: RefreshDomain, scope: string, task: Promise<void>): void {
    this.applyStreamEvent(domain, scope, { type: 'initialization-scheduled', task });
  }

  clearStreamingReady(domain: RefreshDomain, scope: string, task?: Promise<void>): void {
    this.applyStreamEvent(domain, scope, { type: 'initialization-cleared', task });
  }

  beginStreamingStart(domain: RefreshDomain, scope: string, startPromise: StreamStartTask): void {
    this.applyStreamEvent(domain, scope, { type: 'start-began', task: startPromise });
  }

  finishStreamingStart(
    domain: RefreshDomain,
    scope: string,
    startPromise: StreamStartTask
  ): boolean {
    const previous = this.getScopeState(domain, scope).stream;
    const next = this.applyStreamEvent(domain, scope, {
      type: 'start-finished',
      task: startPromise,
    });
    return next !== previous;
  }

  failStreamingStart(domain: RefreshDomain, scope: string, startPromise: StreamStartTask): void {
    this.applyStreamEvent(domain, scope, { type: 'start-failed', task: startPromise });
  }

  cancelStreamingStart(domain: RefreshDomain, scope: string): StreamStartTask | null {
    const state = this.getScopeState(domain, scope);
    const pending =
      state.stream.connection.status === 'starting' ? state.stream.connection.task : null;
    this.applyStreamEvent(domain, scope, { type: 'start-cancelled' });
    this.clearStreamingReady(domain, scope);
    return pending;
  }

  isStreamingCancelled(domain: RefreshDomain, scope: string): boolean {
    const connection = this.getScopeState(domain, scope).stream.connection;
    return connection.status !== 'inactive' && connection.cancellationRequested;
  }

  clearStreamingCancelled(domain: RefreshDomain, scope: string): void {
    this.applyStreamEvent(domain, scope, { type: 'start-cancellation-cleared' });
  }

  // The orchestrator stopped the scope's stream; a start still in flight is
  // cancelled separately (cancelStreamingStart).
  markStreamingStopped(domain: RefreshDomain, scope: string): void {
    this.applyStreamEvent(domain, scope, { type: 'stream-stopped' });
  }

  clearStreamHealth(domain: RefreshDomain, scope: string): void {
    this.applyStreamEvent(domain, scope, { type: 'health-cleared' });
  }

  setStreamHealth(
    domain: RefreshDomain,
    scope: string,
    payload: AppEvents['refresh:resource-stream-health']
  ): AppEvents['refresh:resource-stream-health'] | undefined {
    const previous = this.getScopeState(domain, scope).stream.health;
    this.applyStreamEvent(domain, scope, { type: 'health-received', payload });
    return previous.status === 'known' ? previous.payload : undefined;
  }

  getStreamHealth(
    domain: RefreshDomain,
    scope: string
  ): AppEvents['refresh:resource-stream-health'] | undefined {
    const health = this.getScopeState(domain, scope).stream.health;
    return health.status === 'known' ? health.payload : undefined;
  }

  clearAllStreamHealth(): void {
    this.forEachStreamState((state) => {
      this.applyStreamEvent(state.domain, state.scope, { type: 'health-cleared' });
    });
  }

  clearAsyncStreamingBookkeeping(): void {
    this.forEachStreamState((state) => {
      this.applyStreamEvent(state.domain, state.scope, { type: 'async-cleared' });
    });
  }

  clearAllStreaming(reset: boolean): void {
    this.forEachStreamState((state) => {
      this.applyStreamEvent(state.domain, state.scope, { type: 'all-cleared', reset });
    });
  }

  // Consecutive failed starts, which set the next retry's backoff.
  getStreamStartFailures(domain: RefreshDomain, scope: string): number {
    return this.getScopeState(domain, scope).stream.startRetry.failures;
  }

  setStreamStartRetry(
    domain: RefreshDomain,
    scope: string,
    timer: ReturnType<typeof setTimeout>
  ): void {
    this.applyStreamEvent(domain, scope, { type: 'start-retry-scheduled', timer });
  }

  // Forgets the scope's pending retry, keeping its failure count, and hands
  // back the timer to cancel.
  takeStreamStartRetry(
    domain: RefreshDomain,
    scope: string
  ): ReturnType<typeof setTimeout> | undefined {
    const retry = this.getScopeState(domain, scope).stream.startRetry;
    this.applyStreamEvent(domain, scope, { type: 'start-retry-taken' });
    return retry.status === 'scheduled' ? retry.timer : undefined;
  }

  // Clears the failure count and any pending retry, handing back its timer.
  resetStreamStartRetry(
    domain: RefreshDomain,
    scope: string
  ): ReturnType<typeof setTimeout> | undefined {
    const retry = this.getScopeState(domain, scope).stream.startRetry;
    this.applyStreamEvent(domain, scope, { type: 'start-retry-reset' });
    return retry.status === 'scheduled' ? retry.timer : undefined;
  }

  // Clears every scope's failure count and pending retry, handing back the timers.
  resetAllStreamStartRetries(): Array<ReturnType<typeof setTimeout>> {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    this.forEachStreamState((state) => {
      const timer = this.resetStreamStartRetry(state.domain, state.scope);
      if (timer !== undefined) {
        timers.push(timer);
      }
    });
    return timers;
  }

  private forEachStreamState(
    callback: (state: ScopedRefreshState & { scope: string }) => void
  ): void {
    Array.from(this.scopedStates.values()).forEach((state) => {
      if (state.scope !== undefined) {
        callback(state as ScopedRefreshState & { scope: string });
      }
    });
  }

  private applyStreamEvent(
    domain: RefreshDomain,
    scope: string,
    event: ScopedStreamEvent
  ): ScopedStreamState {
    const state = this.getScopeState(domain, scope);
    const stream = transitionScopedStreamState(state.stream, event);
    if (stream !== state.stream) {
      this.storeScopeState({ ...state, stream });
    }
    return stream;
  }

  resolveStreamingFetchMode(input: StreamingFetchDecisionInput): StreamingFetchDecision {
    if (input.isManual || !input.shouldStream) {
      return { mode: 'snapshot', fallback: false };
    }

    // A scope with no applied data yet must load its first page even when the stream
    // is healthy — the notify-only stream signals changes, it does not deliver a new
    // query's initial snapshot. Without this, a filter/scope change never fetches.
    if (!input.hasData) {
      return { mode: 'snapshot', fallback: false };
    }

    // A doorbell-triggered fetch IS the stream refresh: skipping it for a
    // "healthy stream" swallows the very signal the stream sent.
    if (input.streamSignal) {
      return { mode: 'snapshot', fallback: false };
    }

    // While the stream is healthy, streaming IS the refresh: change signals
    // (object clock) and doorbells (metric/event/catalog clocks) drive refetch;
    // the poll runs only as the stream-down fallback.
    return input.streamingHealthy
      ? { mode: 'skip', fallback: false }
      : { mode: 'snapshot', fallback: true };
  }

  resetTransientState(): void {
    this.forEachStreamState((state) => {
      this.applyStreamEvent(state.domain, state.scope, { type: 'transient-reset' });
    });
  }

  resetAllState(): void {
    this.scopedStates.clear();
    this.authState = { status: 'available' };
  }
}
