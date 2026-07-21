import { describe, expect, it, vi } from 'vitest';
import { createWailsRuntimeHarness } from '@/test-utils/wailsRuntimeHarness';
import { ClusterWorkspaceStore, type ClusterWorkspaceWireState } from './clusterWorkspaceStore';

const emptyState = (): ClusterWorkspaceWireState => ({
  selectedKubeconfigs: [],
  visibleClusterId: '',
  clusters: {},
});

describe('ClusterWorkspaceStore', () => {
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
