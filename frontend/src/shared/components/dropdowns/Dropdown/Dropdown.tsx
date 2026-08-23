/**
 * frontend/src/shared/components/dropdowns/Dropdown/Dropdown.tsx
 *
 * UI component for Dropdown.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAriaAnnouncements } from './hooks/useAriaAnnouncements';
import { useDropdownState } from './hooks/useDropdownState';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import type { DropdownOption, DropdownProps } from './types';
import '@styles/components/dropdowns.css';
import { ListboxOptionButton } from '@shared/components/aria/ListboxOptionButton';
import {
  DropdownArrowIcon,
  DropdownSelectAllIcon,
  DropdownSelectNoneIcon,
} from '@shared/components/icons/DropdownIcons';
import { useKeyboardSurface } from '@ui/shortcuts';

type DropdownMenuStyle = React.CSSProperties & {
  '--dropdown-menu-anchor-width': string;
  '--dropdown-menu-available-height': string;
};

const DROPDOWN_MENU_GAP = 2;
const DROPDOWN_VIEWPORT_PADDING = 8;
const DROPDOWN_MENU_MAX_HEIGHT = 400;
const DROPDOWN_MENU_MIN_VISIBLE_HEIGHT = 48;

type DropdownPosition = 'bottom' | 'top';
type HorizontalPosition = 'start' | 'end';

interface DropdownPlacement {
  dropdownPosition: DropdownPosition;
  horizontalPosition: HorizontalPosition;
  menuStyle: DropdownMenuStyle;
}

const getZoomFactor = () => {
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor')
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const getVerticalPosition = (
  measuredMenuHeight: number,
  spaceBelow: number,
  spaceAbove: number
): DropdownPosition =>
  measuredMenuHeight <= spaceBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top';

const getPreferredTop = (
  position: DropdownPosition,
  triggerRect: Pick<DOMRect, 'bottom' | 'top'>,
  renderedMenuHeight: number
) =>
  position === 'bottom'
    ? triggerRect.bottom + DROPDOWN_MENU_GAP
    : triggerRect.top - DROPDOWN_MENU_GAP - renderedMenuHeight;

const calculateDropdownPlacement = (
  trigger: HTMLButtonElement,
  menu: HTMLDivElement
): DropdownPlacement => {
  const zoomFactor = getZoomFactor();
  const visualTriggerRect = trigger.getBoundingClientRect();
  const triggerRect = {
    top: visualTriggerRect.top / zoomFactor,
    right: visualTriggerRect.right / zoomFactor,
    bottom: visualTriggerRect.bottom / zoomFactor,
    left: visualTriggerRect.left / zoomFactor,
    width: visualTriggerRect.width / zoomFactor,
    height: visualTriggerRect.height / zoomFactor,
  };
  const viewportHeight = window.innerHeight / zoomFactor;
  const viewportWidth = window.innerWidth / zoomFactor;
  const viewportMenuWidth = Math.max(0, viewportWidth - DROPDOWN_VIEWPORT_PADDING * 2);
  const viewportMenuHeight = Math.max(0, viewportHeight - DROPDOWN_VIEWPORT_PADDING * 2);
  const anchorWidth = Math.min(triggerRect.width, viewportMenuWidth);

  menu.style.setProperty('--dropdown-menu-anchor-width', `${anchorWidth}px`);
  menu.style.setProperty(
    '--dropdown-menu-available-height',
    `${Math.min(DROPDOWN_MENU_MAX_HEIGHT, viewportMenuHeight)}px`
  );
  menu.style.maxWidth = `${viewportMenuWidth}px`;

  const measuredMenuWidth = Math.min(Math.max(menu.offsetWidth, anchorWidth), viewportMenuWidth);
  const measuredMenuHeight = Math.min(menu.offsetHeight, DROPDOWN_MENU_MAX_HEIGHT);
  const spaceBelow = Math.max(
    0,
    viewportHeight - DROPDOWN_VIEWPORT_PADDING - triggerRect.bottom - DROPDOWN_MENU_GAP
  );
  const spaceAbove = Math.max(0, triggerRect.top - DROPDOWN_VIEWPORT_PADDING - DROPDOWN_MENU_GAP);
  const dropdownPosition = getVerticalPosition(measuredMenuHeight, spaceBelow, spaceAbove);
  const selectedSpace = dropdownPosition === 'bottom' ? spaceBelow : spaceAbove;
  const availableHeight = Math.min(
    DROPDOWN_MENU_MAX_HEIGHT,
    viewportMenuHeight,
    Math.max(selectedSpace, Math.min(DROPDOWN_MENU_MIN_VISIBLE_HEIGHT, viewportMenuHeight))
  );

  menu.style.setProperty('--dropdown-menu-available-height', `${availableHeight}px`);
  const renderedMenuHeight = Math.min(menu.offsetHeight, availableHeight);
  const maxLeft = Math.max(
    DROPDOWN_VIEWPORT_PADDING,
    viewportWidth - DROPDOWN_VIEWPORT_PADDING - measuredMenuWidth
  );
  const left = Math.max(DROPDOWN_VIEWPORT_PADDING, Math.min(triggerRect.left, maxLeft));
  const maxTop = Math.max(
    DROPDOWN_VIEWPORT_PADDING,
    viewportHeight - DROPDOWN_VIEWPORT_PADDING - renderedMenuHeight
  );
  const preferredTop = getPreferredTop(dropdownPosition, triggerRect, renderedMenuHeight);
  const top = Math.max(DROPDOWN_VIEWPORT_PADDING, Math.min(preferredTop, maxTop));
  const horizontalPosition =
    triggerRect.left + measuredMenuWidth > viewportWidth - DROPDOWN_VIEWPORT_PADDING
      ? 'end'
      : 'start';

  return {
    dropdownPosition,
    horizontalPosition,
    menuStyle: {
      position: 'fixed',
      top,
      right: 'auto',
      bottom: 'auto',
      left,
      maxWidth: viewportMenuWidth,
      visibility: 'visible',
      '--dropdown-menu-anchor-width': `${anchorWidth}px`,
      '--dropdown-menu-available-height': `${availableHeight}px`,
    },
  };
};

const observeDropdownElements = (
  positionMenu: () => void,
  trigger: HTMLButtonElement,
  menu: HTMLDivElement
) => {
  if (typeof ResizeObserver === 'undefined') {
    return null;
  }
  const observer = new ResizeObserver(positionMenu);
  observer.observe(trigger);
  observer.observe(menu);
  let ancestor = trigger.parentElement;
  while (ancestor) {
    observer.observe(ancestor);
    ancestor = ancestor.parentElement;
  }
  return observer;
};

const useDropdownPlacement = (
  isOpen: boolean,
  triggerRef: React.RefObject<HTMLButtonElement | null>,
  menuRef: React.RefObject<HTMLDivElement | null>
) => {
  const [placement, setPlacement] = useState<DropdownPlacement>({
    dropdownPosition: 'bottom',
    horizontalPosition: 'start',
    menuStyle: {
      position: 'fixed',
      visibility: 'hidden',
      '--dropdown-menu-anchor-width': '0px',
      '--dropdown-menu-available-height': `${DROPDOWN_MENU_MAX_HEIGHT}px`,
    },
  });

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!isOpen || !trigger || !menu) {
      return;
    }

    const positionMenu = () => setPlacement(calculateDropdownPlacement(trigger, menu));
    positionMenu();
    document.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);
    const resizeObserver = observeDropdownElements(positionMenu, trigger, menu);

    return () => {
      document.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener('resize', positionMenu);
      resizeObserver?.disconnect();
    };
  }, [isOpen, menuRef, triggerRef]);

  return placement;
};

const getMultipleDisplayText = <TMetadata,>(
  value: string[],
  options: DropdownOption<TMetadata>[],
  placeholder: string
) => {
  if (value.length === 0) {
    return placeholder;
  }
  return value
    .map((optionValue) => options.find((option) => option.value === optionValue)?.label)
    .filter(Boolean)
    .join(', ');
};

const getDropdownDisplayText = <TMetadata,>({
  loading,
  renderValue,
  displayValue,
  multiple,
  value,
  options,
  placeholder,
}: Pick<
  DropdownProps<TMetadata>,
  'displayValue' | 'loading' | 'multiple' | 'options' | 'placeholder' | 'renderValue' | 'value'
>) => {
  if (loading) {
    return 'Loading...';
  }
  if (renderValue) {
    return renderValue(value, options);
  }
  if (typeof displayValue === 'function') {
    return displayValue(value as string);
  }
  if (displayValue) {
    return displayValue;
  }
  if (multiple && Array.isArray(value)) {
    return getMultipleDisplayText(value, options, placeholder ?? 'Select...');
  }
  return options.find((option) => option.value === value)?.label || placeholder;
};

const getActiveOptionId = (isOpen: boolean, highlightedIndex: number, controlId: string) =>
  isOpen && highlightedIndex >= 0 ? `${controlId}-option-${highlightedIndex}` : undefined;

interface DropdownTriggerProps {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  searchable: boolean;
  isOpen: boolean;
  menuId: string;
  activeOptionId?: string;
  disabled: boolean;
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaLabelledBy?: string;
  toggleDropdown: () => void;
  children: React.ReactNode;
}

const DropdownTrigger = ({
  triggerRef,
  searchable,
  isOpen,
  menuId,
  activeOptionId,
  disabled,
  id,
  ariaLabel,
  ariaDescribedBy,
  ariaLabelledBy,
  toggleDropdown,
  children,
}: DropdownTriggerProps) => {
  if (searchable) {
    return (
      <button
        type="button"
        ref={triggerRef}
        className="dropdown-trigger"
        onClick={toggleDropdown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-labelledby={ariaLabelledBy}
        aria-controls={menuId}
        tabIndex={disabled ? -1 : 0}
        id={id}
        disabled={disabled}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      ref={triggerRef}
      className="dropdown-trigger"
      onClick={toggleDropdown}
      role="combobox"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-labelledby={ariaLabelledBy}
      aria-controls={menuId}
      aria-activedescendant={activeOptionId}
      tabIndex={disabled ? -1 : 0}
      id={id}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

interface DropdownBulkActionsProps {
  showLabels: boolean;
  showSelectionActions: boolean;
  selectedCount: number;
  selectableCount: number;
  onSelectAll: () => void;
  onSelectNone: () => void;
  additionalActions?: React.ReactNode;
}

const DropdownBulkActions = ({
  showLabels,
  showSelectionActions,
  selectedCount,
  selectableCount,
  onSelectAll,
  onSelectNone,
  additionalActions,
}: DropdownBulkActionsProps) => (
  <div
    className={`dropdown-bulk-actions icon-bar${
      showLabels ? ' dropdown-bulk-actions--labeled' : ''
    }`}
  >
    {showSelectionActions ? (
      <>
        <button
          type="button"
          className={`dropdown-bulk-action icon-bar-button${
            showLabels ? ' dropdown-bulk-action--labeled' : ''
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onSelectAll();
          }}
          disabled={selectedCount === selectableCount}
          title="Select all"
          aria-label="Select all"
        >
          <DropdownSelectAllIcon width={20} height={20} />
          {showLabels ? <span className="dropdown-bulk-action-label">All</span> : null}
        </button>
        <button
          type="button"
          className={`dropdown-bulk-action icon-bar-button${
            showLabels ? ' dropdown-bulk-action--labeled' : ''
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onSelectNone();
          }}
          disabled={selectedCount === 0}
          title="Select none"
          aria-label="Select none"
        >
          <DropdownSelectNoneIcon width={20} height={20} />
          {showLabels ? <span className="dropdown-bulk-action-label">None</span> : null}
        </button>
      </>
    ) : null}
    {additionalActions}
  </div>
);

interface DropdownMenuControlsProps {
  searchable: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchPlaceholder: string;
  searchValue: string;
  menuId: string;
  activeOptionId?: string;
  showBulkActions: boolean;
  showBulkActionLabels: boolean;
  selectedCount: number;
  selectableCount: number;
  onSearchChange: (value: string) => void;
  onSearchFocusChange: (focused: boolean) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  additionalBulkActions?: React.ReactNode;
}

const DropdownMenuControls = ({
  searchable,
  searchInputRef,
  searchPlaceholder,
  searchValue,
  menuId,
  activeOptionId,
  showBulkActions,
  showBulkActionLabels,
  selectedCount,
  selectableCount,
  onSearchChange,
  onSearchFocusChange,
  onSelectAll,
  onSelectNone,
  additionalBulkActions,
}: DropdownMenuControlsProps) => {
  if (!searchable && !showBulkActions && !additionalBulkActions) {
    return null;
  }

  return (
    <div className="dropdown-menu-controls">
      {searchable ? (
        <div className="search-container">
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onFocus={() => onSearchFocusChange(true)}
            onBlur={() => onSearchFocusChange(false)}
            role="combobox"
            aria-label={searchPlaceholder}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={menuId}
            aria-activedescendant={activeOptionId}
          />
        </div>
      ) : null}
      {showBulkActions || additionalBulkActions ? (
        <DropdownBulkActions
          showLabels={showBulkActionLabels}
          showSelectionActions={showBulkActions}
          selectedCount={selectedCount}
          selectableCount={selectableCount}
          onSelectAll={onSelectAll}
          onSelectNone={onSelectNone}
          additionalActions={additionalBulkActions}
        />
      ) : null}
    </div>
  );
};

interface DropdownOptionContentProps<TMetadata> {
  option: DropdownOption<TMetadata>;
  optionIsSelected: boolean;
  multiple: boolean;
  renderOption: DropdownProps<TMetadata>['renderOption'];
}

const DropdownOptionContent = <TMetadata,>({
  option,
  optionIsSelected,
  multiple,
  renderOption,
}: DropdownOptionContentProps<TMetadata>) => {
  if (renderOption) {
    return renderOption(option, optionIsSelected);
  }
  return (
    <>
      {multiple ? (
        <span className="dropdown-filter-check">{optionIsSelected ? '✓' : ''}</span>
      ) : null}
      <span className="option-label">{option.label}</span>
    </>
  );
};

interface DropdownOptionRowProps<TMetadata> {
  option: DropdownOption<TMetadata>;
  index: number;
  controlId: string;
  multiple: boolean;
  highlightedIndex: number;
  optionIsSelected: boolean;
  renderOption: DropdownProps<TMetadata>['renderOption'];
  renderOptionActions: DropdownProps<TMetadata>['renderOptionActions'];
  selectOption: (value: string) => void;
}

const DropdownOptionRow = <TMetadata,>({
  option,
  index,
  controlId,
  multiple,
  highlightedIndex,
  optionIsSelected,
  renderOption,
  renderOptionActions,
  selectOption,
}: DropdownOptionRowProps<TMetadata>) => {
  const isGroupHeader = option.group === 'header';
  if (isGroupHeader && option.label.trim().length === 0) {
    return <hr className="dropdown-separator" />;
  }
  if (isGroupHeader) {
    return (
      <div className="dropdown-group-header">
        {renderOption ? renderOption(option, false) : option.label}
      </div>
    );
  }

  const optionIsHighlighted = index === highlightedIndex;
  const optionAriaSelected = multiple
    ? optionIsSelected
    : optionIsHighlighted || (highlightedIndex < 0 && optionIsSelected);

  const optionButton = (
    <ListboxOptionButton
      id={`${controlId}-option-${index}`}
      data-dropdown-option-index={index}
      className={[
        'dropdown-option',
        optionIsSelected && 'selected',
        optionIsHighlighted && 'highlighted',
        option.disabled && 'disabled',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => selectOption(option.value)}
      selected={optionAriaSelected}
      aria-disabled={option.disabled}
      disabled={option.disabled}
    >
      <DropdownOptionContent
        option={option}
        optionIsSelected={optionIsSelected}
        multiple={multiple}
        renderOption={renderOption}
      />
    </ListboxOptionButton>
  );
  if (!renderOptionActions) {
    return optionButton;
  }
  return (
    <div
      className={`dropdown-option-row${optionIsHighlighted ? ' highlighted' : ''}`}
      role="presentation"
      data-dropdown-option-index={index}
    >
      {optionButton}
      <div className="dropdown-option-actions">{renderOptionActions(option)}</div>
    </div>
  );
};

interface DropdownOptionListProps<TMetadata> {
  options: DropdownOption<TMetadata>[];
  controlId: string;
  multiple: boolean;
  highlightedIndex: number;
  renderOption: DropdownProps<TMetadata>['renderOption'];
  renderOptionActions: DropdownProps<TMetadata>['renderOptionActions'];
  isSelected: (value: string) => boolean;
  selectOption: (value: string) => void;
}

const DropdownOptionList = <TMetadata,>({
  options,
  controlId,
  multiple,
  highlightedIndex,
  renderOption,
  renderOptionActions,
  isSelected,
  selectOption,
}: DropdownOptionListProps<TMetadata>) => {
  if (options.length === 0) {
    return <div className="no-options">No options available</div>;
  }
  return options.map((option, index) => (
    <DropdownOptionRow
      key={option.value}
      option={option}
      index={index}
      controlId={controlId}
      multiple={multiple}
      highlightedIndex={highlightedIndex}
      optionIsSelected={isSelected(option.value)}
      renderOption={renderOption}
      renderOptionActions={renderOptionActions}
      selectOption={selectOption}
    />
  ));
};

interface DropdownMenuPortalProps<TMetadata> {
  isOpen: boolean;
  disabled: boolean;
  loading: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  menuClasses: string;
  menuStyle: DropdownMenuStyle;
  multiple: boolean;
  menuId: string;
  searchable: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchPlaceholder: string;
  searchValue: string;
  activeOptionId?: string;
  showBulkActions: boolean;
  showBulkActionLabels: boolean;
  selectedCount: number;
  selectableCount: number;
  options: DropdownOption<TMetadata>[];
  controlId: string;
  highlightedIndex: number;
  renderOption: DropdownProps<TMetadata>['renderOption'];
  renderOptionActions: DropdownProps<TMetadata>['renderOptionActions'];
  isSelected: (value: string) => boolean;
  selectOption: (value: string) => void;
  setHighlightedIndex: (index: number) => void;
  onSearchChange: (value: string) => void;
  onSearchFocusChange: (focused: boolean) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  additionalBulkActions?: React.ReactNode;
}

const DropdownMenuPortal = <TMetadata,>({
  isOpen,
  disabled,
  loading,
  menuRef,
  menuClasses,
  menuStyle,
  multiple,
  menuId,
  searchable,
  searchInputRef,
  searchPlaceholder,
  searchValue,
  activeOptionId,
  showBulkActions,
  showBulkActionLabels,
  selectedCount,
  selectableCount,
  options,
  controlId,
  highlightedIndex,
  renderOption,
  renderOptionActions,
  isSelected,
  selectOption,
  setHighlightedIndex,
  onSearchChange,
  onSearchFocusChange,
  onSelectAll,
  onSelectNone,
  additionalBulkActions,
}: DropdownMenuPortalProps<TMetadata>) => {
  if (!isOpen || disabled || loading || typeof document === 'undefined') {
    return null;
  }

  const highlightOptionFromTarget = (target: EventTarget) => {
    if (!(target instanceof Element)) {
      return;
    }
    const isOptionAction = Boolean(target.closest('.dropdown-option-actions'));
    const optionElement = target.closest<HTMLElement>('[data-dropdown-option-index]');
    const optionIndex = Number(optionElement?.dataset.dropdownOptionIndex);
    if (!Number.isInteger(optionIndex) || (options[optionIndex]?.disabled && !isOptionAction)) {
      return;
    }
    setHighlightedIndex(optionIndex);
  };

  return createPortal(
    <div
      ref={menuRef}
      className={menuClasses}
      style={menuStyle}
      role="listbox"
      aria-multiselectable={multiple}
      id={menuId}
      data-focus-portal-owner={menuId}
      onMouseOver={(event) => highlightOptionFromTarget(event.target)}
      onFocus={(event) => highlightOptionFromTarget(event.target)}
    >
      <DropdownMenuControls
        searchable={searchable}
        searchInputRef={searchInputRef}
        searchPlaceholder={searchPlaceholder}
        searchValue={searchValue}
        menuId={menuId}
        activeOptionId={activeOptionId}
        showBulkActions={showBulkActions}
        showBulkActionLabels={showBulkActionLabels}
        selectedCount={selectedCount}
        selectableCount={selectableCount}
        onSearchChange={onSearchChange}
        onSearchFocusChange={onSearchFocusChange}
        onSelectAll={onSelectAll}
        onSelectNone={onSelectNone}
        additionalBulkActions={additionalBulkActions}
      />
      <DropdownOptionList
        options={options}
        controlId={controlId}
        multiple={multiple}
        highlightedIndex={highlightedIndex}
        renderOption={renderOption}
        renderOptionActions={renderOptionActions}
        isSelected={isSelected}
        selectOption={selectOption}
      />
    </div>,
    document.body
  );
};

interface DropdownClearButtonProps {
  clearable: boolean;
  multiple: boolean;
  value: string | string[];
  disabled: boolean;
  onClear: () => void;
}

const DropdownClearButton = ({
  clearable,
  multiple,
  value,
  disabled,
  onClear,
}: DropdownClearButtonProps) => {
  if (!clearable || multiple || !value || disabled) {
    return null;
  }
  return (
    <button
      type="button"
      className="clear-button"
      onClick={onClear}
      aria-label="Clear selection"
      tabIndex={-1}
    >
      ×
    </button>
  );
};

const DropdownHiddenInput = ({ name, value }: Pick<DropdownProps, 'name' | 'value'>) => {
  if (!name) {
    return null;
  }
  return <input type="hidden" name={name} value={Array.isArray(value) ? value.join(',') : value} />;
};

const Dropdown = <TMetadata,>({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  displayValue,
  variant = 'default',
  disabled = false,
  loading = false,
  error = false,
  multiple = false,
  searchable = false,
  searchMode = 'local',
  searchValue,
  searchPlaceholder = 'Search...',
  onSearchChange,
  clearable = false,
  showBulkActions = false,
  additionalBulkActions,
  renderOption,
  renderOptionActions,
  renderValue,
  className = '',
  dropdownClassName = '',
  ariaLabel,
  ariaDescribedBy,
  ariaLabelledBy,
  name,
  id,
  onOpen,
  onClose,
}: DropdownProps<TMetadata>) => {
  const {
    isOpen,
    highlightedIndex,
    searchQuery,
    dropdownRef,
    triggerRef,
    menuRef,
    openDropdown,
    closeDropdown,
    toggleDropdown,
    selectOption,
    isSelected,
    setHighlightedIndex,
    setSearchQuery,
  } = useDropdownState(value, onChange, multiple, disabled);

  const [isFocused, setIsFocused] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const menuScrollTopRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const generatedId = React.useId().replace(/:/g, '');
  const controlId = id || `dropdown-${generatedId}`;
  const menuId = `${controlId}-menu`;
  const activeOptionId = getActiveOptionId(isOpen, highlightedIndex, controlId);

  useEffect(() => {
    const nodes = [dropdownRef.current, isOpen ? menuRef.current : null].filter(
      (node): node is HTMLDivElement => node !== null
    );
    if (nodes.length === 0) {
      return;
    }

    const handleFocusIn = () => setIsFocused(true);
    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (
        !nextTarget ||
        (!dropdownRef.current?.contains(nextTarget) && !menuRef.current?.contains(nextTarget))
      ) {
        setIsFocused(false);
      }
    };

    nodes.forEach((node) => {
      node.addEventListener('focusin', handleFocusIn);
      node.addEventListener('focusout', handleFocusOut);
    });
    return () => {
      nodes.forEach((node) => {
        node.removeEventListener('focusin', handleFocusIn);
        node.removeEventListener('focusout', handleFocusOut);
      });
    };
  }, [dropdownRef, isOpen, menuRef]);

  const effectiveSearchQuery = searchValue ?? searchQuery;

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchable || !effectiveSearchQuery || searchMode === 'remote') {
      return options;
    }
    return options.filter((option) =>
      option.label.toLowerCase().includes(effectiveSearchQuery.toLowerCase())
    );
  }, [effectiveSearchQuery, options, searchMode, searchable]);

  // Set initial highlighted index when dropdown opens
  useEffect(() => {
    if (isOpen && !multiple && value && highlightedIndex === -1) {
      const selectedIndex = filteredOptions.findIndex((opt) => opt.value === value);
      if (selectedIndex >= 0) {
        setHighlightedIndex(selectedIndex);
      }
    }
  }, [filteredOptions, highlightedIndex, isOpen, multiple, setHighlightedIndex, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (highlightedIndex >= filteredOptions.length) {
      setHighlightedIndex(-1);
    }
  }, [filteredOptions.length, highlightedIndex, isOpen, setHighlightedIndex]);

  useLayoutEffect(() => {
    if (isOpen && searchable) {
      searchInputRef.current?.focus();
    }
  }, [isOpen, searchable]);

  const { handleKeyAction } = useKeyboardNavigation({
    options: filteredOptions,
    isOpen,
    highlightedIndex,
    setHighlightedIndex,
    selectOption,
    openDropdown,
    closeDropdown,
    disabled,
  });

  const { announcementRef } = useAriaAnnouncements({
    value,
    options: filteredOptions,
    isOpen,
    highlightedIndex,
  });

  const previousOpenRef = useRef(isOpen);
  useEffect(() => {
    if (!previousOpenRef.current && isOpen) {
      onOpen?.(value);
    }
    if (previousOpenRef.current && !isOpen) {
      onClose?.(value);
      if (searchable && onSearchChange && effectiveSearchQuery !== '') {
        onSearchChange('');
      }
    }
    previousOpenRef.current = isOpen;
  }, [effectiveSearchQuery, isOpen, onClose, onOpen, onSearchChange, searchable, value]);

  const selectableFilteredValues = useMemo(
    () =>
      filteredOptions
        .filter((option) => !option.disabled && option.group !== 'header')
        .map((option) => option.value),
    [filteredOptions]
  );

  const selectedValueSet = useMemo(() => new Set(Array.isArray(value) ? value : []), [value]);

  const selectableSelectedCount = useMemo(
    () =>
      selectableFilteredValues.filter((optionValue) => selectedValueSet.has(optionValue)).length,
    [selectableFilteredValues, selectedValueSet]
  );

  const handleSelectAll = useMemo(
    () => () => {
      if (!multiple) {
        return;
      }
      const currentValues = Array.isArray(value) ? value : [];
      const nextValues = Array.from(new Set([...currentValues, ...selectableFilteredValues]));
      onChange(nextValues);
    },
    [multiple, onChange, selectableFilteredValues, value]
  );

  const handleSelectNone = useMemo(
    () => () => {
      if (!multiple) {
        return;
      }
      const currentValues = Array.isArray(value) ? value : [];
      const visibleValues = new Set(selectableFilteredValues);
      onChange(currentValues.filter((optionValue) => !visibleValues.has(optionValue)));
    },
    [multiple, onChange, selectableFilteredValues, value]
  );

  // Scroll highlighted option into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && menuRef.current) {
      // Find the actual option element with the highlighted class
      const highlightedElement = menuRef.current.querySelector(
        '.dropdown-option.highlighted, .dropdown-group-header.highlighted'
      ) as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      }
    }
  }, [highlightedIndex, isOpen, menuRef]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!isOpen || !menu) {
      return;
    }

    const handleMenuScroll = () => {
      menuScrollTopRef.current = menu.scrollTop;
    };

    menu.addEventListener('scroll', handleMenuScroll, { passive: true });
    return () => {
      menuScrollTopRef.current = menu.scrollTop;
      menu.removeEventListener('scroll', handleMenuScroll);
    };
  }, [isOpen, menuRef]);

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) {
      return;
    }
    if (menuRef.current.scrollTop !== menuScrollTopRef.current) {
      menuRef.current.scrollTop = menuScrollTopRef.current;
    }
  });

  useEffect(() => {
    if (!isOpen) {
      menuScrollTopRef.current = 0;
    }
  }, [isOpen]);

  const { dropdownPosition, horizontalPosition, menuStyle } = useDropdownPlacement(
    isOpen,
    triggerRef,
    menuRef
  );

  const containerClasses = [
    'dropdown',
    variant !== 'default' && `variant-${variant}`,
    error && 'error',
    disabled && 'disabled',
    loading && 'loading',
    isOpen && 'open',
    isSearchFocused && 'search-focused',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const menuClasses = [
    'dropdown-menu',
    'dropdown-menu--portal',
    `position-${dropdownPosition}`,
    `position-horizontal-${horizontalPosition}`,
    dropdownClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const shortcutsEnabled = !disabled && (isOpen || isFocused);

  const isTypingInSearch = () => {
    if (!searchable) {
      return false;
    }
    const active = document.activeElement as HTMLElement | null;
    return Boolean(active?.classList.contains('search-input'));
  };

  const handleDropdownKeyDown = (event: KeyboardEvent) => {
    if (event.key === ' ' && isTypingInSearch()) {
      return false;
    }

    const result = handleKeyAction(event.key);
    if (result === 'handled-no-prevent') {
      return 'handled-no-prevent' as const;
    }
    if (result === 'handled') {
      return true;
    }
    return false;
  };

  useKeyboardSurface({
    kind: 'dropdown',
    rootRef: dropdownRef,
    active: shortcutsEnabled,
    priority: 350,
    suppressShortcuts: true,
    onKeyDown: handleDropdownKeyDown,
  });

  useKeyboardSurface({
    kind: 'dropdown',
    rootRef: menuRef,
    active: isOpen,
    priority: 350,
    suppressShortcuts: true,
    onKeyDown: handleDropdownKeyDown,
  });

  const handleSearchInputChange = (nextValue: string) => {
    if (searchValue === undefined) {
      setSearchQuery(nextValue);
    }
    onSearchChange?.(nextValue);
    setHighlightedIndex(-1);
  };

  const showBulkActionLabels = !searchable;
  const triggerContent = (
    <>
      <span className="dropdown-value">
        {getDropdownDisplayText({
          loading,
          renderValue,
          displayValue,
          multiple,
          value,
          options,
          placeholder,
        })}
      </span>
      <span className="dropdown-arrow">
        <DropdownArrowIcon />
      </span>
    </>
  );

  return (
    <div ref={dropdownRef} className={containerClasses}>
      <DropdownTrigger
        triggerRef={triggerRef}
        searchable={searchable}
        isOpen={isOpen}
        menuId={menuId}
        activeOptionId={activeOptionId}
        disabled={disabled}
        id={id}
        ariaLabel={ariaLabel}
        ariaDescribedBy={ariaDescribedBy}
        ariaLabelledBy={ariaLabelledBy}
        toggleDropdown={toggleDropdown}
      >
        {triggerContent}
      </DropdownTrigger>
      <DropdownClearButton
        clearable={clearable}
        multiple={multiple}
        value={value}
        disabled={disabled}
        onClear={() => onChange('')}
      />
      <DropdownMenuPortal
        isOpen={isOpen}
        disabled={disabled}
        loading={loading}
        menuRef={menuRef}
        menuClasses={menuClasses}
        menuStyle={menuStyle}
        multiple={multiple}
        menuId={menuId}
        searchable={searchable}
        searchInputRef={searchInputRef}
        searchPlaceholder={searchPlaceholder}
        searchValue={effectiveSearchQuery}
        activeOptionId={activeOptionId}
        showBulkActions={multiple && showBulkActions && selectableFilteredValues.length > 0}
        showBulkActionLabels={showBulkActionLabels}
        selectedCount={selectableSelectedCount}
        selectableCount={selectableFilteredValues.length}
        options={filteredOptions}
        controlId={controlId}
        highlightedIndex={highlightedIndex}
        renderOption={renderOption}
        renderOptionActions={renderOptionActions}
        isSelected={isSelected}
        selectOption={selectOption}
        setHighlightedIndex={setHighlightedIndex}
        onSearchChange={handleSearchInputChange}
        onSearchFocusChange={setIsSearchFocused}
        onSelectAll={handleSelectAll}
        onSelectNone={handleSelectNone}
        additionalBulkActions={additionalBulkActions}
      />
      <DropdownHiddenInput name={name} value={value} />
      <div ref={announcementRef} aria-live="polite" aria-atomic="true" className="sr-only" />
    </div>
  );
};

export default Dropdown;
