import { describe, expect, it } from 'vitest';

import type { ContainerLogsStreamEventPayload } from '../types';
import {
  type ContainerLogsProtocolState,
  initialContainerLogsProtocolState,
  parseContainerLogsFrame,
  transitionContainerLogsProtocol,
} from './containerLogsStreamProtocol';

const SCOPE = 'cluster-a|team-a:/v1:Pod:web-0';

const frame = (
  overrides: Partial<ContainerLogsStreamEventPayload>
): ContainerLogsStreamEventPayload => ({
  domain: 'container-logs',
  scope: SCOPE,
  sequence: 1,
  generatedAt: 1,
  ...overrides,
});

const entry = (line: string) => ({
  timestamp: '2024-01-01T00:00:00Z',
  pod: 'web-0',
  container: 'app',
  line,
  isInit: false,
});

const receive = (
  state: ContainerLogsProtocolState,
  payload: Partial<ContainerLogsStreamEventPayload>
) => transitionContainerLogsProtocol(state, { type: 'frame-received', frame: frame(payload) });

const opened = (state: ContainerLogsProtocolState = initialContainerLogsProtocolState()) =>
  transitionContainerLogsProtocol(state, { type: 'connection-opened' }).state;

const live = () => receive(opened(), { reset: true, snapshotComplete: true }).state;

describe('parseContainerLogsFrame', () => {
  it('accepts a well-formed snapshot frame', () => {
    const payload = frame({
      reset: true,
      snapshotComplete: true,
      trimmed: 3,
      entries: [entry('ready')],
      warnings: [{ kind: 'targetLimit', scope: 'perTab', hidden: 2, limit: 100 }],
      issues: [
        { pod: 'web-0', container: 'sidecar', state: 'failed', reason: 'connection refused' },
      ],
    });
    expect(parseContainerLogsFrame(payload)).toEqual(payload);
  });

  it.each([
    ['an entry without a line', { entries: [{ ...entry('x'), line: 7 }] }],
    ['an unknown warning kind', { warnings: [{ kind: 'mystery' }] }],
    [
      'an unknown issue state',
      { issues: [{ pod: 'p', container: 'c', state: 'odd', reason: '' }] },
    ],
    ['a non-boolean retryable flag', { retryable: 'yes' }],
    ['a non-numeric trimmed count', { trimmed: '3' }],
    ['a non-boolean resumed flag', { resumed: 'yes' }],
    ['a removed pod that is not a name', { removedPods: [7] }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseContainerLogsFrame({ ...frame({}), ...overrides })).toBeNull();
  });
});

