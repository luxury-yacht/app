import { describe, expect, it } from 'vitest';

import {
  initialRuntimeOperationStatusState,
  runtimeOperationStatusReducer,
  selectRuntimeOperationRows,
  type RuntimeOperationStatusState,
} from './runtimeOperationStatusAdapter';

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

  it('does not resurrect missing port-forward details from status-only events', () => {
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
      portForwardSessions: [],
    };

    const next = runtimeOperationStatusReducer(state, {
      type: 'portforward:status',
      event: {
        sessionId: 'pf-1',
        status: 'active',
        localPort: 18080,
        podName: 'web',
      },
    });

    expect(next.portForwardSessions).toEqual([]);
  });
});

describe('selectRuntimeOperationRows', () => {
  it('shows workflow detail rows before the runtime operation registry loads', () => {
    const state: RuntimeOperationStatusState = {
      operationsLoaded: false,
      operations: [],
      shellSessions: [
        { ...shellSession, sessionId: 'older', startedAt: '2026-05-18T00:00:00Z' },
        { ...shellSession, sessionId: 'newer', startedAt: '2026-05-19T00:00:00Z' },
      ],
      portForwardSessions: [
        { ...portForwardSession, id: 'pf-error', status: 'error' },
        { ...portForwardSession, id: 'pf-active', status: 'active' },
      ],
    };

    const rows = selectRuntimeOperationRows(state);

    expect(rows.shellSessions.map((session) => session.sessionId)).toEqual(['newer', 'older']);
    expect(rows.portForwardSessions.map((session) => session.id)).toEqual([
      'pf-active',
      'pf-error',
    ]);
  });

  it('filters pre-load workflow detail rows by selected cluster', () => {
    const state: RuntimeOperationStatusState = {
      operationsLoaded: false,
      operations: [],
      shellSessions: [
        shellSession,
        { ...shellSession, sessionId: 'shell-b', clusterId: 'cluster-b' },
      ],
      portForwardSessions: [
        portForwardSession,
        { ...portForwardSession, id: 'pf-b', clusterId: 'cluster-b' },
      ],
    };

    const rows = selectRuntimeOperationRows(state, 'cluster-a');

    expect(rows.shellSessions.map((session) => session.sessionId)).toEqual(['shell-1']);
    expect(rows.portForwardSessions.map((session) => session.id)).toEqual(['pf-1']);
  });

  it('uses selected-cluster runtime operations as the presence envelope after load', () => {
    const state: RuntimeOperationStatusState = {
      operationsLoaded: true,
      operations: [
        {
          id: 'shell-1',
          type: 'shell',
          clusterId: 'cluster-a',
          status: 'open',
          startedAt: '2026-05-18T00:00:00Z',
        },
        {
          id: 'shell-b',
          type: 'shell',
          clusterId: 'cluster-b',
          status: 'open',
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
      shellSessions: [
        shellSession,
        { ...shellSession, sessionId: 'shell-b', clusterId: 'cluster-b' },
        { ...shellSession, sessionId: 'ghost-shell', clusterId: 'cluster-a' },
      ],
      portForwardSessions: [],
    };

    const rows = selectRuntimeOperationRows(state, 'cluster-a');

    expect(rows.shellSessions.map((session) => session.sessionId)).toEqual(['shell-1']);
  });
});
