import { stripClusterScope } from '../clusterScope';
import { isPermissionDeniedStatus, resolvePermissionDeniedMessage } from '../permissionErrors';
import {
  RESOURCE_STREAM_MESSAGE_TYPES,
  RESOURCE_STREAM_SIGNALS,
  type ResourceStreamMessageType,
  type ResourceStreamServerMessage,
  type ResourceStreamSignal,
} from '../types';
import {
  domainSupportsSourceClock,
  isClusterScopedDomain,
  isResourceStreamSourceClock,
  isSupportedDomain,
  type ResourceStreamSourceClock,
} from './resourceStreamDomains';
import type {
  ResourceStreamConnectionStatus,
  ResourceStreamHealthStatus,
} from './resourceStreamHealth';

type WireMessage = Partial<ResourceStreamServerMessage>;

export type CanonicalResourceStreamMessage =
  | { kind: 'acknowledged' }
  | { kind: 'heartbeat' }
  | {
      kind: 'changed';
      source?: ResourceStreamSourceClock;
      version?: string;
      sequence?: bigint;
      resourceVersion?: bigint;
    }
  | {
      kind: 'reset';
      reason: 'reset' | 'complete';
      source?: ResourceStreamSourceClock;
      version?: string;
    }
  | { kind: 'error'; reason: string; permissionDenied: boolean };

export type NormalizedResourceStreamProtocolMessage = {
  clusterId?: string;
  clusterName?: string;
  domain: import('./resourceStreamDomains').DoorbellDomain;
  scope: string;
  routing: 'strict' | 'compatible';
  message: CanonicalResourceStreamMessage;
};

const hasMessageType = (value: unknown): value is ResourceStreamMessageType =>
  typeof value === 'string' &&
  RESOURCE_STREAM_MESSAGE_TYPES.includes(value as ResourceStreamMessageType);

const hasSignalType = (value: unknown): value is ResourceStreamSignal =>
  typeof value === 'string' && RESOURCE_STREAM_SIGNALS.includes(value as ResourceStreamSignal);

const normalizeScope = (
  domain: NormalizedResourceStreamProtocolMessage['domain'],
  scope: unknown
): string | null => {
  if (typeof scope === 'string') {
    const normalized = stripClusterScope(scope.trim());
    return normalized || isClusterScopedDomain(domain) ? normalized : null;
  }
  return (scope === null || scope === undefined) && isClusterScopedDomain(domain) ? '' : null;
};

