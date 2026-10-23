/**
 * frontend/src/ui/favorites/FavSaveModal.test.tsx
 *
 * The favorite save modal's data contract: it saves the current view's route
 * (bound to the selected cluster's id and name, or to no cluster for Global
 * views) with every declared table filter, column, and sort setting the user
 * leaves or edits; keeps case-distinct cluster ids and semantic "all"
 * selections; offers only valid kubeconfig contexts; refuses another
 * favorite's name; keeps the draft while the live table refreshes and starts
 * over on reopen; enables Save for an edit only after a change; offers Delete
 * only for an existing favorite; stays open when its overlay is clicked; and
 * reports a rejected save inline. Runs inside the production shell with the
 * real kubeconfig and namespace owners, keyboard registry, dropdowns, and
 * portals (test-utils/appState); the modal's props are what the view's heart
 * passes it (FavToggle.test.tsx covers that wiring).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import FavSaveModal, { type FavoriteModalTable, type FavSaveModalProps } from './FavSaveModal';

const app = installAppStateHarness();
let view: MountedApp | undefined;
let prod: TestCluster;

const defaultFilters: FavoriteFilters = {
  search: '',
  kinds: { mode: 'all' },
  namespaces: { mode: 'all' },
  clusters: { mode: 'all' },
  queryFacets: {
    apiGroups: { mode: 'some', values: ['apps'] },
    resourceScopes: { mode: 'some', values: ['Namespace'] },
  },
  includeMetadata: false,
};

const defaultTableState: FavoriteTableState = {
  sortColumn: 'name',
  sortDirection: 'asc',
  columnVisibility: {},
};

const threeColumns = [
  { key: 'name', label: 'Name', hideable: false, sortable: true },
  { key: 'status', label: 'Status', hideable: true, sortable: true },
  { key: 'age', label: 'Age', hideable: true, sortable: true },
];

const ownersFacet = {
  key: 'owners',
  label: 'Owners',
  placeholder: 'All owners',
  options: [
    { value: 'Deployment/api', label: 'Deployment/api' },
    { value: 'StatefulSet/db', label: 'StatefulSet/db' },
  ],
};

const makeFavorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'My Pods',
  clusterSelection: prod.selection,
  viewType: 'namespace',
  view: 'pods',
  namespace: 'default',
  filters: { ...defaultFilters },
  tableState: { ...defaultTableState },
  order: 0,
  ...overrides,
});

const makeTable = (overrides: Partial<FavoriteModalTable> = {}): FavoriteModalTable => ({
  filters: { ...defaultFilters },
  tableState: { ...defaultTableState },
  filterOptions: {},
  ...overrides,
});

const makeProps = (overrides: Partial<FavSaveModalProps> = {}): FavSaveModalProps => ({
  isOpen: true,
  onClose: vi.fn(),
  existingFavorite: null,
  defaultName: 'prod / default / Pods',
  kubeconfigSelection: prod.selection,
  viewType: 'namespace',
  viewLabel: 'Pods',
  namespace: 'default',
  table: makeTable(),
  onSave: vi.fn(),
  onDelete: vi.fn(),
  ...overrides,
});

/** Shows the modal with `props`, mounting the shell on first use. */
const show = async (props: FavSaveModalProps) => {
  view ??= await app.render(null);
  await view.show(<FavSaveModal {...props} />);
};

const dialog = () =>
  requireValue(
    document.querySelector<HTMLElement>('[aria-labelledby="fav-save-modal-title"]'),
    'the favorite modal'
  );
const buttonIn = (root: ParentNode, label: string) =>
  requireValue(
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === label
    ),
    `the ${label} button`
  );
const saveButton = () => buttonIn(dialog(), 'Save');
const nameInput = () =>
  requireValue(dialog().querySelector<HTMLInputElement>('input[id$="-fav-name"]'), 'name field');

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

