/**
 * frontend/src/ui/dockable/appWidePanelClusterSwitch.test.tsx
 *
 * App-wide panels (Diagnostics) keep their open flag outside the per-cluster
 * dock layout. Switching cluster tabs must not hide one the user has open.
 * Two real clusters are open and the user switches between them through the
 * real kubeconfig owner (test-utils/appState).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { DockablePanelTestHost } from '@/test-utils/DockablePanelTestHost';
import DockablePanel from './DockablePanel';
import { DockablePanelProvider } from './DockablePanelProvider';

const app = installAppStateHarness();

describe('app-wide dockable panels across cluster tabs', () => {
  let view: MountedApp;
  let alpha: TestCluster;
  let beta: TestCluster;

  const draw = async (isOpen: boolean) => {
    await view.show(
      <DockablePanelProvider>
        <DockablePanelTestHost />
        <DockablePanel panelId="diagnostics" title="Diagnostics" isOpen={isOpen}>
          <div data-testid="diagnostics-body" />
        </DockablePanel>
      </DockablePanelProvider>
    );
  };

  const diagnosticsVisible = () =>
    Boolean(document.querySelector('[data-testid="diagnostics-body"]'));

  beforeEach(async () => {
    const content = document.createElement('div');
    content.className = 'content';
    const body = document.createElement('div');
    body.className = 'content-body';
    content.appendChild(body);
    document.body.appendChild(content);
    alpha = app.cluster({ name: 'dev', context: 'alpha' });
    beta = app.cluster({ name: 'dev', context: 'beta' });
    app.namespaces(alpha, ['default']);
    app.namespaces(beta, ['default']);
    view = await app.render(null);
  });

  afterEach(() => {
    document.querySelectorAll('.content').forEach((node) => {
      node.remove();
    });
  });

  it('stays open when the user switches to a cluster tab visited before it opened', async () => {
    // Both tabs are visited while the panel is closed, as when two clusters
    // are open before the user opens Diagnostics.
    await draw(false);
    await view.selectCluster(beta);
    await view.selectCluster(alpha);

    await draw(true);
    expect(diagnosticsVisible()).toBe(true);

    await view.selectCluster(beta);
    expect(diagnosticsVisible()).toBe(true);
  });

  it('stays closed on every cluster tab once the user closes it', async () => {
    await draw(true);
    await view.selectCluster(beta);
    expect(diagnosticsVisible()).toBe(true);

    await draw(false);
    await view.selectCluster(alpha);
    expect(diagnosticsVisible()).toBe(false);
  });
});
