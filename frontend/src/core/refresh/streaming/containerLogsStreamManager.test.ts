/**
 * frontend/src/core/refresh/streaming/containerLogsStreamManager.test.ts
 *
 * Covers the container-logs stream manager as the only writer of
 * `container-logs` state: request, staged snapshots, ordered and bounded
 * buffers, reconnect and failure handling, and lifecycle events.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@core/backend-api', () => ({
  GetSelectionDiagnostics: vi.fn(async () => ({})),
}));

const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock('@utils/errorHandler', () => ({ errorHandler: errorHandlerMock }));

import { eventBus } from '@/core/events';
import { getScopedDomainState, resetScopedDomainState } from '../store';
import type { ContainerLogsStreamEventPayload, ContainerLogsWireEntry } from '../types';
import { CONTAINER_LOGS_MAX_BYTES, ContainerLogsStreamManager } from './containerLogsStreamManager';
import {
  resetContainerLogsStreamScopeParamsCacheForTesting,
  setContainerLogsStreamScopeParams,
} from './containerLogsStreamScopeParams';

const SCOPE = 'cluster-a|default:/v1:Pod:example';

// A scripted Wails JSON stream: frames are pushed with `receive`, and the
// connection is dropped with `lose`.
class FakeStream {
  static instances: FakeStream[] = [];
  sent: unknown[] = [];
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;

  constructor() {
    FakeStream.instances.push(this);
    queueMicrotask(() => this.onopen?.(new Event('open')));
  }

  send(value: unknown) {
    this.sent.push(value);
  }

  close() {
    this.closed = true;
  }

  receive(payload: Partial<ContainerLogsStreamEventPayload>) {
    this.onmessage?.({
      data: { domain: 'container-logs', scope: SCOPE, sequence: 1, generatedAt: 1, ...payload },
    } as MessageEvent<unknown>);
  }

  lose() {
    this.onerror?.(new Event('error'));
  }

  static latest(): FakeStream {
    const stream = FakeStream.instances[FakeStream.instances.length - 1];
    if (!stream) {
      throw new Error('no stream was opened');
    }
    return stream;
  }
}

const entry = (timestamp: string, line: string, pod = 'web-0'): ContainerLogsWireEntry => ({
  timestamp,
  pod,
  container: 'app',
  line,
  isInit: false,
});

const state = () => getScopedDomainState('container-logs', SCOPE);
const lines = () => (state().data?.entries ?? []).map((item) => item.line);

const flushOpen = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const startLive = async (
  manager: ContainerLogsStreamManager,
  snapshot: ContainerLogsWireEntry[] = []
) => {
  manager.startStream(SCOPE);
  await flushOpen();
  FakeStream.latest().receive({ reset: true, snapshotComplete: true, entries: snapshot });
};

beforeEach(() => {
  FakeStream.instances = [];
  errorHandlerMock.handle.mockClear();
  (
    globalThis as typeof globalThis & { __wailsJSONStreamFactory?: (name: string) => unknown }
  ).__wailsJSONStreamFactory = () => new FakeStream();
  resetContainerLogsStreamScopeParamsCacheForTesting();
  resetScopedDomainState('container-logs', SCOPE);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__wailsJSONStreamFactory');
  vi.useRealTimers();
  resetContainerLogsStreamScopeParamsCacheForTesting();
});

describe('ContainerLogsStreamManager', () => {
  test('asks for the scope, its source selection and the buffer limits', async () => {
    setContainerLogsStreamScopeParams(SCOPE, { selectedFilters: ['pod:web-2', 'container:app'] });
    const manager = new ContainerLogsStreamManager({ maxEntries: 500 });

    manager.startStream(SCOPE);
    await flushOpen();

    expect(FakeStream.latest().sent).toEqual([
      {
        scope: SCOPE,
        selectedFilters: ['pod:web-2', 'container:app'],
        matchNone: false,
        maxEntries: 500,
        maxBytes: CONTAINER_LOGS_MAX_BYTES,
      },
    ]);
    manager.stopAll(true);
  });

  test('keeps an explicit empty selection in the request', async () => {
    setContainerLogsStreamScopeParams(SCOPE, { matchNone: true });
    const manager = new ContainerLogsStreamManager();

    manager.startStream(SCOPE);
    await flushOpen();

    expect(FakeStream.latest().sent[0]).toMatchObject({ selectedFilters: [], matchNone: true });
    manager.stopAll(true);
  });

  test('shows a staged snapshot only once all its frames have arrived', async () => {
    const manager = new ContainerLogsStreamManager();
    manager.startStream(SCOPE);
    await flushOpen();
    const stream = FakeStream.latest();

    stream.receive({
      reset: true,
      entries: [entry('2024-01-01T00:00:01Z', 'first')],
      warnings: [{ kind: 'targetLimit', scope: 'perTab', hidden: 2, limit: 100 }],
    });
    expect(lines()).toEqual([]);
    expect(state().status).toBe('loading');

    stream.receive({ entries: [entry('2024-01-01T00:00:02Z', 'second')], snapshotComplete: true });
    expect(lines()).toEqual(['first', 'second']);
    expect(state().status).toBe('ready');
    expect(state().data?.phase).toEqual({ status: 'live' });
    expect(state().data?.warnings).toEqual([
      { kind: 'targetLimit', scope: 'perTab', hidden: 2, limit: 100 },
    ]);
    manager.stopAll(true);
  });

  test('places late history in timestamp order and keeps same-time lines in arrival order', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [
      entry('2024-01-01T00:00:02Z', 'two'),
      entry('2024-01-01T00:00:03.5Z', 'three'),
    ]);

    FakeStream.latest().receive({
      entries: [
        entry('2024-01-01T00:00:01Z', 'one'),
        entry('2024-01-01T00:00:03Z', 'three-a'),
        entry('2024-01-01T00:00:03Z', 'three-b'),
        entry('2024-01-01T00:00:04Z', 'four'),
      ],
    });

    expect(lines()).toEqual(['one', 'two', 'three-a', 'three-b', 'three', 'four']);
    manager.stopAll(true);
  });

  test('evicts the oldest entries by bytes and still keeps a delayed older line that fits', async () => {
    const manager = new ContainerLogsStreamManager({ maxEntries: 3, maxBytes: 1000 });
    const hundred = (label: string) => label.padEnd(100, '.');
    await startLive(manager, [
      entry('2024-01-01T00:00:01Z', hundred('a')),
      entry('2024-01-01T00:00:02Z', hundred('b')),
      entry('2024-01-01T00:00:03Z', hundred('c')),
    ]);

    FakeStream.latest().receive({
      entries: [entry('2024-01-01T00:00:05Z', 'big'.padEnd(950, '.'))],
    });
    expect(lines()).toEqual(['big'.padEnd(950, '.')]);

    FakeStream.latest().receive({
      entries: [entry('2024-01-01T00:00:04Z', 'late'.padEnd(25, '.'))],
    });
    expect(lines()).toEqual(['late'.padEnd(25, '.'), 'big'.padEnd(950, '.')]);
    expect(state().data?.truncation).toEqual({ shown: 2, received: 5 });
    manager.stopAll(true);
  });

  test('counts history the backend left out as truncation', async () => {
    const manager = new ContainerLogsStreamManager();
    manager.startStream(SCOPE);
    await flushOpen();

    FakeStream.latest().receive({
      reset: true,
      snapshotComplete: true,
      trimmed: 40,
      entries: [entry('2024-01-01T00:00:01Z', 'kept')],
    });

    expect(state().data?.truncation).toEqual({ shown: 1, received: 41 });
    manager.stopAll(true);
  });

  test('keeps entries while reconnecting and backs off until a snapshot arrives', async () => {
    vi.useFakeTimers();
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [entry('2024-01-01T00:00:01Z', 'kept')]);

    FakeStream.latest().lose();
    expect(state().data?.phase).toMatchObject({ status: 'reconnecting', attempt: 1 });
    expect(lines()).toEqual(['kept']);
    expect(errorHandlerMock.handle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeStream.instances).toHaveLength(2);
    await flushOpen();
    FakeStream.latest().lose();

    // The socket opened but no snapshot arrived, so the next wait doubles.
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeStream.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeStream.instances).toHaveLength(3);
    manager.stopAll(true);
  });

  test('stops for good on a failure that cannot be retried', async () => {
    vi.useFakeTimers();
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [entry('2024-01-01T00:00:01Z', 'kept')]);

    FakeStream.latest().receive({ error: 'deployments.apps "web" not found', retryable: false });

    expect(state().status).toBe('error');
    expect(state().error).toBe('deployments.apps "web" not found');
    expect(state().data?.phase).toMatchObject({ status: 'failed', retryable: false });
    expect(lines()).toEqual(['kept']);
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeStream.instances).toHaveLength(1);
    manager.stopAll(true);
  });

  test('reconnects after a failure the backend marks retryable', async () => {
    vi.useFakeTimers();
    const manager = new ContainerLogsStreamManager();
    await startLive(manager);

    FakeStream.latest().receive({ error: 'apiserver is restarting', retryable: true });
    expect(state().data?.phase).toMatchObject({
      status: 'reconnecting',
      reason: 'apiserver is restarting',
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeStream.instances).toHaveLength(2);
    manager.stopAll(true);
  });

  test('treats a malformed frame as a lost connection', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [entry('2024-01-01T00:00:01Z', 'kept')]);

    FakeStream.latest().receive({
      entries: [{ ...entry('t', 'x'), line: 7 } as unknown as ContainerLogsWireEntry],
    });

    expect(state().data?.phase).toMatchObject({ status: 'reconnecting' });
    expect(FakeStream.instances[0].closed).toBe(true);
    expect(lines()).toEqual(['kept']);
    manager.stopAll(true);
  });

  test('keeps the buffer across a stop and restart until the new snapshot arrives', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [entry('2024-01-01T00:00:01Z', 'kept')]);
    const before = state().data?.entries;

    manager.stop(SCOPE, false);
    manager.startStream(SCOPE);
    await flushOpen();
    expect(lines()).toEqual(['kept']);
    expect(state().status).toBe('updating');

    FakeStream.latest().receive({
      reset: true,
      snapshotComplete: true,
      entries: [entry('2024-01-01T00:00:01Z', 'kept')],
    });
    expect(state().data?.entries).toBe(before);
    manager.stopAll(true);
  });

  // A closed panel's scope is reset after its Logs tab stopped keeping its
  // lines; reopening starts empty and reads full history.
  test('forgets a stopped scope once it is reset', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [entry('2024-01-01T00:00:01Z', 'old')]);
    manager.stop(SCOPE, false);

    manager.stop(SCOPE, true);
    manager.startStream(SCOPE);
    await flushOpen();

    expect(lines()).toEqual([]);
    expect((FakeStream.latest().sent[0] as { resume?: unknown[] }).resume).toBeUndefined();
    manager.stopAll(true);
  });

  const resumeBuffer = [
    entry('2024-01-01T00:00:01Z', 'a-1'),
    entry('2024-01-01T00:00:02Z', 'b-1', 'web-1'),
    entry('2024-01-01T00:00:03Z', 'a-2'),
    entry('2024-01-01T00:00:03.000Z', 'a-3'),
  ];
  const resumePoints = [
    {
      pod: 'web-0',
      container: 'app',
      isInit: false,
      isEphemeral: false,
      timestamp: '2024-01-01T00:00:03.000Z',
      lines: ['a-2', 'a-3'],
    },
    {
      pod: 'web-1',
      container: 'app',
      isInit: false,
      isEphemeral: false,
      timestamp: '2024-01-01T00:00:02Z',
      lines: ['b-1'],
    },
  ];
  const sentResume = () =>
    (FakeStream.latest().sent[0] as { resume?: unknown[] } | undefined)?.resume;

  test('after a reconnect, asks only for what follows the buffer and adds it', async () => {
    vi.useFakeTimers();
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, resumeBuffer);

    FakeStream.latest().lose();
    await vi.advanceTimersByTimeAsync(1000);
    await flushOpen();
    expect(sentResume()).toEqual(expect.arrayContaining(resumePoints));
    expect(sentResume()).toHaveLength(2);

    FakeStream.latest().receive({
      reset: true,
      resumed: true,
      snapshotComplete: true,
      trimmed: 2,
      entries: [
        entry('2024-01-01T00:00:02.5Z', 'b-2', 'web-1'),
        entry('2024-01-01T00:00:04Z', 'a-4'),
      ],
    });
    expect(lines()).toEqual(['a-1', 'b-1', 'b-2', 'a-2', 'a-3', 'a-4']);
    expect(state().data?.truncation).toEqual({ shown: 6, received: 8 });
    manager.stopAll(true);
  });

  test('resumes from the buffer when the window is shown again', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, resumeBuffer);

    eventBus.emit('app:visibility-hidden');
    eventBus.emit('app:visibility-visible');
    await flushOpen();

    expect(FakeStream.instances).toHaveLength(2);
    expect(sentResume()).toEqual(expect.arrayContaining(resumePoints));
    manager.stopAll(true);
  });

  test('reads full history again after the source selection changes', async () => {
    setContainerLogsStreamScopeParams(SCOPE, { selectedFilters: ['pod:web-0'] });
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, resumeBuffer);

    setContainerLogsStreamScopeParams(SCOPE, { selectedFilters: ['pod:web-0', 'pod:web-1'] });
    manager.startStream(SCOPE);
    await flushOpen();

    expect(sentResume()).toBeUndefined();
    manager.stopAll(true);
  });

  test('reads full history again after the buffer grows, but not after it shrinks', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, resumeBuffer);

    eventBus.emit('settings:obj-panel-logs-buffer-size', 50);
    manager.startStream(SCOPE);
    await flushOpen();
    expect(sentResume()).toBeDefined();

    eventBus.emit('settings:obj-panel-logs-buffer-size', 9000);
    manager.startStream(SCOPE);
    await flushOpen();
    expect(sentResume()).toBeUndefined();
    manager.stopAll(true);
  });

  // The snapshot was asked for with the larger size but the buffer kept only
  // the smaller one, so growing back needs the history read again.
  test('reads full history after growing back from a shrink made while a snapshot was on its way', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, resumeBuffer);
    manager.startStream(SCOPE);
    await flushOpen();

    eventBus.emit('settings:obj-panel-logs-buffer-size', 100);
    FakeStream.latest().receive({
      reset: true,
      resumed: true,
      snapshotComplete: true,
      entries: [],
    });
    eventBus.emit('settings:obj-panel-logs-buffer-size', 5000);
    manager.startStream(SCOPE);
    await flushOpen();

    expect(sentResume()).toBeUndefined();
    manager.stopAll(true);
  });

  test('replaces the buffer when the backend sends full history instead', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, resumeBuffer);

    manager.startStream(SCOPE);
    await flushOpen();
    expect(sentResume()).toBeDefined();
    FakeStream.latest().receive({
      reset: true,
      snapshotComplete: true,
      entries: [entry('2024-01-01T00:00:09Z', 'fresh')],
    });

    expect(lines()).toEqual(['fresh']);
    manager.stopAll(true);
  });

  test('drops the lines of pods a resumed snapshot says no longer exist', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [
      entry('2024-01-01T00:00:01Z', 'gone-1', 'web-gone'),
      entry('2024-01-01T00:00:02Z', 'kept-1'),
      entry('2024-01-01T00:00:03Z', 'gone-2', 'web-gone'),
    ]);

    manager.startStream(SCOPE);
    await flushOpen();
    FakeStream.latest().receive({
      reset: true,
      resumed: true,
      snapshotComplete: true,
      removedPods: ['web-gone'],
      entries: [entry('2024-01-01T00:00:04Z', 'kept-2')],
    });

    expect(lines()).toEqual(['kept-1', 'kept-2']);
    expect(state().data?.pods).toEqual(['web-0']);
    // Lines of ended pods are not lines the buffer had no room for.
    expect(state().data?.truncation).toBeNull();
    manager.stopAll(true);
  });

  test('drops the lines of a pod that ended during the session', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [
      entry('2024-01-01T00:00:01Z', 'kept', 'web-0'),
      entry('2024-01-01T00:00:02Z', 'gone', 'web-1'),
    ]);

    FakeStream.latest().receive({ removedPods: ['web-1'] });

    expect(lines()).toEqual(['kept']);
    expect(state().data?.pods).toEqual(['web-0']);
    expect(state().data?.truncation).toBeNull();
    manager.stopAll(true);
  });

  test('lists the pods that have lines in the buffer', async () => {
    const manager = new ContainerLogsStreamManager({ maxEntries: 2 });
    await startLive(manager, [
      entry('2024-01-01T00:00:01Z', 'one', 'web-1'),
      entry('2024-01-01T00:00:02Z', 'two', 'web-2'),
    ]);
    expect([...(state().data?.pods ?? [])].sort()).toEqual(['web-1', 'web-2']);

    FakeStream.latest().receive({
      entries: [entry('2024-01-01T00:00:03Z', 'three', 'web-3')],
    });
    // web-1's only line was evicted.
    expect([...(state().data?.pods ?? [])].sort()).toEqual(['web-2', 'web-3']);
    manager.stopAll(true);
  });

  test('stopAll with reset clears every scope', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [entry('2024-01-01T00:00:01Z', 'kept')]);

    manager.stopAll(true);

    expect(state().data).toBeNull();
    expect(FakeStream.latest().closed).toBe(true);
  });

  test('kubeconfig:changing resets active streams', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager, [entry('2024-01-01T00:00:01Z', 'kept')]);

    eventBus.emit('kubeconfig:changing', 'other-config');

    expect(state().data).toBeNull();
    expect(FakeStream.latest().closed).toBe(true);
  });

  test('suspends while hidden and resumes active scopes, but not stopped ones', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(manager);

    eventBus.emit('app:visibility-hidden');
    expect(FakeStream.latest().closed).toBe(true);
    eventBus.emit('app:visibility-visible');
    await flushOpen();
    expect(FakeStream.instances).toHaveLength(2);

    eventBus.emit('app:visibility-hidden');
    manager.stop(SCOPE);
    eventBus.emit('app:visibility-visible');
    await flushOpen();
    expect(FakeStream.instances).toHaveLength(2);
    manager.stopAll(true);
  });

  test('a smaller buffer setting trims existing buffers at once', async () => {
    const manager = new ContainerLogsStreamManager();
    await startLive(
      manager,
      Array.from({ length: 150 }, (_, index) =>
        entry(
          `2024-01-01T00:00:${String(index % 60).padStart(2, '0')}.${String(index).padStart(3, '0')}Z`,
          `line-${index}`
        )
      )
    );

    eventBus.emit('settings:obj-panel-logs-buffer-size', 100);

    expect(state().data?.entries).toHaveLength(100);
    expect(state().data?.truncation).toEqual({ shown: 100, received: 150 });
    manager.stopAll(true);
  });
});
