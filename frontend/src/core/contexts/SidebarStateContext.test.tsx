/**
 * frontend/src/core/contexts/SidebarStateContext.test.tsx
 *
 * The workspace window's sidebar state: each committed visibility change
 * reaches the native menu once, and the sidebar selection is kept per cluster
 * tab, can be prepared for another tab, and is dropped with a closed tab. Runs
 * the production shell's own sidebar owner under the real kubeconfig owner
 * (test-utils/appState); cluster tabs switch, close, and reopen through it.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useSidebarState } from './SidebarStateContext';

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;
let sidebar: ReturnType<typeof useSidebarState> | null = null;

function Probe() {
  sidebar = useSidebarState();
  return null;
}

const current = () => requireValue(sidebar, 'sidebar state');
const OVERVIEW = { type: 'overview', value: 'overview' };

beforeEach(async () => {
  sidebar = null;
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta' });
  app.namespaces(alpha, ['default']);
  app.namespaces(beta, ['default']);
  view = await app.render(null);
  await view.show(<Probe />);
});

describe('sidebar state', () => {
  it('publishes each committed visibility change to the native menu once', async () => {
    for (const visible of [false, true]) {
      const before = app.backend.calls('SetSidebarVisible').length;

      await act(async () => current().toggleSidebar());

      expect(current().isSidebarVisible).toBe(visible);
      expect(app.backend.calls('SetSidebarVisible').slice(before)).toEqual([[visible]]);
    }
  });

  it('keeps the sidebar selection isolated per cluster tab', async () => {
    act(() => current().setSidebarSelection({ type: 'namespace', value: 'default' }));
    expect(current().sidebarSelection).toEqual({ type: 'namespace', value: 'default' });

    await view.selectCluster(beta);
    expect(current().sidebarSelection).toEqual(OVERVIEW);
    act(() => current().setSidebarSelection({ type: 'cluster', value: 'cluster' }));

    await view.selectCluster(alpha);
    expect(current().sidebarSelection).toEqual({ type: 'namespace', value: 'default' });
  });

  it('prepares another cluster tab’s selection without changing the active one', async () => {
    act(() =>
      current().setSidebarSelectionForCluster(beta.clusterId, { type: 'cluster', value: 'cluster' })
    );
    expect(current().sidebarSelection).toEqual(OVERVIEW);

    await view.selectCluster(beta);

    expect(current().sidebarSelection).toEqual({ type: 'cluster', value: 'cluster' });
  });

  it('drops a closed cluster tab’s selection, so reopening it starts at the overview', async () => {
    await view.selectCluster(beta);
    act(() => current().setSidebarSelection({ type: 'cluster', value: 'cluster' }));

    await act(async () => {
      await view.owners().kubeconfig.closeKubeconfig(beta.selection);
    });
    await app.settle();
    await act(async () => {
      await view.owners().kubeconfig.openKubeconfig(beta.selection);
    });
    await app.settle();

    expect(view.owners().kubeconfig.selectedClusterId).toBe(beta.clusterId);
    expect(current().sidebarSelection).toEqual(OVERVIEW);
  });
});
