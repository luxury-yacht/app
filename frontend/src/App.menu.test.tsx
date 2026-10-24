/**
 * frontend/src/App.menu.test.tsx
 *
 * Application menu commands in a workspace window: Settings runs in the window
 * and New Window goes to the backend. Both keep working while one cluster tab
 * closes, and neither runs while the window itself is closing, whether given
 * with the menu's keyboard accelerators, as in a window that draws its own
 * menu (Windows and Linux), or as the commands the native macOS menu sends.
 * Runs in the full app over the faked backend (test-utils/appState);
 * `backend.hold` keeps a close in flight.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '@/core/backend-api/models';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';

const app = installAppStateHarness();
let view: MountedApp;
let dev: TestCluster;
let stg: TestCluster;

/** Presses a menu accelerator (Ctrl+key outside macOS). */
const pressAccelerator = async (key: string) => {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
    );
  });
  await app.settle();
};

const giveSettingsAndNewWindow = async () => {
  await pressAccelerator(',');
  await pressAccelerator('n');
};

const settingsOpen = () => document.querySelector('button[aria-label="Close Settings"]') !== null;
const paletteOpen = () => document.querySelector('dialog.command-palette') !== null;

/** The workspace commands the native macOS menu sends the window (backend/application_menu_commands.go). */
const giveNativeSettingsAndPalette = async () => {
  for (const command of ['open-settings', 'open-command-palette']) {
    await act(async () => {
      app.events.emit(command, undefined, { sender: app.windowName });
    });
    await app.settle();
  }
};

beforeEach(async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  stg = app.cluster({ name: 'stg', context: 'beta' });
  for (const cluster of [dev, stg]) {
    app.namespaces(cluster, ['default']);
    app.startScreen(cluster);
  }
  app.backend.answer('ExecuteApplicationMenuCommand', () => undefined);
  app.backend.answer('AcknowledgeWorkspaceWindowClose', () => undefined);
  // The Settings modal opens on Appearance, which lists the saved themes.
  app.backend.answer('GetThemes', () => []);
  view = await app.mountApp();
});

describe('application menu commands', () => {
  it('runs Settings in the window and sends New Window to the backend while a cluster tab closes', async () => {
    const approveClose = app.backend.hold('CloseClusterView');
    // File > Close closes the visible cluster's tab.
    await pressAccelerator('w');
    expect(app.backend.calls('CloseClusterView')).toEqual([[app.windowName, dev.clusterId]]);

    await giveSettingsAndNewWindow();

    expect(settingsOpen()).toBe(true);
    expect(app.backend.calls('ExecuteApplicationMenuCommand')).toEqual([
      [backend.ApplicationMenuCommand.ApplicationMenuCommandNewWindow],
    ]);
    await act(async () => approveClose());
    await app.settle();
    expect(view.owners().kubeconfig.managedClusterIds).toEqual([stg.clusterId]);
  });

  it('runs no menu command while the window is closing', async () => {
    const acknowledgeClose = app.backend.hold('AcknowledgeWorkspaceWindowClose');
    await act(async () => {
      app.events.emit(
        'workspace-window:close-requested',
        { windowName: app.windowName },
        { sender: app.windowName }
      );
    });
    await app.settle();
    // The window has published its panels and waits for the backend to close it.
    expect(app.backend.calls('AcknowledgeWorkspaceWindowClose')).toEqual([[app.windowName]]);

    await giveSettingsAndNewWindow();
    await giveNativeSettingsAndPalette();

    expect(settingsOpen()).toBe(false);
    expect(paletteOpen()).toBe(false);
    expect(app.backend.calls('ExecuteApplicationMenuCommand')).toEqual([]);
    await act(async () => acknowledgeClose());
    await app.settle();
  });
});