/** The dropdown trigger a form label names. */
const control = (label: string) => {
  const labelElement = requireValue(
    Array.from(dialog().querySelectorAll<HTMLLabelElement>('label')).find(
      (candidate) => candidate.textContent?.trim() === label
    ),
    `the ${label} label`
  );
  return requireValue(
    document.getElementById(labelElement.htmlFor) as HTMLButtonElement | null,
    `the ${label} control`
  );
};

/** The trigger of the favorite's cluster dropdown, beside the Cluster scope. */
const clusterControl = () =>
  requireValue(
    Array.from(dialog().querySelectorAll<HTMLElement>('.fav-save-inline-row'))
      .find(
        (row) => row.querySelector('input[type="radio"]') && row.textContent?.includes('Cluster')
      )
      ?.querySelector<HTMLButtonElement>('.dropdown-trigger'),
    'the cluster dropdown'
  );

/** Opens a dropdown and returns its menu. */
const openMenu = async (trigger: HTMLButtonElement) => {
  await click(trigger);
  return requireValue(
    document.getElementById(trigger.getAttribute('aria-controls') ?? ''),
    'the open dropdown menu'
  );
};
const optionIn = (menu: HTMLElement, label: string) =>
  requireValue(
    Array.from(menu.querySelectorAll<HTMLButtonElement>('.dropdown-option')).find(
      (option) => option.textContent?.trim() === label
    ),
    `the ${label} option`
  );
/** Picks options in an open dropdown, as the user clicks them. */
const pick = async (trigger: HTMLButtonElement, ...labels: string[]) => {
  const menu = await openMenu(trigger);
  for (const label of labels) {
    await click(optionIn(menu, label));
  }
};

/** Saves and returns the favorite the modal handed to its owner. */
const save = async (onSave: ReturnType<typeof vi.fn>) => {
  await click(saveButton());
  return onSave.mock.calls[0]?.[0] as Favorite;
};

beforeEach(() => {
  view = undefined;
  prod = app.cluster({ name: 'config', context: 'prod' });
  app.namespaces(prod, ['default', 'kube-system']);
});