describe('transitionContainerLogsProtocol', () => {
  it('sends the request once the connection opens', () => {
    const transition = transitionContainerLogsProtocol(initialContainerLogsProtocolState(), {
      type: 'connection-opened',
    });
    expect(transition.state.phase).toEqual({ status: 'awaiting-snapshot' });
    expect(transition.effects).toEqual([{ type: 'send-request' }]);
  });

  it('does not treat a frame before the snapshot as the snapshot', () => {
    const transition = receive(opened(), { entries: [] });
    expect(transition.state.phase).toEqual({ status: 'awaiting-snapshot' });
    expect(transition.effects).toEqual([]);
  });

  it('applies a staged snapshot only when its last frame arrives', () => {
    let state = opened();
    let transition = receive(state, {
      reset: true,
      entries: [entry('a')],
      warnings: [{ kind: 'dropped', count: 4 }],
      issues: [{ pod: 'web-0', container: 'sidecar', state: 'unavailable', reason: 'waiting' }],
    });
    expect(transition.effects).toEqual([]);
    state = transition.state;
    transition = receive(state, { entries: [entry('b')] });
    expect(transition.effects).toEqual([]);
    state = transition.state;

    transition = receive(state, { entries: [entry('c')], snapshotComplete: true, trimmed: 2 });
    expect(transition.state.phase).toEqual({ status: 'live' });
    expect(transition.effects).toEqual([
      {
        type: 'apply-snapshot',
        entries: [entry('a'), entry('b'), entry('c')],
        resumed: false,
        removedPods: [],
        trimmed: 2,
        warnings: [{ kind: 'dropped', count: 4 }],
        issues: [{ pod: 'web-0', container: 'sidecar', state: 'unavailable', reason: 'waiting' }],
      },
    ]);
  });

  it('marks a snapshot that continues the client buffer as resumed', () => {
    const first = receive(opened(), { reset: true, resumed: true, entries: [entry('a')] });
    const transition = receive(first.state, { entries: [entry('b')], snapshotComplete: true });
    expect(transition.effects).toEqual([
      expect.objectContaining({
        type: 'apply-snapshot',
        entries: [entry('a'), entry('b')],
        resumed: true,
      }),
    ]);
  });

  it('carries the pods a resumed snapshot says no longer exist', () => {
    const first = receive(opened(), { reset: true, resumed: true, removedPods: ['web-gone'] });
    const transition = receive(first.state, { entries: [entry('b')], snapshotComplete: true });
    expect(transition.effects).toEqual([
      expect.objectContaining({ type: 'apply-snapshot', removedPods: ['web-gone'] }),
    ]);
  });

  it('removes the pods a live frame says ended', () => {
    const transition = receive(live(), { removedPods: ['web-1'] });
    expect(transition.effects).toEqual([{ type: 'remove-pods', pods: ['web-1'] }]);
  });

  it('applies live batches and replaces warnings and issues', () => {
    const transition = receive(live(), {
      entries: [entry('live')],
      warnings: [],
      issues: [{ pod: 'web-0', container: 'app', state: 'failed', reason: 'boom' }],
    });
    expect(transition.effects).toEqual([
      { type: 'append-entries', entries: [entry('live')] },
      { type: 'replace-warnings', warnings: [] },
      {
        type: 'replace-issues',
        issues: [{ pod: 'web-0', container: 'app', state: 'failed', reason: 'boom' }],
      },
    ]);
  });

  it('grows the reconnect backoff until a snapshot arrives, not when a socket opens', () => {
    let transition = transitionContainerLogsProtocol(live(), {
      type: 'connection-lost',
      reason: 'lost',
    });
    expect(transition.effects).toContainEqual({ type: 'schedule-reconnect', attempt: 0 });
    transition = transitionContainerLogsProtocol(opened(transition.state), {
      type: 'connection-lost',
      reason: 'lost',
    });
    expect(transition.effects).toContainEqual({ type: 'schedule-reconnect', attempt: 1 });
    transition = transitionContainerLogsProtocol(opened(transition.state), {
      type: 'connection-lost',
      reason: 'lost',
    });
    expect(transition.effects).toContainEqual({ type: 'schedule-reconnect', attempt: 2 });

    const recovered = receive(opened(transition.state), {
      reset: true,
      snapshotComplete: true,
    }).state;
    transition = transitionContainerLogsProtocol(recovered, {
      type: 'connection-lost',
      reason: 'lost',
    });
    expect(transition.effects).toContainEqual({ type: 'schedule-reconnect', attempt: 0 });
  });

  it('reconnects after a retryable failure', () => {
    const transition = receive(live(), { error: 'apiserver is restarting', retryable: true });
    expect(transition.state.phase).toEqual({
      status: 'reconnecting',
      attempt: 1,
      reason: 'apiserver is restarting',
    });
    expect(transition.effects).toEqual([
      { type: 'close-connection' },
      { type: 'schedule-reconnect', attempt: 0 },
    ]);
  });

  it('stops for good after a failure that cannot be retried', () => {
    const failed = receive(live(), {
      error: 'pods is forbidden: User "viewer" cannot list resource "pods"',
      errorDetails: {
        kind: 'Status',
        apiVersion: 'v1',
        message: 'pods is forbidden: User "viewer" cannot list resource "pods"',
        reason: 'Forbidden',
        code: 403,
        details: { domain: 'container-logs', resource: 'core/pods' },
      },
    });
    expect(failed.state.phase).toMatchObject({
      status: 'failed',
      permissionDenied: true,
      retryable: false,
    });
    expect(failed.effects).toEqual([{ type: 'close-connection' }]);

    const afterLoss = transitionContainerLogsProtocol(failed.state, {
      type: 'connection-lost',
      reason: 'closed',
    });
    expect(afterLoss.state).toEqual(failed.state);
    expect(afterLoss.effects).toEqual([]);
  });

  it('ignores frames once stopping', () => {
    const stopping = transitionContainerLogsProtocol(live(), { type: 'stopping' });
    expect(stopping.effects).toEqual([{ type: 'close-connection' }]);
    expect(receive(stopping.state, { entries: [entry('late')] }).effects).toEqual([]);
  });
});
