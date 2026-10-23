/**
 * frontend/src/shared/components/tables/GridTableFiltersBar.test.tsx
 *
 * The table filter bar: its Kinds, Namespaces, Clusters, and query-facet
 * menus report the values the user picks (cluster IDs compared exactly), its
 * chips clear one filter or all of them, the result count appears only while
 * a filter narrows the rows (marking approximate totals), partial data shows a
 * Partial chip that explains it, filtered or not, the search box keeps focus while typing and answers
 * the app's Find shortcut, and the Columns menu shows, reorders, resets, and
 * edits custom columns. Runs the real filter bar and dropdowns inside the
 * production shell (keyboard and zoom owners) with only the backend boundary
 * faked (test-utils/appState).
 */

import GridTableFiltersBar from '@shared/components/tables/GridTableFiltersBar';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

type FiltersBarProps = React.ComponentProps<typeof GridTableFiltersBar>;

const NO_FILTERS: FiltersBarProps['activeFilters'] = {
  search: '',
  kinds: { mode: 'all' },
  namespaces: { mode: 'all' },
  clusters: { mode: 'all' },
  includeMetadata: false,
};

const app = installAppStateHarness();
// Spies this file installs, restored after each test; the harness keeps its own.
const spies: Array<{ mockRestore(): void }> = [];
const track = <S extends { mockRestore(): void }>(spy: S): S => {
  spies.push(spy);
  return spy;
};
let view: MountedApp;

beforeEach(async () => {
  view = await app.render(null);
});

afterEach(() => {
  vi.useRealTimers();
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

const renderFilters = (props: Partial<FiltersBarProps>) =>
  view.show(
    <GridTableFiltersBar
      activeFilters={NO_FILTERS}
      resolvedFilterOptions={{
        searchBehavior: 'local',
        clusters: [
          { label: 'alpha', value: 'cluster-a' },
          { label: 'beta', value: 'cluster-b' },
        ],
        kinds: [
          { label: 'Pods', value: 'Pod' },
          { label: 'Deployments', value: 'Deployment' },
        ],
        namespaces: [
          { label: 'team-a', value: 'team-a' },
          { label: 'team-b', value: 'team-b' },
        ],
      }}
      kindDropdownId="kinds"
      namespaceDropdownId="namespaces"
      clusterDropdownId="clusters"
      searchInputId="search"
      onKindsChange={vi.fn()}
      onNamespacesChange={vi.fn()}
      onClustersChange={vi.fn()}
      onFiltersChange={vi.fn()}
      onSearchChange={vi.fn()}
      onReset={vi.fn()}
      renderOption={(choice) => choice.label}
      {...props}
    />
  );

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
  });
};

const button = (label: string) =>
  requireValue(
    document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    `button ${label}`
  );

/** Opens the filter menu with the given role in the bar. */
const openMenu = async (role: string) => {
  await click(
    requireValue(
      view.container.querySelector<HTMLElement>(
        `[data-gridtable-filter-role="${role}"] .dropdown-trigger, [data-gridtable-filter-role="${role}"] button[aria-haspopup]`
      ),
      `${role} menu button`
    )
  );
};

// Each option's own button (not its row's Only, Edit, or reorder actions).
const menuOptions = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('button[data-dropdown-option-index]'));

const option = (label: string) =>
  requireValue(
    menuOptions().find((candidate) => candidate.textContent?.trim() === label),
    `option ${label}`
  );

const isChosen = (element: HTMLElement) =>
  element.getAttribute('aria-selected') === 'true' ||
  element.getAttribute('aria-pressed') === 'true';

const resultCount = () =>
  view.container.querySelector('[data-gridtable-filter-role="result-count"]');

const chips = () =>
  requireValue(
    view.container.querySelector('[aria-label="Active GridTable filters"]'),
    'active filter chips'
  );

