/**
 * frontend/src/core/panel-windows/panelWindowFloat.test.tsx
 *
 * Undocking a panel group into its own native window freezes the source
 * window until the move settles, then unfreezes it whether the window opened
 * or the backend refused. Runs the real app shell, coordinator, lifecycle
 * guard registry, and dockable panels; only the backend boundary is faked
 * (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { acknowledgePanelWindowReady } from '@/core/panel-windows';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';

const app = installAppStateHarness();

const configMap = {
  group: '',
  version: 'v1',
  kind: 'ConfigMap',
  namespace: 'default',
  name: 'app-config',
};

const openConfigMapPanel = async () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
  const panel = app.object(dev, configMap);
  app.snapshots.serve('object-details', panel.scopes.detailScope ?? '', {
    detailType: 'configmap',
    details: {
      name: 'app-config',
      namespace: 'default',
      data: { key: 'value' },
      binaryData: {},
      labels: {},
      annotations: {},
    },
  } as never);
  const view = await app.mountApp();
  await act(async () => {
    view.owners().objectPanel.openWithObject(panel.ref);
  });
  await app.settle();
  return { view };
};

const undock = async (view: MountedApp) => {
  const button = view.container.querySelector<HTMLElement>(
    '[aria-label="Undock panel to floating window"]'
  );
  if (!button) {
    throw new Error('the docked panel has no undock control');
  }
  await act(async () => {
    button.click();
  });
  await app.settle();
};

const windowFrozen = (view: MountedApp) =>
  view.container.querySelector('.panel-lifecycle-surface')?.hasAttribute('inert');

const configMapPanelOpen = (view: MountedApp) =>
  view.openPanels().some((ref) => ref.kind === 'ConfigMap' && ref.name === 'app-config');

describe('undocking a panel group into a native window', () => {
  it('moves the group out and unfreezes the window once the new window is ready', async () => {
    const { view } = await openConfigMapPanel();

    await undock(view);

    expect(windowFrozen(view)).toBe(true);
    const [[, snapshot]] = app.backend.calls('BeginPanelWindowOpen');
    // The new window boots and acknowledges; the backend tells this window.
    await act(async () => {
      await acknowledgePanelWindowReady('panel-1', snapshot.transferId);
    });
    await app.settle();

    expect(windowFrozen(view)).toBe(false);
    expect(configMapPanelOpen(view)).toBe(false);
  });

  it('keeps the group docked and unfreezes the window when the backend refuses', async () => {
    const { view } = await openConfigMapPanel();
    app.backend.answer('BeginPanelWindowOpen', () => {
      throw new Error('source window "workspace-1" is not live');
    });

    await undock(view);

    expect(windowFrozen(view)).toBe(false);
    expect(configMapPanelOpen(view)).toBe(true);
    expect(
      app.errors
        .take((record) => record.kinds.includes('operational'))
        .map(({ context }) => context)
    ).toEqual([expect.objectContaining({ action: 'float-group' })]);
  });
});
