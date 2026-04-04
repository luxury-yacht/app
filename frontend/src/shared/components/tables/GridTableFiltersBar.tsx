/**
 * frontend/src/shared/components/tables/GridTableFiltersBar.tsx
 *
 * UI component for GridTableFiltersBar.
 * Handles rendering and interactions for the shared components.
 */

import React, { useRef, useMemo } from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import SearchInput from '@shared/components/inputs/SearchInput';
import type {
  GridTableFilterState,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';
import { useSearchShortcutTarget } from '@ui/shortcuts';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { CaseSensitiveIcon, ResetFiltersIcon } from '@shared/components/icons/MenuIcons';

interface GridTableFiltersBarProps {
  activeFilters: GridTableFilterState;
  resolvedFilterOptions: InternalFilterOptions;
  kindDropdownId: string;
  namespaceDropdownId: string;
  columnsDropdownId?: string;
  searchInputId: string;
  onKindsChange: (value: string | string[]) => void;
  onNamespacesChange: (value: string | string[]) => void;
  onSearchChange: (value: string) => void;
  onReset: () => void;
  /** Toggle the case-sensitive search filter. */
  onToggleCaseSensitive: () => void;
  renderOption: (option: DropdownOption, isSelected: boolean) => React.ReactNode;
  renderKindsValue: (value: string | string[], options: DropdownOption[]) => React.ReactNode;
  renderNamespacesValue: (value: string | string[], options: DropdownOption[]) => React.ReactNode;
  renderColumnsValue?: (value: string | string[], options: DropdownOption[]) => React.ReactNode;
  columnOptions?: DropdownOption[];
  columnValue?: string[];
  onColumnsChange?: (value: string | string[]) => void;
  showKindDropdown?: boolean;
  showNamespaceDropdown?: boolean;
  showColumnsDropdown?: boolean;
  searchShortcutActive?: boolean;
  searchShortcutPriority?: number;
  containerRef?: React.Ref<HTMLDivElement>;
  /** IconBar items rendered before the built-in Reset action (e.g. Favorite toggle). */
  preActions?: IconBarItem[];
  /** IconBar items rendered after a separator following Reset (e.g. Load More). */
  postActions?: IconBarItem[];
  /** Arbitrary content rendered after the IconBar (e.g. text toggle buttons). */
  customActions?: React.ReactNode;
  /** Displayed vs total item count shown to the right of actions. */
  resultCount?: { displayed: number; total: number };
}

const GridTableFiltersBar: React.FC<GridTableFiltersBarProps> = ({
  activeFilters,
  resolvedFilterOptions,
  kindDropdownId,
  namespaceDropdownId,
  columnsDropdownId,
  searchInputId,
  onKindsChange,
  onNamespacesChange,
  onSearchChange,
  onReset,
  onToggleCaseSensitive,
  renderOption,
  renderKindsValue,
  renderNamespacesValue,
  renderColumnsValue = () => 'Columns',
  columnOptions,
  columnValue,
  onColumnsChange,
  showKindDropdown = false,
  showNamespaceDropdown = false,
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
  const hasActiveFilters =
    activeFilters.search.trim().length > 0 ||
    activeFilters.kinds.length > 0 ||
    activeFilters.namespaces.length > 0;

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
    const items: IconBarItem[] = [
      {
        type: 'action',
        id: 'reset',
        icon: <ResetFiltersIcon />,
        onClick: onReset,
        title: 'Reset filters',
        disabled: !hasActiveFilters,
      },
      // Case-sensitive toggle is built into the filter bar so every view gets it.
      {
        type: 'toggle',
        id: 'case-sensitive',
        icon: <CaseSensitiveIcon width={16} height={16} />,
        active: activeFilters.caseSensitive,
        onClick: onToggleCaseSensitive,
        title: 'Match case',
      },
    ];
    if (preActions && preActions.length > 0) {
      items.push(...preActions);
    }
    if (postActions && postActions.length > 0) {
      items.push({ type: 'separator' });
      items.push(...postActions);
    }
    return items;
  }, [
    onReset,
    hasActiveFilters,
    activeFilters.caseSensitive,
    onToggleCaseSensitive,
    preActions,
    postActions,
  ]);

  return (
    <div className="gridtable-filter-bar" ref={containerRef}>
      <div className="gridtable-filter-cluster" data-gridtable-filter-cluster="primary">
        {(showKindDropdown || showNamespaceDropdown) && (
          <div className="gridtable-filter-subcluster">
            {showKindDropdown && (
              <div className="gridtable-filter-group" data-gridtable-filter-role="kind">
                <Dropdown
                  id={kindDropdownId}
                  name="gridtable-filter-kind"
                  multiple
                  size="compact"
                  placeholder="All kinds"
                  value={activeFilters.kinds}
                  options={resolvedFilterOptions.kinds}
                  disabled={!resolvedFilterOptions.kinds?.length}
                  onChange={onKindsChange}
                  dropdownClassName="dropdown-filter-menu"
                  renderOption={renderOption}
                  renderValue={renderKindsValue}
                />
              </div>
            )}
            {showNamespaceDropdown && (
              <div className="gridtable-filter-group" data-gridtable-filter-role="namespace">
                <Dropdown
                  id={namespaceDropdownId}
                  name="gridtable-filter-namespace"
                  multiple
                  size="compact"
                  placeholder="All namespaces"
                  value={activeFilters.namespaces}
                  options={resolvedFilterOptions.namespaces}
                  disabled={!resolvedFilterOptions.namespaces?.length}
                  onChange={onNamespacesChange}
                  dropdownClassName="dropdown-filter-menu"
                  renderOption={renderOption}
                  renderValue={renderNamespacesValue}
                />
              </div>
            )}
          </div>
        )}
        <div className="gridtable-filter-subcluster">
          <div className="gridtable-filter-group" data-gridtable-filter-role="search">
            <SearchInput
              inputRef={searchInputRef}
              id={searchInputId}
              name="gridtable-filter-search"
              placeholder={resolvedFilterOptions.searchPlaceholder ?? 'Search'}
              value={activeFilters.search}
              onChange={onSearchChange}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div className="gridtable-filter-actions">
            <IconBar items={iconBarItems} />
            {customActions && (
              <div
                className="gridtable-filter-custom-actions"
                data-gridtable-filter-role="custom-actions"
              >
                {customActions}
              </div>
            )}
            {resultCount && (
              <span
                className="gridtable-filter-result-count"
                data-gridtable-filter-role="result-count"
              >
                {resultCount.displayed === resultCount.total
                  ? `${resultCount.total} items`
                  : `${resultCount.displayed} of ${resultCount.total} items`}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="gridtable-filter-cluster" data-gridtable-filter-cluster="tertiary">
        {showColumnsDropdown && columnOptions && columnValue && onColumnsChange && (
          <div className="gridtable-filter-group" data-gridtable-filter-role="columns">
            <Dropdown
              id={columnsDropdownId ?? `${searchInputId}-columns`}
              name="gridtable-filter-columns"
              multiple
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
  );
};

export default GridTableFiltersBar;
