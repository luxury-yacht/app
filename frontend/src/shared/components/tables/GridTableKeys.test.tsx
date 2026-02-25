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

// Mock the keyboard shortcuts hooks — we only need the rendered DOM.
vi.mock('@ui/shortcuts', () => ({
  useSearchShortcutTarget: () => {},
  useKeyboardNavigationScope: () => {},
  useKeyboardContext: () => ({ pushContext: () => {}, popContext: () => {} }),
  useShortcuts: () => {},
}));

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
    vi.restoreAllMocks();
  });

  // These selectors must stay in sync with getFilterTargets in GridTableKeys.ts.
  const SELECTORS = {
    search: '[data-gridtable-filter-role="search"] input',
    reset: '[data-gridtable-filter-role="reset"]',
    kind: '[data-gridtable-filter-role="kind"] .dropdown-trigger',
    namespace: '[data-gridtable-filter-role="namespace"] .dropdown-trigger',
  };

  const renderFiltersBar = async (
    overrides?: Partial<React.ComponentProps<typeof GridTableFiltersBar>>
  ) => {
    const defaultProps: React.ComponentProps<typeof GridTableFiltersBar> = {
      activeFilters: { search: '', kinds: [], namespaces: [] },
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
});
