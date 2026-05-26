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
  status: string;
  statusReason?: string;
  startedAt: string;
}

export interface PortForwardStatusEvent {
  sessionId: string;
  status: string;
  statusReason?: string;
  localPort?: number;
  podName?: string;
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
  if (!value) return 0;
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

function getPortForwardStatusPriority(status: string): number {
  switch (status) {
    case 'active':
      return 0;
    case 'reconnecting':
      return 1;
    case 'error':
      return 2;
    case 'stopped':
      return 3;
    default:
      return 4;
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
