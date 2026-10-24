/**
 * frontend/src/ui/overlays/AuthFailureOverlay.integration.test.tsx
 *
 * A window that opens on a workspace whose cluster credentials the backend
 * already reports as failing blocks that cluster's view with the auth failure
 * overlay, retries that cluster when asked, and leaves a healthy sibling
 * cluster's view usable. Runs in the full app over the faked backend
 * (test-utils/appState): the backend's restored workspace state carries the
 * failure, as it does for a window opened while a cluster's SSO session has
 * expired.
 */

import { act } from 'react';
import { expect, it } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();

// What backend/workspace_state.go reports for a cluster whose exec credential
// plugin failed and whose auth recovery is retrying.
const expiredSsoAuth = {
  state: 'recovering',
  errorClass: 'auth',
  secondsUntilRetry: 6,
  class: 'auth',
  kind: 'expired-credentials',
  summary: 'The authentication token or SSO session has expired.',
  execCommand: 'aws',
  reason: 'exec plugin failed with exit code 255',
};

it('blocks the failing cluster’s view with its restored auth failure, retries it, and leaves the healthy sibling usable', async () => {
  const sso = app.cluster({
    name: 'sso',
    context: 'prod',
    lifecycle: backend.ClusterLifecycleState.ClusterStateConnecting,
    auth: expiredSsoAuth,
  });
  const healthy = app.cluster({ name: 'healthy', context: 'dev', auth: { state: 'valid' } });
  app.namespaces(healthy, ['default']);
  app.startScreen(healthy);
  app.backend.answer('RetryClusterAuth', () => undefined);
  // The window opens on its first cluster, the failing one.
  const view = await app.mountApp();
  const overlay = () => view.container.querySelector<HTMLElement>('[role="alertdialog"]');

  const blocking = requireValue(overlay(), 'expected the auth failure overlay');
  expect(blocking.textContent).toContain(sso.clusterName);
  expect(blocking.textContent).toContain(expiredSsoAuth.summary);
  await act(async () => {
    requireValue(
      Array.from(blocking.querySelectorAll('button')).find(
        (button) => button.textContent === 'Retry Now'
      ),
      'expected the retry button'
    ).click();
  });
  await app.settle();
  expect(app.backend.calls('RetryClusterAuth')).toEqual([[sso.clusterId]]);

  await view.selectCluster(healthy);
  expect(overlay()).toBeNull();

  await view.selectCluster(sso);
  expect(overlay()).not.toBeNull();
});
