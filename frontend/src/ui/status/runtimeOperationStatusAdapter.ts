/**
 * frontend/src/ui/status/runtimeOperationStatusAdapter.ts
 *
 * Reducer and selectors for shared runtime-operation status rows.
 */

import { assertNever } from '@shared/utils/assertNever';

/**
 * The closed set of port-forward statuses the backend can emit (mirrors the Go
 * `PortForwardStatus`). Typing the field as this union makes an invalid status
 * unrepresentable downstream; raw Wails payloads are coerced into it at the
 * ingestion boundary via {@link parsePortForwardStatus}.
 */
export type PortForwardStatus = 'connecting' | 'active' | 'reconnecting' | 'error' | 'stopped';

const PORT_FORWARD_STATUSES: ReadonlySet<string> = new Set<PortForwardStatus>([
  'connecting',
  'active',
  'reconnecting',
  'error',
  'stopped',
]);

// Unrecognized status falls back to the most benign transient state, which
// renders as the neutral icon and sorts last — identical to how an unknown
// status was handled before this domain was closed.
const PORT_FORWARD_STATUS_FALLBACK: PortForwardStatus = 'connecting';

// Log each distinct unrecognized status at most once per session (the backend
// is the sole, now-typed producer, so this should never fire).
const warnedUnknownStatuses = new Set<string>();

/**
 * Coerce a raw status string from the backend into the closed
 * {@link PortForwardStatus} union, warning once on anything unexpected.
 */
export function parsePortForwardStatus(raw: string): PortForwardStatus {
  if (PORT_FORWARD_STATUSES.has(raw)) {
    return raw as PortForwardStatus;
  }
  if (!warnedUnknownStatuses.has(raw)) {
    warnedUnknownStatuses.add(raw);
    console.warn(
      `Unrecognized port-forward status "${raw}"; treating as "${PORT_FORWARD_STATUS_FALLBACK}".`
    );
  }
  return PORT_FORWARD_STATUS_FALLBACK;
}

export interface ShellSessionInfo {
  sessionId: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  container: string;
  command?: string[];
  status?: string;
  startedAt?: string | { time?: string };
}

export interface PortForwardSession {
  id: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  containerPort: number;
  localPort: number;
  targetKind?: string;
  targetName?: string;
  status: PortForwardStatus;
  statusReason?: string;
  startedAt: string;
}

export interface PortForwardStatusEvent {
  sessionId: string;
  status: PortForwardStatus;
  statusReason?: string;
  localPort?: number;
  podName?: string;
}

/** Port-forward session as delivered by Wails, before status normalization. */
export type RawPortForwardSession = Omit<PortForwardSession, 'status'> & { status: string };

/** Port-forward status event as delivered by Wails, before status normalization. */
export type RawPortForwardStatusEvent = Omit<PortForwardStatusEvent, 'status'> & { status: string };

/** Convert a raw Wails port-forward session into the typed domain shape. */
export function normalizePortForwardSession(raw: RawPortForwardSession): PortForwardSession {
  return { ...raw, status: parsePortForwardStatus(raw.status) };
}

/** Convert a raw Wails port-forward status event into the typed domain shape. */
export function normalizePortForwardStatusEvent(
  raw: RawPortForwardStatusEvent
): PortForwardStatusEvent {
  return { ...raw, status: parsePortForwardStatus(raw.status) };
}

export type RuntimeOperationType = 'shell' | 'port-forward' | 'drain' | string;

export interface RuntimeOperation {
  id: string;
  type: RuntimeOperationType;
  clusterId: string;
  clusterName?: string;
  status: string;
  startedAt: string;
}

export interface RuntimeOperationStatusState {
  operationsLoaded: boolean;
  operations: RuntimeOperation[];
  shellSessions: ShellSessionInfo[];
  portForwardSessions: PortForwardSession[];
}

export interface RuntimeOperationRows {
  shellSessions: ShellSessionInfo[];
  portForwardSessions: PortForwardSession[];
}

export type RuntimeOperationStatusAction =
  | { type: 'runtime-operations:list'; operations: RuntimeOperation[] }
  | { type: 'object-shell:list'; sessions: ShellSessionInfo[] }
  | { type: 'portforward:list'; sessions: PortForwardSession[] }
  | { type: 'portforward:status'; event: PortForwardStatusEvent };

export const initialRuntimeOperationStatusState: RuntimeOperationStatusState = {
  operationsLoaded: false,
  operations: [],
  shellSessions: [],
  portForwardSessions: [],
};

