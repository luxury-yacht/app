import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshManager } from '@/core/refresh';
import type { RefresherName } from '@/core/refresh/refresherTypes';
import type { RefreshCallback, RefreshContext, Refresher } from '@/core/refresh';
import { eventBus } from '@/core/events';

const TEST_REFRESHER = 'object-test' as RefresherName;

type UnsafeRefreshManager = {
  emitStateChange: (name: RefresherName) => void;
  startRefresher: (name: RefresherName) => void;
  refreshSingle: (name: RefresherName, isManual: boolean) => Promise<void>;
  getManualRefreshTargets: (previous: RefreshContext, current: RefreshContext) => RefresherName[];
  didObjectPanelTargetChange: (previous: RefreshContext, current: RefreshContext) => boolean;
  getObjectPanelRefresherTargets: (context: RefreshContext) => RefresherName[];
  getRefresherTargetsForContext: (context: RefreshContext) => RefresherName[];
  abortRefresher: (name: RefresherName) => void;
  pauseRefresher: (name: RefresherName, instance: unknown) => void;
  resumeRefresher: (name: RefresherName, instance: unknown) => void;
  clearTimers: (instance: unknown) => void;
  refreshers: Map<RefresherName, any>;
  subscribers: Map<RefresherName, Set<RefreshCallback>>;
  isGloballyPaused: boolean;
};

const unsafeRefreshManager = refreshManager as unknown as UnsafeRefreshManager;

describe('RefreshManager manual refresh flow', () => {
  const callback = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    refreshManager.register({
      name: TEST_REFRESHER,
      interval: 10_000,
      cooldown: 5_000,
      timeout: 2,
      resource: 'object-test-resource',
      enabled: false,
    });
    refreshManager.subscribe(TEST_REFRESHER, callback);
  });

  afterEach(() => {
    refreshManager.unregister(TEST_REFRESHER);
    callback.mockReset();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('executes subscribers during manual refresh and respects cooldown', async () => {
    await refreshManager.triggerManualRefresh(TEST_REFRESHER);

    expect(callback).toHaveBeenCalledTimes(1);
    const [isManual, signal] = callback.mock.calls[0];
    expect(isManual).toBe(true);
    expect(signal).toBeInstanceOf(AbortSignal);

    expect(refreshManager.getState(TEST_REFRESHER)?.status).toBe('cooldown');

    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshManager.getState(TEST_REFRESHER)?.status).toBe('disabled');
  });
});

