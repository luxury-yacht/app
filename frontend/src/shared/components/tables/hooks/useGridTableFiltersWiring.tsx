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
import type { IconBarItem } from '@shared/components/IconBar/IconBar';

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
  totalDataCount?: number;
  maxDisplayRows?: number;
  filters: GridTableFilterConfig<T> | undefined;
  diagnosticsLabel?: string;
  columnsDropdown?: ColumnsDropdownConfig;
  searchShortcut?: SearchShortcutConfig;
  /** IconBar items rendered before the built-in Reset action. */
  preActions?: IconBarItem[];
  /** IconBar items rendered after a separator following Reset. */
  postActions?: IconBarItem[];
};

// This hook gathers everything the GridTable needs to wire up the filter bar.
// It hides the details of: enabling/disabling filters, deriving the filtered data,
// managing focusable elements for keyboard navigation, and building the props for
// the shared GridTableFiltersBar component.
export function useGridTableFiltersWiring<T>({
  data,
  totalDataCount,
  maxDisplayRows,
  filters,
  diagnosticsLabel,
  columnsDropdown,
  searchShortcut,
  preActions,
  postActions,
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
    toggleCaseSensitive,
  } = useGridTableFilters({
    data,
    filters,
    diagnosticsLabel,
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
  const resolvedPreActions = preActions ?? resolvedFilterOptions.preActions;
  const resolvedPostActions = postActions ?? resolvedFilterOptions.postActions;
  const resolvedCustomActions = resolvedFilterOptions.customActions;

  // Compute result count: displayed items vs total items.
  // If the consumer provides a totalCount override (e.g. server-side paginated total), use it.
  const resultCount = useMemo(() => {
    if (!filteringEnabled) return undefined;
    const total = filters?.options?.totalCount ?? totalDataCount ?? data.length;
    const displayed =
      typeof maxDisplayRows === 'number' && maxDisplayRows > 0
        ? Math.min(tableData.length, maxDisplayRows)
        : tableData.length;
    return {
      displayed,
      total,
      capped: displayed < tableData.length || total > data.length,
    };
  }, [
    filteringEnabled,
    filters?.options?.totalCount,
    totalDataCount,
    maxDisplayRows,
    data.length,
    tableData.length,
  ]);

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
      onToggleCaseSensitive: toggleCaseSensitive,
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
      preActions: resolvedPreActions,
      postActions: resolvedPostActions,
      customActions: resolvedCustomActions,
      resultCount,
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
      toggleCaseSensitive,
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
      resolvedPreActions,
      resolvedPostActions,
      resolvedCustomActions,
      resultCount,
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
    handleFilterReset,
  };
}

// Convenience helper so callers can render the filter bar without importing the
// component directly. Keeping this here ensures the render path always uses the
// same props shape produced by the wiring hook.
function renderGridTableFiltersBar(props: ComponentProps<typeof GridTableFiltersBar>) {
  return <GridTableFiltersBar {...props} />;
}
