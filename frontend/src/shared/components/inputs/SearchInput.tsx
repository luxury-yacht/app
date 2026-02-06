/**
 * frontend/src/shared/components/inputs/SearchInput.tsx
 *
 * Reusable search/filter text input with optional right-side icon toggle
 * buttons for features like case-sensitivity, regex mode, etc.
 * Works as a plain search input when no actions are provided.
 */

import React, { useState, useCallback } from 'react';

/** Describes a toggle action rendered as an icon button inside the input. */
export interface SearchInputAction {
  /** Unique key used for React rendering. */
  id: string;
  /** The icon element to render inside the button. */
  icon: React.ReactNode;
  /** Whether the toggle is currently active. */
  active: boolean;
  /** Called when the button is clicked. */
  onToggle: () => void;
  /** Optional tooltip text shown on hover. */
  tooltip?: string;
}

export interface SearchInputProps {
  /** Current input value (controlled). */
  value: string;
  /** Called with the new string value on every change. */
  onChange: (value: string) => void;
  /** Placeholder text shown when the input is empty. */
  placeholder?: string;
  /** Optional toggle actions rendered as icon buttons on the right side. */
  actions?: SearchInputAction[];
  /** Additional CSS class applied to the outermost wrapper. */
  className?: string;
  /** HTML id applied to the inner input element. */
  id?: string;
  /** HTML name applied to the inner input element. */
  name?: string;
  /** Whether the input should receive focus on mount. */
  autoFocus?: boolean;
  /** Disables the input and all action buttons. */
  disabled?: boolean;
  /** Ref forwarded to the inner input element for external focus management. */
  inputRef?: React.Ref<HTMLInputElement>;
  /** Optional keydown handler forwarded to the inner input element. */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search',
  actions,
  className,
  id,
  name,
  autoFocus = false,
  disabled = false,
  inputRef,
  onKeyDown,
}) => {
  const [focused, setFocused] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  // Build wrapper class list.
  const wrapperClasses = [
    'search-input-wrapper',
    focused && 'focused',
    disabled && 'disabled',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        className="search-input-field"
        type="search"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        disabled={disabled}
      />

      {actions && actions.length > 0 && (
        <div className="search-input-actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`search-input-action${action.active ? ' active' : ''}`}
              onClick={action.onToggle}
              title={action.tooltip}
              disabled={disabled}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchInput;
