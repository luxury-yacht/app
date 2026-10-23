/**
 * frontend/src/ui/favorites/FavToggle.test.tsx
 *
 * A view's favorite heart (useFavToggle): it is filled only when a saved
 * favorite matches the visible cluster, view, namespace, and table settings;
 * it opens the save modal, which saves the current view and table settings as
 * a new favorite, cancels without saving, refuses another favorite's name, and
 * deletes the matching favorite after confirmation. When a favorite is opened,
 * the view's own table restores its saved filter text, sort, and columns and
 * consumes it; a table that offers no favorites leaves it alone. Runs in the
 * full app on the namespace Config view, with the real favorites, kubeconfig,
 * view-state, namespace, and grid-table owners over a faked backend
 * (test-utils/appState). Favorites are opened from the header's menu.
 */

import { act, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '@/core/persistence/favorites';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useFavToggle } from './FavToggle';

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;

const NO_FILTERS: Favorite['filters'] = {
  search: '',
  kinds: { mode: 'all' },
  namespaces: { mode: 'all' },
  clusters: { mode: 'all' },
  includeMetadata: false,
};

/** A favorite of team-a's Config view in alpha, saved with the view's default table. */
const configFavorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'Team A config',
  clusterSelection: alpha.selection,
  clusterId: alpha.clusterId,
  clusterName: alpha.clusterName,
  viewType: 'namespace',
  view: 'config',
  namespace: 'team-a',
  filters: NO_FILTERS,
  tableState: { sortColumn: 'name', sortDirection: 'asc', columnVisibility: {}, columnOrder: [] },
  order: 0,
  ...overrides,
});

const mount = async (saved: Favorite[], probes?: ReactNode) => {
  app.backend.answer('GetFavorites', () => saved);
  view = await app.mountApp(probes);
};

/** Mounts the app on team-a's Config view in alpha. */
const openConfigView = async (saved: Favorite[]) => {
  await mount(saved);
  await view.goTo({ namespace: 'team-a', view: 'config' });
};

const heart = () =>
  requireValue(
    view.container.querySelector<HTMLButtonElement>(
      '.icon-bar-button[aria-label="Save as favorite"], .icon-bar-button[aria-label="Edit favorite"]'
    ),
    'the view’s favorite heart'
  );
const favorited = () => heart().getAttribute('aria-pressed') === 'true';

const dialog = () =>
  document.querySelector<HTMLElement>('[aria-labelledby="fav-save-modal-title"]');
const buttonIn = (root: ParentNode | null, label: string) =>
  requireValue(
    Array.from(root?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent?.trim() === label
    ),
    `the ${label} button`
  );
const nameInput = () =>
  requireValue(dialog()?.querySelector<HTMLInputElement>('input[id$="-fav-name"]'), 'name field');

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

