/**
 * frontend/src/core/contexts/ClusterLifecycleContext.test.tsx
 *
 * Per-cluster lifecycle as the workspace window reports it: hydrated from the
 * backend's workspace state, updated by backend lifecycle events, relayed to
 * the app's event bus for the refresh and permission layers, closed against
 * unknown or incomplete states, released with the window, and stable in
 * identity when an event repeats the current state. A named object action
 * keeps its pending permission query while another cluster reports auth
 * progress. Runs the production shell's own lifecycle provider and its
 * neighbours (test-utils/appState); lifecycle reaches it only through the
 * faked backend (workspace state RPC and runtime events).
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { useCapabilities } from '@/core/capabilities/hooks';
import { eventBus } from '@/core/events';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useClusterLifecycle } from './ClusterLifecycleContext';

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;
let lifecycle: ReturnType<typeof useClusterLifecycle> | null = null;
let relayed: string[] = [];
let stopRelay: (() => void) | null = null;

function Probe() {
  lifecycle = useClusterLifecycle();
  return null;
}

const current = () => requireValue(lifecycle, 'cluster lifecycle');

/** Records what the app's event bus relays, from before the window mounts. */
const recordRelay = () => {
  stopRelay = eventBus.on('cluster:lifecycle', ({ clusterId, state }) => {
    relayed.push(`${clusterId}:${state}`);
  });
};

/** Alpha (visible) is ready; beta reports `betaLifecycle` in the workspace state. */
const clusters = (betaLifecycle = backend.ClusterLifecycleState.ClusterStateConnecting) => {
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta', lifecycle: betaLifecycle });
  app.namespaces(alpha, ['default']);
  app.namespaces(beta, ['default']);
};

const start = async () => {
  view = await app.render(null);
  await view.show(<Probe />);
};

const emitLifecycle = async (payload: Record<string, unknown>) => {
  await act(async () => {
    app.events.emit('cluster:lifecycle', payload);
  });
};

afterEach(() => {
  stopRelay?.();
  stopRelay = null;
  relayed = [];
  lifecycle = null;
  vi.restoreAllMocks();
});

describe('cluster lifecycle', () => {
  it('reports each open cluster’s hydrated lifecycle, and nothing for an unknown cluster', async () => {
    clusters();
    recordRelay();

    await start();

    expect(current().getClusterState(alpha.clusterId)).toBe('ready');
    expect(current().getClusterState(beta.clusterId)).toBe('connecting');
    expect(current().getClusterState('nonexistent')).toBeUndefined();
    // The refresh and permission layers learn the hydrated states too.
    expect(relayed).toEqual(
      expect.arrayContaining([`${alpha.clusterId}:ready`, `${beta.clusterId}:connecting`])
    );
  });

  it('follows backend lifecycle events and relays them to the app’s event bus', async () => {
    clusters();
    await start();
    recordRelay();

    await emitLifecycle({ clusterId: beta.clusterId, state: 'ready', previousState: 'loading' });

    expect(current().getClusterState(beta.clusterId)).toBe('ready');
    expect(relayed).toEqual([`${beta.clusterId}:ready`]);
  });

  it('keeps getClusterState identity when a lifecycle event repeats the current state', async () => {
    // Consumers key derived scope lists on getClusterState; a new identity per
    // redundant event re-runs their reconciliation on every heartbeat.
    clusters();
    await start();
    await emitLifecycle({
      clusterId: beta.clusterId,
      state: 'loading',
      previousState: 'connected',
    });
    const identity = current().getClusterState;

    await emitLifecycle({
      clusterId: beta.clusterId,
      state: 'loading',
      previousState: 'connected',
    });
    expect(current().getClusterState).toBe(identity);

    await emitLifecycle({ clusterId: beta.clusterId, state: 'ready', previousState: 'loading' });
    expect(current().getClusterState(beta.clusterId)).toBe('ready');
  });

  it('ignores lifecycle events without a cluster, without a state, or with an unknown state', async () => {
    // An unrecognized state (backend/frontend version skew) must not replace
    // the last known state or reach the event bus: gates comparing against
    // known states would hold dispatch forever.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    clusters();
    await start();
    recordRelay();

    await emitLifecycle({ state: 'ready' });
    await emitLifecycle({ clusterId: beta.clusterId });
    await emitLifecycle({
      clusterId: beta.clusterId,
      state: 'context-test-bogus-live',
      previousState: 'connecting',
    });

    expect(current().getClusterState(beta.clusterId)).toBe('connecting');
    expect(current().getClusterState('')).toBeUndefined();
    expect(relayed).toEqual([]);
  });

  it('drops an unknown hydrated state but keeps the valid ones', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    clusters('context-test-bogus-hydrate' as backend.ClusterLifecycleState);
    recordRelay();

    await start();

    expect(current().getClusterState(beta.clusterId)).toBeUndefined();
    expect(current().getClusterState(alpha.clusterId)).toBe('ready');
    expect(relayed.filter((entry) => entry.startsWith(`${beta.clusterId}:`))).toEqual([]);
  });

  it('stops listening for backend lifecycle events when the window unmounts', async () => {
    clusters();
    await start();
    expect(app.events.listenerCount('cluster:lifecycle')).toBe(1);

    view.unmount();

    expect(app.events.listenerCount('cluster:lifecycle')).toBe(0);
  });

  it('enables a pending object action despite auth-progress events for another cluster', async () => {
    // Auth progress republishes lifecycle state; it must not restart a named
    // permission query that is still in flight for a ready cluster.
    clusters();
    await start();
    const edit = {
      id: 'edit',
      clusterId: alpha.clusterId,
      group: '',
      version: 'v1',
      resourceKind: 'Pod',
      namespace: 'default',
      name: 'api',
      verb: 'patch',
    };
    const descriptors = [edit];
    function NamedAction() {
      const permissions = useCapabilities(descriptors);
      return (
        <button type="button" disabled={permissions.loading || !permissions.isAllowed('edit')}>
          Edit YAML
        </button>
      );
    }
    const editQueries = () =>
      app.backend
        .calls('QueryPermissions')
        .filter(([queries]) => (queries ?? []).some((query) => query.id === edit.id));
    const releaseQuery = app.backend.hold('QueryPermissions');
    await view.show(<NamedAction />);
    const button = requireValue(
      Array.from(view.container.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent === 'Edit YAML'
      ),
      'the Edit YAML action'
    );
    expect(button.disabled).toBe(true);
    const queriesBeforeProgress = editQueries().length;
    expect(queriesBeforeProgress).toBeGreaterThan(0);

    await act(async () => {
      app.events.emit('cluster:auth:failed', {
        clusterId: beta.clusterId,
        clusterName: beta.clusterName,
        reason: 'expired',
      });
    });
    for (const secondsUntilRetry of [3, 2, 1]) {
      await act(async () => {
        app.events.emit('cluster:auth:progress', { clusterId: beta.clusterId, secondsUntilRetry });
      });
    }
    expect(editQueries()).toHaveLength(queriesBeforeProgress);
    await act(async () => releaseQuery());
    await app.settle();

    expect(button.disabled).toBe(false);
    expect(editQueries()).toHaveLength(queriesBeforeProgress);
  });
});