describe('GridTableFiltersBar menus', () => {
  it('reports the kinds and namespaces the user leaves selected, with search and bulk choices for kinds', async () => {
    const onKindsChange = vi.fn();
    const onNamespacesChange = vi.fn();
    await renderFilters({
      showKindDropdown: true,
      showNamespaceDropdown: true,
      onKindsChange,
      onNamespacesChange,
    });

    await openMenu('kind');
    // Kinds are always searchable and offer Select all / none.
    expect(document.body.querySelector('[role="combobox"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="Select none"]')).not.toBeNull();
    await click(option('Deployments'));
    expect(onKindsChange).toHaveBeenLastCalledWith(['Pod']);

    await openMenu('namespace');
    await click(option('team-a'));
    expect(onNamespacesChange).toHaveBeenLastCalledWith(['team-b']);
  });

  it('reports cluster IDs, not their context names', async () => {
    const onClustersChange = vi.fn();
    await renderFilters({ showClusterDropdown: true, onClustersChange });

    await openMenu('cluster');
    expect(menuOptions().map((candidate) => candidate.textContent?.trim())).toEqual([
      'alpha',
      'beta',
    ]);
    await click(option('alpha'));

    expect(onClustersChange).toHaveBeenLastCalledWith(['cluster-b']);
  });

  it.each(['all', 'some'] as const)(
    'shows case-distinct clusters selected in %s mode',
    async (mode) => {
      const values = ['config:Production', 'config:production'];
      await renderFilters({
        showClusterDropdown: true,
        activeFilters: {
          ...NO_FILTERS,
          clusters: mode === 'some' ? { mode, values } : { mode },
        },
        resolvedFilterOptions: {
          kinds: [],
          namespaces: [],
          clusters: values.map((value) => ({ value, label: value })),
        },
      });

      await openMenu('cluster');

      expect(values.map((value) => isChosen(option(value)))).toEqual([true, true]);
    }
  );

  it('reports a backend query facet change by its facet key, with search and bulk choices', async () => {
    const onQueryFacetChange = vi.fn();
    await renderFilters({
      activeFilters: {
        ...NO_FILTERS,
        queryFacets: { apiGroups: { mode: 'some', values: ['apps'] } },
      },
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [],
        queryFacets: [
          {
            key: 'apiGroups',
            label: 'API groups',
            placeholder: 'All API groups',
            options: [
              { label: 'core', value: '(core)' },
              { label: 'apps', value: 'apps' },
            ],
            searchable: true,
            bulkActions: true,
          },
        ],
      },
      queryFacetDropdownIdPrefix: 'facet',
      onQueryFacetChange,
    });

    await openMenu('query-facet-apiGroups');
    expect(document.body.querySelector('[role="combobox"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="Select all"]')).not.toBeNull();
    await click(option('core'));

    expect(onQueryFacetChange).toHaveBeenLastCalledWith('apiGroups', ['apps', '(core)']);
  });
});

