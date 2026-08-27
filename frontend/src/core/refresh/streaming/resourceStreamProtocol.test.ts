import { describe, expect, it } from 'vitest';

import {
  computeResourceStreamProtocolHealth,
  initialResourceStreamProtocolState,
  normalizeResourceStreamProtocolMessage,
  transitionResourceStreamProtocol,
} from './resourceStreamProtocol';

const receive = (
  state: ReturnType<typeof initialResourceStreamProtocolState>,
  message: Parameters<typeof transitionResourceStreamProtocol>[1] & { type: 'message-received' }
) => transitionResourceStreamProtocol(state, message);

describe('normalizeResourceStreamProtocolMessage', () => {
  it('covers normalizeResourceStreamProtocolMessage scenarios', async () => {
    {
      // Scenario: normalizes modern and legacy changed frames to the same canonical message
      const modern = normalizeResourceStreamProtocolMessage({
        clusterId: 'cluster-a',
        domain: 'pods',
        scope: 'namespace:default',
        source: 'object',
        signal: 'changed',
        version: 'object:7',
        sequence: '7',
        resourceVersion: '42',
      });
      const legacy = normalizeResourceStreamProtocolMessage({
        type: 'MODIFIED',
        clusterId: 'cluster-a',
        domain: 'pods',
        scope: 'namespace:default',
        source: 'object',
        version: 'object:7',
        sequence: '7',
        resourceVersion: '42',
      });

      expect(modern?.message).toEqual(legacy?.message);
      expect(modern).toMatchObject({ routing: 'strict', domain: 'pods' });
      expect(legacy).toMatchObject({ routing: 'compatible', domain: 'pods' });
    }

    {
      // Scenario: normalizes RESET/COMPLETE and signal reset into one canonical reset event
      const modern = normalizeResourceStreamProtocolMessage({
        clusterId: 'cluster-a',
        domain: 'namespace-config',
        scope: 'namespace:default',
        source: 'object',
        signal: 'reset',
        version: 'object:8',
      });
      const reset = normalizeResourceStreamProtocolMessage({
        type: 'RESET',
        domain: 'namespace-config',
        scope: 'namespace:default',
      });
      const complete = normalizeResourceStreamProtocolMessage({
        type: 'COMPLETE',
        domain: 'namespace-config',
        scope: 'namespace:default',
      });

      expect(modern?.message).toMatchObject({ kind: 'reset', reason: 'reset' });
      expect(reset?.message).toEqual({ kind: 'reset', reason: 'reset' });
      expect(complete?.message).toEqual({ kind: 'reset', reason: 'complete' });
    }
    // Scenario: rejects a modern signal clock that its domain does not declare
    expect(
      normalizeResourceStreamProtocolMessage({
        clusterId: 'cluster-a',
        domain: 'namespace-config',
        scope: 'namespace:default',
        source: 'metric',
        signal: 'changed',
        version: 'metric:1',
      })
    ).toBeNull();
  });
});