describe('RefreshManager scheduling and state handling', () => {
  const AUTO_NAME = 'workloads' as RefresherName;

  beforeEach(() => {
    refreshManager.unregister(AUTO_NAME);
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    refreshManager.unregister(AUTO_NAME);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('performs scheduled refresh cycles and updates cooldown/idle state', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    refreshManager.register({
      name: AUTO_NAME,
      interval: 1_000,
      cooldown: 300,
      timeout: 2,
      resource: 'ns-workloads',
    });
    refreshManager.subscribe(AUTO_NAME, callback);

    await refreshManager.triggerManualRefresh(AUTO_NAME);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(refreshManager.getState(AUTO_NAME)?.status).toBe('cooldown');

    await vi.advanceTimersByTimeAsync(300);
    expect(refreshManager.getState(AUTO_NAME)?.status).toBe('idle');

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(refreshManager.getState(AUTO_NAME)?.status).toBe('cooldown');

    await vi.advanceTimersByTimeAsync(300);
    expect(refreshManager.getState(AUTO_NAME)?.status).toBe('idle');
  });

  it('records errors and increments consecutive error counts', async () => {
    vi.useFakeTimers();
    const failingCallback = vi.fn(() => {
      throw new Error('boom');
    });

    refreshManager.register({
      name: AUTO_NAME,
      interval: 1_000,
      cooldown: 250,
      timeout: 2,
      resource: 'ns-workloads',
    });
    refreshManager.subscribe(AUTO_NAME, failingCallback);

    await refreshManager.triggerManualRefresh(AUTO_NAME).catch(() => {});

    const stateAfterFailure = refreshManager.getState(AUTO_NAME)!;
    expect(stateAfterFailure.status).toBe('cooldown');
    expect(stateAfterFailure.error?.message).toBe('boom');
    expect(stateAfterFailure.consecutiveErrors).toBe(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(refreshManager.getState(AUTO_NAME)?.status).toBe('idle');
  });
});

describe('RefreshManager registration lifecycle', () => {
  const NAME = 'config' as RefresherName;

  beforeEach(() => {
    refreshManager.unregister(NAME);
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    refreshManager.unregister(NAME);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('preserves subscribers when re-registering an existing refresher', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const subscriber = vi.fn();

    refreshManager.register({
      name: NAME,
      interval: 500,
      cooldown: 200,
      timeout: 2,
      resource: 'ns-config',
    });
    refreshManager.subscribe(NAME, subscriber);

    refreshManager.register({
      name: NAME,
      interval: 400,
      cooldown: 150,
      timeout: 2,
      resource: 'ns-config',
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));

    const callsBeforeManual = subscriber.mock.calls.length;
    await refreshManager.triggerManualRefresh(NAME);
    expect(subscriber.mock.calls.length).toBe(callsBeforeManual + 1);
  });
});

describe('RefreshManager pause/resume behaviour', () => {
  const NAME = 'network' as RefresherName;

  beforeEach(() => {
    refreshManager.unregister(NAME);
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    refreshManager.unregister(NAME);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('pauses and resumes all refreshers respecting global pause flag', async () => {
    vi.useFakeTimers();
    const subscriber = vi.fn();

    refreshManager.subscribe(NAME, subscriber);

    refreshManager.register({
      name: NAME,
      interval: 800,
      cooldown: 200,
      timeout: 2,
      resource: 'ns-network',
    });

    refreshManager.pause();
    expect(refreshManager.getState(NAME)?.status).toBe('paused');

    refreshManager.resume();
    expect(refreshManager.getState(NAME)?.status).toBe('idle');

    const callsBeforeManual = subscriber.mock.calls.length;

    await refreshManager.triggerManualRefresh(NAME);
    expect(subscriber.mock.calls.length).toBe(callsBeforeManual + 1);
    expect(refreshManager.getState(NAME)?.status).toBe('cooldown');

    await vi.advanceTimersByTimeAsync(200);
    expect(refreshManager.getState(NAME)?.status).toBe('idle');

    await vi.advanceTimersByTimeAsync(800);
    await Promise.resolve();
    expect(subscriber.mock.calls.length).toBe(callsBeforeManual + 2);
    expect(refreshManager.getState(NAME)?.status).toBe('cooldown');
  });
});

describe('RefreshManager context updates', () => {
  const NAME = 'workloads' as RefresherName;

  beforeEach(() => {
    refreshManager.unregister(NAME);
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    refreshManager.unregister(NAME);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aborts running refreshers and triggers manual refresh for namespace switches', async () => {
    vi.useFakeTimers();
    const manualSpy = vi.spyOn(refreshManager, 'triggerManualRefreshMany').mockResolvedValue();
    const abortSpy = vi.spyOn(
      refreshManager as unknown as { abortRefresher: (name: RefresherName) => void },
      'abortRefresher'
    );

    refreshManager.register({
      name: NAME,
      interval: 1_000,
      cooldown: 200,
      timeout: 2,
      resource: 'ns-workloads',
    });

    refreshManager.updateContext({
      activeNamespaceView: 'workloads',
      selectedNamespace: 'team-a',
    });

    await Promise.resolve();
    expect(abortSpy).toHaveBeenCalledWith(NAME);
    expect(manualSpy).toHaveBeenCalledWith(expect.arrayContaining([NAME]));
  });
});

describe('RefreshManager global controls', () => {
  const CANCEL_NAME = 'namespace-quotas' as RefresherName;
  const OBJECT_MAIN = 'object-pod' as RefresherName;
  const OBJECT_EVENTS = 'object-pod-events' as RefresherName;
  const NAMESPACE_WORKLOADS = 'workloads' as RefresherName;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    refreshManager.unregister(CANCEL_NAME);
    refreshManager.unregister(OBJECT_MAIN);
    refreshManager.unregister(OBJECT_EVENTS);
    refreshManager.unregister(NAMESPACE_WORKLOADS);
    refreshManager.cancelAllRefreshes();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('cancels active refreshes and clears timers via cancelAllRefreshes', async () => {
    vi.useFakeTimers();
    const subscriber = vi.fn();

    refreshManager.register({
      name: CANCEL_NAME,
      interval: 800,
      cooldown: 200,
      timeout: 2,
      resource: 'ns-quotas',
    });
    refreshManager.subscribe(CANCEL_NAME, subscriber);

    await refreshManager.triggerManualRefresh(CANCEL_NAME);
    expect(subscriber).toHaveBeenCalledTimes(1);

    refreshManager.cancelAllRefreshes();
    subscriber.mockClear();

    await vi.advanceTimersByTimeAsync(1_600);
    expect(subscriber).not.toHaveBeenCalled();
    expect(refreshManager.getState(CANCEL_NAME)?.status).toBe('idle');

    await refreshManager.triggerManualRefresh(CANCEL_NAME);
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(refreshManager.getState(CANCEL_NAME)?.status).toBe('cooldown');
  });

  it('triggers manual refreshes for context-driven targets including object panels', async () => {
    vi.useFakeTimers();
    const nsSubscriber = vi.fn();
    const objectSubscriber = vi.fn();
    const objectEventsSubscriber = vi.fn();

    refreshManager.register({
      name: NAMESPACE_WORKLOADS,
      interval: 1_000,
      cooldown: 300,
      timeout: 2,
      resource: 'ns-workloads',
    });
    refreshManager.register({
      name: OBJECT_MAIN,
      interval: 1_000,
      cooldown: 300,
      timeout: 2,
      resource: 'object-Pod',
    });
    refreshManager.register({
      name: OBJECT_EVENTS,
      interval: 1_000,
      cooldown: 300,
      timeout: 2,
      resource: 'object-Pod-events',
    });

    refreshManager.subscribe(NAMESPACE_WORKLOADS, nsSubscriber);
    refreshManager.subscribe(OBJECT_MAIN, objectSubscriber);
    refreshManager.subscribe(OBJECT_EVENTS, objectEventsSubscriber);

    await Promise.resolve();
    nsSubscriber.mockClear();
    objectSubscriber.mockClear();
    objectEventsSubscriber.mockClear();

    await refreshManager.triggerManualRefreshForContext({
      currentView: 'namespace',
      activeNamespaceView: 'workloads',
      selectedNamespace: 'team-a',
      objectPanel: {
        isOpen: true,
        objectKind: 'Pod',
        objectName: 'api',
        objectNamespace: 'team-a',
      },
    });

    await Promise.resolve();

    expect(nsSubscriber).toHaveBeenCalledTimes(1);
    expect(objectSubscriber).toHaveBeenCalledTimes(1);
    expect(objectEventsSubscriber).toHaveBeenCalledTimes(1);

    expect(refreshManager.getState(NAMESPACE_WORKLOADS)?.status).toBe('cooldown');
    expect(refreshManager.getState(OBJECT_MAIN)?.status).toBe('cooldown');
    expect(refreshManager.getState(OBJECT_EVENTS)?.status).toBe('cooldown');
  });

  it('deduplicates manual refresh targets when triggering multiple refreshes', async () => {
    vi.useFakeTimers();
    const duplicateName = 'namespace-storage' as RefresherName;
    const subscriber = vi.fn();

    refreshManager.register({
      name: duplicateName,
      interval: 600,
      cooldown: 200,
      timeout: 2,
      resource: 'ns-storage',
    });
    refreshManager.subscribe(duplicateName, subscriber);

    await refreshManager.triggerManualRefreshMany([duplicateName, duplicateName]);
    expect(subscriber).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(600);

    refreshManager.unregister(duplicateName);
    vi.useRealTimers();
  });

  it('respects the global pause flag when enabling disabled refreshers', () => {
    const pausedName = 'namespace-network' as RefresherName;

    refreshManager.register({
      name: pausedName,
      interval: 700,
      cooldown: 250,
      timeout: 2,
      resource: 'ns-network',
      enabled: false,
    });

    refreshManager.pause();
    refreshManager.enable(pausedName);

    expect(refreshManager.getState(pausedName)?.status).toBe('paused');

    refreshManager.resume();
    refreshManager.unregister(pausedName);
  });

  it('maps cluster context to the appropriate refreshers', async () => {
    const manualSpy = vi
      .spyOn(refreshManager, 'triggerManualRefreshMany')
      .mockResolvedValue(undefined as unknown as void);

    await refreshManager.triggerManualRefreshForContext({
      currentView: 'cluster',
      activeClusterView: 'events',
      objectPanel: { isOpen: false },
    });

    expect(manualSpy).toHaveBeenCalledWith(expect.arrayContaining(['cluster-events']));
    manualSpy.mockRestore();
  });

  it('exposes refresher intervals and ignores redundant disable calls', () => {
    const intervalName = 'namespace-custom' as RefresherName;

    refreshManager.register({
      name: intervalName,
      interval: 900,
      cooldown: 300,
      timeout: 2,
      resource: 'ns-custom',
    });

    expect(refreshManager.getRefresherInterval(intervalName)).toBe(900);

    refreshManager.disable(intervalName);
    const stateAfterDisable = refreshManager.getState(intervalName);
    expect(stateAfterDisable?.status).toBe('disabled');

    refreshManager.disable(intervalName);
    expect(refreshManager.getState(intervalName)?.status).toBe('disabled');

    refreshManager.unregister(intervalName);
  });
});

describe('RefreshManager pause and cancellation integration', () => {
  const NAME = 'namespace-actions' as RefresherName;

  afterEach(() => {
    refreshManager.unregister(NAME);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cancels in-flight refreshes when kubeconfig changes', async () => {
    vi.useFakeTimers();
    const emitSpy = vi.spyOn(eventBus, 'emit');

    refreshManager.register({
      name: NAME,
      interval: 1_000,
      cooldown: 100,
      timeout: 2,
      resource: 'ns-actions',
    });

    await Promise.resolve();

    const refreshPromise = refreshManager.triggerManualRefresh(NAME);
    await Promise.resolve();
    expect(refreshManager.getState(NAME)?.status).toBe('refreshing');

    eventBus.emit('kubeconfig:changing', '');
    await refreshPromise.catch(() => {});

    expect(refreshManager.getState(NAME)?.status).toBe('cooldown');
    expect(emitSpy.mock.calls.some(([event]) => event === 'refresh:state-change')).toBe(true);
    emitSpy.mockRestore();
  });

  it('pauses and resumes all refreshers without running timers while paused', async () => {
    vi.useFakeTimers();
    const emitSpy = vi.spyOn(eventBus, 'emit');
    const subscriber = vi.fn();

    refreshManager.register({
      name: NAME,
      interval: 500,
      cooldown: 0,
      timeout: 2,
      resource: 'ns-actions',
    });
    refreshManager.subscribe(NAME, subscriber);

    await Promise.resolve();
    subscriber.mockClear();
    emitSpy.mockClear();

    refreshManager.pause();
    expect(refreshManager.getState(NAME)?.status).toBe('paused');

    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(subscriber).not.toHaveBeenCalled();

    refreshManager.resume();
    expect(refreshManager.getState(NAME)?.status).toBe('idle');

    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(subscriber).toHaveBeenCalled();

    expect(emitSpy.mock.calls.some(([event]) => event === 'refresh:state-change')).toBe(true);

    emitSpy.mockRestore();
  });
});

describe('RefreshManager guard paths and helpers', () => {
  let counter = 0;

  const nextName = (prefix: string): RefresherName => `${prefix}-${counter++}` as RefresherName;

  const register = (prefix: string, overrides: Partial<Refresher> = {}): RefresherName => {
    const name = nextName(prefix);
    const config: Refresher = {
      name,
      interval: 200,
      cooldown: 100,
      timeout: 1,
      ...overrides,
    };
    refreshManager.register(config);
    return name;
  };

  afterEach(() => {
    refreshManager.cancelAllRefreshes();
    for (const key of Array.from(unsafeRefreshManager.refreshers.keys())) {
      refreshManager.unregister(key);
    }
    refreshManager.resume();
    counter = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('emits state change gracefully when window is undefined', () => {
    vi.stubGlobal('window', undefined as unknown as Window & typeof globalThis.window);
    expect(() =>
      unsafeRefreshManager.emitStateChange('missing-refresher' as RefresherName)
    ).not.toThrow();
  });

  it('startRefresher returns when no refresher is registered', () => {
    expect(() =>
      unsafeRefreshManager.startRefresher('ghost-refresher' as RefresherName)
    ).not.toThrow();
  });

  it('startRefresher marks disabled refreshers without scheduling timers', () => {
    const name = register('disabled', { enabled: false });
    const instance = unsafeRefreshManager.refreshers.get(name)!;

    unsafeRefreshManager.startRefresher(name);

    expect(instance.state.status).toBe('disabled');
    expect(instance.intervalTimer).toBeUndefined();
  });

  it('startRefresher respects the global pause flag', () => {
    const name = register('paused');
    refreshManager.pause();
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.intervalTimer = undefined;
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    unsafeRefreshManager.startRefresher(name);

    expect(instance.state.status).toBe('paused');
    expect(intervalSpy).not.toHaveBeenCalled();
    refreshManager.resume();
  });

  it('startRefresher clears existing intervals before creating a new one', () => {
    vi.useFakeTimers();
    const name = register('restart');
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    const previousInterval = instance.intervalTimer!;
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    unsafeRefreshManager.startRefresher(name);

    expect(clearSpy).toHaveBeenCalledWith(previousInterval);
    expect(instance.intervalTimer).not.toBe(previousInterval);
  });

  it('enable no-ops when the refresher is unknown', () => {
    const startSpy = vi.spyOn(unsafeRefreshManager, 'startRefresher');
    refreshManager.enable('missing' as RefresherName);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('enable restarts timers when an enabled refresher lacks an interval', () => {
    const name = register('enable');
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    const startSpy = vi.spyOn(unsafeRefreshManager, 'startRefresher');
    window.clearInterval(instance.intervalTimer!);
    instance.intervalTimer = undefined;

    refreshManager.enable(name);

    expect(startSpy).toHaveBeenCalledWith(name);
  });

  it('enable keeps refreshers paused when globally paused', () => {
    const name = register('resume-pause');
    refreshManager.pause();

    refreshManager.enable(name);

    expect(refreshManager.getState(name)?.status).toBe('paused');
    refreshManager.resume();
  });

  it('disable avoids redundant work for already disabled refreshers', () => {
    const name = register('disable', { enabled: false });
    refreshManager.disable(name);
    const clearSpy = vi.spyOn(unsafeRefreshManager, 'clearTimers');

    refreshManager.disable(name);

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('disable short circuits when the refresher remains disabled', () => {
    const name = register('disable-short', { enabled: false });
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.isEnabled = false;
    instance.state.status = 'disabled';
    const clearSpy = vi.spyOn(unsafeRefreshManager, 'clearTimers');

    expect(instance.isEnabled).toBe(false);
    expect(instance.state.status).toBe('disabled');
    expect(!instance.isEnabled && instance.state.status === 'disabled').toBe(true);

    refreshManager.disable(name);

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('short circuits disable for pre-disabled refreshers in the registry', () => {
    const name = nextName('synthetic-disable');
    const syntheticInstance = {
      config: { name, interval: 100, cooldown: 50, timeout: 1 },
      state: {
        status: 'disabled' as const,
        lastRefreshTime: null,
        nextRefreshTime: null,
        error: null,
        consecutiveErrors: 0,
      },
      intervalTimer: undefined,
      cooldownTimer: undefined,
      timeoutTimer: undefined,
      refreshPromise: undefined,
      abortController: undefined,
      isManualRefresh: false,
      isEnabled: false,
    };
    unsafeRefreshManager.refreshers.set(name, syntheticInstance as any);
    expect(unsafeRefreshManager.refreshers.has(name)).toBe(true);
    expect(refreshManager.getState(name)?.status).toBe('disabled');
    const clearSpy = vi.spyOn(unsafeRefreshManager, 'clearTimers');

    refreshManager.disable(name);

    expect(clearSpy).not.toHaveBeenCalled();
    unsafeRefreshManager.refreshers.delete(name);
  });

  it('removes subscriber entries when the last listener unsubscribes', () => {
    const name = register('subscription', { enabled: false });
    const unsubscribe = refreshManager.subscribe(name, vi.fn());
    expect(unsafeRefreshManager.subscribers.has(name)).toBe(true);

    unsubscribe();

    expect(unsafeRefreshManager.subscribers.has(name)).toBe(false);
  });

  it('detects namespace manual targets when the namespace changes', () => {
    const previous: RefreshContext = {
      currentView: 'namespace',
      activeNamespaceView: 'config',
      selectedNamespace: 'team-a',
      objectPanel: { isOpen: false },
    };
    const current: RefreshContext = {
      ...previous,
      selectedNamespace: 'team-b',
    };

    const manualTargets = unsafeRefreshManager.getManualRefreshTargets(previous, current);

    expect(manualTargets).toEqual(['config']);
  });

  it('omits cluster manual targets when the active cluster view becomes undefined', () => {
    const previous: RefreshContext = {
      currentView: 'cluster',
      activeClusterView: 'events',
      objectPanel: { isOpen: false },
    };
    const current: RefreshContext = {
      currentView: 'cluster',
      activeClusterView: undefined,
      objectPanel: { isOpen: false },
    };

    const manualTargets = unsafeRefreshManager.getManualRefreshTargets(previous, current);

    expect(manualTargets).toEqual([]);
  });

  it('skips manual refreshes when the cluster view is cleared', () => {
    const manualSpy = vi
      .spyOn(refreshManager, 'triggerManualRefreshMany')
      .mockResolvedValue(undefined as unknown as void);

    refreshManager.updateContext({
      currentView: 'cluster',
      activeClusterView: 'events',
      objectPanel: { isOpen: false },
    });

    manualSpy.mockClear();

    refreshManager.updateContext({
      activeClusterView: undefined,
    });

    expect(manualSpy).not.toHaveBeenCalled();
    manualSpy.mockRestore();

    refreshManager.updateContext({
      currentView: 'namespace',
      activeNamespaceView: undefined,
      activeClusterView: undefined,
      objectPanel: { isOpen: false },
    });
  });

  it('adds object panel refreshers when the panel target changes', () => {
    const previous: RefreshContext = {
      currentView: 'namespace',
      activeNamespaceView: 'workloads',
      selectedNamespace: 'team-a',
      objectPanel: {
        isOpen: true,
        objectKind: 'Pod',
        objectName: 'api',
        objectNamespace: 'team-a',
      },
    };
    const current: RefreshContext = {
      ...previous,
      objectPanel: {
        isOpen: true,
        objectKind: 'Deployment',
        objectName: 'web',
        objectNamespace: 'team-a',
      },
    };

    const manualTargets = unsafeRefreshManager.getManualRefreshTargets(previous, current);

    expect(manualTargets.sort()).toEqual(['object-deployment', 'object-deployment-events'].sort());
  });

  it('filters namespace aborts when switching views with object panel changes', async () => {
    const manualSpy = vi
      .spyOn(refreshManager, 'triggerManualRefreshMany')
      .mockResolvedValue(undefined as unknown as void);
    const abortSpy = vi.spyOn(unsafeRefreshManager, 'abortRefresher');

    refreshManager.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'workloads',
      selectedNamespace: 'team-a',
      objectPanel: {
        isOpen: true,
        objectKind: 'Pod',
        objectName: 'api',
        objectNamespace: 'team-a',
      },
    });

    abortSpy.mockClear();
    manualSpy.mockClear();

    refreshManager.updateContext({
      currentView: 'cluster',
      activeClusterView: 'events',
      objectPanel: {
        isOpen: true,
        objectKind: 'Deployment',
        objectName: 'web',
        objectNamespace: 'team-a',
      },
    });

    expect(abortSpy).not.toHaveBeenCalled();
    expect(manualSpy).toHaveBeenCalledWith(
      expect.arrayContaining(['cluster-events', 'object-deployment', 'object-deployment-events'])
    );

    manualSpy.mockRestore();
    abortSpy.mockRestore();

    refreshManager.updateContext({
      currentView: 'namespace',
      activeNamespaceView: undefined,
      activeClusterView: undefined,
      objectPanel: { isOpen: false },
    });
  });

  it('tracks object panel target changes across open and closed states', () => {
    const base: RefreshContext = {
      currentView: 'namespace',
      activeNamespaceView: 'network',
      selectedNamespace: 'team-a',
      objectPanel: {
        isOpen: false,
        objectKind: undefined,
        objectName: undefined,
        objectNamespace: undefined,
      },
    };

    expect(
      unsafeRefreshManager.didObjectPanelTargetChange(base, {
        ...base,
        objectPanel: { ...base.objectPanel, isOpen: false },
      })
    ).toBe(false);

    expect(
      unsafeRefreshManager.didObjectPanelTargetChange(base, {
        ...base,
        objectPanel: {
          isOpen: true,
          objectKind: 'Pod',
          objectName: 'api',
          objectNamespace: 'team-a',
        },
      })
    ).toBe(true);

    expect(
      unsafeRefreshManager.didObjectPanelTargetChange(
        {
          ...base,
          objectPanel: {
            isOpen: true,
            objectKind: 'Pod',
            objectName: 'api',
            objectNamespace: 'team-a',
          },
        },
        {
          ...base,
          objectPanel: {
            isOpen: true,
            objectKind: 'Pod',
            objectName: 'api',
            objectNamespace: 'team-b',
          },
        }
      )
    ).toBe(true);

    expect(
      unsafeRefreshManager.didObjectPanelTargetChange(
        {
          ...base,
          objectPanel: {
            isOpen: true,
            objectKind: 'Pod',
            objectName: 'api',
            objectNamespace: 'team-a',
          },
        },
        {
          ...base,
          objectPanel: {
            isOpen: false,
            objectKind: undefined,
            objectName: undefined,
            objectNamespace: undefined,
          },
        }
      )
    ).toBe(true);

    expect(
      unsafeRefreshManager.didObjectPanelTargetChange(
        {
          ...base,
          objectPanel: {
            isOpen: false,
            objectKind: 'Service',
            objectName: 'svc',
            objectNamespace: 'team-a',
          },
        },
        {
          ...base,
          objectPanel: {
            isOpen: false,
            objectKind: 'Service',
            objectName: 'svc',
            objectNamespace: 'team-a',
          },
        }
      )
    ).toBe(false);
  });

  it('derives object panel refresher targets only when the panel is open with a kind', () => {
    const closed: RefreshContext = {
      currentView: 'namespace',
      activeNamespaceView: 'config',
      selectedNamespace: 'team-a',
      objectPanel: { isOpen: false },
    };
    const open: RefreshContext = {
      ...closed,
      objectPanel: {
        isOpen: true,
        objectKind: 'Pod',
        objectName: 'api',
        objectNamespace: 'team-a',
      },
    };

    expect(unsafeRefreshManager.getObjectPanelRefresherTargets(closed)).toEqual([]);
    expect(unsafeRefreshManager.getObjectPanelRefresherTargets(open)).toEqual([
      'object-pod',
      'object-pod-events',
    ]);
  });

  it('collects refresher targets across namespace, cluster, overview, and object panel contexts', () => {
    const context: RefreshContext = {
      currentView: 'namespace',
      activeNamespaceView: 'workloads',
      activeClusterView: undefined,
      selectedNamespace: 'team-a',
      objectPanel: {
        isOpen: true,
        objectKind: 'Pod',
        objectName: 'api',
        objectNamespace: 'team-a',
      },
    };
    const namespaceTargets = unsafeRefreshManager.getRefresherTargetsForContext(context);
    expect(namespaceTargets.sort()).toEqual(
      ['workloads', 'object-pod', 'object-pod-events'].sort()
    );

    const clusterContext: RefreshContext = {
      ...context,
      currentView: 'cluster',
      activeNamespaceView: undefined,
      activeClusterView: 'events',
    };
    expect(unsafeRefreshManager.getRefresherTargetsForContext(clusterContext).sort()).toEqual(
      ['cluster-events', 'object-pod', 'object-pod-events'].sort()
    );

    const overviewContext: RefreshContext = {
      ...context,
      currentView: 'overview',
      activeNamespaceView: undefined,
      activeClusterView: undefined,
    };
    expect(unsafeRefreshManager.getRefresherTargetsForContext(overviewContext).sort()).toEqual(
      ['cluster-overview', 'object-pod', 'object-pod-events'].sort()
    );
  });

  it('returns null for unknown refresher intervals', () => {
    expect(refreshManager.getRefresherInterval('unknown' as RefresherName)).toBeNull();
  });

  it('returns null for unknown refresher state lookups', () => {
    expect(refreshManager.getState('ghost-state' as RefresherName)).toBeNull();
  });

  it('returns early when triggerManualRefreshForContext has no targets', async () => {
    const manualSpy = vi.spyOn(refreshManager, 'triggerManualRefreshMany');

    await refreshManager.triggerManualRefreshForContext({
      currentView: 'settings',
      objectPanel: { isOpen: false },
    } as RefreshContext);

    expect(manualSpy).not.toHaveBeenCalled();
  });

  it('uses the stored context when triggering manual refresh without parameters', async () => {
    refreshManager.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'config',
      selectedNamespace: 'team-b',
      objectPanel: { isOpen: false },
    });
    const manualSpy = vi
      .spyOn(refreshManager, 'triggerManualRefreshMany')
      .mockResolvedValue(undefined as unknown as void);

    await refreshManager.triggerManualRefreshForContext();

    expect(manualSpy).toHaveBeenCalledWith(expect.arrayContaining(['config']));

    manualSpy.mockRestore();
    refreshManager.updateContext({
      currentView: 'namespace',
      activeNamespaceView: undefined,
      selectedNamespace: undefined,
      objectPanel: { isOpen: false },
    });
  });

  it('pause(name) only pauses existing refreshers', () => {
    const name = register('named-pause', { enabled: true });
    refreshManager.pause(name);
    expect(refreshManager.getState(name)?.status).toBe('paused');

    expect(() => refreshManager.pause('absent-refresher' as RefresherName)).not.toThrow();
  });

  it('resume(name) skips refreshers that are not paused', () => {
    const name = register('resume-nonpaused');
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.state.status = 'idle';
    const resumeSpy = vi.spyOn(unsafeRefreshManager, 'resumeRefresher');

    refreshManager.resume(name);

    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it('resume(name) restarts paused refreshers', () => {
    const name = register('resume-paused');
    refreshManager.pause(name);
    const resumeSpy = vi.spyOn(unsafeRefreshManager, 'resumeRefresher');

    refreshManager.resume(name);

    expect(resumeSpy).toHaveBeenCalledWith(name, expect.any(Object));
    expect(refreshManager.getState(name)?.status).toBe('idle');
  });

  it('resume() starts idle refreshers that lack intervals', () => {
    const name = register('resume-all', { enabled: false });
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.isEnabled = true;
    instance.state.status = 'idle';
    instance.intervalTimer = undefined;
    const startSpy = vi.spyOn(unsafeRefreshManager, 'startRefresher');

    refreshManager.resume();

    expect(startSpy).toHaveBeenCalledWith(name);
  });

  it('resumeRefresher marks disabled refreshers when invoked directly', () => {
    const name = register('resume-disabled', { enabled: false });
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.isEnabled = false;

    unsafeRefreshManager.resumeRefresher(name, instance);

    expect(instance.state.status).toBe('disabled');
  });

  it('abortRefresher returns when attempting to abort unknown refreshers', () => {
    expect(() => unsafeRefreshManager.abortRefresher('nobody' as RefresherName)).not.toThrow();
  });

  it('refreshSingle returns immediately for unknown refreshers', async () => {
    await expect(
      unsafeRefreshManager.refreshSingle('shadow' as RefresherName, true)
    ).resolves.toBeUndefined();
  });

  it('refreshSingle skips disabled automatic refreshes', async () => {
    const name = register('auto-disabled', { enabled: false });
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.state.status = 'idle';

    await unsafeRefreshManager.refreshSingle(name, false);

    expect(instance.state.status).toBe('idle');
  });

  it('refreshSingle skips auto refreshes during global pause', async () => {
    const name = register('global-pause');
    refreshManager.pause();
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.state.status = 'paused';

    await unsafeRefreshManager.refreshSingle(name, false);

    expect(instance.state.status).toBe('paused');
    refreshManager.resume();
  });

  it('refreshSingle skips auto refreshes when the refresher is paused', async () => {
    const name = register('paused-state');
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.state.status = 'paused';

    await unsafeRefreshManager.refreshSingle(name, false);

    expect(instance.state.status).toBe('paused');
  });

  it('refreshSingle returns when an auto refresh collides with an in-flight refresh', async () => {
    const name = register('collision');
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.state.status = 'refreshing';
    instance.refreshPromise = Promise.resolve();

    await unsafeRefreshManager.refreshSingle(name, false);

    expect(instance.state.status).toBe('refreshing');
  });

  it('refreshSingle interrupts in-flight refreshes for manual triggers', async () => {
    vi.useFakeTimers();
    const name = register('manual-interrupt');
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.state.status = 'refreshing';
    instance.abortController = new AbortController();
    instance.refreshPromise = Promise.resolve();
    const subscriber = vi.fn();
    refreshManager.subscribe(name, subscriber);

    await unsafeRefreshManager.refreshSingle(name, true);
    await vi.advanceTimersByTimeAsync(100);

    expect(subscriber).toHaveBeenCalled();
    expect(refreshManager.getState(name)?.status).toBe('idle');
    refreshManager.disable(name);
    vi.clearAllTimers();
  });

  it('refreshSingle skips auto refreshes during cooldown', async () => {
    const name = register('cooldown-skip');
    const instance = unsafeRefreshManager.refreshers.get(name)!;
    instance.state.status = 'cooldown';

    await unsafeRefreshManager.refreshSingle(name, false);

    expect(instance.state.status).toBe('cooldown');
  });
});
