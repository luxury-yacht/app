/**
 * frontend/src/hooks/multiClusterIsolation.test.ts
 *
 * Auth failures and health reported for one cluster stay with that cluster:
 * the auth context and the health listener report each cluster's own state,
 * the visible cluster's state as the active one (following a tab switch), and
 * nothing active when no cluster is open. A health event without a cluster is
 * ignored without logging its payload, and unmounting one menu-event consumer
 * leaves the app's own handler for that event working. Runs inside the
 * production shell over a faked backend (test-utils/appState): the backend
 * changes an open cluster's state with `app.setClusterState`, which later
 * workspace answers keep, and other runtime events arrive through
 * `app.events`.
 */

import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import {
  type ClusterAuthState,
  useActiveClusterAuthState,
  useAuthError,
} from '@/core/contexts/AuthErrorContext';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import {
  type ClusterFixture,
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useClusterHealthListener, useWailsRuntimeEvents } from './useWailsRuntimeEvents';

const app = installAppStateHarness();

interface ProbeState {
  auth: ReturnType<typeof useAuthError>;
  activeAuth: ClusterAuthState;
  health: ReturnType<typeof useClusterHealthListener>;
}

let probed: ProbeState | null = null;

// Reads the hooks the way their consumers do (ConnectivityStatus,
// AuthFailureOverlay, ClusterOverview): the active cluster is the visible one.
function Probe() {
  const { selectedClusterId } = useKubeconfig();
  probed = {
    auth: useAuthError(),
    activeAuth: useActiveClusterAuthState(selectedClusterId),
    health: useClusterHealthListener(selectedClusterId),
  };
  return null;
}

const state = () => requireValue(probed, 'expected the probe to render');

const openCluster = (name: string, auth?: ClusterFixture['auth']) => {
  const cluster = app.cluster({ name, context: name, auth });
  app.namespaces(cluster, ['default']);
  return cluster;
};

const showProbe = async (): Promise<MountedApp> => {
  const view = await app.render(null);
  await view.show(createElement(Probe));
  return view;
};

const emit = async (name: string, data: unknown) => {
  await act(async () => {
    app.events.emit(name, data);
  });
  await app.settle();
};

const failAuth = (cluster: TestCluster, reason: string) =>
  app.setClusterState(cluster, { auth: { state: 'invalid', reason } });

const { ClusterHealthDegraded: DEGRADED, ClusterHealthHealthy: HEALTHY } =
  backend.ClusterHealthState;

describe('auth error isolation', () => {
  it('keeps an auth failure, its retry, and its recovery to that cluster', async () => {
    const dev = openCluster('dev');
    const stg = openCluster('stg');
    await showProbe();

    await failAuth(dev, 'Token expired');
    await failAuth(stg, 'Certificate invalid');
    // The backend retries dev's credentials; the failure's diagnostic stays.
    await app.setClusterState(dev, { auth: { state: 'recovering', reason: 'Token expired' } });

    expect(state().auth.getClusterAuthState(dev.clusterId)).toMatchObject({
      hasError: true,
      isRecovering: true,
      reason: 'Token expired',
      clusterName: dev.clusterName,
    });
    expect(state().auth.getClusterAuthState(stg.clusterId)).toMatchObject({
      hasError: true,
      isRecovering: false,
      reason: 'Certificate invalid',
    });

    await app.setClusterState(dev, { auth: { state: 'valid' } });

    expect(state().auth.getClusterAuthState(dev.clusterId).hasError).toBe(false);
    expect(state().auth.getClusterAuthState(stg.clusterId)).toMatchObject({
      hasError: true,
      reason: 'Certificate invalid',
    });
    expect([...state().auth.clusterAuthErrors.keys()]).toEqual([stg.clusterId]);
  });

  it('reports the visible cluster’s auth state as the active one, following a tab switch', async () => {
    // The backend's workspace state carries each cluster's auth state
    // (backend/workspace_state.go), so it is seeded there, as a window opened
    // after the failures would read it.
    const dev = openCluster('dev');
    const stg = openCluster('stg', { state: 'invalid', reason: 'Token expired for stg' });
    const view = await showProbe();

    expect(state().activeAuth.hasError).toBe(false);
    expect(state().auth.getClusterAuthState(stg.clusterId).hasError).toBe(true);

    await view.selectCluster(stg);

    expect(state().activeAuth).toMatchObject({
      hasError: true,
      reason: 'Token expired for stg',
      clusterName: stg.clusterName,
    });
    expect(state().auth.getClusterAuthState(dev.clusterId).hasError).toBe(false);
  });

  it('reports no active auth failure or health when no cluster is open', async () => {
    await showProbe();

    await emit('cluster:auth:failed', {
      clusterId: 'background',
      clusterName: 'background',
      reason: 'Token expired',
    });
    await emit('cluster:health:degraded', { clusterId: 'background' });

    expect(state().auth.getClusterAuthState('background').hasError).toBe(true);
    expect(state().activeAuth.hasError).toBe(false);
    expect(state().health.getActiveClusterHealth()).toBe('unknown');
  });
});

