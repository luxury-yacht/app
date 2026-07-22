import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { createWailsRuntimeHarness } from '@/test-utils/wailsRuntimeHarness';
import { ClusterWorkspaceStore, type ClusterWorkspaceWireState } from './clusterWorkspaceStore';

const emptyState = (): ClusterWorkspaceWireState => ({
  selectedKubeconfigs: [],
  visibleClusterId: '',
  clusters: {},
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClusterWorkspaceStore', () => {
  it('emits lifecycle only when an authoritative read changes the state', async () => {
    const workspaceState = (lifecycle: 'ready' | 'loading'): ClusterWorkspaceWireState => ({
      ...emptyState(),
      clusters: {
        'cluster-a': {
          clusterId: 'cluster-a',
          clusterName: 'Alpha',
          lifecycle,
          auth: { state: 'valid' },
          health: 'healthy',
          scopeRevision: 1,
        },
      },
    });
    const read = vi
      .fn<() => Promise<ClusterWorkspaceWireState>>()
      .mockResolvedValueOnce(workspaceState('ready'))
      .mockResolvedValueOnce(workspaceState('ready'))
      .mockResolvedValueOnce(workspaceState('loading'));
    const lifecycleEvents: string[] = [];
    const unsubscribe = eventBus.on('cluster:lifecycle', ({ state }) =>
      lifecycleEvents.push(state)
    );
    const store = new ClusterWorkspaceStore({ read, runtime: () => undefined });
    const release = store.acquire();

    await store.hydrate();
    expect(lifecycleEvents).toEqual(['ready']);

    await store.refresh();
    expect(lifecycleEvents).toEqual(['ready']);

    await store.refresh();
    expect(lifecycleEvents).toEqual(['ready', 'loading']);

    release();
    unsubscribe();
  });

  it('continues notifying subscribers after one subscriber throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new ClusterWorkspaceStore({
      read: async () => emptyState(),
      runtime: () => undefined,
    });
    store.subscribe(() => {
      throw new Error('broken subscriber');
    });
    const laterSubscriber = vi.fn();
    store.subscribe(laterSubscriber);

    expect(() => store.applyWireState(emptyState())).not.toThrow();
    expect(laterSubscriber).toHaveBeenCalledOnce();
  });

  it('continues registering workspace events when one runtime subscription throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registered: string[] = [];
    const runtime: WailsRuntime = {
      EventsOn: (eventName) => {
        registered.push(eventName);
        if (eventName === 'cluster:lifecycle') {
          throw new Error('lifecycle subscription failed');
        }
        return () => undefined;
      },
    };
    const store = new ClusterWorkspaceStore({
      read: async () => emptyState(),
      runtime: () => runtime,
    });

    let release: (() => void) | undefined;
    expect(() => {
      release = store.acquire();
    }).not.toThrow();
    await store.hydrate();

    expect(registered).toContain('cluster:auth:failed');
    release?.();
  });

  it('runs every runtime disposer when one disposer throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const disposed: string[] = [];
    const runtime: WailsRuntime = {
      EventsOn: (eventName) => () => {
        if (eventName === 'cluster:lifecycle') {
          throw new Error('lifecycle disposer failed');
        }
        disposed.push(eventName);
      },
    };
    const store = new ClusterWorkspaceStore({
      read: async () => emptyState(),
      runtime: () => runtime,
    });
    const release = store.acquire();
    await store.hydrate();

    expect(release).not.toThrow();
    expect(disposed).toContain('cluster:auth:failed');
    expect(store.getSnapshot().visibleClusterId).toBe('');
    expect(store.getSnapshot().clusters.size).toBe(0);
  });

  it('keeps subscriptions and state until the last owner releases', async () => {
    const runtime = createWailsRuntimeHarness();
    const store = new ClusterWorkspaceStore({
      read: async () => ({
        ...emptyState(),
        visibleClusterId: 'cluster-a',
      }),
      runtime: () => runtime.runtime,
    });
    const releaseFirst = store.acquire();
    const releaseSecond = store.acquire();
    await store.hydrate();

    releaseFirst();
    expect(runtime.listenerCount('cluster:lifecycle')).toBe(1);
    expect(store.getSnapshot().visibleClusterId).toBe('cluster-a');

    releaseSecond();
    expect(runtime.listenerCount('cluster:lifecycle')).toBe(0);
    expect(store.getSnapshot().visibleClusterId).toBe('');
  });

  it('retains live state after hydration failure and heals on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = createWailsRuntimeHarness();
    const read = vi
      .fn<() => Promise<ClusterWorkspaceWireState>>()
      .mockRejectedValueOnce(new Error('workspace unavailable'))
      .mockResolvedValueOnce({
        ...emptyState(),
        clusters: {
          'cluster-a': {
            clusterId: 'cluster-a',
            clusterName: 'Alpha',
            lifecycle: 'ready',
            auth: { state: 'valid' },
            health: 'healthy',
            scopeRevision: 1,
          },
        },
      });
    const store = new ClusterWorkspaceStore({ read, runtime: () => runtime.runtime });
    const release = store.acquire();

    await expect(store.hydrate()).rejects.toThrow('workspace unavailable');
    runtime.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    expect(store.getCluster('cluster-a')?.lifecycle).toBe('loading');

    await store.refresh();
    expect(store.getCluster('cluster-a')?.lifecycle).toBe('ready');
    release();
  });

  it('subscribes before hydration and keeps a newer lifecycle event', async () => {
    let resolveHydration: (state: ClusterWorkspaceWireState) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<ClusterWorkspaceWireState>((resolve) => {
          resolveHydration = resolve;
        })
    );
    const runtime = createWailsRuntimeHarness();
    const store = new ClusterWorkspaceStore({ read, runtime: () => runtime.runtime });

    const release = store.acquire();
    expect(runtime.listenerCount('cluster:lifecycle')).toBe(1);
    runtime.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    resolveHydration({
      ...emptyState(),
      clusters: {
        'cluster-a': {
          clusterId: 'cluster-a',
          clusterName: 'Alpha',
          lifecycle: 'connecting',
          auth: { state: 'unknown' },
          health: 'unknown',
          scopeRevision: 0,
        },
      },
    });
    await Promise.resolve();

    expect(store.getCluster('cluster-a')?.lifecycle).toBe('loading');
    release();
  });

  it('lets a later refresh heal a lifecycle field changed before that refresh began', async () => {
    const runtime = createWailsRuntimeHarness();
    const read = vi
      .fn<() => Promise<ClusterWorkspaceWireState>>()
      .mockResolvedValueOnce({
        ...emptyState(),
        clusters: {
          'cluster-a': {
            clusterId: 'cluster-a',
            clusterName: 'Alpha',
            lifecycle: 'connecting',
            auth: { state: 'unknown' },
            health: 'unknown',
            scopeRevision: 0,
          },
        },
      })
      .mockResolvedValueOnce({
        ...emptyState(),
        clusters: {
          'cluster-a': {
            clusterId: 'cluster-a',
            clusterName: 'Alpha',
            lifecycle: 'ready',
            auth: { state: 'valid' },
            health: 'healthy',
            scopeRevision: 2,
          },
        },
      });
    const store = new ClusterWorkspaceStore({ read, runtime: () => runtime.runtime });

    const release = store.acquire();
    await store.hydrate();
    runtime.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    runtime.emit('cluster:auth:failed', { clusterId: 'cluster-a', reason: 'stale token' });
    runtime.emit('cluster:health:degraded', { clusterId: 'cluster-a' });
    runtime.emit('cluster:scope:changed', { clusterId: 'cluster-a' });
    await store.refresh();

    expect(store.getCluster('cluster-a')).toMatchObject({
      lifecycle: 'ready',
      auth: { hasError: false },
      health: 'healthy',
      scopeRevision: 2,
    });
    release();
  });

  it('does not let an earlier refresh overwrite a later refresh that resolved first', async () => {
    let readCount = 0;
    let resolveEarlier: (state: ClusterWorkspaceWireState) => void = () => undefined;
    let resolveLater: (state: ClusterWorkspaceWireState) => void = () => undefined;
    const read = vi.fn(() => {
      readCount++;
      if (readCount === 1) {
        return Promise.resolve(emptyState());
      }
      return new Promise<ClusterWorkspaceWireState>((resolve) => {
        if (readCount === 2) {
          resolveEarlier = resolve;
        } else {
          resolveLater = resolve;
        }
      });
    });
    const store = new ClusterWorkspaceStore({ read, runtime: () => undefined });
    const release = store.acquire();
    await store.hydrate();

    const earlier = store.refresh();
    const later = store.refresh();
    resolveLater({
      ...emptyState(),
      selectedKubeconfigs: ['later'],
      visibleClusterId: 'cluster-later',
    });
    await later;
    resolveEarlier({
      ...emptyState(),
      selectedKubeconfigs: ['earlier'],
      visibleClusterId: 'cluster-earlier',
    });
    await earlier;

    expect(store.getSnapshot()).toMatchObject({
      selectedKubeconfigs: ['later'],
      visibleClusterId: 'cluster-later',
    });
    release();
  });

  it('does not carry live markers across authoritative removal and re-addition', async () => {
    const runtime = createWailsRuntimeHarness();
    const read = vi
      .fn<() => Promise<ClusterWorkspaceWireState>>()
      .mockResolvedValueOnce({
        ...emptyState(),
        clusters: {
          'cluster-a': {
            clusterId: 'cluster-a',
            clusterName: 'Alpha',
            lifecycle: 'connecting',
            auth: { state: 'unknown' },
            health: 'unknown',
            scopeRevision: 0,
          },
        },
      })
      .mockResolvedValueOnce({
        ...emptyState(),
        clusters: {
          'cluster-a': {
            clusterId: 'cluster-a',
            clusterName: 'Alpha',
            lifecycle: 'ready',
            auth: { state: 'valid' },
            health: 'healthy',
            scopeRevision: 1,
          },
        },
      });
    const store = new ClusterWorkspaceStore({ read, runtime: () => runtime.runtime });

    const release = store.acquire();
    await store.hydrate();
    runtime.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    runtime.emit('cluster:auth:failed', { clusterId: 'cluster-a', reason: 'stale token' });
    runtime.emit('cluster:health:degraded', { clusterId: 'cluster-a' });
    runtime.emit('cluster:scope:changed', { clusterId: 'cluster-a' });
    store.applyWireState(emptyState());
    await store.refresh();

    expect(store.getCluster('cluster-a')).toMatchObject({
      lifecycle: 'ready',
      auth: { hasError: false },
      health: 'healthy',
      scopeRevision: 1,
    });
    release();
  });

  it('ignores a hydration response started before an authoritative snapshot', async () => {
    let resolveHydration: (state: ClusterWorkspaceWireState) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<ClusterWorkspaceWireState>((resolve) => {
          resolveHydration = resolve;
        })
    );
    const store = new ClusterWorkspaceStore({ read, runtime: () => undefined });

    const release = store.acquire();
    const hydration = store.hydrate();
    store.applyWireState(emptyState());
    resolveHydration({
      ...emptyState(),
      clusters: {
        'removed-cluster': {
          clusterId: 'removed-cluster',
          clusterName: 'Removed',
          lifecycle: 'ready',
          auth: { state: 'valid' },
          health: 'healthy',
          scopeRevision: 1,
        },
      },
    });
    await hydration;

    expect(store.getCluster('removed-cluster')).toBeUndefined();
    release();
  });

  it('tracks auth, health, and scope changes independently per cluster', async () => {
    const runtime = createWailsRuntimeHarness();
    const store = new ClusterWorkspaceStore({
      read: async () => emptyState(),
      runtime: () => runtime.runtime,
    });
    const release = store.acquire();
    await Promise.resolve();

    runtime.emit('cluster:auth:failed', { clusterId: 'cluster-a', reason: 'expired' });
    runtime.emit('cluster:health:degraded', { clusterId: 'cluster-b' });
    runtime.emit('cluster:scope:changed', { clusterId: 'cluster-a' });

    expect(store.getCluster('cluster-a')?.auth.reason).toBe('expired');
    expect(store.getCluster('cluster-a')?.scopeRevision).toBe(1);
    expect(store.getCluster('cluster-b')?.health).toBe('degraded');
    expect(store.getCluster('cluster-b')?.auth.hasError).toBe(false);
    release();
  });

  it('holds foreground dispatch until activation ends', async () => {
    const store = new ClusterWorkspaceStore({
      read: async () => emptyState(),
      runtime: () => undefined,
    });
    store.applyWireState({
      ...emptyState(),
      clusters: {
        'cluster-a': {
          clusterId: 'cluster-a',
          clusterName: 'Alpha',
          lifecycle: 'ready',
          auth: { state: 'valid' },
          health: 'healthy',
          scopeRevision: 0,
        },
      },
    });

    expect(store.isServiceable('cluster-a')).toBe(true);
    store.beginForegroundActivation('cluster-a');
    expect(store.isServiceable('cluster-a')).toBe(false);
    store.endForegroundActivation('cluster-a');
    expect(store.isServiceable('cluster-a')).toBe(true);
  });
});
