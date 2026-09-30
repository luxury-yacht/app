/**
 * frontend/src/core/refresh/streaming/containerLogsStreamProtocol.ts
 *
 * Container-logs stream protocol: frame validation and a pure transition
 * reducer. The manager owns sockets, timers and the store; it feeds connection
 * events and frames in and applies the returned effects.
 */

import { isPermissionDeniedStatus, resolvePermissionDeniedMessage } from '../permissionErrors';
import type {
  ContainerLogsIssueState,
  ContainerLogsLimitScope,
  ContainerLogsStreamEventPayload,
  ContainerLogsStreamPhase,
  ContainerLogsTargetIssue,
  ContainerLogsWarning,
  ContainerLogsWarningKind,
  ContainerLogsWireEntry,
} from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOptional = (value: unknown, type: 'string' | 'number' | 'boolean'): boolean =>
  value === undefined || typeof value === type;

// Each set lists every value of its generated union, so a new backend value
// fails typechecking here until it is accepted.
const WARNING_KINDS = new Set(
  Object.keys({ targetLimit: true, dropped: true } satisfies Record<ContainerLogsWarningKind, true>)
);
const LIMIT_SCOPES = new Set(
  Object.keys({ perTab: true, global: true } satisfies Record<ContainerLogsLimitScope, true>)
);
const ISSUE_STATES = new Set(
  Object.keys({ unavailable: true, forbidden: true, failed: true } satisfies Record<
    ContainerLogsIssueState,
    true
  >)
);

const isOneOf = (value: unknown, allowed: Set<string>): boolean =>
  typeof value === 'string' && allowed.has(value);

const isValidEntry = (value: unknown): value is ContainerLogsWireEntry =>
  isRecord(value) &&
  typeof value.timestamp === 'string' &&
  typeof value.pod === 'string' &&
  typeof value.container === 'string' &&
  typeof value.line === 'string' &&
  typeof value.isInit === 'boolean' &&
  isOptional(value.isEphemeral, 'boolean');

/** True when the value is a warning in the container-logs contract. */
export const isContainerLogsWarning = (value: unknown): value is ContainerLogsWarning =>
  isRecord(value) &&
  isOneOf(value.kind, WARNING_KINDS) &&
  (value.scope === undefined || isOneOf(value.scope, LIMIT_SCOPES)) &&
  isOptional(value.hidden, 'number') &&
  isOptional(value.limit, 'number') &&
  isOptional(value.count, 'number');

/** True when the value is a target issue in the container-logs contract. */
export const isContainerLogsTargetIssue = (value: unknown): value is ContainerLogsTargetIssue =>
  isRecord(value) &&
  typeof value.pod === 'string' &&
  typeof value.container === 'string' &&
  isOptional(value.isInit, 'boolean') &&
  isOptional(value.isEphemeral, 'boolean') &&
  isOneOf(value.state, ISSUE_STATES) &&
  typeof value.reason === 'string';

// Lists may be absent (unchanged) or null (Go's empty slice); otherwise every
// item must be valid.
const isValidList = (value: unknown, isValid: (item: unknown) => boolean): boolean =>
  value === undefined || value === null || (Array.isArray(value) && value.every(isValid));

const hasValidEnvelope = (value: Record<string, unknown>): boolean =>
  typeof value.domain === 'string' &&
  typeof value.scope === 'string' &&
  typeof value.sequence === 'number' &&
  typeof value.generatedAt === 'number';

const hasValidFlags = (value: Record<string, unknown>): boolean =>
  isOptional(value.reset, 'boolean') &&
  isOptional(value.resumed, 'boolean') &&
  isOptional(value.snapshotComplete, 'boolean') &&
  isOptional(value.trimmed, 'number') &&
  isOptional(value.error, 'string') &&
  isOptional(value.retryable, 'boolean') &&
  (value.errorDetails === undefined || isPermissionDeniedStatus(value.errorDetails));

