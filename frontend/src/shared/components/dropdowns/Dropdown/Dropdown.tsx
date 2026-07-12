/**
 * frontend/src/shared/components/dropdowns/Dropdown/Dropdown.tsx
 *
 * UI component for Dropdown.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAriaAnnouncements } from './hooks/useAriaAnnouncements';
import { useDropdownState } from './hooks/useDropdownState';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import type { DropdownProps } from './types';
import '@styles/components/dropdowns.css';
import {
  DropdownArrowIcon,
  DropdownSelectAllIcon,
  DropdownSelectNoneIcon,
} from '@shared/components/icons/DropdownIcons';
import { useKeyboardSurface } from '@ui/shortcuts';

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
  renderOption,
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
  const activeOptionId =
    isOpen && highlightedIndex >= 0 ? `${controlId}-option-${highlightedIndex}` : undefined;

  useEffect(() => {
    const node = dropdownRef.current;
    if (!node) {
      return;
    }

    const handleFocusIn = () => setIsFocused(true);
    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!nextTarget || !node.contains(nextTarget)) {
        setIsFocused(false);
      }
    };

    node.addEventListener('focusin', handleFocusIn);
    node.addEventListener('focusout', handleFocusOut);
    return () => {
      node.removeEventListener('focusin', handleFocusIn);
      node.removeEventListener('focusout', handleFocusOut);
    };
  }, [dropdownRef]);

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

  // Get display text for current value
  const getDisplayText = () => {
    if (loading) {
      return 'Loading...';
    }

    if (renderValue) {
      return renderValue(value, options);
    }

    if (displayValue) {
      if (typeof displayValue === 'function') {
        return displayValue(value as string);
      }
      return displayValue;
    }

    if (multiple && Array.isArray(value)) {
      if (value.length === 0) {
        return placeholder;
      }
      const selectedLabels = value
        .map((v) => options.find((opt) => opt.value === v)?.label)
        .filter(Boolean);
      return selectedLabels.join(', ');
    }

    const selectedOption = options.find((opt) => opt.value === value);
    return selectedOption?.label || placeholder;
  };

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

  // Calculate dropdown position to avoid viewport edges
  const [dropdownPosition, setDropdownPosition] = React.useState<'bottom' | 'top'>('bottom');
  const [horizontalPosition, setHorizontalPosition] = React.useState<'start' | 'end'>('start');

  useEffect(() => {
    if (isOpen && triggerRef.current && menuRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const menuHeight = menuRef.current.offsetHeight;
      const menuWidth = menuRef.current.offsetWidth;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      const spaceRight = viewportWidth - triggerRect.left;
      const spaceLeft = triggerRect.right;

      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        setDropdownPosition('top');
      } else {
        setDropdownPosition('bottom');
      }

      if (spaceRight < menuWidth && spaceLeft > spaceRight) {
        setHorizontalPosition('end');
      } else {
        setHorizontalPosition('start');
      }
    }
  }, [isOpen, menuRef, triggerRef]);

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

  useKeyboardSurface({
    kind: 'dropdown',
    rootRef: dropdownRef,
    active: shortcutsEnabled,
    priority: 350,
    suppressShortcuts: true,
    onKeyDown: (event) => {
      if (event.key === ' ' && isTypingInSearch()) {
        return false;
      }

      const result = handleKeyAction(event.key);
      if (result === 'handled-no-prevent') {
        return 'handled-no-prevent';
      }
      if (result === 'handled') {
        return true;
      }
      return false;
    },
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
      <span className="dropdown-value">{getDisplayText()}</span>
      <span className="dropdown-arrow">
        <DropdownArrowIcon />
      </span>
    </>
  );

  return (
    <div ref={dropdownRef} className={containerClasses}>
      {/* Trigger */}
      {searchable ? (
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
          {triggerContent}
        </button>
      ) : (
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
          {triggerContent}
        </button>
      )}

      {clearable && !multiple && value && !disabled && (
        <button
          type="button"
          className="clear-button"
          onClick={() => onChange('')}
          aria-label="Clear selection"
          tabIndex={-1}
        >
          ×
        </button>
      )}

      {/* Menu */}
      {isOpen && !disabled && !loading && (
        <div
          ref={menuRef}
          className={menuClasses}
          role="listbox"
          aria-multiselectable={multiple}
          id={menuId}
        >
          {(searchable || (multiple && showBulkActions && selectableFilteredValues.length > 0)) && (
            <div className="dropdown-menu-controls">
              {!!searchable && (
                <div className="search-container">
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="search-input"
                    placeholder={searchPlaceholder}
                    value={effectiveSearchQuery}
                    onChange={(e) => handleSearchInputChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setIsSearchFocused(false)}
                    role="combobox"
                    aria-label={searchPlaceholder}
                    aria-autocomplete="list"
                    aria-expanded="true"
                    aria-controls={menuId}
                    aria-activedescendant={activeOptionId}
                  />
                </div>
              )}

              {multiple && showBulkActions && selectableFilteredValues.length > 0 && (
                <div
                  className={`dropdown-bulk-actions icon-bar${
                    showBulkActionLabels ? ' dropdown-bulk-actions--labeled' : ''
                  }`}
                >
                  <button
                    type="button"
                    className={`dropdown-bulk-action icon-bar-button${
                      showBulkActionLabels ? ' dropdown-bulk-action--labeled' : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectAll();
                    }}
                    disabled={selectableSelectedCount === selectableFilteredValues.length}
                    title="Select all"
                    aria-label="Select all"
                  >
                    <DropdownSelectAllIcon width={20} height={20} />
                    {showBulkActionLabels && (
                      <span className="dropdown-bulk-action-label">All</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`dropdown-bulk-action icon-bar-button${
                      showBulkActionLabels ? ' dropdown-bulk-action--labeled' : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectNone();
                    }}
                    disabled={selectableSelectedCount === 0}
                    title="Select none"
                    aria-label="Select none"
                  >
                    <DropdownSelectNoneIcon width={20} height={20} />
                    {showBulkActionLabels && (
                      <span className="dropdown-bulk-action-label">None</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {filteredOptions.length === 0 ? (
            <div className="no-options">No options available</div>
          ) : (
            filteredOptions.map((option, index) => {
              const optionIsSelected = isSelected(option.value);
              const optionIsHighlighted = index === highlightedIndex;
              const isGroupHeader = option.group === 'header';
              const isSeparator = isGroupHeader && option.label.trim().length === 0;

              if (isGroupHeader) {
                return isSeparator ? (
                  <hr key={option.value} className="dropdown-separator" />
                ) : (
                  <div key={option.value} className="dropdown-group-header" role="presentation">
                    {renderOption ? renderOption(option, false) : option.label}
                  </div>
                );
              }

              const optionAriaSelected = multiple
                ? optionIsSelected
                : optionIsHighlighted || (highlightedIndex < 0 && optionIsSelected);
              return (
                <button
                  type="button"
                  key={option.value}
                  id={`${controlId}-option-${index}`}
                  className={[
                    'dropdown-option',
                    optionIsSelected && 'selected',
                    optionIsHighlighted && 'highlighted',
                    option.disabled && 'disabled',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => selectOption(option.value)}
                  onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                  role="option"
                  aria-selected={optionAriaSelected}
                  aria-disabled={option.disabled}
                  disabled={option.disabled}
                  tabIndex={-1}
                >
                  {renderOption ? (
                    renderOption(option, optionIsSelected)
                  ) : (
                    <>
                      {!!multiple && (
                        <span className="dropdown-filter-check">{optionIsSelected ? '✓' : ''}</span>
                      )}
                      <span className="option-label">{option.label}</span>
                    </>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Hidden input for form integration */}
      {!!name && (
        <input type="hidden" name={name} value={Array.isArray(value) ? value.join(',') : value} />
      )}

      {/* ARIA live region for announcements */}
      <div ref={announcementRef} aria-live="polite" aria-atomic="true" className="sr-only" />
    </div>
  );
};

export default Dropdown;
