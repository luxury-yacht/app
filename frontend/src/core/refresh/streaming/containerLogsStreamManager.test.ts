/**
 * frontend/src/core/refresh/streaming/containerLogsStreamManager.test.ts
 *
 * Test suite for containerLogsStreamManager.
 * Covers key behaviors and edge cases for containerLogsStreamManager.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import { installWindowProperty } from '@/test-utils/windowProperty';

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

import {
  resetContainerLogsStreamScopeParamsCacheForTesting,
  setContainerLogsStreamScopeParams,
} from '@modules/object-panel/components/ObjectPanel/Logs/containerLogsStreamScopeParamsCache';
import { getScopedDomainState, resetScopedDomainState } from '../store';

const SCOPE = 'default:pod:example';
let restoreEventSource: (() => void) | undefined;

const installEventSource = (eventSource: unknown) => {
  restoreEventSource?.();
  restoreEventSource = installWindowProperty('EventSource', eventSource);
};

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
  resetContainerLogsStreamScopeParamsCacheForTesting();
  resetScopedDomainState('container-logs', SCOPE);
});

afterEach(() => {
  restoreEventSource?.();
  restoreEventSource = undefined;
  vi.useRealTimers();
  if (typeof window !== 'undefined') {
    Object.assign(window, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  }
  resetContainerLogsStreamScopeParamsCacheForTesting();
});

describe('ContainerLogsStreamManager', () => {
  test('applyPayload stores entries and marks ready', async () => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
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

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.status).toBe('ready');
    expect(state.data?.entries).toHaveLength(1);
    expect(state.data?.entries?.[0].line).toBe('hello world');
    expect(state.data?.resetCount).toBe(1);
  });

  test('applyPayload carries backend warnings into snapshot stats', async () => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        reset: true,
        warnings: ['Showing logs for 24 of 25 pod/container targets. Refine filters to view more.'],
        entries: [],
      },
      'stream'
    );

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.status).toBe('ready');
    expect(state.stats?.warnings).toContain(
      'Showing logs for 24 of 25 pod/container targets. Refine filters to view more.'
    );
  });

  test('applyPayload clears backend warnings when the server sends an empty warning list', async () => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        reset: true,
        warnings: ['Showing logs for 24 of 25 pod/container targets. Refine filters to view more.'],
        entries: [],
      },
      'stream'
    );

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 2,
        generatedAt: 124,
        warnings: [],
        entries: [],
      },
      'stream'
    );

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.stats?.warnings).toBeUndefined();
  });

  test('applyPayload treats a null warning list as a warning clear', async () => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        warnings: ['selection truncated'],
        entries: [],
      },
      'stream'
    );
    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 2,
        generatedAt: 124,
        warnings: null,
        entries: [],
      },
      'stream'
    );

    expect(getScopedDomainState('container-logs', SCOPE).stats?.warnings).toBeUndefined();
  });

  test('applyPayload uses permission denied details when provided', async () => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        errorDetails: {
          kind: 'Status',
          apiVersion: 'v1',
          message: 'permission denied',
          reason: 'Forbidden',
          details: { domain: 'container-logs', resource: 'core/pods/log' },
          code: 403,
        },
      },
      'stream'
    );

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.status).toBe('error');
    expect(state.error).toBe('permission denied (domain container-logs, resource core/pods/log)');
  });

  test('handleStreamError sets error state', async () => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    manager.handleStreamError(SCOPE, 'connection lost');

    const state = getScopedDomainState('container-logs', SCOPE);
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
      listeners: Record<string, (evt?: unknown) => void> = {};
      constructor(_url: string) {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        // Closing is intentionally inert in this test double.
      }
    }
    installEventSource(MockEventSource);

    ensureRefreshBaseURLMock.mockRejectedValueOnce(new Error('not ready yet'));
    ensureRefreshBaseURLMock.mockRejectedValueOnce(new Error('still failing'));
    ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();
    const errorSpy = vi.spyOn(
      manager as unknown as { handleStreamError: (...args: unknown[]) => void },
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

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(['loading', 'updating']).toContain(state.status);
  });

  test('closes failed container log streams before scheduling one reconnect', async () => {
    vi.useFakeTimers();
    Object.assign(window, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      closed = false;
      constructor(_url: string) {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(type: string): void {
        delete this.listeners[type];
      }
      close(): void {
        this.closed = true;
      }
      emit(type: string, evt?: unknown) {
        this.listeners[type]?.(evt);
      }
    }
    installEventSource(MockEventSource);

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    await manager.startStream(SCOPE);
    expect(MockEventSource.instances).toHaveLength(1);

    const firstStream = requireValue(
      MockEventSource.instances[0],
      'expected test value in containerLogsStreamManager.test.ts'
    );
    firstStream.emit('error');
    firstStream.emit('error');

    expect(firstStream.closed).toBe(true);
    expect(firstStream.listeners).toEqual({});

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  test('refreshOnce streams once and resolves when reset payload arrives', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      constructor() {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        // Closing is intentionally inert in this test double.
      }
      emit(type: string, evt?: unknown) {
        this.listeners[type]?.(evt);
      }
    }
    installEventSource(MockEventSource);

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    const refreshPromise = manager.refreshOnce(SCOPE);
    await Promise.resolve();
    expect(MockEventSource.instances).toHaveLength(1);

    const payload = {
      domain: 'container-logs',
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
          isInit: false,
        },
      ],
    };
    MockEventSource.instances[0]?.emit('log', { data: JSON.stringify(payload) });

    await refreshPromise;

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.status).toBe('ready');
    expect(state.data?.entries).toHaveLength(1);
    expect(state.data?.sequence).toBe(10);
    expect(state.isManual).toBe(true);
    expect(errorHandlerMock.handle).not.toHaveBeenCalled();
  });

  test('accepts a null warning list from the stream as a warning clear', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      constructor() {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        // Closing is intentionally inert in this test double.
      }
      emit(type: string, evt?: unknown) {
        this.listeners[type]?.(evt);
      }
    }
    installEventSource(MockEventSource);

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();
    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        warnings: ['selection truncated'],
        entries: [],
      },
      'stream'
    );

    await manager.startStream(SCOPE);
    MockEventSource.instances[0]?.emit('log', {
      data: JSON.stringify({
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 2,
        generatedAt: 124,
        warnings: null,
        entries: [],
      }),
    });

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.status).toBe('ready');
    expect(state.stats?.warnings).toBeUndefined();
    expect(errorHandlerMock.handle).not.toHaveBeenCalled();
  });

  test('rejects a stream payload whose log entry is missing backend-required fields', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      constructor() {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        // Closing is intentionally inert in this test double.
      }
      emit(type: string, evt?: unknown) {
        this.listeners[type]?.(evt);
      }
    }
    installEventSource(MockEventSource);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();
    await manager.startStream(SCOPE);

    MockEventSource.instances[0]?.emit('log', {
      data: JSON.stringify({
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        entries: [{ pod: 'pod-a', container: 'app' }],
      }),
    });

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data).toBeNull();
    expect(consoleError).toHaveBeenCalledWith('Invalid container logs stream payload structure');
    consoleError.mockRestore();
  });

  test('rejects a manual refresh when its reset frame violates the log entry contract', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      constructor() {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        // Closing is intentionally inert in this test double.
      }
      emit(type: string, evt?: unknown) {
        this.listeners[type]?.(evt);
      }
    }
    installEventSource(MockEventSource);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();
    const refreshPromise = manager.refreshOnce(SCOPE);
    await Promise.resolve();

    MockEventSource.instances[0]?.emit('log', {
      data: JSON.stringify({
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 123,
        reset: true,
        entries: [{ pod: 'pod-a', container: 'app' }],
      }),
    });

    await expect(refreshPromise).rejects.toThrow('Invalid container logs stream payload');
    expect(getScopedDomainState('container-logs', SCOPE).status).toBe('error');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid container logs stream payload' }),
      expect.objectContaining({ scope: SCOPE })
    );
    consoleError.mockRestore();
  });

  test('startStream appends cluster-prefixed scope and cached selection filters to the stream URL', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      url: string;
      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        // Closing is intentionally inert in this test double.
      }
    }
    installEventSource(MockEventSource);

    const logScope = 'cluster-a|default:apps/v1:deployment:web';
    setContainerLogsStreamScopeParams(logScope, {
      container: 'app',
      selectedFilters: ['pod:web-2', 'container:app'],
    });

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    await manager.startStream(logScope);

    expect(MockEventSource.instances).toHaveLength(1);
    const streamURL = new URL(
      requireValue(
        MockEventSource.instances[0],
        'expected test value in containerLogsStreamManager.test.ts'
      ).url
    );
    expect(streamURL.searchParams.get('scope')).toBe(logScope);
    expect(streamURL.searchParams.get('container')).toBe('app');
    expect(streamURL.searchParams.getAll('selectedFilter')).toEqual(['pod:web-2', 'container:app']);
  });

  test('startStream preserves an explicit empty selection in the stream URL', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      url: string;
      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // The test only observes stream creation and its URL.
      }
      close(): void {
        // The test only observes stream creation and its URL.
      }
    }
    installEventSource(MockEventSource);

    const logScope = 'cluster-a|default:apps/v1:deployment:web';
    setContainerLogsStreamScopeParams(logScope, { matchNone: true });
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    await manager.startStream(logScope);

    const streamURL = new URL(
      requireValue(MockEventSource.instances[0], 'expected explicit-empty stream').url
    );
    expect(streamURL.searchParams.get('matchNone')).toBe('true');
    expect(streamURL.searchParams.getAll('selectedFilter')).toEqual([]);
  });

  test('refreshOnce rejects and marks error when the stream fails', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      constructor() {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void) {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        // Closing is intentionally inert in this test double.
      }
      emit(type: string, evt?: unknown) {
        this.listeners[type]?.(evt);
      }
    }
    installEventSource(MockEventSource);

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    const refreshPromise = manager.refreshOnce(SCOPE);
    await Promise.resolve();
    expect(MockEventSource.instances).toHaveLength(1);

    MockEventSource.instances[0]?.emit('error');

    await expect(refreshPromise).rejects.toThrow('Container logs stream connection lost');
    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.status).toBe('error');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Container logs stream connection lost' }),
      expect.objectContaining({ scope: SCOPE })
    );
  });

  test('stopAll with reset clears scoped buffers and state', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      constructor() {
        MockEventSource.instances.push(this);
      }
      addEventListener(): void {
        // Listener registration is intentionally inert in this test double.
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        // Closing is intentionally inert in this test double.
      }
    }
    installEventSource(MockEventSource);

    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    await manager.startStream(SCOPE);
    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 3,
        generatedAt: Date.now(),
        reset: true,
        entries: [
          { timestamp: 't1', pod: 'pod-1', container: 'app', line: 'line 1', isInit: false },
          { timestamp: 't2', pod: 'pod-1', container: 'app', line: 'line 2', isInit: false },
        ],
      },
      'stream'
    );

    expect(getScopedDomainState('container-logs', SCOPE).status).toBe('ready');
    manager.stopAll(true);

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
  });

  test('kubeconfig:changing resets active container logs streams and scoped state', async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      listeners: Record<string, (evt?: unknown) => void> = {};
      closed = false;
      constructor() {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, handler: (evt?: unknown) => void): void {
        this.listeners[type] = handler;
      }
      removeEventListener(): void {
        // Listener removal is intentionally inert in this test double.
      }
      close(): void {
        this.closed = true;
      }
    }
    installEventSource(MockEventSource);

    const { eventBus } = await import('@/core/events');
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    await manager.startStream(SCOPE);
    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 2,
        generatedAt: Date.now(),
        reset: true,
        entries: [
          { timestamp: 't1', pod: 'pod-1', container: 'app', line: 'line 1', isInit: false },
        ],
      },
      'stream'
    );

    expect(getScopedDomainState('container-logs', SCOPE).data?.entries).toHaveLength(1);

    eventBus.emit('kubeconfig:changing', '');

    expect(MockEventSource.instances[0]?.closed).toBe(true);
    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
  });

  test('applyPayload truncates buffers and emits warnings when exceeding max size', async () => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

    const manyEntries = Array.from({ length: 1050 }, (_, index) => ({
      timestamp: `2024-01-01T00:00:${index.toString().padStart(2, '0')}Z`,
      pod: `pod-${Math.floor(index / 10)}`,
      container: 'app',
      line: `line-${index}`,
      isInit: false,
    }));

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 10,
        reset: true,
        entries: manyEntries,
      },
      'stream'
    );

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(1000);
    expect(state.stats?.truncated).toBe(true);
    expect(state.stats?.warnings?.[0]).toBe('Showing most recent 1000 of 1050 log entries');
  });

  test('deduplicates container logs stream error notifications and clears when connected', async () => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();

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
  // remount. See docs/workflows/logs/container-logs.md.
  // ---------------------------------------------------------------------

  const seedScopeWithEntries = async (
    count: number,
    sequence = 3
  ): Promise<
    InstanceType<typeof import('./containerLogsStreamManager').ContainerLogsStreamManager>
  > => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();
    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
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
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 2_000,
        reset: true,
        entries: [],
      },
      'stream'
    );

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(3);
    expect(state.data?.entries?.map((e) => e.line)).toEqual(['seed-0', 'seed-1', 'seed-2']);
  });

  test('applyPayload replaces the buffer when reset=true and incoming is non-empty', async () => {
    const manager = await seedScopeWithEntries(3);

    // Manual refresh or server-driven fresh snapshot: replace as before.
    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
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

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(2);
    expect(state.data?.entries?.map((e) => e.line)).toEqual(['fresh-a', 'fresh-b']);
  });

  test('applyPayload preserves truncated total across stream reconnect replacement snapshots', async () => {
    const { eventBus } = await import('@/core/events');
    const manager = await seedScopeWithEntries(5);

    eventBus.emit('settings:obj-panel-logs-buffer-size', 3);

    let state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(3);
    expect(state.stats?.totalItems).toBe(5);

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 6,
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
          {
            timestamp: '2024-01-01T00:01:02Z',
            pod: 'pod-1',
            container: 'app',
            line: 'fresh-c',
            isInit: false,
          },
        ],
      },
      'stream'
    );

    state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(3);
    expect(state.data?.entries?.map((e) => e.line)).toEqual(['fresh-a', 'fresh-b', 'fresh-c']);
    expect(state.stats?.totalItems).toBe(5);

    eventBus.emit('settings:obj-panel-logs-buffer-size', 1000);
  });

  test('applyPayload appends when reset=false regardless of what was buffered', async () => {
    const manager = await seedScopeWithEntries(2);

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
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

    const state = getScopedDomainState('container-logs', SCOPE);
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
        domain: 'container-logs',
        scope: SCOPE,
        sequence: 1,
        generatedAt: 2_000,
        reset: true,
        entries: [],
      },
      'stream'
    );

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.sequence).toBe(5);
  });

  test('sequence advances normally on forward progress', async () => {
    const manager = await seedScopeWithEntries(2, 2);

    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
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

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.sequence).toBe(4);
  });

  // ---------------------------------------------------------------------
  // User-configurable buffer size. The manager subscribes to the
  // 'settings:obj-panel-logs-buffer-size' event in its constructor — shrinking the
  // size must retroactively trim existing buffers and push the update
  // to the scoped store so open LogViewers re-render; growing the size
  // must not disturb anything.
  // ---------------------------------------------------------------------

  const seedScopeWithNEntries = async (
    count: number
  ): Promise<
    InstanceType<typeof import('./containerLogsStreamManager').ContainerLogsStreamManager>
  > => {
    const { ContainerLogsStreamManager } = await import('./containerLogsStreamManager');
    const manager = new ContainerLogsStreamManager();
    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
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

  test('settings:obj-panel-logs-buffer-size event trims existing buffers when shrinking', async () => {
    const { eventBus } = await import('@/core/events');
    await seedScopeWithNEntries(50);

    // Baseline: all 50 entries in the store.
    expect(getScopedDomainState('container-logs', SCOPE).data?.entries).toHaveLength(50);

    // Shrink the buffer cap. The event is dispatched synchronously, so
    // the store update should be visible immediately after emit.
    eventBus.emit('settings:obj-panel-logs-buffer-size', 20);

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(20);
    // The trim must keep the TAIL (newest entries), not the head.
    expect(state.data?.entries?.[0].line).toBe('line-30');
    expect(state.data?.entries?.[19].line).toBe('line-49');
    expect(state.stats?.truncated).toBe(true);
  });

  test('settings:obj-panel-logs-buffer-size event leaves smaller buffers untouched when growing', async () => {
    const { eventBus } = await import('@/core/events');
    await seedScopeWithNEntries(10);

    const before = getScopedDomainState('container-logs', SCOPE).data?.entries;
    expect(before).toHaveLength(10);

    eventBus.emit('settings:obj-panel-logs-buffer-size', 5000);

    // No change — the existing buffer is smaller than the new cap.
    const after = getScopedDomainState('container-logs', SCOPE).data?.entries;
    expect(after).toHaveLength(10);
    expect(after?.map((e) => e.line)).toEqual(before?.map((e) => e.line));
  });

  test('settings:obj-panel-logs-buffer-size event clamps subsequent applyPayload truncation', async () => {
    const { eventBus } = await import('@/core/events');
    const manager = await seedScopeWithNEntries(5);

    // Tighten the cap to 10. The existing 5 entries aren't touched.
    eventBus.emit('settings:obj-panel-logs-buffer-size', 10);

    // Send a payload large enough to exceed the new cap. applyPayload
    // must honor the updated cap, not the old default.
    manager.applyPayload(
      SCOPE,
      {
        domain: 'container-logs',
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

    const state = getScopedDomainState('container-logs', SCOPE);
    expect(state.data?.entries).toHaveLength(10);
    expect(state.stats?.truncated).toBe(true);
  });
});
