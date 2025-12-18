import React, { useRef } from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import type {
  GridTableFilterState,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';
import { useSearchShortcutTarget } from '@ui/shortcuts';

interface GridTableFiltersBarProps {
  activeFilters: GridTableFilterState;
  resolvedFilterOptions: InternalFilterOptions;
  kindDropdownId: string;
  namespaceDropdownId: string;
  columnsDropdownId?: string;
  searchInputId: string;
  onKindsChange: (value: string | string[]) => void;
  onNamespacesChange: (value: string | string[]) => void;
  onSearchChange: React.ChangeEventHandler<HTMLInputElement>;
  onReset: () => void;
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
  customActions?: React.ReactNode;
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
  customActions,
}) => {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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
          <div className="gridtable-filter-group" data-gridtable-filter-role="search-wrapper">
            <input
              ref={searchInputRef}
              id={searchInputId}
              name="gridtable-filter-search"
              type="search"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={resolvedFilterOptions.searchPlaceholder ?? 'Search'}
              value={activeFilters.search}
              onChange={onSearchChange}
              onKeyDown={handleSearchKeyDown}
              data-gridtable-filter-role="search"
            />
          </div>
          <div className="gridtable-filter-actions">
            {customActions && (
              <div
                className="gridtable-filter-custom-actions"
                data-gridtable-filter-role="custom-actions"
              >
                {customActions}
              </div>
            )}
            <button
              type="button"
              className="button generic"
              onClick={onReset}
              data-gridtable-filter-role="reset"
              disabled={false}
            >
              Reset
            </button>
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