const parsePositiveInteger = (value?: string | number): bigint | undefined => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  try {
    const parsed = BigInt(value.trim());
    return parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const canonicalSource = (
  domain: NormalizedResourceStreamProtocolMessage['domain'],
  source: unknown
): ResourceStreamSourceClock | undefined =>
  isResourceStreamSourceClock(source) && domainSupportsSourceClock(domain, source)
    ? source
    : undefined;

const legacySignal = (type: WireMessage['type']): ResourceStreamSignal | undefined => {
  switch (type) {
    case 'ADDED':
    case 'MODIFIED':
    case 'DELETED':
      return 'changed';
    case 'RESET':
    case 'COMPLETE':
      return 'reset';
    case 'ERROR':
      return 'error';
    default:
      return undefined;
  }
};

const canonicalMessage = (
  wire: WireMessage,
  domain: NormalizedResourceStreamProtocolMessage['domain'],
  modernSignal: ResourceStreamSignal | undefined
): CanonicalResourceStreamMessage | null => {
  const source = canonicalSource(domain, wire.source);
  const version = wire.version?.trim() || undefined;
  const sequence = parsePositiveInteger(wire.sequence);
  const resourceVersion = parsePositiveInteger(wire.resourceVersion);
  const errorReason =
    resolvePermissionDeniedMessage(wire.error, wire.errorDetails) || 'stream error';

  const signal = modernSignal ?? legacySignal(wire.type);
  if (signal === 'changed') {
    return { kind: 'changed', source, version, sequence, resourceVersion };
  }
  if (signal === 'reset') {
    return {
      kind: 'reset',
      reason: wire.type === 'COMPLETE' ? 'complete' : 'reset',
      source,
      version,
    };
  }
  if (signal === 'error') {
    return {
      kind: 'error',
      reason: errorReason,
      permissionDenied: isPermissionDeniedStatus(wire.errorDetails),
    };
  }

  switch (wire.type) {
    case 'ACK':
      return { kind: 'acknowledged' };
    case 'HEARTBEAT':
      return { kind: 'heartbeat' };
    default:
      return null;
  }
};

export const normalizeResourceStreamProtocolMessage = (
  wire: WireMessage
): NormalizedResourceStreamProtocolMessage | null => {
  if (!isSupportedDomain(wire.domain)) {
    return null;
  }
  const domain = wire.domain;
  const scope = normalizeScope(domain, wire.scope);
  if (scope === null) {
    return null;
  }
  if (isResourceStreamSourceClock(wire.source) && !domainSupportsSourceClock(domain, wire.source)) {
    return null;
  }

  const clusterId = wire.clusterId?.trim() || undefined;
  const version = wire.version?.trim();
  const modernSignal =
    clusterId && version && canonicalSource(domain, wire.source) && hasSignalType(wire.signal)
      ? wire.signal
      : undefined;
  if (!modernSignal && !hasMessageType(wire.type)) {
    return null;
  }
  const message = canonicalMessage(wire, domain, modernSignal);
  if (!message) {
    return null;
  }
  return {
    clusterId,
    clusterName: wire.clusterName?.trim() || undefined,
    domain,
    scope,
    routing: modernSignal ? 'strict' : 'compatible',
    message,
  };
};

type ConfirmedStreamHealth = {
  epoch: number;
  delivered: boolean;
};

type AwaitingAckPhase = {
  status: 'awaiting-ack';
  expectsReset: boolean;
  errorReason?: string;
  preservedHealth?: ConfirmedStreamHealth;
};

export type ResourceStreamProtocolPhase =
  | { status: 'connecting'; errorReason?: string }
  | AwaitingAckPhase
  | { status: 'synchronized'; epoch: number; delivered: boolean; expectsReset: boolean }
  | {
      status: 'resyncing';
      reason: string;
      errorReason?: string;
      preservedHealth?: ConfirmedStreamHealth;
    }
  | { status: 'permission-blocked'; reason: string; at: number }
  | { status: 'stopping' };

type PendingChanges = {
  count: number;
  sourceVersions: Partial<Record<ResourceStreamSourceClock, string>>;
  latest?: string;
};

export type ResourceStreamCoalescingState =
  | { status: 'idle' }
  | ({ status: 'waiting-for-timer' } & PendingChanges)
  | ({ status: 'scheduled'; timer: number } & PendingChanges);

export type ResourceStreamProtocolState = {
  phase: ResourceStreamProtocolPhase;
  resume: { lastSequence?: bigint; resourceVersion?: bigint };
  activity: { lastMessageAt?: number; lastDeliveryAt?: number };
  coalescing: ResourceStreamCoalescingState;
  lastResyncAt: number;
};

export type ResourceStreamProtocolEffect =
  | { type: 'schedule-flush' }
  | { type: 'cancel-flush'; timer: number }
  | {
      type: 'advance-source';
      sourceVersions: Partial<Record<ResourceStreamSourceClock, string>>;
      latest?: string;
    }
  | { type: 'advance-legacy-reset' }
  | { type: 'request-resync'; reason: string; force: boolean; errorReason?: string }
  | { type: 'permission-denied'; reason: string }
  | { type: 'mark-resyncing'; reason: string }
  | { type: 'mark-resync-complete' }
  | { type: 'send-subscribe' };

export type ResourceStreamProtocolEvent =
  | { type: 'subscribe-sent'; expectsReset: boolean }
  | { type: 'connection-opened'; epoch: number }
  | { type: 'connection-lost'; reason: string }
  | {
      type: 'message-received';
      message: CanonicalResourceStreamMessage;
      now: number;
      connectionEpoch: number;
      hasRetainedData: boolean;
      completeResync: boolean;
      maxPendingChanges: number;
    }
  | { type: 'flush-timer-attached'; timer: number }
  | { type: 'flush-fired'; timer: number }
  | {
      type: 'resync-requested';
      reason: string;
      now: number;
      force: boolean;
      cooldownMs: number;
      errorReason?: string;
    }
  | { type: 'resync-completed' }
  | { type: 'stopping' };

export type ResourceStreamProtocolTransition = {
  state: ResourceStreamProtocolState;
  effects: ResourceStreamProtocolEffect[];
};

export const initialResourceStreamProtocolState = (): ResourceStreamProtocolState => ({
  phase: { status: 'connecting' },
  resume: {},
  activity: {},
  coalescing: { status: 'idle' },
  lastResyncAt: 0,
});

const transition = (
  state: ResourceStreamProtocolState,
  effects: ResourceStreamProtocolEffect[] = []
): ResourceStreamProtocolTransition => ({ state, effects });

const phaseError = (phase: ResourceStreamProtocolPhase): string | undefined =>
  'errorReason' in phase ? phase.errorReason : undefined;

const confirmedHealth = (phase: ResourceStreamProtocolPhase): ConfirmedStreamHealth | undefined => {
  if (phase.status === 'synchronized') {
    return { epoch: phase.epoch, delivered: phase.delivered };
  }
  if (phase.status === 'resyncing' || phase.status === 'awaiting-ack') {
    return phase.preservedHealth;
  }
  return undefined;
};

const preservesConfirmedHealth = (reason: string): boolean =>
  reason === 'initial' || reason === 'manual refresh';

const expectsReset = (phase: ResourceStreamProtocolPhase): boolean =>
  (phase.status === 'awaiting-ack' || phase.status === 'synchronized') && phase.expectsReset;

const synchronizedPhase = (
  phase: ResourceStreamProtocolPhase,
  epoch: number,
  delivered: boolean
): ResourceStreamProtocolPhase => ({
  status: 'synchronized',
  epoch,
  delivered,
  expectsReset: expectsReset(phase),
});

const sourceEffect = (
  source: ResourceStreamSourceClock | undefined,
  version: string | undefined
): ResourceStreamProtocolEffect | null =>
  source && version
    ? { type: 'advance-source', sourceVersions: { [source]: version }, latest: version }
    : null;

const pendingChanges = (coalescing: ResourceStreamCoalescingState): PendingChanges =>
  coalescing.status === 'idle'
    ? { count: 0, sourceVersions: {} }
    : {
        count: coalescing.count,
        sourceVersions: coalescing.sourceVersions,
        ...(coalescing.latest ? { latest: coalescing.latest } : {}),
      };

const appendChange = (
  coalescing: ResourceStreamCoalescingState,
  message: Extract<CanonicalResourceStreamMessage, { kind: 'changed' }>
): PendingChanges => {
  const pending = pendingChanges(coalescing);
  const sourceVersions = { ...pending.sourceVersions };
  if (message.source && message.version) {
    sourceVersions[message.source] = message.version;
  }
  return {
    count: pending.count + 1,
    sourceVersions,
    ...(message.version
      ? { latest: message.version }
      : pending.latest
        ? { latest: pending.latest }
        : {}),
  };
};

const cancelFlushEffect = (
  coalescing: ResourceStreamCoalescingState
): ResourceStreamProtocolEffect[] =>
  coalescing.status === 'scheduled' ? [{ type: 'cancel-flush', timer: coalescing.timer }] : [];

const advancePendingEffect = (
  coalescing: ResourceStreamCoalescingState,
  includeEmpty = false
): ResourceStreamProtocolEffect[] => {
  if (!includeEmpty && (coalescing.status === 'idle' || coalescing.count === 0)) {
    return [];
  }
  const pending = pendingChanges(coalescing);
  return [
    {
      type: 'advance-source',
      sourceVersions: pending.sourceVersions,
      ...(pending.latest ? { latest: pending.latest } : {}),
    },
  ];
};

const receiveChanged = (
  state: ResourceStreamProtocolState,
  event: Extract<ResourceStreamProtocolEvent, { type: 'message-received' }>,
  message: Extract<CanonicalResourceStreamMessage, { kind: 'changed' }>
): ResourceStreamProtocolTransition => {
  if (
    state.phase.status === 'resyncing' ||
    state.phase.status === 'permission-blocked' ||
    state.phase.status === 'stopping'
  ) {
    return transition({
      ...state,
      activity: { ...state.activity, lastMessageAt: event.now },
    });
  }
  if (
    message.sequence !== undefined &&
    state.resume.lastSequence !== undefined &&
    message.sequence <= state.resume.lastSequence
  ) {
    return transition({
      ...state,
      activity: { ...state.activity, lastMessageAt: event.now },
    });
  }

  const resume = { ...state.resume };
  if (message.sequence !== undefined) {
    resume.lastSequence = message.sequence;
  }
  if (
    message.resourceVersion !== undefined &&
    (resume.resourceVersion === undefined || message.resourceVersion > resume.resourceVersion)
  ) {
    resume.resourceVersion = message.resourceVersion;
  }
  const nextBase: ResourceStreamProtocolState = {
    ...state,
    phase: synchronizedPhase(state.phase, event.connectionEpoch, true),
    resume,
    activity: { lastMessageAt: event.now, lastDeliveryAt: event.now },
  };

  if (event.completeResync) {
    return transition(nextBase, [
      { type: 'request-resync', reason: 'complete-only update', force: false },
    ]);
  }

  const pending = appendChange(state.coalescing, message);
  if (pending.count > event.maxPendingChanges) {
    return transition({ ...nextBase, coalescing: { status: 'idle' } }, [
      ...cancelFlushEffect(state.coalescing),
      { type: 'request-resync', reason: 'update backlog overflow', force: true },
    ]);
  }
  if (state.coalescing.status === 'idle') {
    return transition({ ...nextBase, coalescing: { status: 'waiting-for-timer', ...pending } }, [
      { type: 'schedule-flush' },
    ]);
  }
  return transition({ ...nextBase, coalescing: { ...state.coalescing, ...pending } });
};

const receiveReset = (
  state: ResourceStreamProtocolState,
  event: Extract<ResourceStreamProtocolEvent, { type: 'message-received' }>,
  message: Extract<CanonicalResourceStreamMessage, { kind: 'reset' }>
): ResourceStreamProtocolTransition => {
  const effects: ResourceStreamProtocolEffect[] = [];
  const advance = sourceEffect(message.source, message.version);
  if (advance) {
    effects.push(advance);
  } else {
    effects.push({ type: 'advance-legacy-reset' });
  }
  const initialReset = message.reason === 'reset' && expectsReset(state.phase);
  const phase: ResourceStreamProtocolPhase = initialReset
    ? {
        status: 'synchronized',
        epoch: event.connectionEpoch,
        delivered: confirmedHealth(state.phase)?.delivered ?? false,
        expectsReset: false,
      }
    : state.phase;
  const next = {
    ...state,
    phase,
    activity: { ...state.activity, lastMessageAt: event.now },
  };
  if (initialReset) {
    return transition(next, event.hasRetainedData ? effects : []);
  }
  effects.push({ type: 'request-resync', reason: message.reason, force: false });
  return transition(next, effects);
};

const receiveMessage = (
  state: ResourceStreamProtocolState,
  event: Extract<ResourceStreamProtocolEvent, { type: 'message-received' }>
): ResourceStreamProtocolTransition => {
  if (state.phase.status === 'stopping') {
    return transition(state);
  }
  if (state.phase.status === 'permission-blocked') {
    return transition({
      ...state,
      activity: { ...state.activity, lastMessageAt: event.now },
    });
  }
  const { message } = event;
  if (message.kind === 'changed') {
    return receiveChanged(state, event, message);
  }
  if (message.kind === 'reset') {
    return receiveReset(state, event, message);
  }
  const withActivity = {
    ...state,
    activity: { ...state.activity, lastMessageAt: event.now },
  };
  if (message.kind === 'heartbeat') {
    return transition(withActivity);
  }
  if (message.kind === 'acknowledged') {
    return transition({
      ...withActivity,
      phase: {
        status: 'synchronized',
        epoch: event.connectionEpoch,
        delivered: confirmedHealth(state.phase)?.delivered ?? false,
        expectsReset: expectsReset(state.phase),
      },
    });
  }
  if (message.permissionDenied) {
    return transition(
      {
        ...withActivity,
        phase: { status: 'permission-blocked', reason: message.reason, at: event.now },
      },
      [{ type: 'permission-denied', reason: message.reason }]
    );
  }
  return transition(withActivity, [
    { type: 'request-resync', reason: message.reason, force: true, errorReason: message.reason },
  ]);
};

const subscribeSent = (
  state: ResourceStreamProtocolState,
  event: Extract<ResourceStreamProtocolEvent, { type: 'subscribe-sent' }>
): ResourceStreamProtocolTransition => {
  if (state.phase.status === 'permission-blocked' || state.phase.status === 'stopping') {
    return transition(state);
  }
  const preservedHealth = confirmedHealth(state.phase);
  return transition({
    ...state,
    phase: {
      status: 'awaiting-ack',
      expectsReset: event.expectsReset,
      ...(phaseError(state.phase) ? { errorReason: phaseError(state.phase) } : {}),
      ...(preservedHealth ? { preservedHealth } : {}),
    },
  });
};

const connectionOpened = (state: ResourceStreamProtocolState): ResourceStreamProtocolTransition => {
  if (state.phase.status === 'permission-blocked' || state.phase.status === 'stopping') {
    return transition(state);
  }
  if (state.resume.lastSequence !== undefined) {
    return transition(
      {
        ...state,
        phase: {
          status: 'awaiting-ack',
          expectsReset: false,
          ...(phaseError(state.phase) ? { errorReason: phaseError(state.phase) } : {}),
        },
      },
      [{ type: 'mark-resync-complete' }, { type: 'send-subscribe' }]
    );
  }
  return transition(state, [
    {
      type: 'request-resync',
      reason: 'reconnect',
      force: true,
      ...(phaseError(state.phase) ? { errorReason: phaseError(state.phase) } : {}),
    },
  ]);
};

const connectionLost = (
  state: ResourceStreamProtocolState,
  event: Extract<ResourceStreamProtocolEvent, { type: 'connection-lost' }>
): ResourceStreamProtocolTransition => {
  if (state.phase.status === 'permission-blocked' || state.phase.status === 'stopping') {
    return transition(state);
  }
  return transition(
    {
      ...state,
      phase: {
        status: 'connecting',
        ...(phaseError(state.phase) ? { errorReason: phaseError(state.phase) } : {}),
      },
    },
    [
      { type: 'mark-resyncing', reason: event.reason },
      ...(state.resume.lastSequence === undefined
        ? ([{ type: 'request-resync', reason: event.reason, force: false }] as const)
        : []),
    ]
  );
};

const attachFlushTimer = (
  state: ResourceStreamProtocolState,
  event: Extract<ResourceStreamProtocolEvent, { type: 'flush-timer-attached' }>
): ResourceStreamProtocolTransition =>
  state.coalescing.status !== 'waiting-for-timer'
    ? transition(state)
    : transition({
        ...state,
        coalescing: { ...state.coalescing, status: 'scheduled', timer: event.timer },
      });

const flushPendingChanges = (
  state: ResourceStreamProtocolState,
  event: Extract<ResourceStreamProtocolEvent, { type: 'flush-fired' }>
): ResourceStreamProtocolTransition => {
  if (state.coalescing.status !== 'scheduled' || state.coalescing.timer !== event.timer) {
    return transition(state);
  }
  return transition(
    { ...state, coalescing: { status: 'idle' } },
    advancePendingEffect(state.coalescing)
  );
};

const requestResync = (
  state: ResourceStreamProtocolState,
  event: Extract<ResourceStreamProtocolEvent, { type: 'resync-requested' }>
): ResourceStreamProtocolTransition => {
  if (
    state.phase.status === 'resyncing' ||
    state.phase.status === 'permission-blocked' ||
    state.phase.status === 'stopping' ||
    (!event.force && state.lastResyncAt > 0 && event.now - state.lastResyncAt < event.cooldownMs)
  ) {
    return transition(state);
  }
  const preservedHealth = preservesConfirmedHealth(event.reason)
    ? confirmedHealth(state.phase)
    : undefined;
  return transition(
    {
      ...state,
      phase: {
        status: 'resyncing',
        reason: event.reason,
        ...(event.errorReason ? { errorReason: event.errorReason } : {}),
        ...(preservedHealth ? { preservedHealth } : {}),
      },
      resume: { ...state.resume, lastSequence: undefined },
      coalescing: { status: 'idle' },
      lastResyncAt: event.now,
    },
    [
      ...cancelFlushEffect(state.coalescing),
      ...advancePendingEffect(state.coalescing, true),
      ...(event.reason === 'initial'
        ? []
        : ([{ type: 'mark-resyncing', reason: event.reason }] as const)),
    ]
  );
};

const completeResync = (state: ResourceStreamProtocolState): ResourceStreamProtocolTransition => {
  if (state.phase.status !== 'resyncing') {
    return transition(state);
  }
  return transition(
    {
      ...state,
      phase: {
        status: 'awaiting-ack',
        expectsReset: true,
        ...(state.phase.errorReason ? { errorReason: state.phase.errorReason } : {}),
        ...(state.phase.preservedHealth ? { preservedHealth: state.phase.preservedHealth } : {}),
      },
    },
    [{ type: 'mark-resync-complete' }, { type: 'send-subscribe' }]
  );
};

const stopProtocol = (state: ResourceStreamProtocolState): ResourceStreamProtocolTransition =>
  transition(
    { ...state, phase: { status: 'stopping' }, coalescing: { status: 'idle' } },
    cancelFlushEffect(state.coalescing)
  );

export const transitionResourceStreamProtocol = (
  state: ResourceStreamProtocolState,
  event: ResourceStreamProtocolEvent
): ResourceStreamProtocolTransition => {
  switch (event.type) {
    case 'subscribe-sent':
      return subscribeSent(state, event);
    case 'connection-opened':
      return connectionOpened(state);
    case 'connection-lost':
      return connectionLost(state, event);
    case 'message-received':
      return receiveMessage(state, event);
    case 'flush-timer-attached':
      return attachFlushTimer(state, event);
    case 'flush-fired':
      return flushPendingChanges(state, event);
    case 'resync-requested':
      return requestResync(state, event);
    case 'resync-completed':
      return completeResync(state);
    case 'stopping':
      return stopProtocol(state);
  }
};

const pendingProtocolHealth = (
  phase: { errorReason?: string; preservedHealth?: ConfirmedStreamHealth },
  waitingReason: string
): { status: ResourceStreamHealthStatus; reason: string } => {
  if (phase.preservedHealth) {
    return {
      status: 'healthy',
      reason: phase.preservedHealth.delivered ? 'delivering' : 'synchronized',
    };
  }
  return phase.errorReason
    ? { status: 'unhealthy', reason: phase.errorReason }
    : { status: 'degraded', reason: waitingReason };
};

export const computeResourceStreamProtocolHealth = (
  state: ResourceStreamProtocolState,
  connectionStatus: ResourceStreamConnectionStatus,
  connectionError: string
): { status: ResourceStreamHealthStatus; reason: string } => {
  if (connectionStatus !== 'connected') {
    return { status: 'unhealthy', reason: connectionError || 'stream disconnected' };
  }
  switch (state.phase.status) {
    case 'permission-blocked':
      return { status: 'unhealthy', reason: state.phase.reason };
    case 'resyncing':
      return pendingProtocolHealth(state.phase, 'resyncing');
    case 'awaiting-ack':
    case 'connecting':
      return pendingProtocolHealth(state.phase, 'awaiting updates');
    case 'synchronized':
      return {
        status: 'healthy',
        reason: state.phase.delivered ? 'delivering' : 'synchronized',
      };
    case 'stopping':
      return { status: 'unhealthy', reason: 'inactive' };
  }
};
