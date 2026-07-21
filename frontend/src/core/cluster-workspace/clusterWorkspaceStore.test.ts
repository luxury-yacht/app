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
