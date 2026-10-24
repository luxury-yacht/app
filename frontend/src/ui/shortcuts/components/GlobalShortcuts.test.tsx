/**
 * frontend/src/ui/shortcuts/components/GlobalShortcuts.test.tsx
 *
 * The workspace window's global shortcuts as the app shell wires them
 * (App.tsx AppContent): Shift+? toggles the keyboard shortcut help unless
 * Settings is open; Escape closes the help, then Settings, then the
 * Application Logs panel; Cmd/Ctrl+R refreshes what the selected cluster
 * shows; Cmd/Ctrl+Alt+Left/Right switch cluster tabs; and the native Close
 * menu (or its accelerator) closes the active cluster tab, or the window when
 * no cluster is open. Runs in provider mode inside the real app shell, which
 * mounts GlobalShortcuts with its production owners; only the backend
 * boundary is faked (test-utils/appState).
 */

import { Window as WailsWindow } from '@wailsio/runtime';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { isMacPlatform } from '@/utils/platform';

const app = installAppStateHarness();
let view: MountedApp;

const primary = (): KeyboardEventInit => (isMacPlatform() ? { metaKey: true } : { ctrlKey: true });

const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  await app.settle();
  return event;
};

/** Delivers a native menu event, as the backend does. */
const menu = async (name: string) => {
  await act(async () => {
    app.events.emit(name);
  });
  await app.settle();
};

const viewState = () => {
  const state = view.owners().viewState;
  if (!state) {
    throw new Error('expected the workspace view state');
  }
  return state;
};

const helpOpen = () =>
  document.querySelector('[role="dialog"][aria-labelledby="shortcut-help-modal-title"]') !== null;

// The help keeps its surface through its 200 ms exit animation.
const finishHelpExit = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const openClusters = (names: string[]): TestCluster[] =>
  names.map((name, index) => {
    const cluster = app.cluster({ name, context: `ctx-${index}` });
    app.namespaces(cluster, ['default']);
    return cluster;
  });

beforeEach(() => {
  // The Wails runtime's window handle (an external boundary, vitest.setup.ts).
  vi.mocked(WailsWindow.Close).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GlobalShortcuts', () => {
  it('toggles the shortcut help with Shift+?, and Escape closes it before the Application Logs panel', async () => {
    openClusters(['dev']);
    view = await app.render(null);
    vi.useFakeTimers();
    await menu('toggle-app-logs-panel');
    expect(viewState().showAppLogsPanel).toBe(true);

    await press('?', { shiftKey: true });
    expect(helpOpen()).toBe(true);
    await press('?', { shiftKey: true });
    await finishHelpExit();
    expect(helpOpen()).toBe(false);

    await press('?', { shiftKey: true });
    await press('Escape');
    await finishHelpExit();

    expect(helpOpen()).toBe(false);
    expect(viewState().showAppLogsPanel).toBe(true);
  });

  it('keeps the help closed while Settings is open and opens it once Settings closes', async () => {
    openClusters(['dev']);
    view = await app.render(null);
    await menu('open-settings');
    expect(viewState().isSettingsOpen).toBe(true);

    await press('?', { shiftKey: true });
    expect(helpOpen()).toBe(false);

    await press('Escape');
    expect(viewState().isSettingsOpen).toBe(false);
    await press('?', { shiftKey: true });
    expect(helpOpen()).toBe(true);
  });

  it('closes Settings before the Application Logs panel on Escape, then the panel', async () => {
    openClusters(['dev']);
    view = await app.render(null);
    await menu('toggle-app-logs-panel');
    await menu('open-settings');
    expect(viewState().isSettingsOpen).toBe(true);

    await press('Escape');
    expect(viewState().isSettingsOpen).toBe(false);
    expect(viewState().showAppLogsPanel).toBe(true);

    await press('Escape');
    expect(viewState().showAppLogsPanel).toBe(false);
  });

  it('refreshes what the selected cluster shows on Cmd/Ctrl+R', async () => {
    const [, prod] = openClusters(['dev', 'prod']);
    view = await app.render(null);
    await view.selectCluster(prod);
    await app.settle();
    app.snapshots.clearReads();
    const jobsBefore = app.snapshots.requests().length;

    const event = await press('r', primary());

    expect(event.defaultPrevented).toBe(true);
    // A manual refresh runs a refresh job for each scope the cluster shows, then rereads it.
    expect(app.snapshots.requests().slice(jobsBefore)).toContain('POST /api/v2/refresh/namespaces');
    expect(app.snapshots.reads().map(({ domain, scope }) => `${domain} ${scope}`)).toContain(
      `namespaces ${prod.clusterId}|`
    );
    expect(app.snapshots.reads().every(({ scope }) => scope.startsWith(`${prod.clusterId}|`))).toBe(
      true
    );
  });

  it('switches to the previous and next cluster tab on Cmd/Ctrl+Alt+Left and Right', async () => {
    const [dev, stg, prod] = openClusters(['dev', 'stg', 'prod']);
    view = await app.render(null);
    await view.selectCluster(stg);
    const switchTab = async (key: 'ArrowLeft' | 'ArrowRight') => {
      await press(key, { ...primary(), altKey: true });
      return view.owners().kubeconfig.selectedClusterId;
    };

    expect(await switchTab('ArrowLeft')).toBe(dev.clusterId);
    // The first tab has no previous tab; the order does not wrap.
    expect(await switchTab('ArrowLeft')).toBe(dev.clusterId);
    expect(await switchTab('ArrowRight')).toBe(stg.clusterId);
    expect(await switchTab('ArrowRight')).toBe(prod.clusterId);
    expect(await switchTab('ArrowRight')).toBe(prod.clusterId);
  });

  it('closes the active cluster tab from the native Close menu, keeping the others', async () => {
    const [dev, prod] = openClusters(['dev', 'prod']);
    view = await app.render(null);
    await view.selectCluster(prod);

    await menu('menu:close');

    expect(app.backend.calls('CloseClusterView')).toEqual([[app.windowName, prod.clusterId]]);
    expect(view.owners().kubeconfig.selectedKubeconfigs).toEqual([dev.selection]);
    expect(view.owners().kubeconfig.selectedClusterId).toBe(dev.clusterId);
    expect(WailsWindow.Close).not.toHaveBeenCalled();
  });

  it('closes the last cluster tab from the Close accelerator without closing the window', async () => {
    const [dev] = openClusters(['dev']);
    view = await app.render(null);

    await press('w', primary());

    expect(app.backend.calls('CloseClusterView')).toEqual([[app.windowName, dev.clusterId]]);
    expect(view.owners().kubeconfig.selectedKubeconfigs).toEqual([]);
    expect(WailsWindow.Close).not.toHaveBeenCalled();
  });

  it('closes the window from the native Close menu when no cluster is open', async () => {
    view = await app.render(null);

    await menu('menu:close');

    expect(WailsWindow.Close).toHaveBeenCalledOnce();
    expect(app.backend.calls('CloseClusterView')).toEqual([]);
  });
});
