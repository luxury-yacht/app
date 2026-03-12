/**
 * frontend/src/ui/modals/create-resource/TagPickerInput.tsx
 *
 * Inline chip-style tag picker.  Selected items render as chips inside an
 * input-like container.  A filter input sits alongside the chips and a
 * dropdown appears below with available options.
 *
 * Keyboard navigation: arrow keys move a cursor through selected items.
 * Backspace deletes behind the cursor, Delete deletes in front.
 * Home/End jump to the start/end of the chip list.
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
  /** Placeholder for the filter input. */
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

  // Cursor position within the tag list.  Position i means the cursor
  // sits between value[i-1] and value[i].  null = not navigating.
  const [cursorPos, setCursorPos] = React.useState<number | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const chipAreaRef = React.useRef<HTMLDivElement>(null);
  const blurTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelBlurTimer(): void {
    if (blurTimerRef.current !== null) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }

  function startBlurTimer(): void {
    blurTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setFilterText('');
      setCursorPos(null);
      blurTimerRef.current = null;
    }, 150);
  }

  React.useEffect(() => {
    const input = inputRef.current;
    const ctr = chipAreaRef.current;

    const handleFocus = (): void => { cancelBlurTimer(); setIsOpen(true); };
    const handleBlur = (): void => { startBlurTimer(); };
    const handleContainerFocus = (): void => { cancelBlurTimer(); };
    const handleContainerBlur = (): void => { startBlurTimer(); };

    input?.addEventListener('focus', handleFocus);
    input?.addEventListener('blur', handleBlur);
    ctr?.addEventListener('focus', handleContainerFocus);
    ctr?.addEventListener('blur', handleContainerBlur);

    return () => {
      input?.removeEventListener('focus', handleFocus);
      input?.removeEventListener('blur', handleBlur);
      ctr?.removeEventListener('focus', handleContainerFocus);
      ctr?.removeEventListener('blur', handleContainerBlur);
      cancelBlurTimer();
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
    setCursorPos(null);
    inputRef.current?.focus();
  }

  const showDropdown = isOpen && filteredOptions.length > 0;

  // Keyboard handler for navigating selected items.
  function handleKeyDown(e: React.KeyboardEvent): void {
    const inInput = cursorPos === null || cursorPos === value.length;

    if (e.key === 'Home' && value.length > 0) {
      e.preventDefault();
      setCursorPos(0);
      chipAreaRef.current?.focus();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setCursorPos(null);
      inputRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (inInput) {
        const atStart =
          filterText === '' &&
          (inputRef.current?.selectionStart ?? 0) === 0 &&
          (inputRef.current?.selectionEnd ?? 0) === 0;
        if (!atStart || value.length === 0) return;
      }
      e.preventDefault();
      const pos = cursorPos !== null && cursorPos < value.length ? cursorPos : value.length;
      const next = Math.max(0, pos - 1);
      setCursorPos(next);
      chipAreaRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (cursorPos === null) return;
      e.preventDefault();
      const next = cursorPos + 1;
      if (next >= value.length) {
        setCursorPos(null);
        inputRef.current?.focus();
      } else {
        setCursorPos(next);
      }
      return;
    }

    if (e.key === 'Backspace' && value.length > 0) {
      const pos = cursorPos !== null && cursorPos < value.length ? cursorPos : value.length;
      if (pos === 0) return;
      if (pos === value.length && filterText !== '') return;
      e.preventDefault();
      const removeIndex = pos - 1;
      onChange(value.filter((_, i) => i !== removeIndex));
      const next = pos - 1;
      if (value.length - 1 === 0) {
        setCursorPos(null);
        inputRef.current?.focus();
      } else if (pos === value.length) {
        setCursorPos(null);
      } else {
        setCursorPos(next);
      }
      return;
    }

    if (e.key === 'Delete' && cursorPos !== null && cursorPos < value.length) {
      if (cursorPos >= value.length) return;
      e.preventDefault();
      onChange(value.filter((_, i) => i !== cursorPos));
      if (cursorPos >= value.length - 1) {
        setCursorPos(null);
        inputRef.current?.focus();
      }
      return;
    }

    // Typing while navigating returns to the input.
    if (cursorPos !== null && cursorPos < value.length && e.key.length === 1) {
      setCursorPos(null);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="tag-picker" onKeyDown={handleKeyDown}>
      {/* Chip container — styled like .resource-form-input */}
      <div
        className="tag-picker-input-area"
        ref={chipAreaRef}
        tabIndex={-1}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, index) => (
          <React.Fragment key={tag}>
            {cursorPos === index && (
              <span className="tag-picker-cursor" />
            )}
            <span className="tag-picker-chip">
              {tag}
              <button
                className="tag-picker-chip-remove"
                onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                aria-label={`Remove ${tag}`}
                tabIndex={-1}
              >
                &times;
              </button>
            </span>
          </React.Fragment>
        ))}
        {cursorPos === value.length && cursorPos !== null && (
          <span className="tag-picker-cursor" />
        )}
        <input
          ref={inputRef}
          type="text"
          className="tag-picker-inline-input"
          value={filterText}
          placeholder={value.length === 0 ? placeholder : undefined}
          aria-label={ariaLabel}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); handleKeyDown(e); }}
          {...INPUT_BEHAVIOR_PROPS}
        />
      </div>

      {/* Dropdown — appears below the chip container when focused */}
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
