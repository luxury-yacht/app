/**
 * frontend/src/shared/components/tables/GridTableKeys.test.tsx
 *
 * Contract tests for GridTable filter-bar keyboard target discovery and order.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import GridTableFiltersBar from '@shared/components/tables/GridTableFiltersBar';
import { useGridTableKeyboardScopes } from '@shared/components/tables/GridTableKeys';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

const registeredSurfaces: Array<{
  kind: string;
  onKeyDown?: (event: KeyboardEvent) => boolean | 'handled-no-prevent' | undefined;
}> = [];

// Mock the keyboard shortcuts hooks — we only need the rendered DOM.
vi.mock('@ui/shortcuts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui/shortcuts')>();
  return {
    ...actual,
    useSearchShortcutTarget: () => undefined,
    useKeyboardContext: () => ({
      registerShortcut: () => 'mock-id',
      unregisterShortcut: () => undefined,
      getAvailableShortcuts: () => [],
      isShortcutAvailable: () => false,
      setEnabled: () => undefined,
      isEnabled: true,
      registerSurface: () => 'mock-surface-id',
      unregisterSurface: () => undefined,
      updateSurface: () => undefined,
      dispatchNativeAction: () => false,
      hasActiveBlockingSurface: () => false,
    }),
    useShortcuts: () => undefined,
    useKeyboardSurface: (surface: {
      kind: string;
      onKeyDown?: (event: KeyboardEvent) => boolean | 'handled-no-prevent' | undefined;
    }) => {
      registeredSurfaces.push(surface);
    },
  };
});

vi.mock('@wailsjs/go/backend/App', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

describe('GridTableKeys filter target selectors', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    registeredSurfaces.length = 0;
    vi.restoreAllMocks();
  });

  // These selectors identify the controls whose keyboard order the tests exercise.
  const SELECTORS = {
    search: '[data-gridtable-filter-role="search"] input',
    caseSensitive: '.icon-bar-button[title="Match case"]',
    kind: '[data-gridtable-filter-role="kind"] .dropdown-trigger',
    namespace: '[data-gridtable-filter-role="namespace"] .dropdown-trigger',
    cluster: '[data-gridtable-filter-role="cluster"] .dropdown-trigger',
    apiGroups: '[data-gridtable-filter-role="query-facet-apiGroups"] .dropdown-trigger',
    columns: '[data-gridtable-filter-role="columns"] .dropdown-trigger',
  };

  const renderFiltersBar = async (
    overrides?: Partial<React.ComponentProps<typeof GridTableFiltersBar>>
  ) => {
    const defaultProps: React.ComponentProps<typeof GridTableFiltersBar> = {
      activeFilters: {
        search: '',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      },
      resolvedFilterOptions: {
        kinds: [{ label: 'Pod', value: 'Pod' }],
        namespaces: [{ label: 'default', value: 'default' }],
        clusters: [{ label: 'alpha', value: 'cluster-a' }],
      },
      kindDropdownId: 'test-kind',
      namespaceDropdownId: 'test-ns',
      clusterDropdownId: 'test-cluster',
      searchInputId: 'test-search',
      onKindsChange: vi.fn(),
      onNamespacesChange: vi.fn(),
      onClustersChange: vi.fn(),
      onFiltersChange: vi.fn(),
      onSearchChange: vi.fn(),
      onReset: vi.fn(),
      onToggleCaseSensitive: vi.fn(),
      renderOption: (opt) => opt.label,
      renderKindsValue: () => 'Kinds',
      renderNamespacesValue: () => 'Namespaces',
      renderClustersValue: () => 'Clusters',
      showKindDropdown: true,
      showNamespaceDropdown: true,
      ...overrides,
    };

    await act(async () => {
      root.render(
        <ZoomProvider>
          <GridTableFiltersBar {...defaultProps} />
        </ZoomProvider>
      );
    });

    return container;
  };

  it('search selector matches the search input element', async () => {
    const el = await renderFiltersBar();

    const searchInput = el.querySelector<HTMLInputElement>(SELECTORS.search);
    expect(searchInput).not.toBeNull();
    expect(requireValue(searchInput, 'expected test value in GridTableKeys.test.tsx').tagName).toBe(
      'INPUT'
    );
  });

  it('kind selector matches the kind dropdown trigger', async () => {
    const el = await renderFiltersBar({ showKindDropdown: true });

    const kindTrigger = el.querySelector<HTMLElement>(SELECTORS.kind);
    expect(kindTrigger).not.toBeNull();
  });

  it('namespace selector matches the namespace dropdown trigger', async () => {
    const el = await renderFiltersBar({ showNamespaceDropdown: true });

    const nsTrigger = el.querySelector<HTMLElement>(SELECTORS.namespace);
    expect(nsTrigger).not.toBeNull();
  });

  it('cluster selector matches the cluster dropdown trigger', async () => {
    const el = await renderFiltersBar({ showClusterDropdown: true });

    const clusterTrigger = el.querySelector<HTMLElement>(SELECTORS.cluster);
    expect(clusterTrigger).not.toBeNull();
  });

  it('search input is found when dropdowns are hidden', async () => {
    const el = await renderFiltersBar({
      showKindDropdown: false,
      showNamespaceDropdown: false,
    });

    // Search must always be reachable regardless of dropdown visibility.
    const searchInput = el.querySelector<HTMLInputElement>(SELECTORS.search);
    expect(searchInput).not.toBeNull();
    expect(requireValue(searchInput, 'expected test value in GridTableKeys.test.tsx').tagName).toBe(
      'INPUT'
    );
  });

  it('columns selector matches the columns dropdown trigger', async () => {
    const el = await renderFiltersBar({
      showColumnsDropdown: true,
      columnOptions: [{ label: 'Name', value: 'name' }],
      columnValue: ['name'],
      onColumnsChange: vi.fn(),
    });

    const columnsTrigger = el.querySelector<HTMLElement>(SELECTORS.columns);
    expect(columnsTrigger).not.toBeNull();
  });

  it('moves backward into a leading query facet and forward out without trapping focus', async () => {
    const HookHarness = () => {
      const filtersContainerRef = React.useRef<HTMLDivElement | null>(null);
      const wrapperRef = React.useRef<HTMLDivElement | null>(null);
      const focusRef = React.useRef<HTMLTableElement | null>(null);
      const filterFocusIndexRef = React.useRef<number | null>(null);

      useGridTableKeyboardScopes({
        filteringEnabled: true,
        filtersContainerRef,
        filterFocusIndexRef,
        wrapperRef,
        focusRef,
        tableDataLength: 1,
        focusedRowKey: 'row-1',
        suppressFocusedRowHighlight: vi.fn(),
        jumpToIndex: () => true,
      });

      return (
        <>
          <GridTableFiltersBar
            containerRef={filtersContainerRef}
            activeFilters={{
              search: '',
              kinds: { mode: 'all' },
              namespaces: { mode: 'all' },
              clusters: { mode: 'all' },
              queryFacets: { apiGroups: { mode: 'all' } },
              caseSensitive: false,
              includeMetadata: false,
            }}
            resolvedFilterOptions={{
              kinds: [{ label: 'Pod', value: 'Pod' }],
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
            }}
            kindDropdownId="kind"
            namespaceDropdownId="namespace"
            clusterDropdownId="cluster"
            queryFacetDropdownIdPrefix="facet"
            searchInputId="search"
            onKindsChange={vi.fn()}
            onNamespacesChange={vi.fn()}
            onClustersChange={vi.fn()}
            onQueryFacetChange={vi.fn()}
            onFiltersChange={vi.fn()}
            onSearchChange={vi.fn()}
            onReset={vi.fn()}
            onToggleCaseSensitive={vi.fn()}
            renderOption={(option) => option.label}
            renderKindsValue={() => 'Kinds'}
            renderNamespacesValue={() => 'Namespaces'}
            renderClustersValue={() => 'Clusters'}
            showKindDropdown
          />
          <div ref={wrapperRef}>
            <table ref={focusRef} />
          </div>
        </>
      );
    };

    await act(async () => {
      root.render(
        <ZoomProvider>
          <HookHarness />
        </ZoomProvider>
      );
      await Promise.resolve();
    });

    const searchInput = requireValue(
      container.querySelector<HTMLInputElement>(SELECTORS.search),
      'expected the GridTable filter input'
    );
    const kindTrigger = requireValue(
      container.querySelector<HTMLElement>(SELECTORS.kind),
      'expected the Kind dropdown trigger'
    );
    const apiGroupsTrigger = requireValue(
      container.querySelector<HTMLElement>(SELECTORS.apiGroups),
      'expected the API Groups dropdown trigger'
    );
    const [filtersSurface] = registeredSurfaces;

    const dispatchFilterTab = async (shiftKey: boolean) => {
      const target = document.activeElement as HTMLElement;
      await act(async () => {
        filtersSurface?.onKeyDown?.({
          key: 'Tab',
          shiftKey,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          target,
          preventDefault: vi.fn(),
        } as unknown as KeyboardEvent);
        await Promise.resolve();
      });
    };

    searchInput.focus();
    await dispatchFilterTab(true);
    expect(document.activeElement).toBe(kindTrigger);

    await dispatchFilterTab(true);
    expect(document.activeElement).toBe(apiGroupsTrigger);

    await dispatchFilterTab(false);
    expect(document.activeElement).toBe(kindTrigger);
  });

  it('finds icon-bar buttons in DOM order and skips disabled ones before columns', async () => {
    const HookHarness = () => {
      const filtersContainerRef = React.useRef<HTMLDivElement | null>(null);
      const wrapperRef = React.useRef<HTMLDivElement | null>(null);
      const focusRef = React.useRef<HTMLTableElement | null>(null);
      const filterFocusIndexRef = React.useRef<number | null>(null);

      useGridTableKeyboardScopes({
        filteringEnabled: true,
        filtersContainerRef,
        filterFocusIndexRef,
        wrapperRef,
        focusRef,
        tableDataLength: 1,
        focusedRowKey: 'row-1',
        suppressFocusedRowHighlight: vi.fn(),
        jumpToIndex: () => true,
      });

      return (
        <>
          <GridTableFiltersBar
            containerRef={filtersContainerRef}
            activeFilters={{
              search: '',
              kinds: { mode: 'all' },
              namespaces: { mode: 'all' },
              clusters: { mode: 'all' },
              caseSensitive: false,
              includeMetadata: false,
            }}
            resolvedFilterOptions={{
              kinds: [],
              namespaces: [],
            }}
            kindDropdownId="kind"
            namespaceDropdownId="namespace"
            clusterDropdownId="cluster"
            columnsDropdownId="columns"
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
            renderColumnsValue={() => 'Columns'}
            showColumnsDropdown
            columnOptions={[{ label: 'Name', value: 'name' }]}
            columnValue={['name']}
            onColumnsChange={vi.fn()}
            preActions={[
              {
                type: 'action',
                id: 'favorite',
                icon: <span>Fav</span>,
                onClick: vi.fn(),
                title: 'Favorite',
              },
            ]}
            postActions={[
              {
                type: 'action',
                id: 'disabled-extra',
                icon: <span>Disabled</span>,
                onClick: vi.fn(),
                title: 'Disabled extra',
                disabled: true,
              },
              {
                type: 'action',
                id: 'load-more',
                icon: <span>Load</span>,
                onClick: vi.fn(),
                title: 'Load more',
              },
            ]}
          />
          <div ref={wrapperRef}>
            <table ref={focusRef} />
          </div>
        </>
      );
    };

    await act(async () => {
      root.render(
        <ZoomProvider>
          <HookHarness />
        </ZoomProvider>
      );
      await Promise.resolve();
    });

    const searchInput = container.querySelector<HTMLInputElement>(SELECTORS.search);
    expect(searchInput).not.toBeNull();
    await act(async () => {
      requireValue(searchInput, 'expected test value in GridTableKeys.test.tsx').focus();
      await Promise.resolve();
    });

    const [filtersSurface] = registeredSurfaces;
    expect(filtersSurface?.onKeyDown).toBeTruthy();

    const dispatchFilterTab = async () => {
      const target = document.activeElement as HTMLElement;
      await act(async () => {
        filtersSurface?.onKeyDown?.({
          key: 'Tab',
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          target,
          preventDefault: vi.fn(),
        } as unknown as KeyboardEvent);
        await Promise.resolve();
      });
    };

    await dispatchFilterTab();
    expect(document.activeElement?.getAttribute('title')).toBe('Match case');

    await dispatchFilterTab();
    expect(document.activeElement?.getAttribute('title')).toBe('Favorite');

    await dispatchFilterTab();
    expect(document.activeElement?.getAttribute('title')).toBe('Load more');

    await dispatchFilterTab();
    expect(
      (document.activeElement as HTMLElement | null)?.closest(
        '[data-gridtable-filter-role="columns"]'
      )
    ).not.toBeNull();
  });

  it('lets body tab bubble without preventing default at the region boundary', async () => {
    const HookHarness = () => {
      const filtersContainerRef = React.useRef<HTMLDivElement | null>(null);
      const wrapperRef = React.useRef<HTMLDivElement | null>(null);
      const focusRef = React.useRef<HTMLTableElement | null>(null);
      const filterFocusIndexRef = React.useRef<number | null>(null);

      useGridTableKeyboardScopes({
        filteringEnabled: false,
        filtersContainerRef,
        filterFocusIndexRef,
        wrapperRef,
        focusRef,
        tableDataLength: 1,
        focusedRowKey: 'row-1',
        suppressFocusedRowHighlight: vi.fn(),
        jumpToIndex: () => true,
      });

      return (
        <>
          <div ref={filtersContainerRef} />
          <div ref={wrapperRef}>
            <table ref={focusRef} />
          </div>
        </>
      );
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    const tableSurface = registeredSurfaces[registeredSurfaces.length - 1];
    expect(tableSurface?.onKeyDown).toBeTruthy();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });

    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    const result = tableSurface?.onKeyDown?.(event);

    expect(result).toBe(false);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('suppresses the focused row highlight only when tabbing out of the table body', async () => {
    const suppressFocusedRowHighlight = vi.fn();

    const HookHarness = () => {
      const filtersContainerRef = React.useRef<HTMLDivElement | null>(null);
      const wrapperRef = React.useRef<HTMLDivElement | null>(null);
      const focusRef = React.useRef<HTMLTableElement | null>(null);
      const filterFocusIndexRef = React.useRef<number | null>(null);

      useGridTableKeyboardScopes({
        filteringEnabled: true,
        filtersContainerRef,
        filterFocusIndexRef,
        wrapperRef,
        focusRef,
        tableDataLength: 1,
        focusedRowKey: 'row-1',
        suppressFocusedRowHighlight,
        jumpToIndex: () => true,
      });

      return (
        <>
          <div ref={filtersContainerRef}>
            <button type="button">Columns</button>
          </div>
          <div ref={wrapperRef}>
            <table ref={focusRef} />
          </div>
        </>
      );
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    const tableSurface = registeredSurfaces[registeredSurfaces.length - 1];
    expect(tableSurface?.onKeyDown).toBeTruthy();

    await act(async () => {
      tableSurface?.onKeyDown?.({
        key: 'Tab',
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: document.createElement('div'),
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent);
      await Promise.resolve();
    });

    await act(async () => {
      tableSurface?.onKeyDown?.({
        key: 'Tab',
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: document.createElement('div'),
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent);
      await Promise.resolve();
    });

    expect(suppressFocusedRowHighlight).toHaveBeenCalledTimes(2);
  });
});