describe('transitionResourceStreamProtocol', () => {
  it('covers transitionResourceStreamProtocol scenarios', async () => {
    {
      // Scenario: uses ACK as the quiet-stream synchronization boundary
      let state = initialResourceStreamProtocolState();
      ({ state } = transitionResourceStreamProtocol(state, {
        type: 'subscribe-sent',
        expectsReset: true,
      }));

      const result = receive(state, {
        type: 'message-received',
        message: { kind: 'acknowledged' },
        now: 10,
        connectionEpoch: 3,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 1_000,
      });

      expect(result.state.phase).toEqual({
        status: 'synchronized',
        epoch: 3,
        delivered: false,
        expectsReset: true,
      });
      expect(result.effects).toEqual([]);
    }

    for (const reason of ['initial', 'manual refresh']) {
      // Scenarios: %s resubscribe preserves confirmed stream health
      let state = initialResourceStreamProtocolState();
      ({ state } = transitionResourceStreamProtocol(state, {
        type: 'subscribe-sent',
        expectsReset: true,
      }));
      ({ state } = receive(state, {
        type: 'message-received',
        message: { kind: 'acknowledged' },
        now: 10,
        connectionEpoch: 3,
        hasRetainedData: true,
        completeResync: false,
        maxPendingChanges: 1_000,
      }));

      const requested = transitionResourceStreamProtocol(state, {
        type: 'resync-requested',
        reason,
        now: 2_000,
        force: true,
        cooldownMs: 1_000,
      });
      expect(computeResourceStreamProtocolHealth(requested.state, 'connected', '')).toEqual({
        status: 'healthy',
        reason: 'synchronized',
      });

      const completed = transitionResourceStreamProtocol(requested.state, {
        type: 'resync-completed',
      });
      expect(computeResourceStreamProtocolHealth(completed.state, 'connected', '')).toEqual({
        status: 'healthy',
        reason: 'synchronized',
      });
    }

    {
      // Scenario: absorbs the first reset, invalidates retained data, and resyncs on a later reset
      let state = initialResourceStreamProtocolState();
      ({ state } = transitionResourceStreamProtocol(state, {
        type: 'subscribe-sent',
        expectsReset: true,
      }));
      const initialReset = receive(state, {
        type: 'message-received',
        message: { kind: 'reset', reason: 'reset', source: 'object', version: 'object:1' },
        now: 10,
        connectionEpoch: 2,
        hasRetainedData: true,
        completeResync: false,
        maxPendingChanges: 1_000,
      });

      expect(initialReset.state.phase).toEqual({
        status: 'synchronized',
        epoch: 2,
        delivered: false,
        expectsReset: false,
      });
      expect(initialReset.effects).toEqual([
        { type: 'advance-source', sourceVersions: { object: 'object:1' }, latest: 'object:1' },
      ]);

      const laterReset = receive(initialReset.state, {
        type: 'message-received',
        message: { kind: 'reset', reason: 'reset', source: 'object', version: 'object:2' },
        now: 20,
        connectionEpoch: 2,
        hasRetainedData: true,
        completeResync: false,
        maxPendingChanges: 1_000,
      });
      expect(laterReset.effects).toEqual([
        { type: 'advance-source', sourceVersions: { object: 'object:2' }, latest: 'object:2' },
        { type: 'request-resync', reason: 'reset', force: false },
      ]);
    }

    {
      // Scenario: resyncs when manager replacement sends COMPLETE before the initial RESET
      let state = initialResourceStreamProtocolState();
      ({ state } = transitionResourceStreamProtocol(state, {
        type: 'subscribe-sent',
        expectsReset: true,
      }));

      const replacement = receive(state, {
        type: 'message-received',
        message: { kind: 'reset', reason: 'complete' },
        now: 10,
        connectionEpoch: 2,
        hasRetainedData: true,
        completeResync: false,
        maxPendingChanges: 1_000,
      });

      expect(replacement.effects).toEqual([
        { type: 'advance-legacy-reset' },
        { type: 'request-resync', reason: 'complete', force: false },
      ]);
    }

    {
      // Scenario: rejects replayed sequences and coalesces accepted changes behind one timer
      let state = initialResourceStreamProtocolState();
      const first = receive(state, {
        type: 'message-received',
        message: {
          kind: 'changed',
          source: 'object',
          version: 'object:5',
          sequence: 5n,
          resourceVersion: 10n,
        },
        now: 10,
        connectionEpoch: 1,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 1_000,
      });
      expect(first.effects).toEqual([{ type: 'schedule-flush' }]);
      ({ state } = transitionResourceStreamProtocol(first.state, {
        type: 'flush-timer-attached',
        timer: 99,
      }));

      const replay = receive(state, {
        type: 'message-received',
        message: {
          kind: 'changed',
          source: 'object',
          version: 'object:4',
          sequence: 4n,
          resourceVersion: 11n,
        },
        now: 11,
        connectionEpoch: 1,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 1_000,
      });

      expect(replay.state.activity).toEqual({ lastMessageAt: 11, lastDeliveryAt: 10 });
      expect(replay.state.resume).toEqual(state.resume);
      expect(replay.state.coalescing).toEqual(state.coalescing);
      expect(replay.effects).toEqual([]);
      const flushed = transitionResourceStreamProtocol(replay.state, {
        type: 'flush-fired',
        timer: 99,
      });
      expect(flushed.effects).toEqual([
        { type: 'advance-source', sourceVersions: { object: 'object:5' }, latest: 'object:5' },
      ]);
    }

    {
      // Scenario: turns permission denial into a terminal protocol state
      const result = receive(initialResourceStreamProtocolState(), {
        type: 'message-received',
        message: { kind: 'error', reason: 'forbidden', permissionDenied: true },
        now: 50,
        connectionEpoch: 1,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 1_000,
      });

      expect(result.state.phase).toEqual({
        status: 'permission-blocked',
        reason: 'forbidden',
        at: 50,
      });
      expect(result.effects).toEqual([{ type: 'permission-denied', reason: 'forbidden' }]);
    }

    {
      // Scenario: bounds coalescing and requests one forced resync on overflow
      let state = initialResourceStreamProtocolState();
      let result = receive(state, {
        type: 'message-received',
        message: { kind: 'changed', source: 'object', version: 'object:1' },
        now: 1,
        connectionEpoch: 1,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 2,
      });
      ({ state } = transitionResourceStreamProtocol(result.state, {
        type: 'flush-timer-attached',
        timer: 101,
      }));
      result = receive(state, {
        type: 'message-received',
        message: { kind: 'changed', source: 'object', version: 'object:2' },
        now: 2,
        connectionEpoch: 1,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 2,
      });
      result = receive(result.state, {
        type: 'message-received',
        message: { kind: 'changed', source: 'object', version: 'object:3' },
        now: 3,
        connectionEpoch: 1,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 2,
      });

      expect(result.state.coalescing).toEqual({ status: 'idle' });
      expect(result.effects).toEqual([
        { type: 'cancel-flush', timer: 101 },
        { type: 'request-resync', reason: 'update backlog overflow', force: true },
      ]);
    }

    {
      // Scenario: flushes observed clocks before clearing them for resync and then awaits ACK
      let state = initialResourceStreamProtocolState();
      let result = receive(state, {
        type: 'message-received',
        message: { kind: 'changed', source: 'metric', version: 'metric:9' },
        now: 1,
        connectionEpoch: 1,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 1_000,
      });
      ({ state } = transitionResourceStreamProtocol(result.state, {
        type: 'flush-timer-attached',
        timer: 102,
      }));

      result = transitionResourceStreamProtocol(state, {
        type: 'resync-requested',
        reason: 'reconnect',
        now: 2_000,
        force: true,
        cooldownMs: 1_000,
      });
      expect(result.state.phase).toMatchObject({ status: 'resyncing', reason: 'reconnect' });
      expect(result.effects).toEqual([
        { type: 'cancel-flush', timer: 102 },
        { type: 'advance-source', sourceVersions: { metric: 'metric:9' }, latest: 'metric:9' },
        { type: 'mark-resyncing', reason: 'reconnect' },
      ]);

      const completed = transitionResourceStreamProtocol(result.state, {
        type: 'resync-completed',
      });
      expect(completed.state.phase).toMatchObject({ status: 'awaiting-ack', expectsReset: true });
      expect(completed.effects).toEqual([
        { type: 'mark-resync-complete' },
        { type: 'send-subscribe' },
      ]);
    }

    {
      // Scenario: resumes from a sequence on reconnect and cancels coalescing when stopping
      let state = initialResourceStreamProtocolState();
      let result = receive(state, {
        type: 'message-received',
        message: { kind: 'changed', sequence: 7n },
        now: 1,
        connectionEpoch: 1,
        hasRetainedData: false,
        completeResync: false,
        maxPendingChanges: 1_000,
      });
      ({ state } = transitionResourceStreamProtocol(result.state, {
        type: 'flush-timer-attached',
        timer: 103,
      }));
      ({ state } = transitionResourceStreamProtocol(state, {
        type: 'connection-lost',
        reason: 'closed',
      }));
      result = transitionResourceStreamProtocol(state, { type: 'connection-opened', epoch: 2 });
      expect(result.effects).toEqual([
        { type: 'mark-resync-complete' },
        { type: 'send-subscribe' },
      ]);
      expect(result.state.phase).toMatchObject({ status: 'awaiting-ack', expectsReset: false });

      const stopping = transitionResourceStreamProtocol(result.state, { type: 'stopping' });
      expect(stopping.state.phase).toEqual({ status: 'stopping' });
      expect(stopping.effects).toEqual([{ type: 'cancel-flush', timer: 103 }]);
    }

    {
      // Scenario: makes stopping terminal so late frames cannot affect a replacement owner
      const stopping = transitionResourceStreamProtocol(initialResourceStreamProtocolState(), {
        type: 'stopping',
      });
      const lateReset = receive(stopping.state, {
        type: 'message-received',
        message: { kind: 'reset', reason: 'reset', source: 'object', version: 'object:9' },
        now: 10,
        connectionEpoch: 2,
        hasRetainedData: true,
        completeResync: false,
        maxPendingChanges: 1_000,
      });

      expect(lateReset.state).toEqual(stopping.state);
      expect(lateReset.effects).toEqual([]);
    }
  });
});
