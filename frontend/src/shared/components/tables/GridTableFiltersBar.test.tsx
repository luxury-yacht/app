/**
 * frontend/src/shared/components/tables/GridTableFiltersBar.test.tsx
 *
 * Test suite for GridTableFiltersBar.
 * Covers key behaviors and edge cases for GridTableFiltersBar.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import GridTableFiltersBar from '@shared/components/tables/GridTableFiltersBar';

const searchShortcutMock = vi.hoisted(() => ({
  register: vi.fn(),
}));

vi.mock('@ui/shortcuts', () => ({
  useSearchShortcutTarget: (config: unknown) => searchShortcutMock.register(config),
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    id,
    value,
    options,
    onChange,
  }: {
    id: string;
    value: string[];
    options: Array<{ label: string; value: string }>;
    onChange: (value: string[]) => void;
  }) => (
    <select
      data-testid={id}
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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    searchShortcutMock.register.mockReset();
  });

  afterEach(() => {
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
        <GridTableFiltersBar
          activeFilters={{ search: '', kinds: [], namespaces: [] }}
          resolvedFilterOptions={{
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
          searchInputId="search"
          onKindsChange={vi.fn()}
          onNamespacesChange={vi.fn()}
          onSearchChange={vi.fn()}
          onReset={vi.fn()}
          renderOption={(option) => option.label}
          renderKindsValue={() => 'Kinds'}
          renderNamespacesValue={() => 'Namespaces'}
          {...props}
        />
      );
      await Promise.resolve();
    });
  };

  it('renders dropdowns and propagates changes', async () => {
    const onKindsChange = vi.fn();
    const onNamespacesChange = vi.fn();
    const onSearchChange = vi.fn();
    const onReset = vi.fn();

    await renderFilters({
      showKindDropdown: true,
      showNamespaceDropdown: true,
      activeFilters: { search: 'pods', kinds: [], namespaces: [] },
      onKindsChange,
      onNamespacesChange,
      onSearchChange,
      onReset,
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

    const resetButton = container.querySelector('button');
    await act(async () => {
      resetButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
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

    await act(async () => {
      dropdown.value = 'age';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onColumnsChange).toHaveBeenCalledWith(['age']);
  });
});