describe('GridTableFiltersBar chips', () => {
  it('counts every stored kind and an empty namespace selection, and clears one filter', async () => {
    const onFiltersChange = vi.fn();
    await renderFilters({
      showKindDropdown: true,
      showNamespaceDropdown: true,
      activeFilters: {
        ...NO_FILTERS,
        kinds: { mode: 'some', values: ['Pod', 'Kind no longer available'] },
        namespaces: { mode: 'none' },
      },
      onFiltersChange,
    });
    const trigger = (role: string) =>
      view.container.querySelector(`[data-gridtable-filter-role="${role}"] .dropdown-value`)
        ?.textContent;

    expect(chips().textContent).toContain('Kinds: 2');
    expect(chips().textContent).toContain('Namespaces: 0');
    expect(chips().textContent).not.toContain('Clusters');
    // An empty selection must not read like the unfiltered "all" state.
    expect(trigger('kind')).toBe('Kinds (2)');
    expect(trigger('namespace')).toBe('Namespaces (0)');

    await click(button('Clear Kinds filter'));
    expect(onFiltersChange).toHaveBeenCalledWith({ kinds: { mode: 'all' } });
  });

  it('counts query facet selections and clears one facet back to all', async () => {
    const onFiltersChange = vi.fn();
    await renderFilters({
      activeFilters: {
        ...NO_FILTERS,
        queryFacets: {
          status: { mode: 'some', values: ['Running', 'Pending'] },
          owner: { mode: 'none' },
        },
      },
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [],
        queryFacets: [
          { key: 'status', label: 'Status', placeholder: 'All statuses', options: [] },
          { key: 'owner', label: 'Owner', placeholder: 'All owners', options: [] },
        ],
      },
      onFiltersChange,
    });

    expect(chips().textContent).toContain('Statuses: 2');
    expect(chips().textContent).toContain('Owners: 0');

    await click(button('Clear Status filter'));

    expect(onFiltersChange).toHaveBeenCalledWith({
      queryFacets: { status: { mode: 'all' }, owner: { mode: 'none' } },
    });
  });

  it('clears the search text and metadata filter individually or all filters at once', async () => {
    const onFiltersChange = vi.fn();
    const onReset = vi.fn();
    await renderFilters({
      activeFilters: { ...NO_FILTERS, search: 'web', includeMetadata: true },
      onFiltersChange,
      onReset,
    });

    expect(chips().textContent).toContain('Text: web');
    expect(chips().textContent).toContain('Include metadata');

    await click(button('Clear text filter'));
    expect(onFiltersChange).toHaveBeenCalledWith({ search: '' });

    await click(button('Clear all filters'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe('GridTableFiltersBar result count', () => {
  it('shows matching-of-total rows only while a filter narrows the rows', async () => {
    await renderFilters({ resultCount: { filtered: 50, unfiltered: 100, capped: true } });
    expect(resultCount()).toBeNull();

    await renderFilters({
      activeFilters: { ...NO_FILTERS, search: 'web' },
      resultCount: { filtered: 12, unfiltered: 100 },
    });
    expect(resultCount()?.textContent).toBe('Showing 12 of 100 items');
  });

  it('marks an approximate backend total', async () => {
    await renderFilters({
      activeFilters: { ...NO_FILTERS, search: 'web' },
      resolvedFilterOptions: { kinds: [], namespaces: [], searchBehavior: 'query' },
      resultCount: { filtered: 100, unfiltered: 100001, totalIsExact: false, capped: true },
    });

    expect(resultCount()?.textContent).toContain('100001+');
  });

  it('marks partial data with a Partial chip that explains it, without a filter', async () => {
    vi.useFakeTimers();
    await renderFilters({
      activeFilters: NO_FILTERS,
      resultCount: {
        filtered: 500,
        unfiltered: 500,
        capped: true,
        partialDataLabel: 'Only the recent local window is loaded.',
      },
    });

    const trigger = requireValue(
      Array.from(view.container.querySelectorAll<HTMLElement>('.tooltip-trigger')).find(
        (element) => element.textContent === 'Partial'
      ),
      'expected the Partial chip'
    );
    expect(resultCount()).toBeNull();
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(document.body.textContent).toContain('Only the recent local window is loaded.');
  });
});

describe('GridTableFiltersBar search', () => {
  const searchInput = () =>
    requireValue(view.container.querySelector<HTMLInputElement>('#search'), 'search input');

  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('keeps the search box focused across controlled filter updates', async () => {
    function ControlledFilters() {
      const [search, setSearch] = React.useState('');
      return (
        <GridTableFiltersBar
          activeFilters={{ ...NO_FILTERS, search }}
          resolvedFilterOptions={{ searchBehavior: 'query', kinds: [], namespaces: [] }}
          kindDropdownId="kinds"
          namespaceDropdownId="namespaces"
          clusterDropdownId="clusters"
          searchInputId="search"
          onKindsChange={vi.fn()}
          onNamespacesChange={vi.fn()}
          onClustersChange={vi.fn()}
          onFiltersChange={vi.fn()}
          onSearchChange={setSearch}
          onReset={vi.fn()}
          renderOption={(choice) => choice.label}
        />
      );
    }
    await view.show(<ControlledFilters />);

    await act(async () => searchInput().focus());
    await type(searchInput(), 'p');
    expect(document.activeElement).toBe(searchInput());
    expect(searchInput().value).toBe('p');

    await type(searchInput(), 'po');
    expect(document.activeElement).toBe(searchInput());
    expect(searchInput().value).toBe('po');
  });

  it.each([true, false])(
    'answers the Find shortcut only while its table is active (active: %s)',
    async (active) => {
      track(vi.spyOn(navigator, 'platform', 'get')).mockReturnValue('Win32');
      await renderFilters({ searchShortcutActive: active, searchShortcutPriority: 10 });
      const select = vi.spyOn(searchInput(), 'select');

      const find = new KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        document.body.dispatchEvent(find);
      });

      expect(document.activeElement === searchInput()).toBe(active);
      expect(select).toHaveBeenCalledTimes(active ? 1 : 0);
    }
  );

  it('selects the search text with Cmd/Ctrl+A inside the search box', async () => {
    await renderFilters({ searchShortcutActive: true });
    const select = vi.spyOn(searchInput(), 'select');
    await act(async () => searchInput().focus());

    const selectAll = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      searchInput().dispatchEvent(selectAll);
    });

    expect(selectAll.defaultPrevented).toBe(true);
    expect(select).toHaveBeenCalled();
  });
});

describe('GridTableFiltersBar Columns menu', () => {
  const columnsProps = (overrides: Partial<FiltersBarProps> = {}): Partial<FiltersBarProps> => ({
    showColumnsDropdown: true,
    columnOptions: [
      { label: 'Name', value: 'name' },
      { label: 'Age', value: 'age' },
    ],
    columnValue: ['name'],
    onColumnsChange: vi.fn(),
    onMoveColumn: vi.fn(),
    onReorderColumn: vi.fn(),
    onResetColumns: vi.fn(),
    columnsDropdownId: 'columns',
    ...overrides,
  });

  const columnRow = (key: string) =>
    requireValue(
      document.body.querySelector<HTMLElement>(`.dropdown-option-row[data-column-key="${key}"]`),
      `column row ${key}`
    );

  const drag = async (type: string, target: HTMLElement) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() },
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
  };

  it('shows a hidden column, reorders by keyboard and by dragging, and resets', async () => {
    const props = columnsProps({ canResetColumns: true });
    await renderFilters(props);
    await openMenu('columns');

    await click(option('Age'));
    expect(props.onColumnsChange).toHaveBeenLastCalledWith(['name', 'age']);

    await act(async () => {
      button('Reorder Name. Drag the row, or use Up and Down Arrow keys.').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
    });
    expect(props.onMoveColumn).toHaveBeenCalledWith('name', 1);

    await drag('dragstart', columnRow('name'));
    await drag('dragover', columnRow('age'));
    expect(columnRow('age').dataset.dropPosition).toBe('after');
    await drag('drop', columnRow('age'));
    expect(props.onReorderColumn).toHaveBeenCalledWith('name', 1);

    await drag('dragstart', columnRow('age'));
    await drag('dragover', columnRow('name'));
    expect(columnRow('name').dataset.dropPosition).toBe('before');
    await drag('dragend', columnRow('age'));

    expect(button('Reset columns').disabled).toBe(false);
    await click(button('Reset columns'));
    expect(props.onResetColumns).toHaveBeenCalledTimes(1);
  });

  it('disables reset until order or visibility differs from the defaults', async () => {
    await renderFilters(columnsProps({ canResetColumns: false }));
    await openMenu('columns');

    expect(button('Reset columns').disabled).toBe(true);
  });

  it('adds, edits, and directly deletes custom metadata columns', async () => {
    const ownerKey = 'metadata:label:example.com/owner';
    const onAddCustomMetadataColumn = vi.fn();
    const onEditCustomMetadataColumn = vi.fn();
    const onRemoveCustomMetadataColumn = vi.fn();
    const props = columnsProps({
      columnOptions: [
        { label: 'Name', value: 'name' },
        { label: 'Owner', value: ownerKey },
      ],
      columnValue: ['name', ownerKey],
      customMetadataColumnKeys: new Set([ownerKey]),
      onAddCustomMetadataColumn,
      onEditCustomMetadataColumn,
      onRemoveCustomMetadataColumn,
    });
    await renderFilters(props);

    await openMenu('columns');
    await click(button('Add Custom Column'));
    expect(onAddCustomMetadataColumn).toHaveBeenCalledTimes(1);

    await openMenu('columns');
    expect(document.body.querySelector('button[aria-label="Edit Name"]')).toBeNull();
    expect(document.body.querySelector('button[aria-label="Delete Name"]')).toBeNull();
    await click(button('Edit Owner'));
    expect(onEditCustomMetadataColumn).toHaveBeenCalledWith(ownerKey);
    await click(button('Delete Owner'));
    expect(onRemoveCustomMetadataColumn).toHaveBeenCalledWith(ownerKey);
    // Editing and deleting are row actions, not a visibility change.
    expect(props.onColumnsChange).not.toHaveBeenCalled();
  });
});
