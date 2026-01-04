/**
 * frontend/src/core/refresh/streaming/eventStreamManager.test.ts
 *
 * Test suite for eventStreamManager.
 * Covers key behaviors and edge cases for eventStreamManager.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@wailsjs/go/backend/App', () => ({
  GetRefreshBaseURL: vi.fn(async () => 'http://127.0.0.1:0'),
}));

const ensureRefreshBaseURLMock = vi.hoisted(() => vi.fn(async () => 'http://127.0.0.1:0'));
const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('../client', () => ({
  ensureRefreshBaseURL: ensureRefreshBaseURLMock,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

import { getDomainState, resetDomainState } from '../store';

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  ensureRefreshBaseURLMock.mockReset();
  ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');
  errorHandlerMock.handle.mockClear();
  if (!globalThis.window) {
    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
    });
  }
  resetDomainState('cluster-events');
  resetDomainState('namespace-events');
});

afterEach(() => {
  delete (globalThis as any).EventSource;
  vi.useRealTimers();
  if (typeof window !== 'undefined') {
    Object.assign(window, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  }
});

describe('EventStreamManager', () => {
  test('applyPayload updates cluster events state', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('cluster-events', 'cluster', {
      domain: 'cluster-events',
      scope: 'cluster',
      sequence: 1,
      generatedAt: 123,
      reset: true,
      events: [
        {
          clusterId: 'cluster-a',
          clusterName: 'alpha',
          kind: 'Event',
          name: 'test',
          namespace: 'default',
          type: 'Normal',
          source: 'kubelet',
          reason: 'Started',
          object: 'Pod/web',
          message: 'Container started',
        },
      ],
    });

    await flushTimers();

    const state = getDomainState('cluster-events');
    expect(state.status).toBe('ready');
    expect(state.data?.events).toHaveLength(1);
    expect(state.data?.events?.[0].message).toBe('Container started');
    // Cluster metadata must be preserved so the cluster events view can filter correctly.
    expect(state.data?.events?.[0].clusterId).toBe('cluster-a');
    expect(state.data?.events?.[0].clusterName).toBe('alpha');
  });

  test('applyPayload updates namespace events state', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('namespace-events', 'default', {
      domain: 'namespace-events',
      scope: 'default',
      sequence: 2,
      generatedAt: 456,
      reset: true,
      events: [
        {
          clusterId: 'cluster-b',
          clusterName: 'bravo',
          kind: 'Event',
          name: 'ns-event',
          namespace: 'default',
          type: 'Warning',
          source: 'controller',
          reason: 'Backoff',
          object: 'Job/foo',
          message: 'Retrying',
        },
      ],
    });

    await flushTimers();

    const state = getDomainState('namespace-events');
    expect(state.status).toBe('ready');
    expect(state.data?.events).toHaveLength(1);
    expect(state.data?.events?.[0].reason).toBe('Backoff');
    // Cluster metadata must be preserved so namespace events filter per-cluster selections.
    expect(state.data?.events?.[0].clusterId).toBe('cluster-b');
    expect(state.data?.events?.[0].clusterName).toBe('bravo');
  });

  test('applyPayload ignores empty updates when no reset or error', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('cluster-events', 'cluster', {
      domain: 'cluster-events',
      scope: 'cluster',
      sequence: 1,
      generatedAt: 789,
      reset: false,
      events: [],
    });

    await flushTimers();

    const state = getDomainState('cluster-events');
    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
  });

  test('applyPayload surfaces permission denied details when provided', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('cluster-events', 'cluster', {
      domain: 'cluster-events',
      scope: 'cluster',
      sequence: 2,
      generatedAt: 789,
      errorDetails: {
        kind: 'Status',
        apiVersion: 'v1',
        message: 'permission denied',
        reason: 'Forbidden',
        details: { domain: 'cluster-events', resource: 'core/events' },
        code: 403,
      },
    });

    await flushTimers();

    const state = getDomainState('cluster-events');
    expect(state.status).toBe('error');
    expect(state.error).toBe('permission denied (domain cluster-events, resource core/events)');
  });

  test('handleStreamError marks domain error after threshold', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.handleStreamError('cluster-events', 'cluster', 'stream disconnected');
    manager.handleStreamError('cluster-events', 'cluster', 'stream disconnected');
    const clusterState = getDomainState('cluster-events');
    expect(clusterState.status).toBe('updating');
    expect(clusterState.error).toBe('Stream resyncing');

    manager.handleStreamError('cluster-events', 'cluster', 'stream disconnected');
    const clusterStateTerminal = getDomainState('cluster-events');
    expect(clusterStateTerminal.status).toBe('error');
    expect(clusterStateTerminal.error).toBe('stream disconnected');

    manager.handleStreamError('namespace-events', 'default', 'namespace stream error');
    manager.handleStreamError('namespace-events', 'default', 'namespace stream error');
    manager.handleStreamError('namespace-events', 'default', 'namespace stream error');
    const nsState = getDomainState('namespace-events');
    expect(nsState.status).toBe('error');
    expect(nsState.error).toBe('namespace stream error');
  });

  test('scheduleNamespaceStateUpdate coalesces multiple updates per scope', async () => {
    vi.useFakeTimers();
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();
    const updateSpy = vi.spyOn(
      manager as unknown as { updateNamespaceState: (...args: unknown[]) => void },
      'updateNamespaceState'
    );

    const payloadBase = {
      domain: 'namespace-events' as const,
      scope: 'namespace:dev',
      sequence: 1,
      generatedAt: 100,
      reset: true,
      events: [
        {
          kind: 'Event',
          name: 'init',
          namespace: 'dev',
          reason: 'Started',
          message: 'Initial',
        },
      ],
    };

    manager.applyPayload(payloadBase.domain, payloadBase.scope, payloadBase);
    manager.applyPayload(payloadBase.domain, payloadBase.scope, {
      ...payloadBase,
      generatedAt: 200,
      events: [
        {
          kind: 'Event',
          name: 'update',
          namespace: 'dev',
          reason: 'Update',
          message: 'Updated',
        },
      ],
    });

    expect(updateSpy).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const state = getDomainState('namespace-events');
    expect(state.data?.events?.[0].message).toBe('Updated');

    vi.useRealTimers();
  });

  test('handleStreamError deduplicates notifications and markIdle clears them', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.handleStreamError('cluster-events', 'cluster', 'boom');
    manager.handleStreamError('cluster-events', 'cluster', 'boom');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(0);

    (manager as any).markIdle('cluster-events', 'cluster', true);
    const state = getDomainState('cluster-events');
    expect(state.status).toBe('idle');
  });

  test('stopNamespace reset clears cached events and scope', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    await manager.startNamespace('namespace:default');
    manager.applyPayload('namespace-events', 'namespace:default', {
      domain: 'namespace-events',
      scope: 'namespace:default',
      sequence: 1,
      generatedAt: 100,
      reset: true,
      events: [
        {
          kind: 'Event',
          name: 'ns',
          namespace: 'default',
          reason: 'Init',
          message: 'hi',
        },
      ],
    });
    await flushTimers();

    manager.stopNamespace('namespace:default', true);
    expect(getDomainState('namespace-events').data).toBeNull();
  });

  test('stopAll reset clears both cluster and namespace caches', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('cluster-events', 'cluster', {
      domain: 'cluster-events',
      scope: 'cluster',
      sequence: 1,
      generatedAt: 100,
      reset: true,
      events: [
        {
          kind: 'Event',
          name: 'cluster',
          namespace: 'default',
          reason: 'Init',
          message: 'hi',
        },
      ],
    });
    await flushTimers();

    await manager.startNamespace('namespace:default');
    await flushTimers();

    manager.stopAll(true);
    expect(getDomainState('cluster-events').data).toBeNull();
    expect(getDomainState('namespace-events').data).toBeNull();
  });

  test('retries event streams with exponential backoff and clears errors when connected', async () => {
    vi.useFakeTimers();
    Object.assign(window, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: any) => void> = {};
      constructor(_url: string) {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: any) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(type: string): void {
        delete this.listeners[type];
      }
      close(): void {}
      emit(type: string, evt?: any) {
        this.listeners[type]?.(evt);
      }
    }

    (globalThis as any).EventSource = MockEventSource as any;

    ensureRefreshBaseURLMock.mockRejectedValueOnce(new Error('not ready yet'));
    ensureRefreshBaseURLMock.mockRejectedValueOnce(new Error('still failing'));
    ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');

    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();
    const errorSpy = vi.spyOn(
      manager as unknown as {
        handleStreamError: (domain: string, scope: string, message: string) => void;
      },
      'handleStreamError'
    );

    await manager.startCluster();

    expect(errorSpy).toHaveBeenNthCalledWith(1, 'cluster-events', 'cluster', 'not ready yet');
    expect(errorSpy).toHaveBeenNthCalledWith(
      2,
      'cluster-events',
      'cluster',
      expect.stringContaining('Reconnecting in 1s')
    );
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(errorSpy).toHaveBeenNthCalledWith(3, 'cluster-events', 'cluster', 'still failing');
    expect(errorSpy).toHaveBeenNthCalledWith(
      4,
      'cluster-events',
      'cluster',
      expect.stringContaining('Reconnecting in 2s')
    );
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(3);
    expect(MockEventSource.instances).toHaveLength(1);

    const latestState = getDomainState('cluster-events');
    expect(latestState.error).toBeNull();
    expect(latestState.status).toBe('ready');

    MockEventSource.instances[0]?.emit('error');
    expect(errorSpy).toHaveBeenNthCalledWith(
      5,
      'cluster-events',
      'cluster',
      'Event stream connection lost'
    );
    expect(errorSpy).toHaveBeenNthCalledWith(
      6,
      'cluster-events',
      'cluster',
      expect.stringContaining('Reconnecting in 4s')
    );

    await vi.advanceTimersByTimeAsync(4000);
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(4);
  });

  test('namespace stream retries and clears errors after reconnection', async () => {
    vi.useFakeTimers();
    Object.assign(window, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: any) => void> = {};
      url: string;
      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: any) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {}
      close(): void {}
      emit(type: string, evt?: any) {
        this.listeners[type]?.(evt);
      }
    }

    (globalThis as any).EventSource = MockEventSource as any;

    ensureRefreshBaseURLMock.mockRejectedValueOnce(new Error('namespace not ready'));
    ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');

    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();
    const errorSpy = vi.spyOn(
      manager as unknown as {
        handleStreamError: (domain: string, scope: string, message: string) => void;
      },
      'handleStreamError'
    );

    await manager.startNamespace('namespace:prod');
    expect(errorSpy).toHaveBeenCalledWith(
      'namespace-events',
      'namespace:prod',
      'namespace not ready'
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'namespace-events',
      'namespace:prod',
      expect.stringContaining('Reconnecting in 1s')
    );
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(2);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toContain('scope=namespace%3Aprod');

    const namespaceState = getDomainState('namespace-events');
    expect(namespaceState.error).toBeNull();
    expect(namespaceState.status).toBe('ready');

    MockEventSource.instances[0]?.emit('error');
    expect(
      errorSpy.mock.calls.some(
        ([domain, scope, message]) =>
          domain === 'namespace-events' &&
          scope === 'namespace:prod' &&
          message === 'Event stream connection lost'
      )
    ).toBe(true);
    expect(errorSpy).toHaveBeenLastCalledWith(
      'namespace-events',
      'namespace:prod',
      expect.stringContaining('Reconnecting in 2s')
    );

    await vi.advanceTimersByTimeAsync(4000);
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(3);
  });

  test('reconnect includes resume token when available', async () => {
    vi.useFakeTimers();
    Object.assign(window, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: any) => void> = {};
      url: string;
      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: any) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {}
      close(): void {}
      emit(type: string, evt?: any) {
        this.listeners[type]?.(evt);
      }
    }

    (globalThis as any).EventSource = MockEventSource as any;

    ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');

    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    await manager.startCluster();
    expect(MockEventSource.instances).toHaveLength(1);

    const payload = {
      domain: 'cluster-events',
      scope: 'cluster',
      sequence: 41,
      generatedAt: Date.now(),
      events: [],
    };
    MockEventSource.instances[0]?.emit('event', {
      data: JSON.stringify(payload),
      lastEventId: '41',
    });

    MockEventSource.instances[0]?.emit('error');

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]?.url).toContain('since=41');
  });

  test('deduplicates stream error notifications and clears after reconnect', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.handleStreamError('cluster-events', 'cluster', 'stream lost');
    manager.handleStreamError('cluster-events', 'cluster', 'stream lost');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(0);

    manager.markConnected('cluster-events', 'cluster');
    manager.handleStreamError('cluster-events', 'cluster', 'stream lost');
    manager.handleStreamError('cluster-events', 'cluster', 'stream lost');
    manager.handleStreamError('cluster-events', 'cluster', 'stream lost');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);

    manager.handleStreamError('namespace-events', 'namespace:dev', 'namespace error');
    manager.handleStreamError('namespace-events', 'namespace:dev', 'namespace error');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);

    manager.markConnected('namespace-events', 'namespace:dev');
    manager.handleStreamError('namespace-events', 'namespace:dev', 'namespace error');
    manager.handleStreamError('namespace-events', 'namespace:dev', 'namespace error');
    manager.handleStreamError('namespace-events', 'namespace:dev', 'namespace error');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(2);
  });

  test('stopAll reset clears cluster and namespace state', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('cluster-events', 'cluster', {
      domain: 'cluster-events',
      scope: 'cluster',
      sequence: 3,
      generatedAt: 111,
      reset: true,
      events: [
        {
          kind: 'Deployment',
          name: 'api',
          namespace: 'prod',
          message: 'Scaled up',
        },
      ],
    });

    manager.applyPayload('namespace-events', 'namespace:dev', {
      domain: 'namespace-events',
      scope: 'namespace:dev',
      sequence: 4,
      generatedAt: 222,
      reset: true,
      events: [
        {
          kind: 'Pod',
          name: 'dev-pod',
          namespace: 'dev',
          message: 'Started',
        },
      ],
    });

    await flushTimers();
    expect(getDomainState('cluster-events').status).toBe('ready');
    expect(getDomainState('namespace-events').status).toBe('ready');

    (manager as any).namespaceScope = 'namespace:dev';
    manager.stopAll(true);

    const clusterState = getDomainState('cluster-events');
    const namespaceState = getDomainState('namespace-events');

    expect(clusterState.status).toBe('idle');
    expect(clusterState.data).toBeNull();
    expect(namespaceState.status).toBe('idle');
    expect(namespaceState.data).toBeNull();
  });

  test('namespace payload errors propagate to state and notifications', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('namespace-events', 'namespace:qa', {
      domain: 'namespace-events',
      scope: 'namespace:qa',
      sequence: 9,
      generatedAt: 789,
      reset: true,
      error: 'namespace failure',
      events: [
        {
          kind: 'Job',
          name: 'batch',
          namespace: 'qa',
          message: 'CrashLoop',
        },
      ],
    });

    await flushTimers();

    const state = getDomainState('namespace-events');
    expect(state.status).toBe('error');
    expect(state.error).toBe('namespace failure');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'namespace failure' }),
      expect.objectContaining({ domain: 'namespace-events', scope: 'namespace:qa' })
    );
  });

  test('cluster payload errors surface error state and notifications', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('cluster-events', 'cluster', {
      domain: 'cluster-events',
      scope: 'cluster',
      sequence: 11,
      generatedAt: 901,
      reset: true,
      error: 'cluster failure',
      events: [
        {
          kind: 'Node',
          name: 'node-a',
          namespace: '',
          message: 'NotReady',
        },
      ],
    });

    await flushTimers();

    const state = getDomainState('cluster-events');
    expect(state.status).toBe('error');
    expect(state.error).toBe('cluster failure');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'cluster failure' }),
      expect.objectContaining({ domain: 'cluster-events', scope: 'cluster' })
    );
  });

  test('ignores namespace payloads with no updates or errors', async () => {
    const { EventStreamManager } = await import('./eventStreamManager');
    const manager = new EventStreamManager();

    manager.applyPayload('namespace-events', 'namespace:staging', {
      domain: 'namespace-events',
      scope: 'namespace:staging',
      sequence: 12,
      generatedAt: 999,
      reset: false,
      events: [],
    });

    await flushTimers();
    const state = getDomainState('namespace-events');
    expect(state.data).toBeNull();
    expect(state.status).toBe('idle');
  });
});
