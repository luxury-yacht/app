/**
 * frontend/src/ui/layout/ClusterTabs.test.tsx
 *
 * The cluster tab strip: it lists the window's open clusters in their saved
 * drag order (persisting the order only once both the clusters and the saved
 * order have loaded), labels same-named contexts by file, switches, closes,
 * reorders, and opens clusters elsewhere from a tab and its menu, enters and
 * leaves Global without changing the foreground cluster, offers Open Cluster
 * once the saved clusters have loaded, moves a tab dropped from another
 * window, and is traversed by keyboard without activating a tab until Enter
 * or Space. Runs in the full app over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { toClusterInsertIndex } from './ClusterTabs';

const app = installAppStateHarness();
let view: MountedApp;

/** Opens a cluster per context in the startup workspace, serving its start screen. */
const openClusters = (...contexts: string[]): TestCluster[] =>
  contexts.map((context) => {
    const cluster = app.cluster({ name: 'kube', context });
    app.namespaces(cluster, ['default']);
    app.startScreen(cluster);
    return cluster;
  });

const tabs = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.cluster-tabs [role="tab"]'));
const labels = () => tabs().map((tab) => tab.textContent?.trim());
const tabNamed = (label: string) =>
  requireValue(
    tabs().find((tab) => tab.textContent?.trim() === label),
    `expected the ${label} tab`
  );
const buttonNamed = (label: string) =>
  requireValue(
    view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    `expected the ${label} button`
  );
const menuItems = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'));
const menu = () => document.querySelector('[role="menu"]');

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

/** Right-clicks a tab, as the user opens its menu, and returns the menu's items. */
const openMenu = async (label: string) => {
  await act(async () => {
    tabNamed(label).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  await app.settle();
  return menuItems().map((item) => item.textContent);
};

const choose = async (label: string) =>
  click(
    requireValue(
      menuItems().find((item) => item.textContent === label),
      `expected the ${label} menu item`
    )
  );

const owners = () => view.owners();

const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
  await act(async () => {
    requireValue(document.activeElement, 'expected a focused control').dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
    );
  });
};
const savedOrders = () => app.backend.calls('SetClusterTabOrder').map(([order]) => order);