const activeOperationIds = (
  operations: RuntimeOperation[],
  type: RuntimeOperationType
): Set<string> =>
  new Set(
    operations.filter((operation) => operation.type === type).map((operation) => operation.id)
  );

const isClusterMatch = (clusterId: string | undefined, selectedClusterId?: string | null) =>
  !selectedClusterId || clusterId === selectedClusterId;

const keepActiveShellSessions = (
  sessions: ShellSessionInfo[],
  operations: RuntimeOperation[],
  operationsLoaded: boolean
) => {
  if (!operationsLoaded) {
    return sessions;
  }
  const activeShellIds = activeOperationIds(operations, 'shell');
  return sessions.filter((session) => activeShellIds.has(session.sessionId));
};

const keepActivePortForwards = (
  sessions: PortForwardSession[],
  operations: RuntimeOperation[],
  operationsLoaded: boolean
) => {
  if (!operationsLoaded) {
    return sessions;
  }
  const activePortForwardIds = activeOperationIds(operations, 'port-forward');
  return sessions.filter((session) => activePortForwardIds.has(session.id));
};

export const runtimeOperationStatusReducer = (
  state: RuntimeOperationStatusState,
  action: RuntimeOperationStatusAction
): RuntimeOperationStatusState => {
  switch (action.type) {
    case 'runtime-operations:list':
      return {
        ...state,
        operationsLoaded: true,
        operations: action.operations,
        shellSessions: keepActiveShellSessions(state.shellSessions, action.operations, true),
        portForwardSessions: keepActivePortForwards(
          state.portForwardSessions,
          action.operations,
          true
        ),
      };
    case 'object-shell:list':
      return {
        ...state,
        shellSessions: keepActiveShellSessions(
          action.sessions,
          state.operations,
          state.operationsLoaded
        ),
      };
    case 'portforward:list':
      return {
        ...state,
        portForwardSessions: keepActivePortForwards(
          action.sessions,
          state.operations,
          state.operationsLoaded
        ),
      };
    case 'portforward:status':
      return {
        ...state,
        portForwardSessions: state.portForwardSessions.map((session) =>
          session.id === action.event.sessionId
            ? {
                ...session,
                status: action.event.status,
                statusReason: action.event.statusReason,
                ...(action.event.localPort !== undefined && { localPort: action.event.localPort }),
                ...(action.event.podName !== undefined && { podName: action.event.podName }),
              }
            : session
        ),
      };
    default:
      return state;
  }
};

function parseTimestamp(value?: string | { time?: string }): number {
  if (!value) {
    return 0;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.time === 'string') {
    const parsed = Date.parse(value.time);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function getPortForwardStatusPriority(status: PortForwardStatus): number {
  switch (status) {
    case 'active':
      return 0;
    case 'reconnecting':
      return 1;
    case 'error':
      return 2;
    case 'stopped':
      return 3;
    case 'connecting':
      return 4;
    default:
      return assertNever(status, 'port-forward status');
  }
}

export function selectRuntimeOperationRows(
  state: RuntimeOperationStatusState,
  selectedClusterId?: string | null
): RuntimeOperationRows {
  const clusterShellSessions = state.shellSessions.filter((session) =>
    isClusterMatch(session.clusterId, selectedClusterId)
  );
  const clusterPortForwards = state.portForwardSessions.filter((session) =>
    isClusterMatch(session.clusterId, selectedClusterId)
  );

  if (!state.operationsLoaded) {
    return {
      shellSessions: sortShellSessions(clusterShellSessions),
      portForwardSessions: sortPortForwardSessions(clusterPortForwards),
    };
  }

  const filteredRuntimeOperations = state.operations.filter((operation) =>
    isClusterMatch(operation.clusterId, selectedClusterId)
  );
  const runtimeShellIds = activeOperationIds(filteredRuntimeOperations, 'shell');
  const runtimePortForwardIds = activeOperationIds(filteredRuntimeOperations, 'port-forward');

  return {
    shellSessions: sortShellSessions(
      clusterShellSessions.filter((session) => runtimeShellIds.has(session.sessionId))
    ),
    portForwardSessions: sortPortForwardSessions(
      clusterPortForwards.filter((session) => runtimePortForwardIds.has(session.id))
    ),
  };
}

function sortShellSessions(sessions: ShellSessionInfo[]): ShellSessionInfo[] {
  return [...sessions].sort((a, b) => parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt));
}

function sortPortForwardSessions(sessions: PortForwardSession[]): PortForwardSession[] {
  return [...sessions].sort((a, b) => {
    const priorityA = getPortForwardStatusPriority(a.status);
    const priorityB = getPortForwardStatusPriority(b.status);
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt);
  });
}