const typeName = async (value: string) => {
  const input = nameInput();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** Opens a saved favorite from the header's Favorites menu, as the user does. */
const openFavorite = async (name: string) => {
  await click(
    requireValue(
      view.container.querySelector<HTMLElement>('button[aria-label="Favorites"]'),
      'the Favorites menu'
    )
  );
  await click(
    requireValue(
      Array.from(view.container.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((row) =>
        row.textContent?.includes(name)
      ),
      `the ${name} favorite`
    )
  );
};

const searchText = () =>
  view.container.querySelector<HTMLInputElement>('input[name="gridtable-filter-search"]')?.value;
const metadataSearch = () =>
  view.container
    .querySelector('.icon-bar-button[aria-label="Include metadata"]')
    ?.getAttribute('aria-pressed');
// The table's visible columns, in order.
const visibleColumns = () =>
  view.container.querySelector<HTMLInputElement>('input[name="gridtable-filter-columns"]')?.value;
const sortedHeaders = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('[aria-sort]'))
    .filter((header) => header.getAttribute('aria-sort') !== 'none')
    .map(
      (header) =>
        `${header.textContent?.replace(/[^\w ]/g, '').trim()} ${header.getAttribute('aria-sort')}`
    );

beforeEach(() => {
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta' });
  for (const cluster of [alpha, beta]) {
    app.namespaces(cluster, ['default', 'team-a']);
    app.startScreen(cluster);
    app.serveTable(cluster, 'namespace-config');
  }
});

describe('the favorite heart', () => {
  it.each([
    ['no favorite is saved', () => [], false],
    ['a favorite matches the view', () => [configFavorite()], true],
    [
      'a favorite pinned to the cluster by id matches, whatever kubeconfig path it was saved with',
      () => [configFavorite({ clusterSelection: '/elsewhere/dev:alpha' })],
      true,
    ],
    [
      'the matching view’s favorite is pinned to another cluster',
      () => [configFavorite({ clusterId: beta.clusterId, clusterSelection: '' })],
      false,
    ],
    [
      'the view’s favorite was saved with other filters',
      () => [configFavorite({ filters: { ...NO_FILTERS, search: 'other' } })],
      false,
    ],
  ] as const)('is filled only when it should be: %s', async (_case, saved, expected) => {
    await openConfigView([...saved()]);

    expect(favorited()).toBe(expected);
  });

  it('saves the current view and its table settings as a new favorite, then fills', async () => {
    app.backend.answer('AddFavorite', (saved) => ({ ...saved, id: 'saved-1' }));
    await openConfigView([]);

    await click(heart());
    expect(dialog()).not.toBeNull();
    await click(buttonIn(dialog(), 'Save'));

    expect(app.backend.calls('AddFavorite')).toEqual([
      [
        expect.objectContaining({
          id: '',
          clusterSelection: alpha.selection,
          clusterId: alpha.clusterId,
          viewType: 'namespace',
          view: 'config',
          namespace: 'team-a',
          filters: NO_FILTERS,
          tableState: {
            sortColumn: 'name',
            sortDirection: 'asc',
            columnVisibility: {},
            columnOrder: [],
          },
        }),
      ],
    ]);
    expect(dialog()).toBeNull();
    expect(favorited()).toBe(true);
  });

  it('closes the save modal without saving when cancelled', async () => {
    app.backend.answer('AddFavorite', (saved) => saved);
    await openConfigView([]);
    await click(heart());

    await click(buttonIn(dialog(), 'Cancel'));

    expect(dialog()).toBeNull();
    expect(app.backend.calls('AddFavorite')).toEqual([]);
    expect(favorited()).toBe(false);
  });

  it('refuses another favorite’s name but keeps the edited favorite’s own', async () => {
    await openConfigView([
      configFavorite(),
      configFavorite({ id: 'fav-2', name: 'Other Favorite', view: 'pods' }),
    ]);
    await click(heart());
    expect(nameInput().value).toBe('Team A config');
    expect(nameInput().getAttribute('aria-invalid')).toBeNull();

    await typeName('Other Favorite');

    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    expect(buttonIn(dialog(), 'Save').disabled).toBe(true);
  });

  it('deletes the matching favorite after confirmation', async () => {
    app.backend.answer('DeleteFavorite', () => undefined);
    await openConfigView([configFavorite({ id: 'fav-42' })]);
    await click(heart());

    await click(buttonIn(dialog(), 'Delete'));
    expect(app.backend.calls('DeleteFavorite')).toEqual([]);
    await click(buttonIn(document.querySelector('.confirmation-modal-footer'), 'Delete'));

    expect(app.backend.calls('DeleteFavorite')).toEqual([['fav-42']]);
    expect(favorited()).toBe(false);
  });

  it('keeps case-distinct cluster ids in a saved snapshot', async () => {
    app.backend.answer('AddFavorite', (saved) => saved);
    const clusters = { mode: 'some' as const, values: ['Cluster-A', 'cluster-a'] };
    function GlobalTable() {
      const { item, modal } = useFavToggle({
        filters: { ...NO_FILTERS, clusters },
        sortColumn: null,
        sortDirection: 'asc',
        columnVisibility: {},
      });
      return (
        <div data-probe-table>
          <button type="button" onClick={item?.type === 'toggle' ? item.onClick : undefined}>
            Probe heart
          </button>
          {modal}
        </div>
      );
    }
    await mount([], <GlobalTable />);

    await click(buttonIn(view.container.querySelector('[data-probe-table]'), 'Probe heart'));
    await click(buttonIn(dialog(), 'Save'));

    expect(app.backend.calls('AddFavorite')[0]?.[0].filters.clusters).toEqual(clusters);
  });
});

describe('opening a favorite', () => {
  it('restores the saved filter text, sort, and columns into the view’s table, then matches', async () => {
    const saved = configFavorite({
      name: 'Team A recent config',
      filters: { ...NO_FILTERS, search: 'saved filter', includeMetadata: true },
      tableState: {
        sortColumn: 'age',
        sortDirection: 'desc',
        columnVisibility: { data: false },
        columnOrder: ['name', 'kind', 'data', 'age'],
      },
    });
    await mount([saved]);

    await openFavorite('Team A recent config');

    expect(view.owners().viewState?.activeNamespaceTab).toBe('config');
    expect(searchText()).toBe('saved filter');
    expect(metadataSearch()).toBe('true');
    expect(sortedHeaders()).toEqual(['Age descending']);
    expect(visibleColumns()).toBe('name,kind,age');
    expect(favorited()).toBe(true);
  });

  it('restores a favorite saved unsorted as an unsorted table, then matches', async () => {
    // The save modal's "None" sort, or hiding the sorted column, saves no sort column.
    await mount([
      configFavorite({
        name: 'Team A unsorted config',
        tableState: { sortColumn: '', sortDirection: 'asc', columnVisibility: {}, columnOrder: [] },
      }),
    ]);

    await openFavorite('Team A unsorted config');

    expect(sortedHeaders()).toEqual([]);
    expect(favorited()).toBe(true);
  });

  it('leaves an opened favorite to the view’s table when another table offers no favorites', async () => {
    // An attached table on the same view offers no favorites.
    const restore = vi.fn();
    function AttachedTable() {
      useFavToggle({
        enabled: false,
        filters: NO_FILTERS,
        sortColumn: null,
        sortDirection: 'asc',
        columnVisibility: {},
        hydrated: true,
        setFilters: restore,
        setSortConfig: restore,
      });
      return null;
    }
    app.backend.answer('GetFavorites', () => [
      configFavorite({ filters: { ...NO_FILTERS, search: 'saved filter' } }),
    ]);
    view = await app.mountApp(<AttachedTable />);

    await openFavorite('Team A config');

    expect(restore).not.toHaveBeenCalled();
    expect(searchText()).toBe('saved filter');
  });
});
