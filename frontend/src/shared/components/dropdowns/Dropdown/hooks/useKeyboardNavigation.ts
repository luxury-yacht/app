/**
 * frontend/src/shared/components/dropdowns/Dropdown/hooks/useKeyboardNavigation.ts
 *
 * React hook for useKeyboardNavigation.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, KeyboardEvent } from 'react';
import { DropdownOption } from '../types';

interface UseKeyboardNavigationProps {
  options: DropdownOption[];
  isOpen: boolean;
  highlightedIndex: number;
  setHighlightedIndex: (index: number) => void;
  selectOption: (value: string) => void;
  openDropdown: () => void;
  closeDropdown: () => void;
  disabled?: boolean;
}

export function useKeyboardNavigation({
  options,
  isOpen,
  highlightedIndex,
  setHighlightedIndex,
  selectOption,
  openDropdown,
  closeDropdown,
  disabled,
}: UseKeyboardNavigationProps) {
  const getNextEnabledIndex = useCallback(
    (currentIndex: number, direction: 'up' | 'down'): number => {
      const isSelectable = (opt: DropdownOption) => !opt.disabled && opt.group !== 'header';
      const enabledOptions = options.filter(isSelectable);
      if (enabledOptions.length === 0) return -1;

      if (direction === 'down') {
        for (let i = currentIndex + 1; i < options.length; i++) {
          if (isSelectable(options[i])) return i;
        }
        // Wrap to first enabled option
        for (let i = 0; i <= currentIndex; i++) {
          if (isSelectable(options[i])) return i;
        }
      } else {
        for (let i = currentIndex - 1; i >= 0; i--) {
          if (isSelectable(options[i])) return i;
        }
        // Wrap to last enabled option
        for (let i = options.length - 1; i >= currentIndex; i--) {
          if (isSelectable(options[i])) return i;
        }
      }

      return currentIndex;
    },
    [options]
  );

  type KeyActionResult = 'handled' | 'handled-no-prevent' | 'ignored';

  const handleKeyAction = useCallback(
    (key: string): KeyActionResult => {
      if (disabled) return 'ignored';

      const openIfPossible = () => {
        if (!isOpen) {
          openDropdown();
          return true;
        }
        return false;
      };

      switch (key) {
        case 'Enter':
        case ' ': {
          if (!isOpen) {
            openDropdown();
            return 'handled';
          }
          if (highlightedIndex >= 0 && !options[highlightedIndex]?.disabled) {
            selectOption(options[highlightedIndex].value);
            return 'handled';
          }
          return 'handled';
        }
        case 'Escape':
          if (isOpen) {
            closeDropdown();
            return 'handled';
          }
          return 'ignored';

        case 'ArrowDown': {
          if (!isOpen) {
            openDropdown();
            const firstEnabledIndex = getNextEnabledIndex(-1, 'down');
            if (firstEnabledIndex >= 0) {
              setHighlightedIndex(firstEnabledIndex);
            }
            return 'handled';
          }
          const nextIndex = getNextEnabledIndex(highlightedIndex, 'down');
          if (nextIndex >= 0) {
            setHighlightedIndex(nextIndex);
            return 'handled';
          }
          return 'ignored';
        }

        case 'ArrowUp': {
          if (!isOpen) {
            const opened = openIfPossible();
            if (opened) {
              const lastEnabledIndex = getNextEnabledIndex(options.length, 'up');
              if (lastEnabledIndex >= 0) {
                setHighlightedIndex(lastEnabledIndex);
              }
            }
            return opened ? 'handled' : 'ignored';
          }
          const nextIndex = getNextEnabledIndex(highlightedIndex, 'up');
          if (nextIndex >= 0) {
            setHighlightedIndex(nextIndex);
            return 'handled';
          }
          return 'ignored';
        }

        case 'Home': {
          if (!isOpen) {
            return openIfPossible() ? 'handled' : 'ignored';
          }
          const firstEnabledIndex = options.findIndex(
            (opt) => !opt.disabled && opt.group !== 'header'
          );
          if (firstEnabledIndex >= 0) {
            setHighlightedIndex(firstEnabledIndex);
            return 'handled';
          }
          return 'ignored';
        }

        case 'End': {
          if (!isOpen) {
            return openIfPossible() ? 'handled' : 'ignored';
          }
          const lastEnabledIndex = options
            .map((opt, idx) => (!opt.disabled && opt.group !== 'header' ? idx : -1))
            .filter((idx) => idx >= 0)
            .pop();
          if (lastEnabledIndex !== undefined) {
            setHighlightedIndex(lastEnabledIndex);
            return 'handled';
          }
          return 'ignored';
        }

        case 'Tab':
          if (isOpen) {
            closeDropdown();
            return 'handled-no-prevent';
          }
          return 'ignored';

        default:
          return 'ignored';
      }
    },
    [
      closeDropdown,
      disabled,
      getNextEnabledIndex,
      highlightedIndex,
      isOpen,
      openDropdown,
      options,
      selectOption,
      setHighlightedIndex,
    ]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const result = handleKeyAction(event.key);
      if (result === 'handled') {
        event.preventDefault();
        event.stopPropagation();
      } else if (result === 'handled-no-prevent') {
        event.stopPropagation();
      }
    },
    [handleKeyAction]
  );

  return { handleKeyDown, handleKeyAction };
}
