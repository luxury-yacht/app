import { describe, expect, it } from 'vitest';

import {
  initialRuntimeOperationStatusState,
  runtimeOperationStatusReducer,
  type RuntimeOperationStatusState,
} from './runtimeOperationStatus';

const shellSession = {
  sessionId: 'shell-1',
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  namespace: 'default',
  podName: 'web',
  container: 'app',
  startedAt: '2026-05-18T00:00:00Z',
};

const portForwardSession = {
  id: 'pf-1',
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  namespace: 'default',
  podName: 'web',
  containerPort: 8080,
  localPort: 18080,
  status: 'active',
  startedAt: '2026-05-18T00:00:00Z',
};

describe('runtimeOperationStatusReducer', () => {
  it('keeps workflow detail lists before the runtime operation registry loads', () => {
    const state = runtimeOperationStatusReducer(initialRuntimeOperationStatusState, {
      type: 'object-shell:list',
      sessions: [shellSession],
    });

    expect(state.shellSessions).toEqual([shellSession]);
  });

  it('uses runtime operations as the active presence envelope', () => {
    const state: RuntimeOperationStatusState = {
      operationsLoaded: false,
      operations: [],
      shellSessions: [shellSession, { ...shellSession, sessionId: 'ghost-shell' }],
      portForwardSessions: [portForwardSession, { ...portForwardSession, id: 'ghost-pf' }],
    };

    const next = runtimeOperationStatusReducer(state, {
      type: 'runtime-operations:list',
      operations: [
        {
          id: 'shell-1',
          type: 'shell',
          clusterId: 'cluster-a',
          status: 'open',
          startedAt: '2026-05-18T00:00:00Z',
        },
        {
          id: 'pf-1',
          type: 'port-forward',
          clusterId: 'cluster-a',
          status: 'active',
          startedAt: '2026-05-18T00:00:00Z',
        },
        {
          id: 'drain-1',
          type: 'drain',
          clusterId: 'cluster-a',
          status: 'running',
          startedAt: '2026-05-18T00:00:00Z',
        },
      ],
    });

    expect(next.shellSessions.map((session) => session.sessionId)).toEqual(['shell-1']);
    expect(next.portForwardSessions.map((session) => session.id)).toEqual(['pf-1']);
  });

  it('applies port-forward status details without changing registry presence', () => {
    const state: RuntimeOperationStatusState = {
      operationsLoaded: true,
      operations: [
        {
          id: 'pf-1',
          type: 'port-forward',
          clusterId: 'cluster-a',
          status: 'active',
          startedAt: '2026-05-18T00:00:00Z',
        },
      ],
      shellSessions: [],
      portForwardSessions: [portForwardSession],
    };

    const next = runtimeOperationStatusReducer(state, {
      type: 'portforward:status',
      event: {
        sessionId: 'pf-1',
        status: 'reconnecting',
        statusReason: 'pod replaced',
        localPort: 18081,
        podName: 'web-replacement',
      },
    });

    expect(next.portForwardSessions[0]).toEqual({
      ...portForwardSession,
      status: 'reconnecting',
      statusReason: 'pod replaced',
      localPort: 18081,
      podName: 'web-replacement',
    });
  });
});
