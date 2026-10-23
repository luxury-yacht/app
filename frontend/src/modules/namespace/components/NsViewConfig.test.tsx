/**
 * frontend/src/modules/namespace/components/NsViewConfig.test.tsx
 *
 * The namespace Config view, and through it the aggregated namespace table it
 * shares with the Autoscaling, Network, Quotas, RBAC, and Storage views
 * (modules/resource-grid/AggregatedResourceGridView.tsx). It lists the
 * namespace's ConfigMaps and Secrets from the backend's query in the visible
 * cluster, opens a row's object in its panel with full identity, offers Delete
 * only where the user may delete, deletes after confirmation, and lists every
 * namespace's objects under All Namespaces. Runs in the full app, navigated
 * through the sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NamespaceConfigSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const configMap = (name: string, namespace = 'team-a'): NamespaceConfigSummary => ({
  ref: {
    clusterId: dev.clusterId,
    group: '',
    version: 'v1',
    kind: 'ConfigMap',
    resource: 'configmaps',
    namespace,
    name,
    uid: `${name}-uid`,
  },
  data: 2,
  age: '1d',
});

const start = async (rows: () => NamespaceConfigSummary[]) => {
  app.startScreen(dev);
  app.serveTable(dev, 'namespace-config', { rows: rows() });
  view = await app.mountApp();
  await view.goTo({ namespace: 'team-a', view: 'config' });
};

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();

/** Right-clicks the row's name, as the user opens its menu, and returns the menu's labels. */
const openRowMenu = async (name: string) => {
  const cell = requireValue(
    rowOf(name).querySelector<HTMLElement>('.grid-cell'),
    `expected a cell in the ${name} row`
  );
  await act(async () => {
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  await app.settle();
  return menuItems().map(menuLabel);
};

const clickMenuItem = async (label: string) => {
  const item = requireValue(
    menuItems().find((candidate) => menuLabel(candidate) === label),
    `expected the ${label} menu item`
  );
  await act(async () => item.click());
  await app.settle();
};

const confirmDelete = async () => {
  const confirm = requireValue(
    Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.confirmation-modal-footer button')
    ).find((button) => button.textContent?.trim() === 'Delete'),
    'expected the delete confirmation'
  );
  await act(async () => confirm.click());
  await app.settle();
};

const deleteTarget = (name: string, namespace = 'team-a') => ({
  clusterId: dev.clusterId,
  group: '',
  version: 'v1',
  kind: 'ConfigMap',
  namespace,
  name,
});

const rowTexts = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).map((row) =>
    row.textContent?.trim()
  );

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NsViewConfig', () => {
  it('lists the namespace’s config objects from the backend query in the visible cluster', async () => {
    await start(() => [configMap('app-config')]);

    expect(rowTexts()).toEqual([expect.stringContaining('app-config')]);
    const read = requireValue(
      app.snapshots.reads('namespace-config').slice(-1)[0],
      'expected a namespace-config read'
    );
    expect(read.scope.startsWith(`${dev.clusterId}|namespace:team-a`)).toBe(true);
  });

  it('opens the focused row’s object in its panel with full identity on Enter', async () => {
    app.servePanel(dev, {
      group: '',
      version: 'v1',
      kind: 'ConfigMap',
      namespace: 'team-a',
      name: 'app-config',
    });
    await start(() => [configMap('app-config')]);
    const table = requireValue(
      view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'expected the config table'
    );

    await act(async () => table.focus());
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await app.settle();

    expect(view.openPanels()).toEqual([
      { ...deleteTarget('app-config'), clusterName: dev.clusterName },
    ]);
  });

  it('deletes a row’s object after confirmation where the user may delete it', async () => {
    app.backend.answer('RunObjectAction', () => ({}) as never);
    await start(() => [configMap('app-config')]);

    expect(await openRowMenu('app-config')).toContain('Delete');
    await clickMenuItem('Delete');
    expect(app.backend.calls('RunObjectAction')).toEqual([]);
    await confirmDelete();

    expect(app.backend.calls('RunObjectAction')).toEqual([
      [{ action: 'delete', target: deleteTarget('app-config') }],
    ]);
  });

  it('offers no Delete where the user may not delete', async () => {
    app.denyPermissions([{ verb: 'delete', resourceKind: 'ConfigMap', namespace: 'team-a' }]);
    await start(() => [configMap('app-config')]);

    expect(await openRowMenu('app-config')).not.toContain('Delete');
  });

  it('reports a delete the backend refuses', async () => {
    app.backend.answer('RunObjectAction', () => {
      throw new Error('configmaps "app-config" is forbidden');
    });
    await start(() => [configMap('app-config')]);
    await openRowMenu('app-config');
    await clickMenuItem('Delete');

    await confirmDelete();

    expect(app.errors.take((record) => record.context?.action === 'delete')).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ name: 'app-config' }) }),
    ]);
  });

  it('lists every namespace’s config objects under All Namespaces', async () => {
    await start(() => [configMap('app-config'), configMap('db-config', 'team-b')]);

    await view.goTo({ namespace: 'namespace:all', view: 'config' });

    expect(rowTexts()).toEqual([
      expect.stringContaining('team-a'),
      expect.stringContaining('team-b'),
    ]);
  });

  it('stops listening for config changes once the user leaves the view', async () => {
    vi.useFakeTimers();
    await start(() => [configMap('app-config')]);
    const configStreams = () =>
      app.streams.active().filter((stream) => stream.startsWith('namespace-config '));
    expect(configStreams()).not.toEqual([]);

    await view.goTo({ clusterView: 'overview' });
    // A released stream closes after the unsubscribe debounce (resourceStreamManager.ts).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(configStreams()).toEqual([]);
  });
});
