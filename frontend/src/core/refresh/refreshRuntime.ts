import type { AppEvents } from '@/core/events';
import type { RefreshDomain } from './types';

export type InFlightRequest = {
  controller: AbortController;
  isManual: boolean;
  // Preserve the originating request intent if foreground activation aborts
  // this fetch and replays it after the cluster becomes serviceable.
  streamSignal?: boolean;
  requestId: number;
  cleanup?: () => void;
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

export type ScopedActivationState =
  | { status: 'untracked' }
  | { status: 'disabled' }
  | { status: 'enabled'; demands: ScopedDemandCounts }
  | { status: 'superseded'; demands: ScopedDemandCounts };

export type ScopedActivationEvent =
  | { type: 'enabled' }
  | { type: 'disabled' }
  | { type: 'superseded' }
  | { type: 'lease-acquired'; demand: RefreshDemand }
  | { type: 'lease-released'; demand: RefreshDemand };

const NO_SCOPED_DEMAND: ScopedDemandCounts = { query: 0, snapshot: 0 };

const totalDemand = (demands: ScopedDemandCounts): number => demands.query + demands.snapshot;

const demandsFor = (state: ScopedActivationState): ScopedDemandCounts =>
  state.status === 'enabled' || state.status === 'superseded' ? state.demands : NO_SCOPED_DEMAND;

const enableScope = (state: ScopedActivationState): ScopedActivationState =>
  state.status === 'enabled' ? state : { status: 'enabled', demands: { ...demandsFor(state) } };

const disableScope = (state: ScopedActivationState): ScopedActivationState => {
  if (state.status === 'disabled') {
    return state;
  }
  if (state.status === 'enabled' && totalDemand(state.demands) > 0) {
    return state;
  }
  return { status: 'disabled' };
};

const supersedeScope = (state: ScopedActivationState): ScopedActivationState => {
  if (state.status !== 'enabled') {
    return state;
  }
  return totalDemand(state.demands) > 0
    ? { status: 'superseded', demands: state.demands }
    : { status: 'disabled' };
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
  return state.status === 'superseded'
    ? { status: 'superseded', demands: nextDemands }
    : { status: 'enabled', demands: nextDemands };
};

const releaseScopeLease = (
  state: ScopedActivationState,
  event: Extract<ScopedActivationEvent, { type: 'lease-released' }>
): ScopedActivationState => {
  if (
    (state.status !== 'enabled' && state.status !== 'superseded') ||
    state.demands[event.demand] === 0
  ) {
    return state;
  }
  const nextDemands = {
    ...state.demands,
    [event.demand]: state.demands[event.demand] - 1,
  };
  if (state.status === 'superseded' && totalDemand(nextDemands) === 0) {
    return { status: 'disabled' };
  }
  return { ...state, demands: nextDemands };
};

export const transitionScopedActivationState = (
  state: ScopedActivationState,
  event: ScopedActivationEvent
): ScopedActivationState => {
  switch (event.type) {
    case 'enabled':
      return enableScope(state);
    case 'disabled':
      return disableScope(state);
    case 'superseded':
      return supersedeScope(state);
    case 'lease-acquired':
      return acquireScopeLease(state, event);
    case 'lease-released':
      return releaseScopeLease(state, event);
  }
};

export type PendingClusterReadinessRequest = {
  domain: RefreshDomain;
  scope: string;
  isManual: boolean;
  streamSignal: boolean;
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
          isManual: state.request.isManual || event.request.isManual,
          streamSignal: state.request.streamSignal || event.request.streamSignal,
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

export const transitionScopedPermissionState = (
  state: ScopedPermissionState,
  event: ScopedPermissionEvent
): ScopedPermissionState => {
  const status =
    event.type === 'permission-allowed'
      ? 'allowed'
      : event.type === 'permission-denied'
        ? 'denied'
        : 'unknown';
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

type StreamStartTask = Promise<(() => void) | undefined>;
type StreamInitializationState = { status: 'idle' } | { status: 'scheduled'; task: Promise<void> };
type StreamConnectionState =
  | { status: 'inactive' }
  | { status: 'starting'; task: StreamStartTask; cancellationRequested: boolean }
  | { status: 'active'; cleanup: () => void; cancellationRequested: boolean };
type StreamHealthState =
  | { status: 'unknown' }
  | { status: 'known'; payload: AppEvents['refresh:resource-stream-health'] };

export type ScopedStreamState = {
  policy: 'allowed' | 'blocked';
  initialization: StreamInitializationState;
  connection: StreamConnectionState;
  health: StreamHealthState;
};

export type ScopedStreamEvent =
  | { type: 'stream-blocked' }
  | { type: 'stream-block-cleared' }
  | { type: 'initialization-scheduled'; task: Promise<void> }
  | { type: 'initialization-cleared'; task?: Promise<void> }
  | { type: 'start-began'; task: StreamStartTask }
  | { type: 'start-cancelled' }
  | { type: 'start-cancellation-cleared' }
  | { type: 'start-finished'; task: StreamStartTask; cleanup: () => void }
  | { type: 'start-failed'; task: StreamStartTask }
  | { type: 'cleanup-removed' }
  | { type: 'health-received'; payload: AppEvents['refresh:resource-stream-health'] }
  | { type: 'health-cleared' }
  | { type: 'async-cleared' }
  | { type: 'all-cleared'; reset: boolean }
  | { type: 'transient-reset' };

const inactiveStreamState = (): ScopedStreamState => ({
  policy: 'allowed',
  initialization: { status: 'idle' },
  connection: { status: 'inactive' },
  health: { status: 'unknown' },
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
    connection: {
      status: 'active',
      cleanup: event.cleanup,
      cancellationRequested: false,
    },
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

const removeStreamCleanup = (state: ScopedStreamState): ScopedStreamState =>
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

const clearAsyncStreamState = (state: ScopedStreamState): ScopedStreamState => ({
  ...state,
  initialization: { status: 'idle' },
  connection:
    state.connection.status === 'starting'
      ? { status: 'inactive' }
      : state.connection.status === 'active'
        ? { ...state.connection, cancellationRequested: false }
        : state.connection,
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
});

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
    case 'cleanup-removed':
      return removeStreamCleanup(state);
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
  }
};

type ScopedRefreshState = {
  domain: RefreshDomain;
  scope?: string;
  activation: ScopedActivationState;
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

export type RuntimeScopeEnableResult = RuntimeScopeStateChange & {
  staleScopes: string[];
};

// Most domains should only keep one enabled scope per cluster runtime. Domains
// listed here have real concurrent consumers, such as browse data plus
// metadata, object-diff panes, or namespace table plus object-panel pod lists.
const MULTI_ACTIVE_SCOPE_DOMAINS = new Set<RefreshDomain>([
  'catalog',
  'catalog-diff',
  'cluster-attention',
  'cluster-config',
  'cluster-crds',
  'cluster-events',
  'cluster-rbac',
  'cluster-storage',
  'container-logs',
  'namespace-autoscaling',
  'namespace-config',
  'namespace-events',
  'namespace-helm',
  'namespace-network',
  'namespace-quotas',
  'namespace-rbac',
  'namespace-storage',
  'namespace-workloads',
  'nodes',
  'object-details',
  'object-events',
  'object-helm-manifest',
  'object-helm-values',
  'object-maintenance',
  'object-map',
  'object-yaml',
  'pods',
]);

export class ClusterRefreshRuntime {
  readonly clusterId: string;
  private readonly scopedStates = new Map<string, ScopedRefreshState>();
  private readonly knownDomains = new Set<RefreshDomain>();
  private authState: ClusterAuthState = { status: 'available' };
  constructor(clusterId: string) {
    this.clusterId = clusterId;
  }

  private getScopeState(domain: RefreshDomain, scope?: string): ScopedRefreshState {
    return (
      this.scopedStates.get(makeInFlightKey(domain, scope)) ?? {
        domain,
        scope,
        activation: { status: 'untracked' },
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
      state.activation.status === 'untracked' &&
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

  markDomainKnown(domain: RefreshDomain): void {
    this.knownDomains.add(domain);
  }

  deleteDomain(domain: RefreshDomain): void {
    this.knownDomains.delete(domain);
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

  setScopedDomainEnabled(
    domain: RefreshDomain,
    scope: string,
    enabled: boolean
  ): RuntimeScopeStateChange {
    this.knownDomains.add(domain);
    const { previous, next } = this.applyActivationEvent(domain, scope, {
      type: enabled ? 'enabled' : 'disabled',
    });
    const previousEnabled =
      previous.status === 'untracked' ? undefined : previous.status === 'enabled';
    const nextEnabled = next.status === 'enabled';
    return { previous: previousEnabled, changed: previousEnabled !== nextEnabled };
  }

  applyScopedDomainEnabled(
    domain: RefreshDomain,
    scope: string,
    enabled: boolean
  ): RuntimeScopeEnableResult {
    const staleScopes =
      enabled && !MULTI_ACTIVE_SCOPE_DOMAINS.has(domain)
        ? this.disableOtherEnabledScopes(domain, scope)
        : [];
    const change = this.setScopedDomainEnabled(domain, scope, enabled);
    return { ...change, staleScopes };
  }

  private disableOtherEnabledScopes(domain: RefreshDomain, activeScope: string): string[] {
    const staleScopes: string[] = [];
    this.scopedStates.forEach((state) => {
      if (
        state.domain === domain &&
        state.scope !== undefined &&
        state.scope !== activeScope &&
        state.activation.status === 'enabled'
      ) {
        staleScopes.push(state.scope);
      }
    });
    staleScopes.forEach((scope) => {
      this.applyActivationEvent(domain, scope, { type: 'superseded' });
    });
    return staleScopes;
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
    this.knownDomains.add(domain);
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
  ): { count: number; lastLease: boolean; hadLease: boolean } {
    const before = this.getScopeState(domain, scope).activation;
    const counts = demandsFor(before);
    if (counts[demand] <= 0) {
      return { count: 0, lastLease: false, hadLease: false };
    }
    const previousTotal = totalDemand(counts);
    const { next } = this.applyActivationEvent(domain, scope, {
      type: 'lease-released',
      demand,
    });
    const nextTotal = totalDemand(demandsFor(next));
    if (nextTotal === 0) {
      return { count: 0, lastLease: previousTotal === 1, hadLease: true };
    }
    return { count: nextTotal, lastLease: false, hadLease: true };
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

  getStreamingLifecycleKeys(): string[] {
    return Array.from(this.scopedStates.entries()).flatMap(([key, state]) =>
      state.stream.connection.status === 'inactive' ? [] : [key]
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

  beginStreamingStart(
    domain: RefreshDomain,
    scope: string,
    startPromise: Promise<(() => void) | undefined>
  ): void {
    this.applyStreamEvent(domain, scope, { type: 'start-began', task: startPromise });
  }

  finishStreamingStart(
    domain: RefreshDomain,
    scope: string,
    startPromise: StreamStartTask,
    cleanup: (() => void) | undefined
  ): boolean {
    const previous = this.getScopeState(domain, scope).stream;
    const next = this.applyStreamEvent(domain, scope, {
      type: 'start-finished',
      task: startPromise,
      cleanup: cleanup ?? (() => undefined),
    });
    return next !== previous;
  }

  failStreamingStart(domain: RefreshDomain, scope: string, startPromise: StreamStartTask): void {
    this.applyStreamEvent(domain, scope, { type: 'start-failed', task: startPromise });
  }

  cancelStreamingStart(
    domain: RefreshDomain,
    scope: string
  ): Promise<(() => void) | undefined> | null {
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

  getStreamingCleanup(domain: RefreshDomain, scope: string): (() => void) | undefined {
    const connection = this.getScopeState(domain, scope).stream.connection;
    return connection.status === 'active' ? connection.cleanup : undefined;
  }

  deleteStreamingCleanup(domain: RefreshDomain, scope: string): void {
    this.applyStreamEvent(domain, scope, { type: 'cleanup-removed' });
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
    this.knownDomains.clear();
    this.authState = { status: 'available' };
  }
}
