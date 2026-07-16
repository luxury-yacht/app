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
import type { DropdownProps } from './types';
import '@styles/components/dropdowns.css';
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
  const [menuStyle, setMenuStyle] = useState<DropdownMenuStyle>({
    position: 'fixed',
    visibility: 'hidden',
    '--dropdown-menu-anchor-width': '0px',
    '--dropdown-menu-available-height': `${DROPDOWN_MENU_MAX_HEIGHT}px`,
  });
  const menuScrollTopRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const generatedId = React.useId().replace(/:/g, '');
  const controlId = id || `dropdown-${generatedId}`;
  const menuId = `${controlId}-menu`;
  const activeOptionId =
    isOpen && highlightedIndex >= 0 ? `${controlId}-option-${highlightedIndex}` : undefined;

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

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !menuRef.current) {
      return;
    }

    const trigger = triggerRef.current;
    const menu = menuRef.current;

    const positionMenu = () => {
      const visualTriggerRect = trigger.getBoundingClientRect();
      const parsedZoomFactor = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor')
      );
      const zoomFactor =
        Number.isFinite(parsedZoomFactor) && parsedZoomFactor > 0 ? parsedZoomFactor : 1;
      // CSS zoom scales client rectangles, but the fixed menu's left/top and
      // offset dimensions are authored in the document's unscaled CSS space.
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

      const measuredMenuWidth = Math.min(
        Math.max(menu.offsetWidth, anchorWidth),
        viewportMenuWidth
      );
      const measuredMenuHeight = Math.min(menu.offsetHeight, DROPDOWN_MENU_MAX_HEIGHT);
      const spaceBelow = Math.max(
        0,
        viewportHeight - DROPDOWN_VIEWPORT_PADDING - triggerRect.bottom - DROPDOWN_MENU_GAP
      );
      const spaceAbove = Math.max(
        0,
        triggerRect.top - DROPDOWN_VIEWPORT_PADDING - DROPDOWN_MENU_GAP
      );
      const nextVerticalPosition =
        measuredMenuHeight <= spaceBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top';
      const selectedSpace = nextVerticalPosition === 'bottom' ? spaceBelow : spaceAbove;
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
      const preferredLeft = triggerRect.left;
      const left = Math.max(DROPDOWN_VIEWPORT_PADDING, Math.min(preferredLeft, maxLeft));
      const maxTop = Math.max(
        DROPDOWN_VIEWPORT_PADDING,
        viewportHeight - DROPDOWN_VIEWPORT_PADDING - renderedMenuHeight
      );
      const preferredTop =
        nextVerticalPosition === 'bottom'
          ? triggerRect.bottom + DROPDOWN_MENU_GAP
          : triggerRect.top - DROPDOWN_MENU_GAP - renderedMenuHeight;
      const top = Math.max(DROPDOWN_VIEWPORT_PADDING, Math.min(preferredTop, maxTop));
      const nextHorizontalPosition =
        preferredLeft + measuredMenuWidth > viewportWidth - DROPDOWN_VIEWPORT_PADDING
          ? 'end'
          : 'start';

      setDropdownPosition(nextVerticalPosition);
      setHorizontalPosition(nextHorizontalPosition);
      setMenuStyle({
        position: 'fixed',
        top,
        right: 'auto',
        bottom: 'auto',
        left,
        maxWidth: viewportMenuWidth,
        visibility: 'visible',
        '--dropdown-menu-anchor-width': `${anchorWidth}px`,
        '--dropdown-menu-available-height': `${availableHeight}px`,
      });
    };

    positionMenu();
    document.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionMenu);
    resizeObserver?.observe(trigger);
    resizeObserver?.observe(menu);
    let ancestor = trigger.parentElement;
    while (ancestor) {
      resizeObserver?.observe(ancestor);
      ancestor = ancestor.parentElement;
    }

    return () => {
      document.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener('resize', positionMenu);
      resizeObserver?.disconnect();
    };
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
      {isOpen &&
        !disabled &&
        !loading &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            className={menuClasses}
            style={menuStyle}
            role="listbox"
            aria-multiselectable={multiple}
            id={menuId}
            data-focus-portal-owner={menuId}
          >
            {(searchable ||
              (multiple && showBulkActions && selectableFilteredValues.length > 0)) && (
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
                          <span className="dropdown-filter-check">
                            {optionIsSelected ? '✓' : ''}
                          </span>
                        )}
                        <span className="option-label">{option.label}</span>
                      </>
                    )}
                  </button>
                );
              })
            )}
          </div>,
          document.body
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