const isString = (value: unknown): value is string => typeof value === 'string';

const hasValidLists = (value: Record<string, unknown>): boolean =>
  isValidList(value.entries, isValidEntry) &&
  isValidList(value.removedPods, isString) &&
  isValidList(value.warnings, isContainerLogsWarning) &&
  isValidList(value.issues, isContainerLogsTargetIssue);

/** Returns the frame when it matches the stream contract, otherwise null. */
export const parseContainerLogsFrame = (data: unknown): ContainerLogsStreamEventPayload | null =>
  isRecord(data) && hasValidEnvelope(data) && hasValidFlags(data) && hasValidLists(data)
    ? (data as unknown as ContainerLogsStreamEventPayload)
    : null;

type StagedSnapshot = {
  // The snapshot continues the client's buffer from its resume points.
  resumed: boolean;
  // Resumed pods that no longer exist; their lines are dropped.
  removedPods: string[];
  entries: ContainerLogsWireEntry[];
  warnings: ContainerLogsWarning[];
  issues: ContainerLogsTargetIssue[];
};

export type ContainerLogsProtocolState = {
  phase: ContainerLogsStreamPhase;
  // Connection attempts since the last delivered snapshot; drives backoff.
  attempt: number;
  // Frames of a snapshot whose last frame has not arrived yet.
  staged: StagedSnapshot | null;
};

export type ContainerLogsProtocolEvent =
  | { type: 'connection-opened' }
  | { type: 'frame-received'; frame: ContainerLogsStreamEventPayload }
  | { type: 'connection-lost'; reason: string }
  | { type: 'stopping' };

export type ContainerLogsProtocolEffect =
  | { type: 'send-request' }
  | {
      type: 'apply-snapshot';
      entries: ContainerLogsWireEntry[];
      resumed: boolean;
      removedPods: string[];
      trimmed: number;
      warnings: ContainerLogsWarning[];
      issues: ContainerLogsTargetIssue[];
    }
  | { type: 'append-entries'; entries: ContainerLogsWireEntry[] }
  | { type: 'remove-pods'; pods: string[] }
  | { type: 'replace-warnings'; warnings: ContainerLogsWarning[] }
  | { type: 'replace-issues'; issues: ContainerLogsTargetIssue[] }
  | { type: 'schedule-reconnect'; attempt: number }
  | { type: 'close-connection' };

export type ContainerLogsProtocolTransition = {
  state: ContainerLogsProtocolState;
  effects: ContainerLogsProtocolEffect[];
};

export const initialContainerLogsProtocolState = (): ContainerLogsProtocolState => ({
  phase: { status: 'connecting' },
  attempt: 0,
  staged: null,
});

const unchanged = (state: ContainerLogsProtocolState): ContainerLogsProtocolTransition => ({
  state,
  effects: [],
});

const isFinished = (phase: ContainerLogsStreamPhase): boolean =>
  phase.status === 'failed' || phase.status === 'stopping';

const reconnect = (
  state: ContainerLogsProtocolState,
  reason: string
): ContainerLogsProtocolTransition => ({
  state: {
    phase: { status: 'reconnecting', attempt: state.attempt + 1, reason },
    attempt: state.attempt + 1,
    staged: null,
  },
  effects: [{ type: 'close-connection' }, { type: 'schedule-reconnect', attempt: state.attempt }],
});

const receiveError = (
  state: ContainerLogsProtocolState,
  frame: ContainerLogsStreamEventPayload
): ContainerLogsProtocolTransition => {
  const reason =
    resolvePermissionDeniedMessage(frame.error, frame.errorDetails) || 'Log stream failed';
  if (frame.retryable) {
    return reconnect(state, reason);
  }
  return {
    state: {
      ...state,
      phase: {
        status: 'failed',
        reason,
        permissionDenied: isPermissionDeniedStatus(frame.errorDetails),
        retryable: false,
      },
      staged: null,
    },
    effects: [{ type: 'close-connection' }],
  };
};

