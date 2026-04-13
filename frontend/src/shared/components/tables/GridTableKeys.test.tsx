/**
 * frontend/src/shared/components/tables/GridTableKeys.test.tsx
 *
 * Contract test: verifies that the DOM selectors in getFilterTargets
 * (GridTableKeys.ts) match the actual elements rendered by
 * GridTableFiltersBar.tsx. Prevents selector / attribute drift.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import GridTableFiltersBar from '@shared/components/tables/GridTableFiltersBar';
import { useGridTableKeyboardScopes } from '@shared/components/tables/GridTableKeys';

const registeredSurfaces: Array<{
  kind: string;
  onKeyDown?: (event: KeyboardEvent) => boolean | 'handled-no-prevent' | void;
}> = [];

// Mock the keyboard shortcuts hooks — we only need the rendered DOM.
vi.mock('@ui/shortcuts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui/shortcuts')>();
  return {
    ...actual,
    useSearchShortcutTarget: () => {},
    useKeyboardContext: () => ({
      registerShortcut: () => 'mock-id',
      unregisterShortcut: () => {},
      getAvailableShortcuts: () => [],
      isShortcutAvailable: () => false,
      setEnabled: () => {},
      isEnabled: true,
      registerSurface: () => 'mock-surface-id',
      unregisterSurface: () => {},
      updateSurface: () => {},
      dispatchNativeAction: () => false,
      hasActiveBlockingSurface: () => false,
    }),
    useShortcuts: () => {},
    useKeyboardSurface: (surface: {
      kind: string;
      onKeyDown?: (event: KeyboardEvent) => boolean | 'handled-no-prevent' | void;
    }) => {
      registeredSurfaces.push(surface);
    },
  };
});

describe('GridTableKeys filter target selectors', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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

  // These selectors must stay in sync with getFilterTargets in GridTableKeys.ts.
  const SELECTORS = {
    search: '[data-gridtable-filter-role="search"] input',
    reset: '.icon-bar-button[title="Reset filters"]',
    caseSensitive: '.icon-bar-button[title="Match case"]',
    kind: '[data-gridtable-filter-role="kind"] .dropdown-trigger',
    namespace: '[data-gridtable-filter-role="namespace"] .dropdown-trigger',
    columns: '[data-gridtable-filter-role="columns"] .dropdown-trigger',
  };

  const renderFiltersBar = async (
    overrides?: Partial<React.ComponentProps<typeof GridTableFiltersBar>>
  ) => {
    const defaultProps: React.ComponentProps<typeof GridTableFiltersBar> = {
      activeFilters: {
        search: '',
        kinds: [],
        namespaces: [],
        caseSensitive: false,
        includeMetadata: false,
      },
      resolvedFilterOptions: {
        kinds: [{ label: 'Pod', value: 'Pod' }],
        namespaces: [{ label: 'default', value: 'default' }],
      },
      kindDropdownId: 'test-kind',
      namespaceDropdownId: 'test-ns',
      searchInputId: 'test-search',
      onKindsChange: vi.fn(),
      onNamespacesChange: vi.fn(),
      onSearchChange: vi.fn(),
      onReset: vi.fn(),
      onToggleCaseSensitive: vi.fn(),
      renderOption: (opt) => opt.label,
      renderKindsValue: () => 'Kinds',
      renderNamespacesValue: () => 'Namespaces',
      showKindDropdown: true,
      showNamespaceDropdown: true,
      ...overrides,
    };

    await act(async () => {
      root.render(<GridTableFiltersBar {...defaultProps} />);
    });

    return container;
  };

  it('search selector matches the search input element', async () => {
    const el = await renderFiltersBar();

    const searchInput = el.querySelector<HTMLInputElement>(SELECTORS.search);
    expect(searchInput).not.toBeNull();
    expect(searchInput!.tagName).toBe('INPUT');
  });

  it('reset selector matches the reset button', async () => {
    const el = await renderFiltersBar();

    const resetBtn = el.querySelector<HTMLElement>(SELECTORS.reset);
    expect(resetBtn).not.toBeNull();
    expect(resetBtn!.tagName).toBe('BUTTON');
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

  it('search input is found when dropdowns are hidden', async () => {
    const el = await renderFiltersBar({
      showKindDropdown: false,
      showNamespaceDropdown: false,
    });

    // Search must always be reachable regardless of dropdown visibility.
    const searchInput = el.querySelector<HTMLInputElement>(SELECTORS.search);
    expect(searchInput).not.toBeNull();
    expect(searchInput!.tagName).toBe('INPUT');
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

  it('finds icon-bar buttons in DOM order and skips disabled ones before columns', async () => {
    const HookHarness = () => {
      const filtersContainerRef = React.useRef<HTMLDivElement | null>(null);
      const wrapperRef = React.useRef<HTMLDivElement | null>(null);
      const filterFocusIndexRef = React.useRef<number | null>(null);

      useGridTableKeyboardScopes({
        filteringEnabled: true,
        showKindDropdown: false,
        showNamespaceDropdown: false,
        filtersContainerRef,
        filterFocusIndexRef,
        wrapperRef,
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
              kinds: [],
              namespaces: [],
              caseSensitive: false,
              includeMetadata: false,
            }}
            resolvedFilterOptions={{
              kinds: [],
              namespaces: [],
            }}
            kindDropdownId="kind"
            namespaceDropdownId="namespace"
            columnsDropdownId="columns"
            searchInputId="search"
            onKindsChange={vi.fn()}
            onNamespacesChange={vi.fn()}
            onSearchChange={vi.fn()}
            onReset={vi.fn()}
            onToggleCaseSensitive={vi.fn()}
            renderOption={(option) => option.label}
            renderKindsValue={() => 'Kinds'}
            renderNamespacesValue={() => 'Namespaces'}
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
          <div ref={wrapperRef} />
        </>
      );
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    const searchInput = container.querySelector<HTMLInputElement>(SELECTORS.search);
    expect(searchInput).not.toBeNull();
    await act(async () => {
      searchInput!.focus();
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
      const filterFocusIndexRef = React.useRef<number | null>(null);

      useGridTableKeyboardScopes({
        filteringEnabled: false,
        showKindDropdown: false,
        showNamespaceDropdown: false,
        filtersContainerRef,
        filterFocusIndexRef,
        wrapperRef,
        tableDataLength: 1,
        focusedRowKey: 'row-1',
        suppressFocusedRowHighlight: vi.fn(),
        jumpToIndex: () => true,
      });

      return (
        <>
          <div ref={filtersContainerRef} />
          <div ref={wrapperRef} />
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
      const filterFocusIndexRef = React.useRef<number | null>(null);

      useGridTableKeyboardScopes({
        filteringEnabled: true,
        showKindDropdown: false,
        showNamespaceDropdown: false,
        filtersContainerRef,
        filterFocusIndexRef,
        wrapperRef,
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
          <div ref={wrapperRef} />
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
