/**
 * frontend/src/shared/components/tables/GridTableFiltersBar.tsx
 *
 * UI component for GridTableFiltersBar.
 * Handles rendering and interactions for the shared components.
 */

import ActiveFilterChips, { type ActiveFilterChip } from '@shared/components/ActiveFilterChips';
import type { DropdownOption, DropdownProps } from '@shared/components/dropdowns/Dropdown';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import { DROPDOWN_BULK_ACTION_ICON_SIZE } from '@shared/components/dropdowns/Dropdown/Dropdown';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionToDropdownValues,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import {
  CaseSensitiveIcon,
  PlusIcon,
  ResetFiltersIcon,
} from '@shared/components/icons/SharedIcons';
import SearchInput from '@shared/components/inputs/SearchInput';
import Tooltip from '@shared/components/Tooltip';
import type {
  GridTableFilterState,
  GridTableQueryFacetDefinition,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';
import { hasNarrowingGridTableFilters } from '@shared/components/tables/gridTableFilterState';
import { useGridTableColumnOptionRows } from '@shared/components/tables/hooks/useGridTableColumnOptionRows';
import { useSearchShortcutTarget } from '@ui/shortcuts';
import type React from 'react';
import { useMemo, useRef } from 'react';

interface GridTableFiltersBarProps {
  activeFilters: GridTableFilterState;
  resolvedFilterOptions: InternalFilterOptions;
  kindDropdownId: string;
  namespaceDropdownId: string;
  clusterDropdownId: string;
  queryFacetDropdownIdPrefix?: string;
  columnsDropdownId?: string;
  searchInputId: string;
  onKindsChange: (value: string | string[]) => void;
  onNamespacesChange: (value: string | string[]) => void;
  onClustersChange: (value: string | string[]) => void;
  onQueryFacetChange?: (key: string, value: string | string[]) => void;
  onFiltersChange: (changes: Partial<GridTableFilterState>) => void;
  onSearchChange: (value: string) => void;
  onReset: () => void;
  /** Toggle the case-sensitive search filter. */
  onToggleCaseSensitive: () => void;
  renderOption: (option: DropdownOption, isSelected: boolean) => React.ReactNode;
  renderKindsValue: (value: string | string[], options: DropdownOption[]) => React.ReactNode;
  renderNamespacesValue: (value: string | string[], options: DropdownOption[]) => React.ReactNode;
  renderClustersValue: (value: string | string[], options: DropdownOption[]) => React.ReactNode;
  renderColumnsValue?: (value: string | string[], options: DropdownOption[]) => React.ReactNode;
  columnOptions?: DropdownOption[];
  columnValue?: string[];
  onColumnsChange?: (value: string | string[]) => void;
  onMoveColumn?: (key: string, offset: -1 | 1) => void;
  onReorderColumn?: (key: string, targetIndex: number) => void;
  canResetColumns?: boolean;
  onResetColumns?: () => void;
  customMetadataColumnKeys?: Set<string>;
  onAddCustomMetadataColumn?: () => void;
  onEditCustomMetadataColumn?: (key: string) => void;
  onRemoveCustomMetadataColumn?: (key: string) => void;
  showKindDropdown?: boolean;
  showNamespaceDropdown?: boolean;
  showClusterDropdown?: boolean;
  showColumnsDropdown?: boolean;
  searchShortcutActive?: boolean;
  searchShortcutPriority?: number;
  containerRef?: React.Ref<HTMLDivElement>;
  /** IconBar items rendered after the built-in filter toggles (e.g. Favorite toggle). */
  preActions?: IconBarItem[];
  /** IconBar items rendered after a separator following the preceding actions (e.g. Load More). */
  postActions?: IconBarItem[];
  /** Arbitrary content rendered after the IconBar (e.g. text toggle buttons). */
  customActions?: React.ReactNode;
  /** Filter feedback shown after the active filter chips: N matching of M in scope. */
  resultCount?: {
    /** N — items matching the active filters (a total, not the current page). */
    filtered: number;
    /** M — items in scope before the active filters. */
    unfiltered: number;
    totalIsExact?: boolean;
    partialDataLabel?: string;
    capped?: boolean;
  };
}

type FilterControlPlacement = 'before-kinds' | 'kind' | 'namespace' | 'cluster' | 'after-clusters';

interface ResolvedMultiselectFilterControl {
  key: string;
  role: string;
  id: string;
  name: string;
  label: string;
  singularLabel: string;
  clearLabel: string;
  placeholder: string;
  placement: FilterControlPlacement;
  visible: boolean;
  searchable?: boolean;
  bulkActions?: boolean;
  selection: MultiSelectFilterSelection;
  options: DropdownOption[];
  onChange: (value: string | string[]) => void;
  onClear: () => void;
  renderValue: (value: string | string[], options: DropdownOption[]) => React.ReactNode;
}

type PrimaryFilterItem =
  | { type: 'control'; control: ResolvedMultiselectFilterControl }
  | { type: 'before-namespace-actions'; items: IconBarItem[] };

function formatResultCountLabel(
  resultCount: NonNullable<GridTableFiltersBarProps['resultCount']>
): string {
  // Only rendered while a narrowing filter is active, so this is always the filtered view.
  // `+` marks an approximate total (a capped/inexact backend count).
  const approximate = resultCount.totalIsExact === false ? '+' : '';
  return `Showing ${resultCount.filtered} of ${resultCount.unfiltered}${approximate} items`;
}

function queryFacetChipType(facet: GridTableQueryFacetDefinition): string {
  const placeholder = facet.placeholder.trim();
  const suffix = placeholder.slice(3);
  const trimmedSuffix = suffix.trimStart();
  const hasAllPrefix = placeholder.slice(0, 3).toLowerCase() === 'all';
  const hasWhitespaceSeparator = suffix.length > trimmedSuffix.length;
  const unrestrictedLabel =
    hasAllPrefix && hasWhitespaceSeparator && trimmedSuffix ? trimmedSuffix : facet.label;
  return unrestrictedLabel.charAt(0).toUpperCase() + unrestrictedLabel.slice(1);
}

function queryFacetChipSingularType(facet: GridTableQueryFacetDefinition): string {
  const label = facet.label.trim();
  if (/ies$/i.test(label)) {
    return `${label.slice(0, -3)}y`;
  }
  if (/(?:ches|shes|sses|xes|zes)$/i.test(label)) {
    return label.slice(0, -2);
  }
  if (/s$/i.test(label) && !/(?:ss|us)$/i.test(label)) {
    return label.slice(0, -1);
  }
  return label;
}

function buildActiveFilterChips(
  activeFilters: GridTableFilterState,
  filterControls: ResolvedMultiselectFilterControl[],
  onFiltersChange: GridTableFiltersBarProps['onFiltersChange']
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  const search = activeFilters.search.trim();
  if (search) {
    chips.push({
      key: 'search',
      label: `Text: ${search}`,
      removeLabel: 'Clear text filter',
      onRemove: () => onFiltersChange({ search: '' }),
    });
  }
  for (const control of filterControls) {
    const { selection } = control;
    if (selection.mode === 'all') {
      continue;
    }
    const count = selection.mode === 'some' ? selection.values.length : 0;
    const label =
      selection.mode === 'some' && selection.values.length === 1
        ? `${control.singularLabel}: ${control.options.find((option) => option.value === selection.values[0])?.label ?? selection.values[0]}`
        : `${control.label}: ${count}`;
    chips.push({
      key: control.key,
      label,
      removeLabel: `Clear ${control.clearLabel} filter`,
      onRemove: control.onClear,
    });
  }
  if (activeFilters.caseSensitive) {
    chips.push({
      key: 'case-sensitive',
      label: 'Match case',
      removeLabel: 'Clear Match case filter',
      onRemove: () => onFiltersChange({ caseSensitive: false }),
    });
  }
  if (activeFilters.includeMetadata) {
    chips.push({
      key: 'include-metadata',
      label: 'Include metadata',
      removeLabel: 'Clear Include metadata filter',
      onRemove: () => onFiltersChange({ includeMetadata: false }),
    });
  }
  return chips;
}

function renderResultCountChip(
  resultCount: GridTableFiltersBarProps['resultCount'],
  hasNarrowingFilters: boolean,
  searchBehavior: InternalFilterOptions['searchBehavior']
): React.ReactNode {
  if (!resultCount || !hasNarrowingFilters) {
    return undefined;
  }
  return (
    <span className="active-filter-chips__summary" data-gridtable-filter-role="result-count">
      {resultCount.capped ? (
        <Tooltip
          content={
            <>
              {resultCount.totalIsExact === false && (
                <p className="gridtable-filter-result-tooltip-paragraph">
                  The total count is approximate because the backend stopped counting after the
                  configured exact-count budget.
                </p>
              )}
              {!!resultCount.partialDataLabel && (
                <p className="gridtable-filter-result-tooltip-paragraph">
                  {resultCount.partialDataLabel}
                </p>
              )}
              <p className="gridtable-filter-result-tooltip-paragraph">
                {searchBehavior === 'query'
                  ? 'This table is showing the current backend query page.'
                  : 'This table is showing the current local row window.'}
              </p>
              {searchBehavior === 'query' && (
                <p className="gridtable-filter-result-tooltip-paragraph">
                  Use page controls to inspect additional matching rows.
                </p>
              )}
            </>
          }
        >
          <span>{formatResultCountLabel(resultCount)}</span>
        </Tooltip>
      ) : (
        formatResultCountLabel(resultCount)
      )}
    </span>
  );
}

interface ColumnsDropdownOptions {
  show: boolean;
  id: string;
  columnOptions?: DropdownOption[];
  columnValue?: string[];
  onColumnsChange: GridTableFiltersBarProps['onColumnsChange'];
  renderColumnOption: NonNullable<DropdownProps['renderOption']>;
  renderColumnOrderActions: DropdownProps['renderOptionActions'];
  getColumnRowProps: DropdownProps['getOptionRowProps'];
  onResetColumns: GridTableFiltersBarProps['onResetColumns'];
  canResetColumns: boolean;
  onAddCustomMetadataColumn: GridTableFiltersBarProps['onAddCustomMetadataColumn'];
  renderColumnsValue: NonNullable<GridTableFiltersBarProps['renderColumnsValue']>;
}

function renderColumnsDropdown({
  show,
  id,
  columnOptions,
  columnValue,
  onColumnsChange,
  renderColumnOption,
  renderColumnOrderActions,
  getColumnRowProps,
  onResetColumns,
  canResetColumns,
  onAddCustomMetadataColumn,
  renderColumnsValue,
}: ColumnsDropdownOptions): React.ReactNode {
  if (!show || !columnOptions || !columnValue || !onColumnsChange) {
    return null;
  }
  return (
    <div className="gridtable-filter-group" data-gridtable-filter-role="columns">
      <Dropdown
        id={id}
        name="gridtable-filter-columns"
        multiple
        showBulkActions
        size="compact"
        placeholder="Columns"
        value={columnValue}
        options={columnOptions}
        disabled={!columnOptions.length}
        onChange={onColumnsChange}
        dropdownClassName="dropdown-filter-menu dropdown-columns-menu"
        renderOption={renderColumnOption}
        renderOptionActions={renderColumnOrderActions}
        getOptionRowProps={getColumnRowProps}
        additionalBulkActions={({ closeDropdown }) => (
          <>
            {!!onAddCustomMetadataColumn && (
              <button
                type="button"
                className="dropdown-bulk-action dropdown-bulk-action--labeled icon-bar-button"
                title="Add a column from a label or annotation"
                aria-label="Add Custom Column"
                onClick={(event) => {
                  event.stopPropagation();
                  closeDropdown();
                  onAddCustomMetadataColumn();
                }}
              >
                <PlusIcon
                  width={DROPDOWN_BULK_ACTION_ICON_SIZE}
                  height={DROPDOWN_BULK_ACTION_ICON_SIZE}
                />
                <span className="dropdown-bulk-action-label">Add</span>
              </button>
            )}
            {!!onResetColumns && (
              <button
                type="button"
                className="dropdown-bulk-action dropdown-bulk-action--labeled icon-bar-button"
                disabled={!canResetColumns}
                title="Restore the default column order, show every column, and reset automatic widths"
                aria-label="Reset columns"
                onClick={(event) => {
                  event.stopPropagation();
                  onResetColumns();
                }}
              >
                <ResetFiltersIcon
                  width={DROPDOWN_BULK_ACTION_ICON_SIZE}
                  height={DROPDOWN_BULK_ACTION_ICON_SIZE}
                />
                <span className="dropdown-bulk-action-label">Reset</span>
              </button>
            )}
          </>
        )}
        renderValue={renderColumnsValue}
      />
    </div>
  );
}

const GridTableFiltersBar: React.FC<GridTableFiltersBarProps> = ({
  activeFilters,
  resolvedFilterOptions,
  kindDropdownId,
  namespaceDropdownId,
  clusterDropdownId,
  queryFacetDropdownIdPrefix,
  columnsDropdownId,
  searchInputId,
  onKindsChange,
  onNamespacesChange,
  onClustersChange,
  onQueryFacetChange,
  onFiltersChange,
  onSearchChange,
  onReset,
  onToggleCaseSensitive,
  renderOption,
  renderKindsValue,
  renderNamespacesValue,
  renderClustersValue,
  renderColumnsValue = () => 'Columns',
  columnOptions,
  columnValue,
  onColumnsChange,
  onMoveColumn,
  onReorderColumn,
  canResetColumns = false,
  onResetColumns,
  customMetadataColumnKeys,
  onAddCustomMetadataColumn,
  onEditCustomMetadataColumn,
  onRemoveCustomMetadataColumn,
  showKindDropdown = false,
  showNamespaceDropdown = false,
  showClusterDropdown = false,
  showColumnsDropdown = false,
  searchShortcutActive = false,
  searchShortcutPriority = 0,
  containerRef,
  preActions,
  postActions,
  customActions,
  resultCount,
}) => {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // The result count is filter feedback (how many rows match the active filter), not
  // pagination/total info — that lives in the pagination footer. So it shows only when
  // a narrowing filter (search/kind/namespace/cluster/provider query facet) is active.
  const hasNarrowingFilters = hasNarrowingGridTableFilters(activeFilters);
  const showCaseSensitiveToggle = resolvedFilterOptions.searchBehavior !== 'query';
  const queryFacets = resolvedFilterOptions.queryFacets ?? [];
  const { renderColumnOption, renderColumnOrderActions, getColumnRowProps } =
    useGridTableColumnOptionRows({
      columnOptions,
      onMoveColumn,
      onReorderColumn,
      customMetadataColumnKeys,
      onEditCustomMetadataColumn,
      onRemoveCustomMetadataColumn,
    });
  const filterControls: ResolvedMultiselectFilterControl[] = [
    {
      key: 'kinds',
      role: 'kind',
      id: kindDropdownId,
      name: 'gridtable-filter-kind',
      label: 'Kinds',
      singularLabel: 'Kind',
      clearLabel: 'Kinds',
      placeholder: 'All kinds',
      placement: 'kind',
      visible: showKindDropdown,
      searchable: true,
      bulkActions: true,
      selection: activeFilters.kinds,
      options: resolvedFilterOptions.kinds,
      onChange: onKindsChange,
      onClear: () => onFiltersChange({ kinds: ALL_MULTISELECT_FILTER }),
      renderValue: renderKindsValue,
    },
    {
      key: 'namespaces',
      role: 'namespace',
      id: namespaceDropdownId,
      name: 'gridtable-filter-namespace',
      label: 'Namespaces',
      singularLabel: 'Namespace',
      clearLabel: 'Namespaces',
      placeholder: 'All namespaces',
      placement: 'namespace',
      visible: showNamespaceDropdown,
      searchable: resolvedFilterOptions.namespaceDropdownSearchable,
      bulkActions: resolvedFilterOptions.namespaceDropdownBulkActions,
      selection: activeFilters.namespaces,
      options: resolvedFilterOptions.namespaces,
      onChange: onNamespacesChange,
      onClear: () => onFiltersChange({ namespaces: ALL_MULTISELECT_FILTER }),
      renderValue: renderNamespacesValue,
    },
    {
      key: 'clusters',
      role: 'cluster',
      id: clusterDropdownId,
      name: 'gridtable-filter-cluster',
      label: 'Clusters',
      singularLabel: 'Cluster',
      clearLabel: 'Clusters',
      placeholder: 'All clusters',
      placement: 'cluster',
      visible: showClusterDropdown,
      searchable: resolvedFilterOptions.clusterDropdownSearchable,
      bulkActions: resolvedFilterOptions.clusterDropdownBulkActions,
      selection: activeFilters.clusters,
      options: resolvedFilterOptions.clusters ?? [],
      onChange: onClustersChange,
      onClear: () => onFiltersChange({ clusters: ALL_MULTISELECT_FILTER }),
      renderValue: renderClustersValue,
    },
    ...queryFacets.map((facet): ResolvedMultiselectFilterControl => {
      const selection = activeFilters.queryFacets?.[facet.key] ?? ALL_MULTISELECT_FILTER;
      const count = selection.mode === 'some' ? selection.values.length : 0;
      return {
        key: `query-facet-${facet.key}`,
        role: `query-facet-${facet.key}`,
        id: `${queryFacetDropdownIdPrefix ?? 'gridtable-query-facet'}-${facet.key}`,
        name: `gridtable-filter-${facet.key}`,
        label: queryFacetChipType(facet),
        singularLabel: queryFacetChipSingularType(facet),
        clearLabel: facet.label,
        placeholder: facet.placeholder,
        placement: facet.placement === 'before-kinds' ? 'before-kinds' : 'after-clusters',
        visible: true,
        searchable: facet.searchable,
        bulkActions: facet.bulkActions,
        selection,
        options: facet.options,
        onChange: (value) => onQueryFacetChange?.(facet.key, value),
        onClear: () =>
          onFiltersChange({
            queryFacets: {
              ...activeFilters.queryFacets,
              [facet.key]: ALL_MULTISELECT_FILTER,
            },
          }),
        renderValue: () => (count > 0 ? `${facet.label} (${count})` : facet.label),
      };
    }),
  ];

  const controlsAt = (placement: FilterControlPlacement): ResolvedMultiselectFilterControl[] =>
    filterControls.filter((control) => control.visible && control.placement === placement);

  const primaryFilterItems: PrimaryFilterItem[] = [
    ...controlsAt('before-kinds').map((control) => ({
      type: 'control' as const,
      control,
    })),
    ...controlsAt('kind').map((control) => ({
      type: 'control' as const,
      control,
    })),
    ...(resolvedFilterOptions.beforeNamespaceActions?.length
      ? [
          {
            type: 'before-namespace-actions' as const,
            items: resolvedFilterOptions.beforeNamespaceActions,
          },
        ]
      : []),
    ...controlsAt('namespace').map((control) => ({
      type: 'control' as const,
      control,
    })),
    ...controlsAt('cluster').map((control) => ({
      type: 'control' as const,
      control,
    })),
    ...controlsAt('after-clusters').map((control) => ({
      type: 'control' as const,
      control,
    })),
  ];

  const activeFilterChips = buildActiveFilterChips(activeFilters, filterControls, onFiltersChange);

  const renderFilterControl = (control: ResolvedMultiselectFilterControl) => (
    <div
      key={control.key}
      className="gridtable-filter-group"
      data-gridtable-filter-role={control.role}
    >
      <Dropdown
        id={control.id}
        name={control.name}
        multiple
        size="compact"
        searchable={control.searchable}
        showBulkActions={control.bulkActions}
        placeholder={control.placeholder}
        value={filterSelectionToDropdownValues(control.selection, control.options)}
        options={control.options}
        disabled={!control.options.length}
        onChange={control.onChange}
        dropdownClassName="dropdown-filter-menu"
        renderOption={renderOption}
        renderValue={control.renderValue}
      />
    </div>
  );

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.currentTarget.select();
    }
  };

  useSearchShortcutTarget({
    isActive: searchShortcutActive,
    priority: searchShortcutPriority,
    focus: () => {
      const input = searchInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.select();
    },
    label: 'GridTable filters',
  });

  const iconBarItems = useMemo<IconBarItem[]>(() => {
    const items: IconBarItem[] = [];
    if (showCaseSensitiveToggle) {
      items.push({
        type: 'toggle',
        id: 'case-sensitive',
        icon: <CaseSensitiveIcon width={18} height={18} />,
        active: activeFilters.caseSensitive,
        onClick: onToggleCaseSensitive,
        title: 'Match case',
      });
    }
    if (preActions && preActions.length > 0) {
      items.push(...preActions);
    }
    if (postActions && postActions.length > 0) {
      if (items.length > 0) {
        items.push({ type: 'separator' });
      }
      items.push(...postActions);
    }
    return items;
  }, [
    activeFilters.caseSensitive,
    onToggleCaseSensitive,
    showCaseSensitiveToggle,
    preActions,
    postActions,
  ]);

  const resultCountChip = renderResultCountChip(
    resultCount,
    hasNarrowingFilters,
    resolvedFilterOptions.searchBehavior
  );

  return (
    <div className="gridtable-filter-container">
      <div className="gridtable-filter-bar" ref={containerRef}>
        <div className="gridtable-filter-cluster" data-gridtable-filter-cluster="primary">
          {!!primaryFilterItems.length && (
            <div className="gridtable-filter-subcluster">
              {primaryFilterItems.map((item) =>
                item.type === 'control' ? (
                  renderFilterControl(item.control)
                ) : (
                  <div
                    key="before-namespace-actions"
                    className="gridtable-filter-group"
                    data-gridtable-filter-role="before-namespace-actions"
                  >
                    <IconBar items={item.items} />
                  </div>
                )
              )}
            </div>
          )}
          <div className="gridtable-filter-subcluster">
            <div className="gridtable-filter-group" data-gridtable-filter-role="search">
              <SearchInput
                inputRef={searchInputRef}
                id={searchInputId}
                name="gridtable-filter-search"
                placeholder={resolvedFilterOptions.searchPlaceholder ?? 'Filter'}
                value={activeFilters.search}
                onChange={onSearchChange}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
            <div className="gridtable-filter-actions">
              {!!iconBarItems.length && <IconBar items={iconBarItems} />}
              {!!customActions && (
                <div
                  className="gridtable-filter-custom-actions"
                  data-gridtable-filter-role="custom-actions"
                >
                  {customActions}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="gridtable-filter-cluster" data-gridtable-filter-cluster="tertiary">
          {renderColumnsDropdown({
            show: showColumnsDropdown,
            id: columnsDropdownId ?? `${searchInputId}-columns`,
            columnOptions,
            columnValue,
            onColumnsChange,
            renderColumnOption,
            renderColumnOrderActions,
            getColumnRowProps,
            onResetColumns,
            canResetColumns,
            onAddCustomMetadataColumn,
            renderColumnsValue,
          })}
        </div>
      </div>
      <ActiveFilterChips
        ariaLabel="Active GridTable filters"
        chips={activeFilterChips}
        onClearAll={onReset}
        summary={resultCountChip}
      />
    </div>
  );
};

export default GridTableFiltersBar;
