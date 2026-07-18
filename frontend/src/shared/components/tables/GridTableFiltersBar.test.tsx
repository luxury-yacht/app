/**
 * frontend/src/shared/components/tables/GridTableFiltersBar.test.tsx
 *
 * Test suite for GridTableFiltersBar.
 * Covers key behaviors and edge cases for GridTableFiltersBar.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import GridTableFiltersBar from '@shared/components/tables/GridTableFiltersBar';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

const searchShortcutMock = vi.hoisted(() => ({
  register: vi.fn(),
}));

vi.mock('@ui/shortcuts', () => ({
  useSearchShortcutTarget: (config: unknown) => searchShortcutMock.register(config),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    id,
    value,
    options,
    onChange,
    searchable,
    showBulkActions,
  }: {
    id: string;
    value: string[];
    options: Array<{ label: string; value: string }>;
    onChange: (value: string[]) => void;
    searchable?: boolean;
    showBulkActions?: boolean;
  }) => (
    <select
      data-testid={id}
      data-searchable={searchable ? 'true' : 'false'}
      data-bulk-actions={showBulkActions ? 'true' : 'false'}
      value={value[0] ?? ''}
      onChange={(event) => onChange([event.target.value])}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('GridTableFiltersBar', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    searchShortcutMock.register.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderFilters = async (
    props: Partial<React.ComponentProps<typeof GridTableFiltersBar>>
  ) => {
    await act(async () => {
      root.render(
        <ZoomProvider>
          <GridTableFiltersBar
            activeFilters={{
              search: '',
              kinds: { mode: 'all' },
              namespaces: { mode: 'all' },
              clusters: { mode: 'all' },
              caseSensitive: false,
              includeMetadata: false,
            }}
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
            onToggleCaseSensitive={vi.fn()}
            renderOption={(option) => option.label}
            renderKindsValue={() => 'Kinds'}
            renderNamespacesValue={() => 'Namespaces'}
            renderClustersValue={() => 'Clusters'}
            {...props}
          />
        </ZoomProvider>
      );
      await Promise.resolve();
    });
  };

  it('renders dropdowns and propagates changes', async () => {
    const onKindsChange = vi.fn();
    const onNamespacesChange = vi.fn();
    const onSearchChange = vi.fn();

    await renderFilters({
      showKindDropdown: true,
      showNamespaceDropdown: true,
      activeFilters: {
        search: 'pods',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      },
      onKindsChange,
      onNamespacesChange,
      onSearchChange,
    });

    const kindDropdown = container.querySelector('[data-testid="kinds"]') as HTMLSelectElement;
    expect(kindDropdown).toBeTruthy();
    await act(async () => {
      kindDropdown.value = 'Deployment';
      kindDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onKindsChange).toHaveBeenCalledWith(['Deployment']);

    const nsDropdown = container.querySelector('[data-testid="namespaces"]') as HTMLSelectElement;
    expect(nsDropdown).toBeTruthy();
    await act(async () => {
      nsDropdown.value = 'team-b';
      nsDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onNamespacesChange).toHaveBeenCalledWith(['team-b']);
  });

  it('renders a cluster dropdown and propagates cluster IDs', async () => {
    const onClustersChange = vi.fn();

    await renderFilters({
      showClusterDropdown: true,
      onClustersChange,
    });

    const clusterDropdown = container.querySelector(
      '[data-testid="clusters"]'
    ) as HTMLSelectElement;
    expect(clusterDropdown).toBeTruthy();
    expect(Array.from(clusterDropdown.options).map(({ text, value }) => ({ text, value }))).toEqual(
      [
        { text: 'alpha', value: 'cluster-a' },
        { text: 'beta', value: 'cluster-b' },
      ]
    );

    await act(async () => {
      clusterDropdown.value = 'cluster-b';
      clusterDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onClustersChange).toHaveBeenCalledWith(['cluster-b']);
  });

  it('renders backend query facet dropdowns and propagates keyed changes', async () => {
    const onQueryFacetChange = vi.fn();

    await renderFilters({
      activeFilters: {
        search: '',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        queryFacets: { apiGroups: { mode: 'some', values: ['apps'] } },
        caseSensitive: false,
        includeMetadata: false,
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

    const dropdown = container.querySelector(
      '[data-testid="facet-apiGroups"]'
    ) as HTMLSelectElement;
    expect(dropdown).toBeTruthy();
    expect(dropdown.getAttribute('data-searchable')).toBe('true');
    expect(dropdown.getAttribute('data-bulk-actions')).toBe('true');
    await act(async () => {
      dropdown.value = '(core)';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onQueryFacetChange).toHaveBeenCalledWith('apiGroups', ['(core)']);
  });

  it('renders built-in multiselect chips from the stored selection modes', async () => {
    const onFiltersChange = vi.fn();
    await renderFilters({
      activeFilters: {
        search: '',
        kinds: { mode: 'some', values: ['Pod', 'Kind no longer available'] },
        namespaces: { mode: 'none' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      },
      onFiltersChange,
    });

    const chips = container.querySelector('[aria-label="Active GridTable filters"]');
    expect(chips?.textContent).toContain('Clear all');
    expect(chips?.textContent).toContain('Kinds: 2');
    expect(chips?.textContent).toContain('Namespaces: 0');
    expect(chips?.textContent).not.toContain('Clusters');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Clear Kinds filter"]')
        ?.click();
    });
    expect(onFiltersChange).toHaveBeenCalledWith({ kinds: { mode: 'all' } });
  });

  it('uses the selected option label when a built-in filter has one value', async () => {
    await renderFilters({
      activeFilters: {
        search: '',
        kinds: { mode: 'some', values: ['Pod'] },
        namespaces: { mode: 'some', values: ['kube-system'] },
        clusters: { mode: 'some', values: ['cluster-a'] },
        caseSensitive: false,
        includeMetadata: false,
      },
      resolvedFilterOptions: {
        kinds: [{ label: 'Pods', value: 'Pod' }],
        namespaces: [{ label: 'kube-system', value: 'kube-system' }],
        clusters: [{ label: 'alpha', value: 'cluster-a' }],
      },
    });

    const chips = container.querySelector('[aria-label="Active GridTable filters"]');
    expect(chips?.textContent).toContain('Kind: Pods');
    expect(chips?.textContent).toContain('Namespace: kube-system');
    expect(chips?.textContent).toContain('Cluster: alpha');
    expect(chips?.textContent).not.toContain('Namespaces: 1');
  });

  it('renders query facet counts and clears one facet back to all', async () => {
    const onFiltersChange = vi.fn();
    await renderFilters({
      activeFilters: {
        search: '',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        queryFacets: {
          status: { mode: 'some', values: ['Running', 'Pending'] },
          owner: { mode: 'none' },
        },
        caseSensitive: false,
        includeMetadata: false,
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

    const chips = container.querySelector('[aria-label="Active GridTable filters"]');
    expect(chips?.textContent).toContain('Statuses: 2');
    expect(chips?.textContent).toContain('Owners: 0');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Clear Status filter"]')
        ?.click();
    });

    expect(onFiltersChange).toHaveBeenCalledWith({
      queryFacets: {
        status: { mode: 'all' },
        owner: { mode: 'none' },
      },
    });
  });

  it('uses the selected option label when a query facet has one value', async () => {
    await renderFilters({
      activeFilters: {
        search: '',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        queryFacets: { apiGroups: { mode: 'some', values: ['(core)'] } },
        caseSensitive: false,
        includeMetadata: false,
      },
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [],
        queryFacets: [
          {
            key: 'apiGroups',
            label: 'API groups',
            placeholder: 'All API groups',
            options: [{ label: 'core', value: '(core)' }],
          },
        ],
      },
    });

    const chips = container.querySelector('[aria-label="Active GridTable filters"]');
    expect(chips?.textContent).toContain('API group: core');
    expect(chips?.textContent).not.toContain('API groups: 1');
  });

  it('renders text and boolean chips with individual and clear-all actions', async () => {
    const onFiltersChange = vi.fn();
    const onReset = vi.fn();
    await renderFilters({
      activeFilters: {
        search: 'web',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: true,
        includeMetadata: true,
      },
      onFiltersChange,
      onReset,
    });

    const chips = container.querySelector('[aria-label="Active GridTable filters"]');
    expect(chips?.textContent).toContain('Text: web');
    expect(chips?.textContent).toContain('Match case');
    expect(chips?.textContent).toContain('Include metadata');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Clear text filter"]')?.click();
    });
    expect(onFiltersChange).toHaveBeenCalledWith({ search: '' });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Clear all filters"]')?.click();
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('renders leading query facets before Kinds', async () => {
    await renderFilters({
      showKindDropdown: true,
      resolvedFilterOptions: {
        kinds: [{ label: 'Pods', value: 'Pod' }],
        namespaces: [],
        queryFacets: [
          {
            key: 'apiGroups',
            label: 'API groups',
            placeholder: 'All API groups',
            options: [{ label: 'core', value: '(core)' }],
            placement: 'before-kinds',
          },
        ],
      },
      queryFacetDropdownIdPrefix: 'facet',
    });

    const controls = Array.from(
      container.querySelectorAll<HTMLSelectElement>('.gridtable-filter-subcluster select')
    ).map((element) => element.dataset.testid);
    expect(controls).toEqual(['facet-apiGroups', 'kinds']);
  });

  it('renders structural actions immediately before Namespaces', async () => {
    await renderFilters({
      showKindDropdown: true,
      showNamespaceDropdown: true,
      resolvedFilterOptions: {
        kinds: [{ label: 'Deployments', value: 'Deployment' }],
        namespaces: [{ label: 'team-a', value: 'team-a' }],
        ...({
          beforeNamespaceActions: [
            {
              type: 'toggle',
              id: 'pods-pane',
              icon: <span>toggle</span>,
              active: true,
              onClick: vi.fn(),
              title: 'Collapse Pods',
            },
          ],
        } as Record<string, unknown>),
      },
    });

    const controls = Array.from(
      container.querySelector('[data-gridtable-filter-cluster="primary"]')?.children[0]?.children ??
        []
    ).map((element) => element.getAttribute('data-gridtable-filter-role'));
    expect(controls).toEqual(['kind', 'before-namespace-actions', 'namespace']);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-gridtable-filter-role="before-namespace-actions"] button'
      )?.title
    ).toBe('Collapse Pods');
  });

  it('always enables search and bulk actions for the kind dropdown', async () => {
    await renderFilters({
      showKindDropdown: true,
      resolvedFilterOptions: {
        kinds: [
          { label: 'Pods', value: 'Pod' },
          { label: 'Deployments', value: 'Deployment' },
        ],
        namespaces: [],
      },
    });

    expect(container.querySelector('[data-testid="kinds"]')?.getAttribute('data-searchable')).toBe(
      'true'
    );
    expect(
      container.querySelector('[data-testid="kinds"]')?.getAttribute('data-bulk-actions')
    ).toBe('true');
  });

  it('passes searchable through to the namespace dropdown when enabled', async () => {
    await renderFilters({
      showNamespaceDropdown: true,
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [
          { label: 'team-a', value: 'team-a' },
          { label: 'team-b', value: 'team-b' },
        ],
        namespaceDropdownSearchable: true,
      },
    });

    expect(
      container.querySelector('[data-testid="namespaces"]')?.getAttribute('data-searchable')
    ).toBe('true');
  });

  it('passes bulk actions through to the namespace dropdown when enabled', async () => {
    await renderFilters({
      showNamespaceDropdown: true,
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [
          { label: 'team-a', value: 'team-a' },
          { label: 'team-b', value: 'team-b' },
        ],
        namespaceDropdownBulkActions: true,
      },
    });

    expect(
      container.querySelector('[data-testid="namespaces"]')?.getAttribute('data-bulk-actions')
    ).toBe('true');
  });

  it('renders the shared filter input without a search-hint tooltip', async () => {
    await renderFilters({
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [],
        searchBehavior: 'query',
      },
      resultCount: { filtered: 1000, unfiltered: 4200, capped: true },
    });

    const input = container.querySelector('#search') as HTMLInputElement | null;
    expect(input?.getAttribute('placeholder')).toBe('Filter');
    expect(
      container.querySelector('[data-gridtable-filter-role="search-hint"] .tooltip-trigger')
    ).toBeNull();
  });

  it('keeps search input focused across controlled filter updates', async () => {
    const setInputValue = (inputElement: HTMLInputElement, value: string) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(inputElement, value);
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const Harness = () => {
      const [search, setSearch] = React.useState('');
      return (
        <ZoomProvider>
          <GridTableFiltersBar
            activeFilters={{
              search,
              kinds: { mode: 'all' },
              namespaces: { mode: 'all' },
              clusters: { mode: 'all' },
              caseSensitive: false,
              includeMetadata: false,
            }}
            resolvedFilterOptions={{
              searchBehavior: 'query',
              kinds: [],
              namespaces: [],
            }}
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
            onToggleCaseSensitive={vi.fn()}
            renderOption={(option) => option.label}
            renderKindsValue={() => 'Kinds'}
            renderNamespacesValue={() => 'Namespaces'}
            renderClustersValue={() => 'Clusters'}
          />
        </ZoomProvider>
      );
    };

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('#search');
    expect(input).not.toBeNull();

    await act(async () => {
      input?.focus();
      setInputValue(
        requireValue(input, 'expected test value in GridTableFiltersBar.test.tsx'),
        'p'
      );
      await Promise.resolve();
    });

    const updatedInput = container.querySelector<HTMLInputElement>('#search');
    expect(document.activeElement).toBe(updatedInput);
    expect(updatedInput?.value).toBe('p');

    await act(async () => {
      setInputValue(
        requireValue(updatedInput, 'expected test value in GridTableFiltersBar.test.tsx'),
        'po'
      );
      await Promise.resolve();
    });

    const finalInput = container.querySelector<HTMLInputElement>('#search');
    expect(document.activeElement).toBe(finalInput);
    expect(finalInput?.value).toBe('po');
  });

  it('hides the case-sensitive toggle for query-backed search', async () => {
    await renderFilters({
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [],
        searchBehavior: 'query',
      },
    });

    expect(container.querySelector('.icon-bar-button[title="Match case"]')).toBeNull();
  });

  it('marks approximate backend totals with visible copy', async () => {
    vi.useFakeTimers();
    await renderFilters({
      activeFilters: {
        search: 'web',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      },
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [],
        searchBehavior: 'query',
      },
      resultCount: { filtered: 100, unfiltered: 100001, totalIsExact: false, capped: true },
    });

    const resultCount = container.querySelector('[data-gridtable-filter-role="result-count"]');
    expect(resultCount?.textContent).toContain('Showing 100 of 100001+ items');
    expect(resultCount?.classList.contains('active-filter-chips__summary')).toBe(true);
    expect(resultCount?.classList.contains('active-filter-chip')).toBe(false);
    const trigger = resultCount?.querySelector('.tooltip-trigger');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('The total count is approximate');
    expect(document.body.textContent).toContain('current backend query page');
  });

  it('shows filtered-of-unfiltered totals for query-backed tables', async () => {
    await renderFilters({
      activeFilters: {
        search: 'web',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      },
      resolvedFilterOptions: {
        kinds: [],
        namespaces: [],
        searchBehavior: 'query',
      },
      resultCount: { filtered: 250, unfiltered: 5000, totalIsExact: true, capped: true },
    });

    const resultCount = container.querySelector('[data-gridtable-filter-role="result-count"]');
    expect(resultCount?.textContent).toContain('Showing 250 of 5000 items');
  });

  it('hides the result count and tooltip when no narrowing filter is active', async () => {
    // The filter-bar count is filter feedback, not pagination — pagination/total lives
    // in the pagination footer. With no active filter, the count must not render.
    await renderFilters({
      resultCount: { filtered: 50, unfiltered: 100, capped: true },
    });

    expect(container.querySelector('[data-gridtable-filter-role="result-count"]')).toBeNull();
  });

  it('shows the result count once a narrowing filter is active', async () => {
    await renderFilters({
      activeFilters: {
        search: 'web',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      },
      resultCount: { filtered: 12, unfiltered: 100 },
    });

    const resultCount = requireValue(
      container.querySelector('[data-gridtable-filter-role="result-count"]'),
      'expected result count summary'
    );
    expect(resultCount.textContent).toBe('Showing 12 of 100 items');
    expect(resultCount.classList.contains('active-filter-chips__summary')).toBe(true);
    expect(resultCount.classList.contains('active-filter-chip')).toBe(false);
    expect(resultCount.closest('.active-filter-chips')).not.toBeNull();
    expect(resultCount.closest('.gridtable-filter-actions')).toBeNull();
    const clearAll = requireValue(
      container.querySelector('button[aria-label="Clear all filters"]'),
      'expected Clear all button'
    );
    expect(
      Boolean(resultCount.compareDocumentPosition(clearAll) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
  });

  it('surfaces the partial-window note in the result-count tooltip', async () => {
    vi.useFakeTimers();
    await renderFilters({
      activeFilters: {
        search: 'web',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      },
      resultCount: {
        filtered: 50,
        unfiltered: 500,
        capped: true,
        partialDataLabel: 'Only the recent local window is loaded.',
      },
    });

    const resultCount = container.querySelector('[data-gridtable-filter-role="result-count"]');
    expect(resultCount?.textContent).toContain('Showing 50 of 500 items');
    const trigger = resultCount?.querySelector('.tooltip-trigger');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Only the recent local window is loaded.');
    expect(document.body.textContent).toContain('current local row window');
  });

  it('registers search shortcut and focuses the input when invoked', async () => {
    await renderFilters({
      searchShortcutActive: true,
      searchShortcutPriority: 10,
    });

    expect(searchShortcutMock.register).toHaveBeenCalledTimes(1);
    const config = searchShortcutMock.register.mock.calls[0][0] as {
      isActive: boolean;
      focus: () => void;
      priority: number;
    };
    expect(config.isActive).toBe(true);
    expect(config.priority).toBe(10);

    const input = container.querySelector('#search') as HTMLInputElement;
    input.select = vi.fn();

    await act(async () => {
      config.focus();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(input);
    expect(input.select).toHaveBeenCalled();
  });

  it('marks search shortcut inactive when disabled', async () => {
    await renderFilters({
      searchShortcutActive: false,
    });

    const config = searchShortcutMock.register.mock.calls[0][0] as { isActive: boolean };
    expect(config.isActive).toBe(false);
  });

  it('handles Cmd/Ctrl+A inside search input', async () => {
    await renderFilters({
      searchShortcutActive: true,
    });

    const input = container.querySelector('#search') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      bubbles: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    input.dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalled();
    expect(selectSpy).toHaveBeenCalled();

    selectSpy.mockRestore();
  });

  it('does not render the redundant reset-filters icon', async () => {
    await renderFilters({
      activeFilters: {
        search: '',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: true,
      },
    });

    const resetButton = container.querySelector<HTMLButtonElement>(
      '.icon-bar-button[title="Reset filters"]'
    );
    expect(resetButton).toBeNull();
  });

  it('does not add a leading separator when only post-actions are rendered', async () => {
    await renderFilters({
      resolvedFilterOptions: {
        searchBehavior: 'query',
        kinds: [],
        namespaces: [],
      },
      postActions: [
        {
          type: 'action',
          id: 'load-more',
          icon: <span>Load</span>,
          onClick: vi.fn(),
          title: 'Load more',
        },
      ],
    });

    expect(container.querySelector('.icon-bar-button[title="Load more"]')).not.toBeNull();
    expect(container.querySelector('.icon-bar-separator')).toBeNull();
  });

  it('renders the columns dropdown when enabled', async () => {
    const onColumnsChange = vi.fn();
    await renderFilters({
      showColumnsDropdown: true,
      columnOptions: [
        { label: 'Name', value: 'name' },
        { label: 'Age', value: 'age' },
      ],
      columnValue: ['name'],
      onColumnsChange,
      columnsDropdownId: 'columns',
      renderColumnsValue: () => 'Columns',
    });

    const dropdown = container.querySelector('[data-testid="columns"]') as HTMLSelectElement;
    expect(dropdown).toBeTruthy();
    expect(dropdown.dataset.bulkActions).toBe('true');

    await act(async () => {
      dropdown.value = 'age';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onColumnsChange).toHaveBeenCalledWith(['age']);
  });
});
