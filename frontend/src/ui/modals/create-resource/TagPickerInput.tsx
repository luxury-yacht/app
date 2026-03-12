/**
 * frontend/src/ui/modals/create-resource/TagPickerInput.tsx
 *
 * A tag picker where selected items appear as inline chips inside an
 * input-like container.  Typing filters the available options in a
 * dropdown beneath the input.
 *
 * CSS lives in ResourceForm.css under the "Tag Picker Input" section.
 */

import React from 'react';
import { INPUT_BEHAVIOR_PROPS } from './formUtils';

interface TagPickerInputProps {
  /** All available options. */
  options: string[];
  /** Currently selected values (subset of options). */
  value: string[];
  /** Called when selection changes. */
  onChange: (newValue: string[]) => void;
  /** Placeholder for the filter input (shown when no tags selected). */
  placeholder?: string;
  /** Aria label for accessibility. */
  ariaLabel?: string;
}

export function TagPickerInput({
  options,
  value,
  onChange,
  placeholder,
  ariaLabel,
}: TagPickerInputProps): React.ReactElement {
  const [filterText, setFilterText] = React.useState('');
  const [isOpen, setIsOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const blurTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Attach native focus/blur listeners so tests dispatching raw DOM events work.
  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleFocus = (): void => {
      if (blurTimerRef.current !== null) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      setIsOpen(true);
    };

    const handleBlur = (): void => {
      blurTimerRef.current = setTimeout(() => {
        setIsOpen(false);
        setFilterText('');
        blurTimerRef.current = null;
      }, 150);
    };

    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);

    return () => {
      input.removeEventListener('focus', handleFocus);
      input.removeEventListener('blur', handleBlur);
      if (blurTimerRef.current !== null) {
        clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const filteredOptions = options.filter(
    (option) =>
      !value.includes(option) && option.toLowerCase().includes(filterText.toLowerCase())
  );

  function removeTag(tag: string): void {
    onChange(value.filter((v) => v !== tag));
  }

  function selectOption(option: string): void {
    onChange([...value, option]);
    setFilterText('');
    inputRef.current?.focus();
  }

  const showDropdown = isOpen && filteredOptions.length > 0;
  const hasAvailableOptions = options.some((o) => !value.includes(o));

  return (
    <div className="tag-picker">
      {/* Input-like container with inline tag chips + text input */}
      <div
        className="tag-picker-input-area"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="tag-picker-tag">
            {tag}
            <button
              type="button"
              className="tag-picker-tag-remove"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              aria-label={`Remove ${tag}`}
            >
              ✕
            </button>
          </span>
        ))}
        {hasAvailableOptions && (
          <input
            ref={inputRef}
            type="text"
            className="tag-picker-input"
            value={filterText}
            placeholder={value.length === 0 ? placeholder : undefined}
            aria-label={ariaLabel}
            onChange={(e) => setFilterText(e.target.value)}
            {...INPUT_BEHAVIOR_PROPS}
          />
        )}
      </div>

      {/* Dropdown with filtered options */}
      {showDropdown && (
        <div className="tag-picker-dropdown">
          {filteredOptions.map((option) => (
            <div
              key={option}
              className="tag-picker-option"
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(option);
              }}
              onClick={() => selectOption(option)}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
