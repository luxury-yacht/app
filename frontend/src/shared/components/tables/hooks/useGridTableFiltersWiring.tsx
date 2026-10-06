/**
 * frontend/src/shared/components/tables/hooks/useGridTableFiltersWiring.tsx
 *
 * Filter state/data and presentation hooks for GridTable.
 */

import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import {
  DropdownFilterOption,
  dropdownFilterOptionState,
} from '@shared/components/dropdowns/Dropdown/DropdownFilterOption';
import { normalizeDropdownValue } from '@shared/components/dropdowns/dropdownValue';
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
import { useGridTableDownloadAction } from '@shared/components/tables/hooks/useGridTableDownloadAction';
import { useGridTableFilters } from '@shared/components/tables/useGridTableFilters';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';

type ColumnsDropdownConfig = {
  options: DropdownOption[];
  value: string[];
  onChange: (value: string | string[]) => void;
  renderValue?: (value: string | string[], options: DropdownOption[]) => ReactNode;
  onMoveColumn?: (key: string, offset: -1 | 1) => void;
  onReorderColumn?: (key: string, targetIndex: number) => void;
  canResetColumns?: boolean;
  onResetColumns?: () => void;
  customMetadataColumnKeys?: Set<string>;
  onAddCustomMetadataColumn?: () => void;
  onEditCustomMetadataColumn?: (key: string) => void;
  onRemoveCustomMetadataColumn?: (key: string) => void;
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

type UseGridTableFilterModelOptions<T> = {
  data: T[];
  filters: GridTableFilterConfig<T> | undefined;
  diagnosticsLabel?: string;
};

type UseGridTableFiltersPresentationOptions<T> = {
  filterModel: ReturnType<typeof useGridTableFilterModel<T>>;
  data: T[];
  totalDataCount?: number;
  filters: GridTableFilterConfig<T> | undefined;
  columnsDropdown?: ColumnsDropdownConfig;
  searchShortcut?: SearchShortcutConfig;
  exportColumns?: GridColumnDefinition<T>[];
  getTextContent?: (node: ReactNode) => string;
  /** When provided, the Download button copies or saves every matching row it returns. */
  fetchAllRows?: () => Promise<T[]>;
  /** Base of the file name Download's Save to File offers. */
  exportFilename?: string;
};

export function useGridTableFilterModel<T>({
  data,
  filters,
  diagnosticsLabel,
}: UseGridTableFilterModelOptions<T>) {
  const filtersContainerRef = useRef<HTMLDivElement | null>(null);
  const filterFocusIndexRef = useRef<number | null>(null);

  const model = useGridTableFilters({
    data,
    filters,
    diagnosticsLabel,
    defaultGetKind,
    defaultGetNamespace,
    defaultGetSearchText,
  });

  useEffect(() => {
    if (!model.filteringEnabled) {
      filterFocusIndexRef.current = null;
    }
  }, [model.filteringEnabled]);

  return { ...model, filtersContainerRef, filterFocusIndexRef };
}

export function useGridTableFiltersPresentation<T>({
  filterModel,
  data,
  totalDataCount,
  filters,
  columnsDropdown,
  searchShortcut,
  exportColumns,
  getTextContent,
  fetchAllRows,
  exportFilename,
}: UseGridTableFiltersPresentationOptions<T>): ReactNode {
  const {
    filteringEnabled,
    tableData,
    activeFilters,
    resolvedFilterOptions,
    filtersContainerRef,
    handleFilterSearchChange,
    handleFilterKindsChange,
    handleFilterNamespacesChange,
    handleFilterClustersChange,
    handleFilterQueryFacetChange,
    handleFiltersChange,
    handleFilterReset,
  } = filterModel;

  const handleKindDropdownChange = useCallback(
    (value: string | string[]) => {
      handleFilterKindsChange(normalizeDropdownValue(value));
    },
    [handleFilterKindsChange]
  );

  const handleNamespaceDropdownChange = useCallback(
    (value: string | string[]) => {
      handleFilterNamespacesChange(normalizeDropdownValue(value));
    },
    [handleFilterNamespacesChange]
  );

  const handleClusterDropdownChange = useCallback(
    (value: string | string[]) => {
      handleFilterClustersChange(normalizeDropdownValue(value));
    },
    [handleFilterClustersChange]
  );

  const handleQueryFacetDropdownChange = useCallback(
    (key: string, value: string | string[]) => {
      handleFilterQueryFacetChange(key, normalizeDropdownValue(value));
    },
    [handleFilterQueryFacetChange]
  );

  const searchInputId = useId();
  const kindDropdownId = useId();
  const namespaceDropdownId = useId();
  const clusterDropdownId = useId();
  const queryFacetDropdownIdPrefix = useId();
  const columnsDropdownId = useId();

  const showKindDropdown = filters?.options?.showKindDropdown ?? false;
  const showNamespaceDropdown = filters?.options?.showNamespaceDropdown ?? false;
  const showClusterDropdown = filters?.options?.showClusterDropdown ?? false;

  const renderFilterOption = useCallback(
    (option: DropdownOption, isSelected: boolean): ReactNode => (
      <DropdownFilterOption
        label={option.label}
        state={dropdownFilterOptionState(isSelected)}
        plain={isActionOption(option)}
      />
    ),
    []
  );

  const renderColumnsValue = useCallback(
    (_value: string | string[], _options: DropdownOption[]) => 'Columns',
    []
  );

  const searchShortcutActive = searchShortcut?.active ?? filteringEnabled;
  const searchShortcutPriority = searchShortcut?.priority ?? 5;
  const showColumnsDropdown = Boolean(columnsDropdown);
  const resolvedPreActions = resolvedFilterOptions.preActions;

  // Download copies or saves every matching row when the view can fetch all pages.
  // Otherwise it takes this local row set; local presentation pagination still
  // supplies every filtered row here because pagination is applied downstream.
  // That set is every matching row unless it is a backend page or a partial window.
  const downloadAction = useGridTableDownloadAction({
    data: tableData,
    columns: exportColumns,
    getTextContent,
    fetchAllRows,
    allMatchingRows:
      Boolean(fetchAllRows) ||
      (filters?.options?.searchBehavior !== 'query' && !filters?.options?.partialDataLabel),
    defaultFilename: exportFilename ?? 'export',
  });

  // Download ends the icon bar, after a separator.
  const resolvedPostActions = useMemo<IconBarItem[]>(() => [downloadAction], [downloadAction]);

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
      clusterDropdownId,
      queryFacetDropdownIdPrefix,
      columnsDropdownId,
      resolvedFilterOptions,
      containerRef: filtersContainerRef,
      activeFilters,
      onSearchChange: handleFilterSearchChange,
      onKindsChange: handleKindDropdownChange,
      onNamespacesChange: handleNamespaceDropdownChange,
      onClustersChange: handleClusterDropdownChange,
      onQueryFacetChange: handleQueryFacetDropdownChange,
      onFiltersChange: handleFiltersChange,
      onReset: handleFilterReset,
      showKindDropdown,
      showNamespaceDropdown,
      showClusterDropdown,
      renderOption: renderFilterOption,
      renderColumnsValue: columnsDropdown?.renderValue ?? renderColumnsValue,
      columnOptions: columnsDropdown?.options,
      columnValue: columnsDropdown?.value,
      onColumnsChange: columnsDropdown?.onChange,
      onMoveColumn: columnsDropdown?.onMoveColumn,
      onReorderColumn: columnsDropdown?.onReorderColumn,
      canResetColumns: columnsDropdown?.canResetColumns,
      onResetColumns: columnsDropdown?.onResetColumns,
      customMetadataColumnKeys: columnsDropdown?.customMetadataColumnKeys,
      onAddCustomMetadataColumn: columnsDropdown?.onAddCustomMetadataColumn,
      onEditCustomMetadataColumn: columnsDropdown?.onEditCustomMetadataColumn,
      onRemoveCustomMetadataColumn: columnsDropdown?.onRemoveCustomMetadataColumn,
      showColumnsDropdown,
      searchShortcutActive,
      searchShortcutPriority,
      preActions: resolvedPreActions,
      postActions: resolvedPostActions,
      resultCount,
    }),
    [
      searchInputId,
      kindDropdownId,
      namespaceDropdownId,
      clusterDropdownId,
      queryFacetDropdownIdPrefix,
      columnsDropdownId,
      resolvedFilterOptions,
      activeFilters,
      handleFilterSearchChange,
      handleKindDropdownChange,
      handleNamespaceDropdownChange,
      handleClusterDropdownChange,
      handleQueryFacetDropdownChange,
      handleFiltersChange,
      handleFilterReset,
      showKindDropdown,
      showNamespaceDropdown,
      showClusterDropdown,
      renderFilterOption,
      columnsDropdown,
      renderColumnsValue,
      showColumnsDropdown,
      searchShortcutActive,
      searchShortcutPriority,
      resolvedPreActions,
      resolvedPostActions,
      resultCount,
      filtersContainerRef,
    ]
  );

  return filteringEnabled ? <GridTableFiltersBar {...filtersBarProps} /> : null;
}
