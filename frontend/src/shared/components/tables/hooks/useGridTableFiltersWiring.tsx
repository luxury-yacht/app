/**
 * frontend/src/shared/components/tables/hooks/useGridTableFiltersWiring.tsx
 *
 * React hook for useGridTableFiltersWiring.
 * Encapsulates state and side effects for the shared components.
 */

import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import type {
  GridColumnDefinition,
  GridTableFilterConfig,
} from '@shared/components/tables/GridTable.types';
import {
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
} from '@shared/components/tables/GridTable.utils';
import GridTableFiltersBar from '@shared/components/tables/GridTableFiltersBar';
import { useGridTableCsvExport } from '@shared/components/tables/hooks/useGridTableCsvExport';
import { useGridTableCsvFileExportAction } from '@shared/components/tables/hooks/useGridTableCsvFileExportAction';
import { useGridTableFilters } from '@shared/components/tables/useGridTableFilters';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';

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

const isActionOption = (option: DropdownOption): boolean => {
  const metadata = option.metadata;
  return (
    metadata !== null &&
    typeof metadata === 'object' &&
    'isAction' in metadata &&
    metadata.isAction === true
  );
};

type UseGridTableFiltersWiringOptions<T> = {
  data: T[];
  totalDataCount?: number;
  filters: GridTableFilterConfig<T> | undefined;
  diagnosticsLabel?: string;
  columnsDropdown?: ColumnsDropdownConfig;
  searchShortcut?: SearchShortcutConfig;
  exportColumns?: GridColumnDefinition<T>[];
  getTextContent?: (node: ReactNode) => string;
  /** When provided, Copy/Export gain an "all matching rows" scope toggle that calls this. */
  fetchAllRows?: () => Promise<T[]>;
  /** Default filename offered by the file Export action. */
  exportFilename?: string;
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
  filters,
  diagnosticsLabel,
  columnsDropdown,
  searchShortcut,
  exportColumns,
  getTextContent,
  fetchAllRows,
  exportFilename,
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

  const normalizeDropdownValue = useCallback((value: string | string[]) => {
    return Array.isArray(value) ? value : value ? [value] : [];
  }, []);

  const handleKindDropdownChange = useCallback(
    (value: string | string[]) => {
      handleFilterKindsChange(normalizeDropdownValue(value));
    },
    [handleFilterKindsChange, normalizeDropdownValue]
  );

  const handleNamespaceDropdownChange = useCallback(
    (value: string | string[]) => {
      handleFilterNamespacesChange(normalizeDropdownValue(value));
    },
    [handleFilterNamespacesChange, normalizeDropdownValue]
  );

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
          isActionOption(option) ? ' dropdown-filter-option--action' : ''
        }`}
      >
        <span className="dropdown-filter-check">
          {isActionOption(option) ? '' : isSelected ? '✓' : ''}
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
  const resolvedCustomActions = resolvedFilterOptions.customActions;

  // Copy and Export always act on EVERY matching row when the view can fetch all pages
  // (the active filters are part of the fetch scope). Views without a fetcher keep the
  // page-only Copy — on those non-paginated tables the visible rows ARE the full set.
  const supportsExportAll = Boolean(fetchAllRows);

  const fetchAllRowsOrEmpty = useCallback(
    (): Promise<T[]> => (fetchAllRows ? fetchAllRows() : Promise.resolve([])),
    [fetchAllRows]
  );

  const csvExportAction = useGridTableCsvExport({
    data: tableData,
    columns: exportColumns,
    getTextContent,
    // Pass the real (possibly undefined) fetcher: when absent, Copy takes the visible rows.
    fetchAllRows,
  });

  const csvExportFileAction = useGridTableCsvFileExportAction({
    fetchAllRows: fetchAllRowsOrEmpty,
    columns: exportColumns,
    getTextContent,
    defaultFilename: exportFilename ?? 'export',
    disabled: tableData.length === 0,
  });

  const resolvedPostActions = useMemo<IconBarItem[]>(() => {
    // The grouped copy/export pair. When the view can fetch all rows, both act on the
    // full matching set — [copy · export]. Otherwise just the visible-rows copy.
    const items: IconBarItem[] = [];
    if (supportsExportAll) {
      items.push(csvExportAction, csvExportFileAction);
    } else {
      items.push(csvExportAction);
    }

    if (resolvedFilterOptions.postActions?.length) {
      items.push(...resolvedFilterOptions.postActions);
    }
    if (postActions?.length) {
      items.push(...postActions);
    }

    return items;
  }, [
    csvExportAction,
    csvExportFileAction,
    postActions,
    resolvedFilterOptions.postActions,
    supportsExportAll,
  ]);

  // Filter feedback for the bar: N (items matching the active filters) of M (items in scope before
  // them). Both are TOTALS, never the current page. Server-paginated tables get them from the
  // backend (totalCount = N, unfilteredTotal = M); local tables derive N from the client-filtered
  // set and M from the full row set. The bar only renders this while a narrowing filter is active.
  const resultCount = useMemo(() => {
    if (!filteringEnabled) {
      return undefined;
    }
    // Server-paginated tables (searchBehavior 'query') filter on the backend, so the displayed
    // rows are just the current page — N/M come from the backend counts. Local tables filter
    // client-side, so N is the filtered row set and M is the full provided dataset.
    const isServerPaginated = filters?.options?.searchBehavior === 'query';
    const filtered = isServerPaginated
      ? (filters?.options?.totalCount ?? totalDataCount ?? data.length)
      : tableData.length;
    const unfiltered = isServerPaginated
      ? (filters?.options?.unfilteredTotal ?? filtered)
      : data.length;
    return {
      filtered,
      unfiltered,
      totalIsExact: filters?.options?.totalIsExact ?? true,
      partialDataLabel: filters?.options?.partialDataLabel,
      capped:
        Boolean(filters?.options?.partialDataLabel) || filters?.options?.totalIsExact === false,
    };
  }, [
    filteringEnabled,
    filters?.options?.searchBehavior,
    filters?.options?.totalCount,
    filters?.options?.unfilteredTotal,
    filters?.options?.totalIsExact,
    filters?.options?.partialDataLabel,
    totalDataCount,
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

  const filtersNode = filteringEnabled ? <GridTableFiltersBar {...filtersBarProps} /> : null;

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
