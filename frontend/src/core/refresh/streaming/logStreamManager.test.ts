/**
 * frontend/src/core/refresh/streaming/logStreamManager.test.ts
 *
 * Test suite for logStreamManager.
 * Covers key behaviors and edge cases for logStreamManager.
 */

import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@wailsjs/go/backend/App', () => ({
  GetRefreshBaseURL: vi.fn(async () => 'http://127.0.0.1:0'),
  GetSelectionDiagnostics: vi.fn(async () => ({})),
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

import { getScopedDomainState, resetScopedDomainState } from '../store';

const SCOPE = 'default:pod:example';

beforeEach(() => {
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
  Object.assign(globalThis.window, {
    addEventListener: globalThis.window.addEventListener ?? vi.fn(),
    removeEventListener: globalThis.window.removeEventListener ?? vi.fn(),
  });
  resetScopedDomainState('object-logs', SCOPE);
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

describe('LogStreamManager', () => {
  test('applyPayload stores entries and marks ready', async () => {
    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();

    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        reset: true,
        entries: [
          {
            timestamp: '2024-01-01T00:00:00Z',
            pod: 'pod-1',
            container: 'app',
            line: 'hello world',
            isInit: false,
          },
        ],
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.status).toBe('ready');
    expect(state.data?.entries).toHaveLength(1);
    expect(state.data?.entries?.[0].line).toBe('hello world');
    expect(state.data?.resetCount).toBe(1);
  });

  test('applyPayload uses permission denied details when provided', async () => {
    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();

    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        errorDetails: {
          kind: 'Status',
          apiVersion: 'v1',
          message: 'permission denied',
          reason: 'Forbidden',
          details: { domain: 'object-logs', resource: 'core/pods/log' },
          code: 403,
        },
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.status).toBe('error');
    expect(state.error).toBe('permission denied (domain object-logs, resource core/pods/log)');
  });

  test('handleStreamError sets error state', async () => {
    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();

    manager.handleStreamError(SCOPE, 'connection lost');

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.status).toBe('error');
    expect(state.error).toBe('connection lost');
  });

  test('reconnects with exponential backoff after failures', async () => {
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
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as any).EventSource = MockEventSource as any;

    ensureRefreshBaseURLMock.mockRejectedValueOnce(new Error('not ready yet'));
    ensureRefreshBaseURLMock.mockRejectedValueOnce(new Error('still failing'));
    ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');

    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();
    const errorSpy = vi.spyOn(
      manager as unknown as { handleStreamError: (...args: any[]) => void },
      'handleStreamError'
    );

    await manager.startStream(SCOPE);

    expect(errorSpy).toHaveBeenNthCalledWith(1, SCOPE, 'not ready yet');
    expect(errorSpy).toHaveBeenNthCalledWith(
      2,
      SCOPE,
      expect.stringContaining('Reconnecting in 1s')
    );
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(errorSpy).toHaveBeenNthCalledWith(3, SCOPE, 'still failing');
    expect(errorSpy).toHaveBeenNthCalledWith(
      4,
      SCOPE,
      expect.stringContaining('Reconnecting in 2s')
    );
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(3);

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(['loading', 'updating']).toContain(state.status);
  });

  test('refreshOnce streams once and resolves when reset payload arrives', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: any) => void> = {};
      constructor() {
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

    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();

    const refreshPromise = manager.refreshOnce(SCOPE);
    await Promise.resolve();
    expect(MockEventSource.instances).toHaveLength(1);

    const payload = {
      domain: 'object-logs',
      scope: SCOPE,
      sequence: 10,
      generatedAt: 555,
      reset: true,
      entries: [
        {
          timestamp: '2024-01-01T00:00:00Z',
          pod: 'pod-a',
          container: 'sidecar',
          line: 'manual line',
        },
      ],
    };
    MockEventSource.instances[0]?.emit('log', { data: JSON.stringify(payload) });

    await refreshPromise;

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.status).toBe('ready');
    expect(state.data?.entries).toHaveLength(1);
    expect(state.data?.sequence).toBe(10);
    expect(state.isManual).toBe(true);
    expect(errorHandlerMock.handle).not.toHaveBeenCalled();
  });

  test('refreshOnce rejects and marks error when the stream fails', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: any) => void> = {};
      constructor() {
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

    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();

    const refreshPromise = manager.refreshOnce(SCOPE);
    await Promise.resolve();
    expect(MockEventSource.instances).toHaveLength(1);

    MockEventSource.instances[0]?.emit('error');

    await expect(refreshPromise).rejects.toThrow('Log stream connection lost');
    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.status).toBe('error');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Log stream connection lost' }),
      expect.objectContaining({ scope: SCOPE })
    );
  });

  test('stopAll with reset clears scoped buffers and state', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: any) => void> = {};
      constructor() {
        MockEventSource.instances.push(this);
      }
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as any).EventSource = MockEventSource as any;

    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();

    await manager.startStream(SCOPE);
    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 3,
        generatedAt: Date.now(),
        reset: true,
        entries: [
          { timestamp: 't1', pod: 'pod-1', container: 'app', line: 'line 1' },
          { timestamp: 't2', pod: 'pod-1', container: 'app', line: 'line 2' },
        ],
      },
      'stream'
    );

    expect(getScopedDomainState('object-logs', SCOPE).status).toBe('ready');
    manager.stopAll(true);

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
  });

  test('applyPayload truncates buffers and emits warnings when exceeding max size', async () => {
    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();

    const manyEntries = Array.from({ length: 1050 }, (_, index) => ({
      timestamp: `2024-01-01T00:00:${index.toString().padStart(2, '0')}Z`,
      pod: `pod-${Math.floor(index / 10)}`,
      container: 'app',
      line: `line-${index}`,
    }));

    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 10,
        reset: true,
        entries: manyEntries,
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(1000);
    expect(state.stats?.truncated).toBe(true);
    expect(state.stats?.warnings?.[0]).toBe('Showing most recent 1000 of 1050 log entries');
  });

  test('deduplicates log stream error notifications and clears when connected', async () => {
    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();

    manager.handleStreamError(SCOPE, 'lost');
    manager.handleStreamError(SCOPE, 'lost');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);

    manager.markConnected(SCOPE);
    manager.handleStreamError(SCOPE, 'lost');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------
  // Reconnect semantics — the reset=true handshake on new connections
  // must not wipe the client's buffered history, and the client-side
  // sequence must stay monotonic across stream restarts. Together these
  // guarantee the initial-load spinner only shows on the true first load
  // of a scope, not on every auto-refresh toggle / cluster-switch
  // remount. See docs/plans (Tier 1/2 responsiveness fix).
  // ---------------------------------------------------------------------

  const seedScopeWithEntries = async (
    count: number,
    sequence = 3
  ): Promise<InstanceType<typeof import('./logStreamManager').LogStreamManager>> => {
    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();
    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence,
        generatedAt: 1_000,
        reset: true,
        entries: Array.from({ length: count }, (_, index) => ({
          timestamp: `2024-01-01T00:00:${index.toString().padStart(2, '0')}Z`,
          pod: 'pod-1',
          container: 'app',
          line: `seed-${index}`,
          isInit: false,
        })),
      },
      'stream'
    );
    return manager;
  };

  test('applyPayload preserves the buffer when reset=true and incoming is empty', async () => {
    const manager = await seedScopeWithEntries(3);

    // Simulates the server's "new connection" handshake on stream
    // reconnect: reset flag set, but no new entries to send yet.
    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 2_000,
        reset: true,
        entries: [],
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(3);
    expect(state.data?.entries?.map((e) => e.line)).toEqual(['seed-0', 'seed-1', 'seed-2']);
  });

  test('applyPayload replaces the buffer when reset=true and incoming is non-empty', async () => {
    const manager = await seedScopeWithEntries(3);

    // Manual refresh or server-driven fresh snapshot: replace as before.
    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 5,
        generatedAt: 2_000,
        reset: true,
        entries: [
          {
            timestamp: '2024-01-01T00:01:00Z',
            pod: 'pod-1',
            container: 'app',
            line: 'fresh-a',
            isInit: false,
          },
          {
            timestamp: '2024-01-01T00:01:01Z',
            pod: 'pod-1',
            container: 'app',
            line: 'fresh-b',
            isInit: false,
          },
        ],
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(2);
    expect(state.data?.entries?.map((e) => e.line)).toEqual(['fresh-a', 'fresh-b']);
  });

  test('applyPayload appends when reset=false regardless of what was buffered', async () => {
    const manager = await seedScopeWithEntries(2);

    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 4,
        generatedAt: 2_000,
        reset: false,
        entries: [
          {
            timestamp: '2024-01-01T00:02:00Z',
            pod: 'pod-1',
            container: 'app',
            line: 'appended',
            isInit: false,
          },
        ],
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(3);
    expect(state.data?.entries?.map((e) => e.line)).toEqual(['seed-0', 'seed-1', 'appended']);
  });

  test('sequence is monotonic across reset frames (does not regress on reconnect)', async () => {
    const manager = await seedScopeWithEntries(2, 5);

    // The server's per-connection counter restarts at 1 on every new
    // stream open, but the client-side sequence must stay at 5 so the
    // view's hasReceivedInitialLogs (>= 2) keeps evaluating true.
    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 2_000,
        reset: true,
        entries: [],
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.data?.sequence).toBe(5);
  });

  test('sequence advances normally on forward progress', async () => {
    const manager = await seedScopeWithEntries(2, 2);

    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 4,
        generatedAt: 2_000,
        reset: false,
        entries: [
          {
            timestamp: '2024-01-01T00:02:00Z',
            pod: 'pod-1',
            container: 'app',
            line: 'forward',
            isInit: false,
          },
        ],
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.data?.sequence).toBe(4);
  });

  // ---------------------------------------------------------------------
  // User-configurable buffer size. The manager subscribes to the
  // 'settings:log-buffer-size' event in its constructor — shrinking the
  // size must retroactively trim existing buffers and push the update
  // to the scoped store so open LogViewers re-render; growing the size
  // must not disturb anything.
  // ---------------------------------------------------------------------

  const seedScopeWithNEntries = async (
    count: number
  ): Promise<InstanceType<typeof import('./logStreamManager').LogStreamManager>> => {
    const { LogStreamManager } = await import('./logStreamManager');
    const manager = new LogStreamManager();
    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 3,
        generatedAt: 1_000,
        reset: true,
        entries: Array.from({ length: count }, (_, index) => ({
          timestamp: `2024-01-01T00:00:${index.toString().padStart(2, '0')}Z`,
          pod: 'pod-1',
          container: 'app',
          line: `line-${index}`,
          isInit: false,
        })),
      },
      'stream'
    );
    return manager;
  };

  test('settings:log-buffer-size event trims existing buffers when shrinking', async () => {
    const { eventBus } = await import('@/core/events');
    await seedScopeWithNEntries(50);

    // Baseline: all 50 entries in the store.
    expect(getScopedDomainState('object-logs', SCOPE).data?.entries).toHaveLength(50);

    // Shrink the buffer cap. The event is dispatched synchronously, so
    // the store update should be visible immediately after emit.
    eventBus.emit('settings:log-buffer-size', 20);

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(20);
    // The trim must keep the TAIL (newest entries), not the head.
    expect(state.data?.entries?.[0].line).toBe('line-30');
    expect(state.data?.entries?.[19].line).toBe('line-49');
    expect(state.stats?.truncated).toBe(true);
  });

  test('settings:log-buffer-size event leaves smaller buffers untouched when growing', async () => {
    const { eventBus } = await import('@/core/events');
    await seedScopeWithNEntries(10);

    const before = getScopedDomainState('object-logs', SCOPE).data?.entries;
    expect(before).toHaveLength(10);

    eventBus.emit('settings:log-buffer-size', 5000);

    // No change — the existing buffer is smaller than the new cap.
    const after = getScopedDomainState('object-logs', SCOPE).data?.entries;
    expect(after).toHaveLength(10);
    expect(after?.map((e) => e.line)).toEqual(before?.map((e) => e.line));
  });

  test('settings:log-buffer-size event clamps subsequent applyPayload truncation', async () => {
    const { eventBus } = await import('@/core/events');
    const manager = await seedScopeWithNEntries(5);

    // Tighten the cap to 10. The existing 5 entries aren't touched.
    eventBus.emit('settings:log-buffer-size', 10);

    // Send a payload large enough to exceed the new cap. applyPayload
    // must honor the updated cap, not the old default.
    manager.applyPayload(
      SCOPE,
      {
        domain: 'object-logs',
        scope: SCOPE,
        sequence: 4,
        generatedAt: 2_000,
        reset: false,
        entries: Array.from({ length: 20 }, (_, index) => ({
          timestamp: `2024-01-01T00:01:${index.toString().padStart(2, '0')}Z`,
          pod: 'pod-1',
          container: 'app',
          line: `new-${index}`,
          isInit: false,
        })),
      },
      'stream'
    );

    const state = getScopedDomainState('object-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(10);
    expect(state.stats?.truncated).toBe(true);
  });
});
