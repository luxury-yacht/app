/**
 * frontend/src/ui/favorites/FavMenuDropdown.test.tsx
 *
 * The header's Favorites menu: it opens from its trigger by click or keyboard,
 * lists the backend's saved favorites in order, opens a favorite's view (by
 * click or Enter) in the active cluster or, for a pinned favorite, in its own
 * cluster, deletes and reorders favorites through the backend without
 * navigating, and closes on a second click or Escape with focus returned to
 * its trigger. Runs in the full app, where the header renders it, with the
 * real favorites, kubeconfig, view-state, and namespace owners over a faked
 * backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Favorite } from '@/core/persistence/favorites';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;

const favorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'Default config',
  clusterSelection: '',
  viewType: 'namespace',
  view: 'config',
  namespace: 'default',
  filters: {
    search: '',
    kinds: { mode: 'all' },
    namespaces: { mode: 'all' },
    clusters: { mode: 'all' },
    includeMetadata: false,
  },
  tableState: { sortColumn: 'name', sortDirection: 'asc', columnVisibility: {} },
  order: 0,
  ...overrides,
});

const start = async (saved: Favorite[]) => {
  app.backend.answer('GetFavorites', () => saved);
  view = await app.mountApp();
};

const navigation = () => requireValue(view.owners().viewState, 'workspace navigation');
const trigger = () =>
  requireValue(
    view.container.querySelector<HTMLButtonElement>('button[aria-label="Favorites"]'),
    'the Favorites trigger'
  );
const menu = () => view.container.querySelector<HTMLElement>('.fav-dropdown-anchor [role="menu"]');
const rows = () => Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
const rowNamed = (name: string) =>
  requireValue(
    rows().find((row) => row.textContent?.includes(name)),
    `the ${name} favorite row`
  );
const actionIn = (row: HTMLElement, title: string) =>
  requireValue(row.querySelector<HTMLButtonElement>(`button[title="${title}"]`), title);

const press = async (target: HTMLElement, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    target.focus();
    target.dispatchEvent(event);
  });
  await app.settle();
  return event;
};

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

const openMenu = async () => {
  await click(trigger());
  requireValue(menu(), 'the open Favorites menu');
};

beforeEach(() => {
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta' });
  app.namespaces(alpha, ['default']);
  app.namespaces(beta, ['default', 'other-team']);
  for (const cluster of [alpha, beta]) {
    app.startScreen(cluster);
    app.serveTable(cluster, 'namespace-config');
  }
});

describe('FavMenuDropdown', () => {
  it('opens from keyboard activation on its trigger', async () => {
    await start([]);

    await press(trigger(), 'Enter');

    expect(menu()).not.toBeNull();
  });

  it('lists the saved favorites in their saved order', async () => {
    await start([
      favorite({ id: 'fav-1', name: 'Default config' }),
      favorite({ id: 'fav-2', name: 'Nodes', viewType: 'cluster', view: 'nodes', order: 1 }),
    ]);

    await openMenu();

    expect(rows().map((row) => row.querySelector('.fav-dropdown-name')?.textContent)).toEqual([
      'Default config',
      'Nodes',
    ]);
  });

  it('opens a favorite’s view in the active cluster and closes the menu', async () => {
    await start([favorite()]);
    await openMenu();

    await click(rowNamed('Default config'));

    expect(view.owners().kubeconfig.selectedClusterId).toBe(alpha.clusterId);
    expect(navigation().viewType).toBe('namespace');
    expect(navigation().activeNamespaceTab).toBe('config');
    expect(view.owners().namespace.selectedNamespace).toBe('default');
    expect(menu()).toBeNull();
  });

  it('opens a favorite from its focused row with Enter', async () => {
    await start([favorite()]);
    await openMenu();

    await press(rowNamed('Default config'), 'Enter');

    expect(navigation().viewType).toBe('namespace');
    expect(navigation().activeNamespaceTab).toBe('config');
  });

  it('opens a pinned favorite in its own cluster even when the active cluster lacks its namespace', async () => {
    await start([
      favorite({
        name: 'Other team config',
        namespace: 'other-team',
        clusterId: beta.clusterId,
        clusterSelection: beta.selection,
      }),
    ]);
    await openMenu();
    const row = rowNamed('Other team config');
    expect(row.getAttribute('aria-disabled')).toBe('false');

    await click(row);

    expect(view.owners().kubeconfig.selectedClusterId).toBe(beta.clusterId);
    expect(navigation().viewType).toBe('namespace');
    expect(view.owners().namespace.selectedNamespace).toBe('other-team');
  });

  it('deletes a favorite through the backend without navigating', async () => {
    app.backend.answer('DeleteFavorite', () => undefined);
    await start([favorite({ id: 'fav-1' }), favorite({ id: 'fav-2', name: 'Second', order: 1 })]);
    await openMenu();

    await click(actionIn(rowNamed('Default config'), 'Delete favorite'));

    expect(app.backend.calls('DeleteFavorite')).toEqual([['fav-1']]);
    expect(rows().map((row) => row.querySelector('.fav-dropdown-name')?.textContent)).toEqual([
      'Second',
    ]);
    expect(navigation().viewType).toBe('overview');
  });

  it('reorders favorites from their buttons, by click or keyboard, without navigating', async () => {
    app.backend.answer('SetFavoriteOrder', () => undefined);
    await start([
      favorite({ id: 'first', name: 'First' }),
      favorite({ id: 'second', name: 'Second', order: 1 }),
    ]);
    await openMenu();

    // Enter and Space on a reorder button belong to the button, not its row.
    for (const [name, title, key] of [
      ['Second', 'Move up', 'Enter'],
      ['Second', 'Move down', ' '],
    ] as const) {
      const button = actionIn(rowNamed(name), title);
      const event = await press(button, key);
      expect(event.defaultPrevented).toBe(false);
      await click(button);
    }

    expect(app.backend.calls('SetFavoriteOrder')).toEqual([
      [['second', 'first']],
      [['first', 'second']],
    ]);
    expect(navigation().viewType).toBe('overview');
  });

  it('closes on a second click of its trigger', async () => {
    await start([]);
    await openMenu();

    await click(trigger());

    expect(menu()).toBeNull();
  });

  it('closes on Escape from a favorite action and returns focus to its trigger', async () => {
    await start([favorite()]);
    await openMenu();

    await press(actionIn(rowNamed('Default config'), 'Move up'), 'Escape');

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