describe('ClusterTabs', () => {
  it('excludes the synthetic Global tab from persisted drag positions', () => {
    expect(toClusterInsertIndex(0, true)).toBe(0);
    expect(toClusterInsertIndex(1, true)).toBe(0);
    expect(toClusterInsertIndex(2, true)).toBe(1);
    expect(toClusterInsertIndex(2, false)).toBe(2);
  });

  it('lists clusters in the saved drag order, then newly opened ones, and persists that once', async () => {
    const [a, b, c] = openClusters('a', 'b', 'c');
    app.backend.answer('GetClusterTabOrder', () => [b.selection]);

    view = await app.mountApp();

    expect(labels()).toEqual(['Global', 'b', 'a', 'c']);
    expect(savedOrders()).toEqual([[b.selection, a.selection, c.selection]]);
  });

  it.each(['the saved clusters', 'the saved order'])(
    'persists no order when %s load before the other',
    async (loadedFirst) => {
      const [a, b] = openClusters('a', 'b');
      app.backend.answer('GetClusterTabOrder', () => [b.selection, a.selection]);
      const releaseOrder = app.backend.hold('GetClusterTabOrder');
      const releaseClusters = app.backend.hold('GetKubeconfigs');
      const [first, second] =
        loadedFirst === 'the saved clusters'
          ? [releaseClusters, releaseOrder]
          : [releaseOrder, releaseClusters];
      view = await app.mountApp();

      await act(async () => first());
      await app.settle();
      expect(savedOrders()).toEqual([]);
      await act(async () => second());
      await app.settle();

      expect(labels()).toEqual(['Global', 'b', 'a']);
      expect(savedOrders()).toEqual([]);
    }
  );

  it('labels contexts that share a name by their file', async () => {
    for (const [name, context] of [
      ['alpha', 'dev'],
      ['beta', 'dev'],
      ['gamma', 'prod'],
    ]) {
      const cluster = app.cluster({ name, context });
      app.namespaces(cluster, ['default']);
      app.startScreen(cluster);
    }

    view = await app.mountApp();

    expect(labels()).toEqual(['Global', 'alpha:dev', 'beta:dev', 'prod']);
  });

  it('switches to a clicked cluster, and enters and leaves Global without changing it', async () => {
    const [a, b] = openClusters('a', 'b');
    view = await app.mountApp();
    expect(tabNamed('a').getAttribute('aria-selected')).toBe('true');

    await click(tabNamed('Global'));
    expect(owners().viewState?.viewType).toBe('global');
    expect(owners().kubeconfig.selectedClusterId).toBe(a.clusterId);
    expect(tabNamed('Global').getAttribute('aria-selected')).toBe('true');
    expect(tabNamed('a').getAttribute('aria-selected')).toBe('false');

    await click(tabNamed('b'));
    expect(owners().kubeconfig.selectedClusterId).toBe(b.clusterId);
    expect(owners().viewState?.viewType).not.toBe('global');
    expect(tabNamed('b').getAttribute('aria-selected')).toBe('true');
  });

  it('closes a cluster from its tab without reloading the saved clusters, and drops Global with it', async () => {
    const [a, b] = openClusters('a', 'b');
    view = await app.mountApp();
    const discoveries = app.backend.calls('GetKubeconfigs').length;
    expect(tabNamed('Global').parentElement?.querySelector('[aria-label^="Close"]')).toBeNull();

    await click(buttonNamed('Close b'));

    expect(app.backend.calls('CloseClusterView')).toEqual([[app.windowName, b.clusterId]]);
    expect(owners().kubeconfig.selectedClusterIds).toEqual([a.clusterId]);
    expect(labels()).toEqual(['a']);
    expect(app.backend.calls('GetKubeconfigs')).toHaveLength(discoveries);
  });

  it('dispatches a second close while the first is still with the backend', async () => {
    const [a, b, c] = openClusters('a', 'b', 'c');
    view = await app.mountApp();
    const release = app.backend.hold('CloseClusterView');

    await act(async () => {
      buttonNamed('Close b').click();
      buttonNamed('Close c').click();
    });
    await app.settle();

    expect(app.backend.calls('CloseClusterView')).toEqual([
      [app.windowName, b.clusterId],
      [app.windowName, c.clusterId],
    ]);
    await act(async () => release());
    await app.settle();
    expect(owners().kubeconfig.selectedClusterIds).toEqual([a.clusterId]);
  });

  it.each([
    { contexts: ['a'], target: 'a', moves: [] },
    { contexts: ['a', 'b', 'c'], target: 'a', moves: ['Move tab right'] },
    { contexts: ['a', 'b', 'c'], target: 'b', moves: ['Move tab left', 'Move tab right'] },
    { contexts: ['a', 'b', 'c'], target: 'c', moves: ['Move tab left'] },
  ])(
    'offers only the moves $target can make among $contexts',
    async ({ contexts, target, moves }) => {
      openClusters(...contexts);
      view = await app.mountApp();

      expect(await openMenu(target)).toEqual([
        'Open in new window',
        'Move to new window',
        'Close',
        ...moves,
      ]);
    }
  );

  it('moves the right-clicked inactive tab and persists the new order', async () => {
    const [a, b, c] = openClusters('a', 'b', 'c');
    view = await app.mountApp();

    await openMenu('b');
    await choose('Move tab right');

    expect(labels()).toEqual(['Global', 'a', 'c', 'b']);
    expect(savedOrders()).toEqual([
      [a.selection, b.selection, c.selection],
      [a.selection, c.selection, b.selection],
    ]);
    expect(owners().kubeconfig.selectedClusterId).toBe(a.clusterId);
  });

  it('opens and closes the right-clicked inactive cluster without switching to it', async () => {
    const [production, staging] = openClusters('production', 'staging');
    app.backend.answer('OpenClusterWindow', () => undefined);
    view = await app.mountApp();

    await openMenu('staging');
    await choose('Open in new window');
    expect(app.backend.calls('OpenClusterWindow')).toEqual([[app.windowName, staging.clusterId]]);
    expect(owners().kubeconfig.selectedClusterId).toBe(production.clusterId);
    expect(menu()).toBeNull();

    await openMenu('staging');
    await choose('Close');
    expect(app.backend.calls('CloseClusterView')).toEqual([[app.windowName, staging.clusterId]]);
    expect(owners().kubeconfig.selectedClusterId).toBe(production.clusterId);
    expect(menu()).toBeNull();
  });

  it('dismisses a tab’s menu when its cluster closes and does not revive it on reopen', async () => {
    const [, b] = openClusters('a', 'b');
    view = await app.mountApp();
    await openMenu('b');
    expect(menu()).not.toBeNull();

    // The cluster closes from outside the menu (a shortcut or another window).
    await act(async () => owners().kubeconfig.closeKubeconfig(b.selection));
    await app.settle();
    expect(menu()).toBeNull();

    await act(async () => owners().kubeconfig.openKubeconfig(b.selection));
    await app.settle();
    expect(labels()).toEqual(['Global', 'a', 'b']);
    expect(menu()).toBeNull();
  });

  it('offers Open Cluster with no cluster open only once the saved clusters have loaded', async () => {
    const release = app.backend.hold('GetKubeconfigs');
    view = await app.mountApp();
    expect(view.container.querySelector('button[aria-label="Open Cluster"]')).toBeNull();

    await act(async () => release());
    await app.settle();
    await click(buttonNamed('Open Cluster'));

    expect(tabs()).toEqual([]);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Select a kubeconfig');
  });

  it('opens the kubeconfig picker from Open Cluster beside open tabs', async () => {
    openClusters('a');
    view = await app.mountApp();
    expect(labels()).toEqual(['a']);

    await click(buttonNamed('Open Cluster'));

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Select a kubeconfig');
  });

  it('requests a cluster view transfer when a tab is dropped from another app window', async () => {
    const [production] = openClusters('production');
    app.backend.answer('RequestClusterTabTransfer', () => undefined);
    view = await app.mountApp();
    const strip = requireValue(
      view.container.querySelector('.cluster-tabs-wrapper'),
      'expected the cluster tabs'
    );
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: () =>
          JSON.stringify({
            kind: 'cluster-tab',
            clusterId: production.clusterId,
            selection: production.selection,
            sourceWindowName: 'workspace-2',
          }),
        types: ['application/x-luxury-yacht-tab', 'application/x-luxury-yacht-tab-cluster-tab'],
        dropEffect: 'move',
      },
    });

    await act(async () => strip.dispatchEvent(drop));
    await app.settle();

    expect(app.backend.calls('RequestClusterTabTransfer')).toEqual([
      [
        app.windowName,
        expect.objectContaining({
          sourceWindowName: 'workspace-2',
          targetWindowName: app.windowName,
          clusterId: production.clusterId,
        }),
      ],
    ]);
  });

  it('visits every tab and control by keyboard without activating a cluster', async () => {
    const [, b] = openClusters('a', 'b', 'c');
    view = await app.mountApp();
    await click(tabNamed('b'));
    const [globalTab, firstTab, activeTab, lastTab] = tabs();
    const order = [
      globalTab,
      firstTab,
      buttonNamed('Close a'),
      activeTab,
      buttonNamed('Close b'),
      lastTab,
      buttonNamed('Close c'),
      buttonNamed('Open Cluster'),
    ];

    await act(async () => globalTab.focus());
    for (const control of order.slice(1)) {
      await press('Tab');
      expect(document.activeElement).toBe(control);
    }
    for (const control of order.slice(0, -1).reverse()) {
      await press('Tab', { shiftKey: true });
      expect(document.activeElement).toBe(control);
    }
    await press('ArrowRight');
    expect(document.activeElement).toBe(firstTab);
    await act(async () => activeTab.focus());
    await press('ArrowRight');
    expect(document.activeElement).toBe(lastTab);
    await press('ArrowLeft');
    expect(document.activeElement).toBe(activeTab);
    await press('ArrowRight');
    await press('Tab', { ctrlKey: true });
    expect(
      requireValue(document.activeElement, 'expected a focused control').closest('nav.sidebar')
    ).not.toBeNull();
    await press('Tab', { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(lastTab);

    expect(owners().kubeconfig.selectedClusterId).toBe(b.clusterId);
    expect(owners().viewState?.viewType).not.toBe('global');
  });

  it.each(['Enter', ' '])('activates the focused cluster tab on %j', async (key) => {
    const [, b] = openClusters('a', 'b');
    view = await app.mountApp();
    await act(async () => tabNamed('b').focus());

    await press(key);

    expect(owners().kubeconfig.selectedClusterId).toBe(b.clusterId);
  });
});