describe('cluster health isolation', () => {
  it('keeps each cluster’s health to that cluster through its transitions', async () => {
    const dev = openCluster('dev');
    const stg = openCluster('stg');
    const prd = openCluster('prd');
    await showProbe();

    await app.setClusterState(stg, { health: DEGRADED });

    expect(state().health.getClusterHealth(dev.clusterId)).toBe('healthy');
    expect(state().health.getClusterHealth(stg.clusterId)).toBe('degraded');
    expect(state().health.getClusterHealth(prd.clusterId)).toBe('healthy');
    expect(state().health.getClusterHealth('not-open')).toBe('unknown');

    await app.setClusterState(stg, { health: HEALTHY });
    await app.setClusterState(dev, { health: DEGRADED });

    expect(state().health.getClusterHealth(dev.clusterId)).toBe('degraded');
    expect(state().health.getClusterHealth(stg.clusterId)).toBe('healthy');
    expect(state().health.clusterHealth.size).toBe(3);
  });

  it('reports the visible cluster’s health as the active one, following a tab switch', async () => {
    const dev = openCluster('dev');
    const stg = openCluster('stg');
    const view = await showProbe();

    // A background cluster degrades while dev is visible.
    await app.setClusterState(stg, { health: DEGRADED });
    expect(state().health.getActiveClusterHealth()).toBe('healthy');

    await view.selectCluster(stg);
    expect(state().health.getActiveClusterHealth()).toBe('degraded');

    await app.setClusterState(dev, { health: DEGRADED });
    await app.setClusterState(stg, { health: HEALTHY });
    expect(state().health.getActiveClusterHealth()).toBe('healthy');
  });

  it('ignores a health event without a cluster and does not log its payload', async () => {
    const dev = openCluster('dev');
    await showProbe();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await emit('cluster:health:degraded', {
        clusterName: 'private-cluster-name',
        token: 'private-token',
      });

      expect(warn).toHaveBeenCalledWith(
        '[ClusterHealthListener] Received health:degraded without clusterId'
      );
      expect(warn).not.toHaveBeenCalledWith(expect.any(String), expect.anything());
    } finally {
      warn.mockRestore();
    }
    expect(state().health.getClusterHealth(dev.clusterId)).toBe('healthy');
    expect([...state().health.clusterHealth.keys()]).toEqual([dev.clusterId]);
  });
});

describe('menu events', () => {
  it('leaves the app’s own handler working after another consumer of the event unmounts', async () => {
    openCluster('dev');
    const view = await app.render(null);
    const executeCommand = vi.fn();
    function MenuConsumer() {
      useWailsRuntimeEvents(executeCommand);
      return null;
    }
    await view.show(createElement(MenuConsumer));
    await emit('toggle-sidebar', undefined);
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      backend.ApplicationMenuCommand.ApplicationMenuCommandToggleSidebar
    );
    expect(view.owners().viewState?.isSidebarVisible).toBe(false);

    view.clear();
    await emit('toggle-sidebar', undefined);

    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(view.owners().viewState?.isSidebarVisible).toBe(true);
  });
});
