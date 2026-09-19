/**
 * frontend/src/shared/components/inputs/SearchInput.tsx
 *
 * Reusable search/filter text input.
 */

import type React from 'react';

export interface SearchInputProps {
  /** Current input value (controlled). */
  value: string;
  /** Called with the new string value on every change. */
  onChange: (value: string) => void;
  /** Placeholder text shown when the input is empty. */
  placeholder?: string;
  /** Additional CSS class applied to the outermost wrapper. */
  className?: string;
  /** HTML id applied to the inner input element. */
  id?: string;
  /** HTML name applied to the inner input element. */
  name?: string;
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
  className,
  id,
  name,
  disabled = false,
  inputRef,
  onKeyDown,
}) => {
  // Build wrapper class list.
  const wrapperClasses = ['search-input-wrapper', disabled && 'disabled', className]
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
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
    </div>
  );
};

export default SearchInput;
