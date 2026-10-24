/**
 * frontend/src/ui/status/ConnectivityStatus.test.tsx
 *
 * The header connectivity indicator follows the visible cluster's lifecycle,
 * namespace list, authentication, and the auto-refresh preference, and its
 * actions act on that cluster: Refresh Now re-reads the cluster's data, Retry
 * Auth asks the backend to retry that cluster's authentication, and the
 * auto-refresh action saves the inverse preference. A disconnected cluster
 * offers no data refresh. Which state wins is connectivityPresentation's
 * contract (connectivityPresentation.test.ts). Runs in the full app over the
 * faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let view: MountedApp;
let dev: TestCluster;

const indicator = () =>
  requireValue(
    view.container.querySelector<HTMLElement>('[role="button"][aria-label^="Connectivity:"]'),
    'expected the connectivity indicator'
  );
const severity = () =>
  indicator().querySelector('.status-indicator-dot')?.getAttribute('data-status');
const summary = () => indicator().getAttribute('aria-label');

/** Opens the indicator's popover from the keyboard and returns its action buttons. */
const openActions = async () => {
  if (indicator().getAttribute('aria-expanded') !== 'true') {
    await act(async () => {
      indicator().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await app.settle();
  }
  const popover = requireValue(
    document.getElementById(indicator().getAttribute('aria-controls') ?? ''),
    'expected the connectivity popover'
  );
  return Array.from(popover.querySelectorAll<HTMLButtonElement>('.status-popover-actions button'));
};
const actionLabels = async () => (await openActions()).map((button) => button.textContent);
const runAction = async (label: string) => {
  const action = requireValue(
    (await openActions()).find((button) => button.textContent === label),
    `expected the ${label} action`
  );
  await act(async () => action.click());
  await app.settle();
};

/** Preference changes the backend saved, in order. */
const saved = () =>
  app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);

const start = async (lifecycle?: backend.ClusterLifecycleState) => {
  dev = app.cluster({ name: 'dev', context: 'alpha', lifecycle });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
  view = await app.mountApp();
};

beforeEach(() => {
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map(({ key }) => key),
  }));
  app.backend.answer('RetryClusterAuth', () => undefined);
});

describe('ConnectivityStatus', () => {
  it('is ready once the namespaces load, and Refresh Now re-reads the cluster’s data', async () => {
    await start();
    expect(severity()).toBe('healthy');
    expect(summary()).toContain('Ready');
    expect(await actionLabels()).toEqual(['Refresh Now', 'Disable Auto-Refresh']);
    app.snapshots.clearReads();

    await runAction('Refresh Now');

    expect(app.snapshots.reads('cluster-overview').map((read) => read.scope)).toContain(
      buildClusterRefreshScope('cluster-overview', dev.clusterId)
    );
    expect(app.backend.calls('RetryClusterAuth')).toEqual([]);
  });

  it('keeps loading until the namespace list is ready', async () => {
    // The namespace list read stays in flight until the app abandons it.
    app.snapshots.respond((request) =>
      request.domain === 'namespaces'
        ? new Promise<Response>((_resolve, reject) => {
            request.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
        : undefined
    );
    await start();

    expect(severity()).toBe('refreshing');
    expect(summary()).toContain('Loading namespaces');
    expect(await actionLabels()).toEqual(['Disable Auto-Refresh']);
  });

  it('shows an authentication failure with its reason and retries that cluster’s authentication', async () => {
    await start();
    app.snapshots.clearReads();

    await act(async () => {
      app.events.emit('cluster:lifecycle', { clusterId: dev.clusterId, state: 'auth_failed' });
      app.events.emit('cluster:auth:failed', {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        reason: 'token expired',
      });
    });
    await app.settle();

    expect(severity()).toBe('unhealthy');
    expect(summary()).toContain('Authentication failed');
    expect(summary()).toContain('token expired');
    expect(await actionLabels()).toEqual(['Retry Auth', 'Disable Auto-Refresh']);

    await runAction('Retry Auth');

    expect(app.backend.calls('RetryClusterAuth')).toEqual([[dev.clusterId]]);
    expect(app.snapshots.reads()).toEqual([]);
  });

  it('offers Refresh Now and Enable Auto-Refresh while auto-refresh is paused', async () => {
    app.preferences({ autoRefreshEnabled: false });
    await start();

    expect(await actionLabels()).toEqual(['Refresh Now', 'Enable Auto-Refresh']);
  });

  it.each([true, false])(
    'offers a disconnected cluster no data refresh when auto-refresh is %s',
    async (enabled) => {
      app.preferences({ autoRefreshEnabled: enabled });
      await start(backend.ClusterLifecycleState.ClusterStateDisconnected);
      app.snapshots.clearReads();

      expect(severity()).toBe('unhealthy');
      expect(summary()).toContain('Cluster disconnected');
      expect(await actionLabels()).toEqual([
        enabled ? 'Disable Auto-Refresh' : 'Enable Auto-Refresh',
      ]);

      await runAction(enabled ? 'Disable Auto-Refresh' : 'Enable Auto-Refresh');

      expect(saved()).toEqual([{ key: 'autoRefreshEnabled', value: !enabled }]);
      expect(app.backend.calls('RetryClusterAuth')).toEqual([]);
    }
  );
});
