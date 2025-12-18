import React, { useMemo, useEffect, useRef, useState } from 'react';
import { DropdownProps } from './types';
import { useDropdownState } from './hooks/useDropdownState';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useAriaAnnouncements } from './hooks/useAriaAnnouncements';
import '@styles/components/dropdowns.css';
import { useKeyboardContext, useShortcuts } from '@ui/shortcuts';

const Dropdown: React.FC<DropdownProps> = ({
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
  clearable = false,
  renderOption,
  renderValue,
  dropdownClassName = '',
  ariaLabel,
  ariaDescribedBy,
  ariaLabelledBy,
  name,
  id,
  onOpen,
  onClose,
}) => {
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
  const { pushContext, popContext } = useKeyboardContext();
  const shortcutContextActiveRef = useRef(false);

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

  useEffect(() => {
    const shouldActivate = !disabled && (isFocused || isOpen);

    if (shouldActivate && !shortcutContextActiveRef.current) {
      pushContext({ tabActive: 'dropdown', priority: 350 });
      shortcutContextActiveRef.current = true;
    } else if (!shouldActivate && shortcutContextActiveRef.current) {
      popContext();
      shortcutContextActiveRef.current = false;
    }
  }, [disabled, isFocused, isOpen, popContext, pushContext]);

  useEffect(
    () => () => {
      if (shortcutContextActiveRef.current) {
        popContext();
        shortcutContextActiveRef.current = false;
      }
    },
    [popContext]
  );

  // Set initial highlighted index when dropdown opens
  useEffect(() => {
    if (isOpen && !multiple && value && highlightedIndex === -1) {
      const selectedIndex = options.findIndex((opt) => opt.value === value);
      if (selectedIndex >= 0) {
        setHighlightedIndex(selectedIndex);
      }
    }
  }, [isOpen, value, options, multiple, highlightedIndex, setHighlightedIndex]);

  const { handleKeyDown, handleKeyAction } = useKeyboardNavigation({
    options,
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
    options,
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
    }
    previousOpenRef.current = isOpen;
  }, [isOpen, onOpen, onClose, value]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchable || !searchQuery) {
      return options;
    }
    return options.filter((option) =>
      option.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [options, searchQuery, searchable]);

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

  // Calculate dropdown position to avoid viewport edges
  const [dropdownPosition, setDropdownPosition] = React.useState<'bottom' | 'top'>('bottom');

  useEffect(() => {
    if (isOpen && triggerRef.current && menuRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const menuHeight = menuRef.current.offsetHeight;
      const viewportHeight = window.innerHeight;

      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;

      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        setDropdownPosition('top');
      } else {
        setDropdownPosition('bottom');
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
  ]
    .filter(Boolean)
    .join(' ');

  const menuClasses = ['dropdown-menu', `position-${dropdownPosition}`, dropdownClassName]
    .filter(Boolean)
    .join(' ');

  const shortcutsEnabled = !disabled && (isOpen || isFocused);

  const isTypingInSearch = () => {
    if (!searchable) {
      return false;
    }
    const active = document.activeElement as HTMLElement | null;
    return Boolean(active && active.classList.contains('search-input'));
  };

  const runShortcutAction = (key: string) => handleKeyAction(key) === 'handled';

  useShortcuts(
    [
      {
        key: 'ArrowDown',
        handler: () => runShortcutAction('ArrowDown'),
        description: 'Highlight next option',
        enabled: shortcutsEnabled,
      },
      {
        key: 'ArrowUp',
        handler: () => runShortcutAction('ArrowUp'),
        description: 'Highlight previous option',
        enabled: shortcutsEnabled,
      },
      {
        key: 'Home',
        handler: () => runShortcutAction('Home'),
        description: 'Jump to first option',
        enabled: shortcutsEnabled,
      },
      {
        key: 'End',
        handler: () => runShortcutAction('End'),
        description: 'Jump to last option',
        enabled: shortcutsEnabled,
      },
      {
        key: 'Enter',
        handler: () => runShortcutAction('Enter'),
        description: 'Select highlighted option',
        enabled: shortcutsEnabled,
      },
      {
        key: ' ',
        handler: () => {
          if (isTypingInSearch()) {
            return false;
          }
          return runShortcutAction(' ');
        },
        description: 'Toggle dropdown or select highlighted option',
        enabled: shortcutsEnabled,
      },
      {
        key: 'Escape',
        handler: () => runShortcutAction('Escape'),
        description: 'Close dropdown',
        enabled: shortcutsEnabled,
      },
    ],
    {
      view: 'list',
      priority: 350,
      category: 'Dropdown',
    }
  );

  return (
    <div ref={dropdownRef} className={containerClasses} data-allow-shortcuts="true">
      {/* Trigger */}
      <div
        ref={triggerRef}
        className="dropdown-trigger"
        onClick={toggleDropdown}
        onKeyDown={handleKeyDown}
        data-allow-shortcuts="true"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-labelledby={ariaLabelledBy}
        aria-controls={`${id || 'dropdown'}-menu`}
        tabIndex={disabled ? -1 : 0}
        id={id}
      >
        <span className="dropdown-value">{getDisplayText()}</span>

        {clearable && !multiple && value && !disabled && (
          <button
            className="clear-button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            aria-label="Clear selection"
            tabIndex={-1}
          >
            ×
          </button>
        )}

        <span className="dropdown-arrow">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6,9 12,15 18,9" />
          </svg>
        </span>
      </div>

      {/* Menu */}
      {isOpen && !disabled && !loading && (
        <div
          ref={menuRef}
          className={menuClasses}
          role="listbox"
          aria-multiselectable={multiple}
          id={`${id || 'dropdown'}-menu`}
          data-allow-shortcuts="true"
        >
          {searchable && (
            <div className="search-container">
              <input
                type="text"
                className="search-input"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                data-allow-shortcuts="true"
              />
            </div>
          )}

          {filteredOptions.length === 0 ? (
            <div className="no-options">No options available</div>
          ) : (
            filteredOptions.map((option, index) => {
              const optionIsSelected = isSelected(option.value);
              const optionIsHighlighted = index === highlightedIndex;
              const isGroupHeader = option.group === 'header';

              return (
                <div
                  key={option.value}
                  className={[
                    isGroupHeader ? 'dropdown-group-header' : 'dropdown-option',
                    optionIsSelected && 'selected',
                    optionIsHighlighted && 'highlighted',
                    option.disabled && 'disabled',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => !option.disabled && !isGroupHeader && selectOption(option.value)}
                  onMouseEnter={() =>
                    !option.disabled && !isGroupHeader && setHighlightedIndex(index)
                  }
                  role={isGroupHeader ? 'presentation' : 'option'}
                  aria-selected={optionIsSelected}
                  aria-disabled={option.disabled}
                >
                  {renderOption ? (
                    renderOption(option, optionIsSelected)
                  ) : (
                    <>
                      {multiple && !isGroupHeader && (
                        <span className="checkbox">{optionIsSelected ? '☑' : '☐'}</span>
                      )}
                      <span className={isGroupHeader ? 'group-header-label' : 'option-label'}>
                        {option.label}
                      </span>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Hidden input for form integration */}
      {name && (
        <input type="hidden" name={name} value={Array.isArray(value) ? value.join(',') : value} />
      )}

      {/* ARIA live region for announcements */}
      <div ref={announcementRef} aria-live="polite" aria-atomic="true" className="sr-only" />
    </div>
  );
};

export default Dropdown;
