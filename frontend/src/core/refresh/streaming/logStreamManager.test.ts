/**
 * frontend/src/core/refresh/streaming/logStreamManager.test.ts
 *
 * Test suite for logStreamManager.
 * Covers key behaviors and edge cases for logStreamManager.
 */

import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

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
});
