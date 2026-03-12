/**
 * frontend/src/ui/modals/create-resource/TagPickerInput.tsx
 *
 * A tag picker where selected items appear as inline chips inside an
 * input-like container.  Typing filters the available options in a
 * dropdown beneath the input.
 *
 * Keyboard navigation: ArrowLeft/Right moves a cursor through the tag
 * list.  Backspace deletes the tag behind the cursor, Delete deletes
 * the tag in front of the cursor.
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
  // Index of the highlighted dropdown option, or -1 for none.
  const [highlightIndex, setHighlightIndex] = React.useState(-1);

  // Cursor position within the tag list.  Position i means the cursor
  // sits between value[i-1] and value[i].  When cursorPos === value.length
  // the text input has focus (null = not navigating tags).
  const [cursorPos, setCursorPos] = React.useState<number | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const blurTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending blur cleanup — called when focus moves between
  // the input and the container (tag navigation).
  function cancelBlurTimer(): void {
    if (blurTimerRef.current !== null) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }

  // Start the blur cleanup timer — dropdown closes, filter resets,
  // cursor resets after a short delay (allows click events on dropdown
  // options to fire before the dropdown disappears).
  function startBlurTimer(): void {
    blurTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setFilterText('');
      setCursorPos(null);
      setHighlightIndex(-1);
      blurTimerRef.current = null;
    }, 150);
  }

  // Attach native focus/blur listeners on both the input and the
  // container so that moving focus between them cancels the blur timer,
  // but moving focus outside the component triggers cleanup.
  React.useEffect(() => {
    const input = inputRef.current;
    const ctr = containerRef.current;

    const handleFocus = (): void => {
      cancelBlurTimer();
      setIsOpen(true);
    };

    const handleBlur = (): void => {
      startBlurTimer();
    };

    // When the container receives focus (tag navigation) cancel the
    // input's blur timer so the cursor doesn't get reset.
    const handleContainerFocus = (): void => {
      cancelBlurTimer();
    };

    // When focus leaves the container (and doesn't go to the input),
    // start cleanup.
    const handleContainerBlur = (): void => {
      startBlurTimer();
    };

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
    setHighlightIndex(-1);
    setCursorPos(null);
    inputRef.current?.focus();
  }

  const showDropdown = isOpen && filteredOptions.length > 0;
  const hasAvailableOptions = options.some((o) => !value.includes(o));

  // Keyboard handler — works on the container so it catches events
  // whether the text input or the container itself has focus.
  function handleKeyDown(e: React.KeyboardEvent): void {
    const inInput = cursorPos === null || cursorPos === value.length;

    // ArrowDown/ArrowUp navigate the dropdown options.
    if (e.key === 'ArrowDown' && showDropdown) {
      e.preventDefault();
      setHighlightIndex((prev) => (prev + 1) % filteredOptions.length);
      return;
    }
    if (e.key === 'ArrowUp' && showDropdown) {
      e.preventDefault();
      setHighlightIndex((prev) => (prev <= 0 ? filteredOptions.length - 1 : prev - 1));
      return;
    }
    // Enter selects the highlighted dropdown option.
    if (e.key === 'Enter' && showDropdown && highlightIndex >= 0) {
      e.preventDefault();
      selectOption(filteredOptions[highlightIndex]);
      return;
    }

    if (e.key === 'ArrowLeft') {
      if (inInput) {
        // Only enter tag navigation when the text caret is at position 0.
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
      // Move DOM focus away from the input so further keys route through container.
      containerRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowRight') {
      if (cursorPos === null) return;
      e.preventDefault();
      const next = cursorPos + 1;
      if (next >= value.length) {
        // Return to the text input.
        setCursorPos(null);
        inputRef.current?.focus();
      } else {
        setCursorPos(next);
      }
      return;
    }

    if (e.key === 'Backspace' && value.length > 0) {
      // Effective cursor position: if navigating tags use cursorPos,
      // otherwise treat as end of list (value.length).
      const pos = cursorPos !== null && cursorPos < value.length ? cursorPos : value.length;
      if (pos === 0) return; // nothing behind
      // Only act from the text input when it's empty.
      if (pos === value.length && filterText !== '') return;
      e.preventDefault();
      const removeIndex = pos - 1;
      onChange(value.filter((_, i) => i !== removeIndex));
      const next = pos - 1;
      if (value.length - 1 === 0) {
        setCursorPos(null);
        inputRef.current?.focus();
      } else if (pos === value.length) {
        // Stay in the text input.
        setCursorPos(null);
      } else {
        setCursorPos(next);
      }
      return;
    }

    if (e.key === 'Delete' && cursorPos !== null && cursorPos < value.length) {
      // Delete the tag in front of (to the right of) the cursor.
      if (cursorPos >= value.length) return; // nothing in front
      e.preventDefault();
      onChange(value.filter((_, i) => i !== cursorPos));
      // Cursor stays at same position; if we removed the last item, return to input.
      if (cursorPos >= value.length - 1) {
        setCursorPos(null);
        inputRef.current?.focus();
      }
      return;
    }

    // If the user starts typing while navigating tags, return to the input.
    if (cursorPos !== null && cursorPos < value.length && e.key.length === 1) {
      setCursorPos(null);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="tag-picker">
      {/* Input-like container with inline tag chips + text input */}
      <div
        ref={containerRef}
        className="tag-picker-input-area"
        tabIndex={-1}
        onClick={() => { setCursorPos(null); inputRef.current?.focus(); }}
        onKeyDown={handleKeyDown}
      >
        {value.map((tag, index) => (
          <React.Fragment key={tag}>
            {/* Cursor indicator */}
            {cursorPos === index && (
              <span className="tag-picker-cursor" data-testid="tag-cursor" />
            )}
            <span className="tag-picker-tag">
              {tag}
              <button
                type="button"
                className="tag-picker-tag-remove"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                aria-label={`Remove ${tag}`}
              >
                ✕
              </button>
            </span>
          </React.Fragment>
        ))}
        {hasAvailableOptions && (
          <input
            ref={inputRef}
            type="text"
            className="tag-picker-input"
            value={filterText}
            placeholder={value.length === 0 ? placeholder : undefined}
            aria-label={ariaLabel}
            onChange={(e) => { setFilterText(e.target.value); setHighlightIndex(-1); }}
            onFocus={() => setCursorPos(null)}
            {...INPUT_BEHAVIOR_PROPS}
          />
        )}
      </div>

      {/* Dropdown with filtered options */}
      {showDropdown && (
        <div className="tag-picker-dropdown">
          {filteredOptions.map((option, i) => (
            <div
              key={option}
              className={`tag-picker-option${i === highlightIndex ? ' tag-picker-option--highlighted' : ''}`}
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
