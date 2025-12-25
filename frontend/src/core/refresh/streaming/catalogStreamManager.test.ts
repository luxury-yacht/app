/**
 * frontend/src/core/refresh/streaming/catalogStreamManager.test.ts
 *
 * Tests for catalog stream manager.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { getDomainState, resetDomainState, setDomainState } from '../store';

class MockEventSource {
  static instances: MockEventSource[] = [];
  static reset(): void {
    MockEventSource.instances = [];
  }

  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public closed = false;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

const createSnapshot = () => ({
  items: [
    {
      kind: 'Deployment',
      group: 'apps',
      version: 'v1',
      resource: 'deployments',
      namespace: 'team-a',
      name: 'api',
      uid: 'uid-1',
      resourceVersion: '1',
      creationTimestamp: '2024-01-01T00:00:00Z',
      scope: 'Namespace' as const,
    },
  ],
  total: 1,
  resourceCount: 1,
  batchIndex: 0,
  batchSize: 1,
  totalBatches: 1,
  isFinal: true,
});

const createEmptySnapshot = () => ({
  items: [],
  total: 0,
  resourceCount: 0,
  batchIndex: 0,
  batchSize: 0,
  totalBatches: 0,
  isFinal: true,
});

const setupWindow = () => {
  if (!globalThis.window) {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      writable: true,
      configurable: true,
    });
  }

  Object.assign(globalThis.window, {
    addEventListener: globalThis.window.addEventListener ?? vi.fn(),
    removeEventListener: globalThis.window.removeEventListener ?? vi.fn(),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });

  Object.defineProperty(globalThis.window, 'EventSource', {
    value: MockEventSource,
    writable: true,
  });
  (globalThis as any).EventSource = MockEventSource as unknown as typeof EventSource;
};

const importManager = async () => {
  const module = await import('./catalogStreamManager');
  module.catalogStreamManager.stop(true);
  return module.catalogStreamManager;
};

describe('catalogStreamManager', () => {
  beforeEach(async () => {
    setupWindow();
    MockEventSource.reset();
    ensureRefreshBaseURLMock.mockReset();
    ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');
    errorHandlerMock.handle.mockReset();
    resetDomainState('catalog');
    const module = await import('./catalogStreamManager');
    module.catalogStreamManager.stop(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    MockEventSource.reset();
    resetDomainState('catalog');
  });

  it('opens an EventSource stream and applies snapshot payloads', async () => {
    const manager = await importManager();
    const cleanup = await manager.start(' limit=50 ');

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      'http://127.0.0.1:0/api/v2/stream/catalog?limit=50'
    );

    const snapshot = createSnapshot();

    MockEventSource.instances[0].onmessage?.({
      data: JSON.stringify({
        snapshot,
        stats: { itemCount: 1, buildDurationMs: 12 },
        reset: true,
        ready: true,
        generatedAt: 1700000000000,
      }),
    } as MessageEvent);

    await Promise.resolve();
    await Promise.resolve();

    const state = getDomainState('catalog');
    expect(state.status).toBe('ready');
    expect(state.data).toEqual(snapshot);
    expect(state.stats?.itemCount).toBe(1);
    expect(state.scope).toBe('limit=50');
    expect(state.error).toBeNull();

    cleanup();
  });

  it('resets state and closes the stream when stopped with reset', async () => {
    const manager = await importManager();
    await manager.start('limit=5');

    setDomainState('catalog', () => ({
      status: 'ready',
      data: createEmptySnapshot(),
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: 'limit=5',
    }));

    manager.stop(true);

    await Promise.resolve();

    const state = getDomainState('catalog');
    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it('retries with backoff when EventSource fails to initialise', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    ensureRefreshBaseURLMock
      .mockRejectedValueOnce(new Error('bootstrap failed'))
      .mockResolvedValue('http://127.0.0.1:0');

    const manager = await importManager();
    const cleanup = await manager.start('limit=10');

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'bootstrap failed' }),
      expect.objectContaining({ source: 'catalog-stream' })
    );
    expect(MockEventSource.instances).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('handles stream errors by notifying and scheduling reconnects', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const manager = await importManager();
    await manager.start('limit=25');

    errorHandlerMock.handle.mockReset();

    MockEventSource.instances[0].onerror?.(new Event('error'));
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Catalog stream connection lost' }),
      expect.objectContaining({
        source: 'catalog-stream',
        context: expect.objectContaining({ eventType: 'error', scope: 'limit=25' }),
      })
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockEventSource.instances.length).toBeGreaterThan(1);
  });

  it('captures JSON parse failures without interrupting the stream', async () => {
    const manager = await importManager();
    await manager.start('limit=5');

    errorHandlerMock.handle.mockReset();

    MockEventSource.instances[0].onmessage?.({ data: 'not-json' } as MessageEvent);

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: 'catalog-stream-parse' })
    );
  });

  it('refreshOnce restarts the stream with trimmed scope', async () => {
    const manager = await importManager();
    await manager.start('limit=20');

    MockEventSource.reset();

    await manager.refreshOnce(' continue=token ');

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      'http://127.0.0.1:0/api/v2/stream/catalog?continue=token'
    );
  });

  it('returns a no-op cleanup when window is unavailable', async () => {
    const manager = await importManager();
    const originalWindow = globalThis.window;
    // Remove window to exercise the early return branch.
    delete (globalThis as any).window;

    ensureRefreshBaseURLMock.mockClear();
    const cleanup = await manager.start('ignored');
    expect(typeof cleanup).toBe('function');
    expect(ensureRefreshBaseURLMock).not.toHaveBeenCalled();

    globalThis.window = originalWindow;
  });

  it('updates catalog state via Promise fallback when queueMicrotask is unavailable', async () => {
    const manager = await importManager();
    await manager.start('continue=token');

    setDomainState('catalog', () => ({
      status: 'ready',
      data: createSnapshot(),
      stats: { itemCount: 1, buildDurationMs: 10 },
      error: null,
      droppedAutoRefreshes: 0,
      scope: 'continue=token',
    }));

    const originalQueueMicrotask = globalThis.queueMicrotask;
    (globalThis as any).queueMicrotask = undefined;

    MockEventSource.instances[0].onmessage?.({
      data: JSON.stringify({
        snapshot: createSnapshot(),
        stats: { itemCount: 2, buildDurationMs: 15 },
        reset: true,
        ready: false,
        generatedAt: 1700000005000,
      }),
    } as MessageEvent);

    await Promise.resolve();
    await Promise.resolve();

    const state = getDomainState('catalog');
    expect(state.status).toBe('updating');
    expect(state.scope).toBe('continue=token');
    expect(state.stats?.itemCount).toBe(2);
    expect(state.lastUpdated).toBe(1700000005000);

    globalThis.queueMicrotask = originalQueueMicrotask;
  });

  it('suppresses error notifications immediately after kubeconfig changes', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const manager = await importManager();
    await manager.start('limit=25');

    errorHandlerMock.handle.mockReset();
    (manager as unknown as { suppressErrorsUntil: number }).suppressErrorsUntil = Date.now() + 5000;

    MockEventSource.instances[0].onerror?.(new Event('error'));
    expect(errorHandlerMock.handle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(2);
  });

  it('does not schedule duplicate reconnect timers while one is pending', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const manager = await importManager();
    await manager.start('limit=30');

    MockEventSource.instances[0].onerror?.(new Event('error'));
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    MockEventSource.instances[0].onerror?.(new Event('error'));
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(ensureRefreshBaseURLMock).toHaveBeenCalledTimes(2);
  });
});