const stageFrame = (
  staged: StagedSnapshot,
  frame: ContainerLogsStreamEventPayload
): StagedSnapshot => ({
  resumed: frame.reset ? frame.resumed === true : staged.resumed,
  removedPods: frame.reset ? (frame.removedPods ?? []) : staged.removedPods,
  entries: frame.entries?.length ? staged.entries.concat(frame.entries) : staged.entries,
  warnings: frame.warnings !== undefined ? (frame.warnings ?? []) : staged.warnings,
  issues: frame.issues !== undefined ? (frame.issues ?? []) : staged.issues,
});

const EMPTY_STAGE: StagedSnapshot = {
  resumed: false,
  removedPods: [],
  entries: [],
  warnings: [],
  issues: [],
};

// Snapshot frames are collected until the last one arrives, so the buffer is
// replaced, or extended for a resumed snapshot, in one step.
const receiveSnapshotFrame = (
  state: ContainerLogsProtocolState,
  frame: ContainerLogsStreamEventPayload
): ContainerLogsProtocolTransition => {
  const staged = stageFrame(frame.reset ? EMPTY_STAGE : (state.staged ?? EMPTY_STAGE), frame);
  if (!frame.snapshotComplete) {
    return unchanged({ ...state, staged });
  }
  return {
    state: { phase: { status: 'live' }, attempt: 0, staged: null },
    effects: [
      {
        type: 'apply-snapshot',
        entries: staged.entries,
        resumed: staged.resumed,
        removedPods: staged.removedPods,
        trimmed: frame.trimmed ?? 0,
        warnings: staged.warnings,
        issues: staged.issues,
      },
    ],
  };
};

const receiveLiveFrame = (
  state: ContainerLogsProtocolState,
  frame: ContainerLogsStreamEventPayload
): ContainerLogsProtocolTransition => {
  const effects: ContainerLogsProtocolEffect[] = [];
  if (frame.entries?.length) {
    effects.push({ type: 'append-entries', entries: frame.entries });
  }
  if (frame.removedPods?.length) {
    effects.push({ type: 'remove-pods', pods: frame.removedPods });
  }
  if (frame.warnings !== undefined) {
    effects.push({ type: 'replace-warnings', warnings: frame.warnings ?? [] });
  }
  if (frame.issues !== undefined) {
    effects.push({ type: 'replace-issues', issues: frame.issues ?? [] });
  }
  return { state, effects };
};

const receiveFrame = (
  state: ContainerLogsProtocolState,
  frame: ContainerLogsStreamEventPayload
): ContainerLogsProtocolTransition => {
  if (isFinished(state.phase)) {
    return unchanged(state);
  }
  if (frame.error) {
    return receiveError(state, frame);
  }
  if (frame.reset || state.staged) {
    return receiveSnapshotFrame(state, frame);
  }
  if (state.phase.status === 'live') {
    return receiveLiveFrame(state, frame);
  }
  // Nothing before the first snapshot frame changes what the user sees.
  return unchanged(state);
};

export const transitionContainerLogsProtocol = (
  state: ContainerLogsProtocolState,
  event: ContainerLogsProtocolEvent
): ContainerLogsProtocolTransition => {
  switch (event.type) {
    case 'connection-opened':
      if (isFinished(state.phase)) {
        return unchanged(state);
      }
      return {
        state: { ...state, phase: { status: 'awaiting-snapshot' }, staged: null },
        effects: [{ type: 'send-request' }],
      };
    case 'frame-received':
      return receiveFrame(state, event.frame);
    case 'connection-lost':
      return isFinished(state.phase) ? unchanged(state) : reconnect(state, event.reason);
    case 'stopping':
      return {
        state: { ...state, phase: { status: 'stopping' }, staged: null },
        effects: [{ type: 'close-connection' }],
      };
  }
};
