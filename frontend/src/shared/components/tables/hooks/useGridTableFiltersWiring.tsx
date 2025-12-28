/**
 * frontend/src/shared/components/tables/hooks/useGridTableFiltersWiring.tsx
 *
 * React hook for useGridTableFiltersWiring.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import GridTableFiltersBar from '@shared/components/tables/GridTableFiltersBar';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { useGridTableFilters } from '@shared/components/tables/useGridTableFilters';
import { useGridTableFilterHandlers } from '@shared/components/tables/hooks/useGridTableFilterHandlers';
import {
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
} from '@shared/components/tables/GridTable.utils';
import type { GridTableFilterConfig } from '@shared/components/tables/GridTable.types';

// Bundles all filter-bar wiring for GridTable: resolves filter state, builds
// dropdown IDs and renderers, manages focus refs, and returns a ready-to-render
// filter bar node so the table stays agnostic of filter internals.

type ColumnsDropdownConfig = {
  options: DropdownOption[];
  value: string[];
  onChange: (value: string | string[]) => void;
  renderValue?: (value: string | string[], options: DropdownOption[]) => ReactNode;
};

type SearchShortcutConfig = {
  active: boolean;
  priority?: number;
};

type UseGridTableFiltersWiringOptions<T> = {
  data: T[];
  filters: GridTableFilterConfig<T> | undefined;
  columnsDropdown?: ColumnsDropdownConfig;
  searchShortcut?: SearchShortcutConfig;
  customActions?: ReactNode;
};

// This hook gathers everything the GridTable needs to wire up the filter bar.
// It hides the details of: enabling/disabling filters, deriving the filtered data,
// managing focusable elements for keyboard navigation, and building the props for
// the shared GridTableFiltersBar component.
export function useGridTableFiltersWiring<T>({
  data,
  filters,
  columnsDropdown,
  searchShortcut,
  customActions,
}: UseGridTableFiltersWiringOptions<T>) {
  const filtersContainerRef = useRef<HTMLDivElement | null>(null);
  const filterFocusIndexRef = useRef<number | null>(null);

  const {
    filteringEnabled,
    tableData,
    activeFilters,
    filterSignature,
    resolvedFilterOptions,
    handleFilterSearchChange,
    handleFilterKindsChange,
    handleFilterNamespacesChange,
    handleFilterReset,
  } = useGridTableFilters({
    data,
    filters,
    defaultGetKind,
    defaultGetNamespace,
    defaultGetSearchText,
  });

  useEffect(() => {
    if (!filteringEnabled) {
      filterFocusIndexRef.current = null;
    }
  }, [filteringEnabled]);

  const { handleKindDropdownChange, handleNamespaceDropdownChange } = useGridTableFilterHandlers({
    handleFilterKindsChange,
    handleFilterNamespacesChange,
  });

  const searchInputId = useId();
  const kindDropdownId = useId();
  const namespaceDropdownId = useId();
  const columnsDropdownId = useId();

  const showKindDropdown = filters?.options?.showKindDropdown ?? false;
  const showNamespaceDropdown = filters?.options?.showNamespaceDropdown ?? false;

  const renderFilterOption = useCallback(
    (option: DropdownOption, isSelected: boolean): ReactNode => (
      <span
        className={`dropdown-filter-option${
          option.metadata?.isAction ? ' dropdown-filter-option--action' : ''
        }`}
      >
        <span className="dropdown-filter-check">
          {option.metadata?.isAction ? '' : isSelected ? '✓' : ''}
        </span>
        <span className="dropdown-filter-label">{option.label}</span>
      </span>
    ),
    []
  );

  const renderKindsValue = useCallback((value: string | string[], _options: DropdownOption[]) => {
    // Include the selected count so multi-select status is visible at a glance.
    const count = Array.isArray(value) ? value.length : value ? 1 : 0;
    return count > 0 ? `Kinds (${count})` : 'Kinds';
  }, []);
  const renderNamespacesValue = useCallback(
    (value: string | string[], _options: DropdownOption[]) => {
      // Include the selected count so multi-select status is visible at a glance.
      const count = Array.isArray(value) ? value.length : value ? 1 : 0;
      return count > 0 ? `Namespaces (${count})` : 'Namespaces';
    },
    []
  );
  const renderColumnsValue = useCallback(
    (_value: string | string[], _options: DropdownOption[]) => 'Columns',
    []
  );

  const searchShortcutActive = searchShortcut?.active ?? filteringEnabled;
  const searchShortcutPriority = searchShortcut?.priority ?? 5;
  const showColumnsDropdown = Boolean(columnsDropdown);
  const resolvedCustomActions = customActions ?? resolvedFilterOptions.customActions;

  const filtersBarProps = useMemo<ComponentProps<typeof GridTableFiltersBar>>(
    () => ({
      searchInputId,
      kindDropdownId,
      namespaceDropdownId,
      columnsDropdownId,
      resolvedFilterOptions,
      containerRef: filtersContainerRef,
      activeFilters,
      onSearchChange: handleFilterSearchChange,
      onKindsChange: handleKindDropdownChange,
      onNamespacesChange: handleNamespaceDropdownChange,
      onReset: handleFilterReset,
      showKindDropdown,
      showNamespaceDropdown,
      renderOption: renderFilterOption,
      renderKindsValue,
      renderNamespacesValue,
      renderColumnsValue: columnsDropdown?.renderValue ?? renderColumnsValue,
      columnOptions: columnsDropdown?.options,
      columnValue: columnsDropdown?.value,
      onColumnsChange: columnsDropdown?.onChange,
      showColumnsDropdown,
      searchShortcutActive,
      searchShortcutPriority,
      customActions: resolvedCustomActions,
    }),
    [
      searchInputId,
      kindDropdownId,
      namespaceDropdownId,
      columnsDropdownId,
      resolvedFilterOptions,
      activeFilters,
      handleFilterSearchChange,
      handleKindDropdownChange,
      handleNamespaceDropdownChange,
      handleFilterReset,
      showKindDropdown,
      showNamespaceDropdown,
      renderFilterOption,
      renderKindsValue,
      renderNamespacesValue,
      columnsDropdown,
      renderColumnsValue,
      showColumnsDropdown,
      searchShortcutActive,
      searchShortcutPriority,
      resolvedCustomActions,
    ]
  );

  const filtersNode = filteringEnabled ? renderGridTableFiltersBar(filtersBarProps) : null;

  return {
    filteringEnabled,
    tableData,
    activeFilters,
    filterSignature,
    resolvedFilterOptions,
    filtersContainerRef,
    filterFocusIndexRef,
    showKindDropdown,
    showNamespaceDropdown,
    filtersBarProps,
    filtersNode,
  };
}

// Convenience helper so callers can render the filter bar without importing the
// component directly. Keeping this here ensures the render path always uses the
// same props shape produced by the wiring hook.
function renderGridTableFiltersBar(props: ComponentProps<typeof GridTableFiltersBar>) {
  return <GridTableFiltersBar {...props} />;
}