describe('saving a favorite', () => {
  it('saves the current view bound to the selected cluster, then closes', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    await show(makeProps({ onSave, onClose }));

    const saved = await save(onSave);

    expect(saved).toEqual({
      id: '',
      name: 'prod / default / Pods',
      clusterSelection: prod.selection,
      clusterId: prod.clusterId,
      clusterName: prod.clusterName,
      viewType: 'namespace',
      view: 'pods',
      namespace: 'default',
      filters: defaultFilters,
      tableState: defaultTableState,
      order: 0,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves a Global favorite without an active-cluster binding', async () => {
    const onSave = vi.fn();
    await show(makeProps({ onSave, viewType: 'global', viewLabel: 'Clusters', namespace: '' }));

    expect(await save(onSave)).toEqual(
      expect.objectContaining({
        clusterSelection: '',
        clusterId: '',
        clusterName: '',
        viewType: 'global',
        view: 'fleet',
        namespace: '',
      })
    );
  });

  it('keeps the saved route and table settings: the view cannot be retargeted', async () => {
    const onSave = vi.fn();
    await show(makeProps({ onSave }));

    expect(control('View').disabled).toBe(true);
    const saved = await save(onSave);
    expect(saved).toEqual(
      expect.objectContaining({
        viewType: 'namespace',
        view: 'pods',
        namespace: 'default',
        filters: defaultFilters,
        tableState: defaultTableState,
      })
    );
  });

  it('saves every declared filter of the table, including an edited provider facet', async () => {
    const onSave = vi.fn();
    await show(
      makeProps({
        onSave,
        table: makeTable({
          filters: {
            ...defaultFilters,
            clusters: { mode: 'some', values: ['cluster-a'] },
            queryFacets: { owners: { mode: 'some', values: ['Deployment/api'] } },
          },
          tableState: { ...defaultTableState, sortColumn: 'node' },
          filterOptions: {
            showClusterDropdown: true,
            clusters: [{ value: 'cluster-a', label: 'Production' }],
            queryFacets: [ownersFacet],
          },
        }),
      })
    );

    await pick(control('Owners'), 'Deployment/api', 'StatefulSet/db');
    const saved = await save(onSave);

    expect(saved.filters.clusters).toEqual({ mode: 'some', values: ['cluster-a'] });
    expect(saved.filters.queryFacets?.owners).toEqual({
      mode: 'some',
      values: ['StatefulSet/db'],
    });
    expect(saved.tableState.sortColumn).toBe('node');
  });

  it('keeps and edits case-distinct saved cluster ids', async () => {
    const onSave = vi.fn();
    const values = ['config:Production', 'config:production'];
    await show(
      makeProps({
        onSave,
        table: makeTable({
          filters: { ...defaultFilters, clusters: { mode: 'some', values } },
          filterOptions: { showClusterDropdown: true, clusters: [] },
        }),
      })
    );

    // The saved ids are offered even though the table no longer lists them.
    await pick(control('Clusters'), values[1]);
    const saved = await save(onSave);

    expect(saved.filters.clusters).toEqual({ mode: 'some', values: [values[0]] });
  });

  it('saves Select all as a semantic all selection for a provider facet', async () => {
    const onSave = vi.fn();
    await show(
      makeProps({
        onSave,
        table: makeTable({
          filters: {
            ...defaultFilters,
            queryFacets: { owners: { mode: 'some', values: ['Deployment/api'] } },
          },
          filterOptions: { queryFacets: [ownersFacet] },
        }),
      })
    );

    const menu = await openMenu(control('Owners'));
    await click(
      requireValue(menu.querySelector<HTMLButtonElement>('[aria-label="Select all"]'), 'Select all')
    );
    const saved = await save(onSave);

    expect(saved.filters.queryFacets?.owners).toEqual({ mode: 'all' });
  });

  it('edits column visibility, order, and sort for a saved table', async () => {
    const onSave = vi.fn();
    const existingFavorite = makeFavorite({
      tableState: {
        sortColumn: 'name',
        sortDirection: 'asc',
        columnVisibility: { status: false },
        columnOrder: ['name', 'status', 'age'],
      },
    });
    await show(
      makeProps({
        existingFavorite,
        onSave,
        table: makeTable({
          filters: existingFavorite.filters,
          tableState: existingFavorite.tableState,
          columns: threeColumns,
        }),
      })
    );

    const columns = await openMenu(control('Columns'));
    await click(
      requireValue(
        columns.querySelector<HTMLElement>('[data-column-key="status"] .dropdown-option'),
        'the Status column'
      )
    );
    const nameHandle = requireValue(
      columns.querySelector<HTMLElement>('button[data-column-key="name"]'),
      'the Name reorder handle'
    );
    await act(async () => {
      nameHandle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      );
    });
    await pick(control('Sort by'), 'Age');
    await pick(control('Direction'), 'Descending');
    const saved = await save(onSave);

    expect(saved.tableState).toEqual({
      sortColumn: 'age',
      sortDirection: 'desc',
      columnVisibility: {},
      columnOrder: ['status', 'name', 'age'],
    });
  });

  it('drops the sort on a column the favorite hides', async () => {
    const onSave = vi.fn();
    const existingFavorite = makeFavorite({
      tableState: {
        sortColumn: 'status',
        sortDirection: 'asc',
        columnVisibility: {},
        columnOrder: ['name', 'status', 'age'],
      },
    });
    await show(
      makeProps({
        existingFavorite,
        onSave,
        table: makeTable({
          filters: existingFavorite.filters,
          tableState: existingFavorite.tableState,
          columns: threeColumns,
        }),
      })
    );

    await pick(control('Columns'), 'Status');
    const saved = await save(onSave);

    expect(saved.tableState).toMatchObject({ sortColumn: '', columnVisibility: { status: false } });
  });

  it('keeps the modal open and reports a save the backend rejects', async () => {
    const error = new Error('Favorites use a newer schema');
    const onClose = vi.fn();
    await show(makeProps({ onSave: vi.fn().mockRejectedValue(error), onClose }));

    await click(saveButton());

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(error.message);
    expect(app.errors.take((record) => record.error === error)).toEqual([
      expect.objectContaining({
        kinds: ['inline'],
        context: { action: 'saveFavorite', source: 'FavSaveModal' },
      }),
    ]);
  });
});

