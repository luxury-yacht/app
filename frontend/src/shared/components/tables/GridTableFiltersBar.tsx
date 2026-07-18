/**
 * frontend/src/shared/components/tables/GridTableFiltersBar.tsx
 *
 * UI component for GridTableFiltersBar.
 * Handles rendering and interactions for the shared components.
 */

import ActiveFilterChips, { type ActiveFilterChip } from '@shared/components/ActiveFilterChips';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionToDropdownValues,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { CaseSensitiveIcon } from '@shared/components/icons/SharedIcons';
import SearchInput from '@shared/components/inputs/SearchInput';
import Tooltip from '@shared/components/Tooltip';
import type {
  GridTableFilterState,
  GridTableQueryFacetDefinition,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';
import { hasNarrowingGridTableFilters } from '@shared/components/tables/gridTableFilterState';
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

function formatResultCountLabel(
  resultCount: NonNullable<GridTableFiltersBarProps['resultCount']>
): string {
  // Only rendered while a narrowing filter is active, so this is always the filtered view.
  // `+` marks an approximate total (a capped/inexact backend count).
  const approximate = resultCount.totalIsExact === false ? '+' : '';
  return `Showing ${resultCount.filtered} of ${resultCount.unfiltered}${approximate} items`;
}

function queryFacetChipType(facet: GridTableQueryFacetDefinition): string {
  const unrestrictedLabel = /^All\s+(.+)$/i.exec(facet.placeholder.trim())?.[1] ?? facet.label;
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
  const leadingQueryFacets = queryFacets.filter((facet) => facet.placement === 'before-kinds');
  const trailingQueryFacets = queryFacets.filter((facet) => facet.placement !== 'before-kinds');
  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
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

    const addSelectionChip = (
      key: 'kinds' | 'namespaces' | 'clusters',
      pluralLabel: string,
      singularLabel: string,
      options: DropdownOption[]
    ) => {
      const selection = activeFilters[key];
      if (selection.mode === 'all') {
        return;
      }
      const count = selection.mode === 'some' ? selection.values.length : 0;
      const label =
        selection.mode === 'some' && selection.values.length === 1
          ? `${singularLabel}: ${options.find((option) => option.value === selection.values[0])?.label ?? selection.values[0]}`
          : `${pluralLabel}: ${count}`;
      chips.push({
        key,
        label,
        removeLabel: `Clear ${pluralLabel} filter`,
        onRemove: () => onFiltersChange({ [key]: ALL_MULTISELECT_FILTER }),
      });
    };

    addSelectionChip('kinds', 'Kinds', 'Kind', resolvedFilterOptions.kinds);
    addSelectionChip('namespaces', 'Namespaces', 'Namespace', resolvedFilterOptions.namespaces);
    addSelectionChip('clusters', 'Clusters', 'Cluster', resolvedFilterOptions.clusters ?? []);

    for (const facet of queryFacets) {
      const selection = activeFilters.queryFacets?.[facet.key] ?? ALL_MULTISELECT_FILTER;
      if (selection.mode === 'all') {
        continue;
      }
      const count = selection.mode === 'some' ? selection.values.length : 0;
      const label =
        selection.mode === 'some' && selection.values.length === 1
          ? `${queryFacetChipSingularType(facet)}: ${facet.options.find((option) => option.value === selection.values[0])?.label ?? selection.values[0]}`
          : `${queryFacetChipType(facet)}: ${count}`;
      chips.push({
        key: `query-facet-${facet.key}`,
        label,
        removeLabel: `Clear ${facet.label} filter`,
        onRemove: () =>
          onFiltersChange({
            queryFacets: {
              ...(activeFilters.queryFacets ?? {}),
              [facet.key]: ALL_MULTISELECT_FILTER,
            },
          }),
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
  }, [
    activeFilters,
    onFiltersChange,
    queryFacets,
    resolvedFilterOptions.kinds,
    resolvedFilterOptions.namespaces,
    resolvedFilterOptions.clusters,
  ]);

  const renderQueryFacet = (facet: GridTableQueryFacetDefinition) => {
    const selection = activeFilters.queryFacets?.[facet.key] ?? ALL_MULTISELECT_FILTER;
    const selected = filterSelectionToDropdownValues(selection, facet.options);
    const count = selection.mode === 'some' ? selection.values.length : 0;
    return (
      <div
        key={facet.key}
        className="gridtable-filter-group"
        data-gridtable-filter-role={`query-facet-${facet.key}`}
      >
        <Dropdown
          id={`${queryFacetDropdownIdPrefix ?? 'gridtable-query-facet'}-${facet.key}`}
          name={`gridtable-filter-${facet.key}`}
          multiple
          size="compact"
          searchable={facet.searchable}
          showBulkActions={facet.bulkActions}
          placeholder={facet.placeholder}
          value={selected}
          options={facet.options}
          disabled={!facet.options.length}
          onChange={(value) => onQueryFacetChange?.(facet.key, value)}
          dropdownClassName="dropdown-filter-menu"
          renderOption={renderOption}
          renderValue={() => (count > 0 ? `${facet.label} (${count})` : facet.label)}
        />
      </div>
    );
  };

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

  const resultCountChip =
    resultCount && hasNarrowingFilters ? (
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
                  {resolvedFilterOptions.searchBehavior === 'query'
                    ? 'This table is showing the current backend query page.'
                    : 'This table is showing the current local row window.'}
                </p>
                {resolvedFilterOptions.searchBehavior === 'query' && (
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
    ) : undefined;

  return (
    <div className="gridtable-filter-container">
      <div className="gridtable-filter-bar" ref={containerRef}>
        <div className="gridtable-filter-cluster" data-gridtable-filter-cluster="primary">
          {!!(
            showKindDropdown ||
            showNamespaceDropdown ||
            showClusterDropdown ||
            (resolvedFilterOptions.beforeNamespaceActions?.length ?? 0) > 0 ||
            (resolvedFilterOptions.queryFacets?.length ?? 0) > 0
          ) && (
            <div className="gridtable-filter-subcluster">
              {leadingQueryFacets.map(renderQueryFacet)}
              {!!showKindDropdown && (
                <div className="gridtable-filter-group" data-gridtable-filter-role="kind">
                  <Dropdown
                    id={kindDropdownId}
                    name="gridtable-filter-kind"
                    multiple
                    size="compact"
                    searchable
                    showBulkActions
                    placeholder="All kinds"
                    value={filterSelectionToDropdownValues(
                      activeFilters.kinds,
                      resolvedFilterOptions.kinds
                    )}
                    options={resolvedFilterOptions.kinds}
                    disabled={!resolvedFilterOptions.kinds?.length}
                    onChange={onKindsChange}
                    dropdownClassName="dropdown-filter-menu"
                    renderOption={renderOption}
                    renderValue={renderKindsValue}
                  />
                </div>
              )}
              {!!resolvedFilterOptions.beforeNamespaceActions?.length && (
                <div
                  className="gridtable-filter-group"
                  data-gridtable-filter-role="before-namespace-actions"
                >
                  <IconBar items={resolvedFilterOptions.beforeNamespaceActions} />
                </div>
              )}
              {!!showNamespaceDropdown && (
                <div className="gridtable-filter-group" data-gridtable-filter-role="namespace">
                  <Dropdown
                    id={namespaceDropdownId}
                    name="gridtable-filter-namespace"
                    multiple
                    size="compact"
                    searchable={resolvedFilterOptions.namespaceDropdownSearchable}
                    showBulkActions={resolvedFilterOptions.namespaceDropdownBulkActions}
                    placeholder="All namespaces"
                    value={filterSelectionToDropdownValues(
                      activeFilters.namespaces,
                      resolvedFilterOptions.namespaces
                    )}
                    options={resolvedFilterOptions.namespaces}
                    disabled={!resolvedFilterOptions.namespaces?.length}
                    onChange={onNamespacesChange}
                    dropdownClassName="dropdown-filter-menu"
                    renderOption={renderOption}
                    renderValue={renderNamespacesValue}
                  />
                </div>
              )}
              {!!showClusterDropdown && (
                <div className="gridtable-filter-group" data-gridtable-filter-role="cluster">
                  <Dropdown
                    id={clusterDropdownId}
                    name="gridtable-filter-cluster"
                    multiple
                    size="compact"
                    searchable={resolvedFilterOptions.clusterDropdownSearchable}
                    showBulkActions={resolvedFilterOptions.clusterDropdownBulkActions}
                    placeholder="All clusters"
                    value={filterSelectionToDropdownValues(
                      activeFilters.clusters,
                      resolvedFilterOptions.clusters ?? []
                    )}
                    options={resolvedFilterOptions.clusters ?? []}
                    disabled={!resolvedFilterOptions.clusters?.length}
                    onChange={onClustersChange}
                    dropdownClassName="dropdown-filter-menu"
                    renderOption={renderOption}
                    renderValue={renderClustersValue}
                  />
                </div>
              )}
              {trailingQueryFacets.map(renderQueryFacet)}
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
          {!!(showColumnsDropdown && columnOptions && columnValue && onColumnsChange) && (
            <div className="gridtable-filter-group" data-gridtable-filter-role="columns">
              <Dropdown
                id={columnsDropdownId ?? `${searchInputId}-columns`}
                name="gridtable-filter-columns"
                multiple
                showBulkActions
                size="compact"
                placeholder="Columns"
                value={columnValue}
                options={columnOptions}
                disabled={!columnOptions.length}
                onChange={onColumnsChange}
                dropdownClassName="dropdown-filter-menu"
                renderOption={renderOption}
                renderValue={renderColumnsValue}
              />
            </div>
          )}
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
