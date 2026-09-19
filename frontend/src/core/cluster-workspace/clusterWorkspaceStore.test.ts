import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { createWailsRuntimeHarness } from '@/test-utils/wailsRuntimeHarness';
import {
  ClusterWorkspaceStore,
  type ClusterWorkspaceWireState,
  isConfirmedAuthFailure,
} from './clusterWorkspaceStore';

const emptyState = (): ClusterWorkspaceWireState => ({
  selectedKubeconfigs: [],
  visibleClusterId: '',
  clusters: {},
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClusterWorkspaceStore', () => {
  it('preserves only fields changed during each overlapping read, including newly seen clusters', async () => {
    const runtime = createWailsRuntimeHarness();
    const replies: Array<(state: ClusterWorkspaceWireState) => void> = [];
    const store = new ClusterWorkspaceStore({
      read: () => new Promise((resolve) => replies.push(resolve)),
      onEvent: runtime.onEvent,
    });
    const release = store.acquire();
    try {
      const initial = store.hydrate();
      runtime.emit('cluster:auth:failed', { clusterId: 'cluster-a', reason: 'expired' });
      const later = store.refresh();
      runtime.emit('cluster:health:degraded', { clusterId: 'cluster-b' });
      runtime.emit('cluster:scope:changed', { clusterId: 'new-cluster' });
      const wire: ClusterWorkspaceWireState = {
        ...emptyState(),
        clusters: Object.fromEntries(
          ['cluster-a', 'cluster-b'].map((clusterId) => [
            clusterId,
            {
              clusterId,
              clusterName: clusterId,
              lifecycle: 'ready',
              auth: { state: 'valid' },
              health: 'healthy',
              scopeRevision: 4,
            },
          ])
        ),
      };

      replies[0](wire);
      await initial;
      expect(store.getCluster('cluster-a')).toMatchObject({
        auth: { hasError: true, reason: 'expired' },
        health: 'healthy',
        scopeRevision: 4,
      });
      expect(store.getCluster('cluster-b')).toMatchObject({
        auth: { hasError: false },
        health: 'degraded',
        scopeRevision: 4,
      });
      expect(store.getCluster('new-cluster')?.scopeRevision).toBe(1);

      replies[1](wire);
      await later;
      expect(store.getAuth('cluster-a').hasError).toBe(false);
      expect(store.getHealth('cluster-b')).toBe('degraded');
      expect(store.getCluster('new-cluster')?.scopeRevision).toBe(1);
    } finally {
      release();
    }
  });

  it('bridges permission recovery without changing namespace scope revisions', async () => {
    const runtime = createWailsRuntimeHarness();
    const store = new ClusterWorkspaceStore({
      read: async () => emptyState(),
      onEvent: runtime.onEvent,
    });
    const changed = vi.fn();
    const unsubscribe = eventBus.on('cluster:permissions-changed', changed);
    const release = store.acquire();
    try {
      await store.hydrate();
      const before = store.getSnapshot();
      runtime.emit('cluster:permissions:changed', { clusterId: 'cluster-a' });
      expect(changed).toHaveBeenCalledExactlyOnceWith({ clusterId: 'cluster-a' });
      expect(store.getSnapshot()).toBe(before);
      runtime.emit('cluster:permissions:changed', { clusterId: '' });
      expect(changed).toHaveBeenCalledOnce();
    } finally {
      release();
      unsubscribe();
    }
  });

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
    const store = new ClusterWorkspaceStore({ read, onEvent: () => () => undefined });
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
      onEvent: () => () => undefined,
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
    const subscribe = (eventName: string) => {
      registered.push(eventName);
      if (eventName === 'cluster:lifecycle') {
        throw new Error('lifecycle subscription failed');
      }
      return () => undefined;
    };
    const store = new ClusterWorkspaceStore({
      read: async () => emptyState(),
      onEvent: subscribe,
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
    const subscribe = (eventName: string) => () => {
      if (eventName === 'cluster:lifecycle') {
        throw new Error('lifecycle disposer failed');
      }
      disposed.push(eventName);
    };
    const store = new ClusterWorkspaceStore({
      read: async () => emptyState(),
      onEvent: subscribe,
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
      onEvent: runtime.onEvent,
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
    const store = new ClusterWorkspaceStore({ read, onEvent: runtime.onEvent });
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
    const store = new ClusterWorkspaceStore({ read, onEvent: runtime.onEvent });

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
    const store = new ClusterWorkspaceStore({ read, onEvent: runtime.onEvent });

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
    const store = new ClusterWorkspaceStore({ read, onEvent: () => () => undefined });
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
    const store = new ClusterWorkspaceStore({ read, onEvent: runtime.onEvent });

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
    const store = new ClusterWorkspaceStore({ read, onEvent: () => () => undefined });

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
      onEvent: runtime.onEvent,
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
      onEvent: () => () => undefined,
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

it('keeps a confirmed cluster-view close ahead of an older workspace read', async () => {
  let finish!: (state: ClusterWorkspaceWireState) => void;
  const stale = {
    ...emptyState(),
    selectedKubeconfigs: ['alpha:dev', 'beta:prod'],
    visibleClusterId: 'alpha',
  };
  const store = new ClusterWorkspaceStore({
    read: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    onEvent: () => () => undefined,
  });
  const release = store.acquire();
  try {
    const loading = store.hydrate();
    store.applyWireState(stale);
    store.confirmClosedSelection('alpha:dev', 'alpha');
    finish(stale);
    await loading;
    expect(store.getSnapshot().selectedKubeconfigs).toEqual(['beta:prod']);
    expect(store.getSnapshot().visibleClusterId).toBe('');
  } finally {
    release();
  }
});

/**
 * The per-cluster error class (verdict) must be sticky — set by terminal
 * failures and probe results, never cleared by a recovering transition alone —
 * so the failure surface stays stable across automatic retries.
 */
describe('auth error state transitions', () => {
  let runtime: ReturnType<typeof createWailsRuntimeHarness>;
  let store: ClusterWorkspaceStore;
  let release: () => void;

  beforeEach(async () => {
    runtime = createWailsRuntimeHarness();
    store = new ClusterWorkspaceStore({ read: async () => emptyState(), onEvent: runtime.onEvent });
    release = store.acquire();
    await store.hydrate();
  });

  afterEach(() => release());

  const requireClusterState = () => store.getAuth('c1');

  it('marks a terminal failure as a confirmed auth verdict', () => {
    runtime.emit('cluster:auth:failed', {
      clusterId: 'c1',
      clusterName: 'alpha',
      reason: 'token expired',
    });

    const state = requireClusterState();
    expect(state.hasError).toBe(true);
    expect(state.errorClass).toBe('auth');
    expect(isConfirmedAuthFailure(state)).toBe(true);
  });

  it('does not confirm a fresh recovering cluster before any probe verdict', () => {
    runtime.emit('cluster:auth:recovering', {
      clusterId: 'c1',
      clusterName: 'alpha',
      reason: '401 Unauthorized',
    });

    const state = requireClusterState();
    expect(state.hasError).toBe(true);
    expect(state.isRecovering).toBe(true);
    expect(state.errorClass).toBe('');
    expect(isConfirmedAuthFailure(state)).toBe(false);
  });

  it('keeps a connectivity verdict unconfirmed (cluster unreachable, waiting)', () => {
    runtime.emit('cluster:auth:recovering', { clusterId: 'c1', reason: '401' });
    runtime.emit('cluster:auth:progress', {
      clusterId: 'c1',
      secondsUntilRetry: 15,
      errorClass: 'connectivity',
    });

    const state = requireClusterState();
    expect(state.errorClass).toBe('connectivity');
    expect(isConfirmedAuthFailure(state)).toBe(false);
  });

  it('confirms an auth verdict reported by a probe', () => {
    runtime.emit('cluster:auth:recovering', { clusterId: 'c1', reason: '401' });
    runtime.emit('cluster:auth:progress', {
      clusterId: 'c1',
      secondsUntilRetry: 5,
      errorClass: 'auth',
    });

    expect(isConfirmedAuthFailure(requireClusterState())).toBe(true);
  });

  it('carries the exec command, kind, and summary from a failed event', () => {
    runtime.emit('cluster:auth:failed', {
      clusterId: 'c1',
      reason: 'exec: executable gke-gcloud-auth-plugin not found',
      kind: 'missing-helper',
      summary: "The kubeconfig's credential helper could not be found.",
      execCommand: 'gke-gcloud-auth-plugin',
    });

    const state = requireClusterState();
    expect(state.execCommand).toBe('gke-gcloud-auth-plugin');
    expect(state.diagnosticKind).toBe('missing-helper');
    expect(state.diagnosticSummary).toBe("The kubeconfig's credential helper could not be found.");
  });

  it('carries the exec command from a recovering event', () => {
    runtime.emit('cluster:auth:recovering', {
      clusterId: 'c1',
      reason: 'exec: executable aws not found',
      execCommand: 'aws',
    });

    expect(requireClusterState().execCommand).toBe('aws');
  });

  it('keeps the exec command sticky across a progress event without one', () => {
    runtime.emit('cluster:auth:recovering', {
      clusterId: 'c1',
      reason: 'missing helper',
      execCommand: 'gke-gcloud-auth-plugin',
    });
    runtime.emit('cluster:auth:progress', { clusterId: 'c1', secondsUntilRetry: 5 });

    expect(requireClusterState().execCommand).toBe('gke-gcloud-auth-plugin');
  });

  it('adopts the exec command from a progress event that carries one', () => {
    runtime.emit('cluster:auth:recovering', { clusterId: 'c1', reason: 'x' });
    runtime.emit('cluster:auth:progress', {
      clusterId: 'c1',
      secondsUntilRetry: 5,
      execCommand: 'aws',
    });

    expect(requireClusterState().execCommand).toBe('aws');
  });

  it('keeps the previous verdict when a progress event has no verdict yet', () => {
    runtime.emit('cluster:auth:failed', { clusterId: 'c1', reason: 'expired' });
    runtime.emit('cluster:auth:recovering', { clusterId: 'c1' });
    runtime.emit('cluster:auth:progress', {
      clusterId: 'c1',
      secondsUntilRetry: 0,
      errorClass: '',
    });

    const state = requireClusterState();
    expect(state.errorClass).toBe('auth');
    expect(isConfirmedAuthFailure(state)).toBe(true);
  });

  it('keeps the auth verdict across an automatic retry (no overlay flicker)', () => {
    runtime.emit('cluster:auth:failed', { clusterId: 'c1', reason: 'expired' });
    runtime.emit('cluster:auth:recovering', { clusterId: 'c1', reason: 'expired' });

    const state = requireClusterState();
    expect(state.isRecovering).toBe(true);
    expect(state.errorClass).toBe('auth');
    expect(isConfirmedAuthFailure(state)).toBe(true);
  });

  it('lets a connectivity probe verdict supersede an auth verdict', () => {
    // Credentials were bad, then the cluster became unreachable before they
    // were fixed: unreachable is a waiting state, not a confirmed failure.
    runtime.emit('cluster:auth:failed', { clusterId: 'c1', reason: 'expired' });
    runtime.emit('cluster:auth:recovering', { clusterId: 'c1' });
    runtime.emit('cluster:auth:progress', {
      clusterId: 'c1',
      secondsUntilRetry: 15,
      errorClass: 'connectivity',
    });

    expect(isConfirmedAuthFailure(requireClusterState())).toBe(false);
  });

  it('ignores progress for clusters without an active error', () => {
    runtime.emit('cluster:auth:progress', {
      clusterId: 'c1',
      secondsUntilRetry: 0,
      errorClass: 'auth',
    });

    expect(store.getSnapshot().clusters.size).toBe(0);
  });
});