describe('the favorite form', () => {
  it('offers no invalid kubeconfig context as the favorite’s cluster', async () => {
    app.backend.answer('GetKubeconfigs', () => ({
      kubeconfigs: [
        {
          name: 'config',
          path: '/kube/config',
          context: 'prod',
          isDefault: false,
          isCurrentContext: false,
          invalid: false,
          invalidReason: '',
        },
        {
          name: 'broken',
          path: '/kube/broken',
          context: 'broken-context',
          isDefault: false,
          isCurrentContext: false,
          invalid: true,
          invalidReason: 'no cluster',
        },
      ],
      state: backend.KubeconfigDiscoveryState.KubeconfigDiscoveryStateAvailable,
      searchPaths: ['/kube'],
    }));
    await show(makeProps());

    const menu = await openMenu(clusterControl());
    const contextOption = (context: string) =>
      requireValue(
        Array.from(menu.querySelectorAll<HTMLButtonElement>('.dropdown-option')).find(
          (option) => option.querySelector('.kubeconfig-label__context')?.textContent === context
        ),
        `the ${context} context`
      );

    expect(contextOption('broken-context').disabled).toBe(true);
    expect(contextOption('prod').disabled).toBe(false);
  });

  it('refuses a name another saved favorite already uses', async () => {
    const onSave = vi.fn();
    await show(makeProps({ defaultName: 'My Pods', unavailableNames: ['My Pods'], onSave }));

    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    expect(saveButton().disabled).toBe(true);
    await click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps an edited name while the live table refreshes', async () => {
    const table = makeTable({
      filterOptions: { showKindDropdown: true, kinds: ['Pod', 'Deployment'] },
    });
    const props = makeProps({ table });
    await show(props);
    const input = nameInput();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'My custom favorite'
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await show({
      ...props,
      table: { ...table, filterOptions: { ...table.filterOptions, kinds: ['Pod', 'Deployment'] } },
    });

    expect(nameInput().value).toBe('My custom favorite');
  });

  it('starts a new draft from the current view when reopened', async () => {
    const props = makeProps({ defaultName: 'Initial name' });
    await show(props);
    await show({ ...props, isOpen: false, defaultName: 'Updated name' });
    await show({ ...props, isOpen: true, defaultName: 'Updated name' });

    expect(nameInput().value).toBe('Updated name');
  });

  it('enables Save for an existing favorite only after a change', async () => {
    const existingFavorite = makeFavorite();
    await show(
      makeProps({
        existingFavorite,
        defaultName: existingFavorite.name,
        table: makeTable({ filters: existingFavorite.filters }),
      })
    );
    expect(saveButton().disabled).toBe(true);

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        nameInput(),
        'Renamed'
      );
      nameInput().dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(saveButton().disabled).toBe(false);
  });

  it('offers Delete only for an existing favorite', async () => {
    await show(makeProps({ existingFavorite: null }));
    expect(
      Array.from(dialog().querySelectorAll('button')).some((b) => b.textContent === 'Delete')
    ).toBe(false);

    await show(makeProps({ existingFavorite: makeFavorite() }));
    expect(buttonIn(dialog(), 'Delete')).toBeTruthy();
  });

  it('stays open when the overlay or modal body is clicked', async () => {
    const onClose = vi.fn();
    await show(makeProps({ onClose }));
    const overlay = requireValue(dialog().closest<HTMLElement>('.modal-overlay'), 'the overlay');

    await act(async () => {
      dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
