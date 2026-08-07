/**
 * frontend/src/shared/components/dropdowns/Dropdown/hooks/useKeyboardNavigation.ts
 *
 * React hook for useKeyboardNavigation.
 * Encapsulates state and side effects for the shared components.
 */

import { type KeyboardEvent, useCallback } from 'react';
import type { DropdownOption } from '../types';

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

type KeyActionResult = 'handled' | 'handled-no-prevent' | 'ignored';
type MoveDirection = 'up' | 'down';

const isSelectableOption = (option: DropdownOption | undefined): boolean =>
  Boolean(option && !option.disabled && option.group !== 'header');

const findSelectableIndex = (
  options: DropdownOption[],
  start: number,
  end: number,
  step: 1 | -1
): number => {
  for (let index = start; step > 0 ? index <= end : index >= end; index += step) {
    if (isSelectableOption(options[index])) {
      return index;
    }
  }
  return -1;
};

const findNextSelectableIndex = (
  options: DropdownOption[],
  currentIndex: number,
  direction: MoveDirection
): number => {
  if (direction === 'down') {
    const nextIndex = findSelectableIndex(options, currentIndex + 1, options.length - 1, 1);
    return nextIndex >= 0 ? nextIndex : findSelectableIndex(options, 0, currentIndex, 1);
  }
  const previousIndex = findSelectableIndex(options, currentIndex - 1, 0, -1);
  return previousIndex >= 0
    ? previousIndex
    : findSelectableIndex(options, options.length - 1, currentIndex, -1);
};

interface KeyboardNavigationContext {
  options: DropdownOption[];
  isOpen: boolean;
  highlightedIndex: number;
  setHighlightedIndex: (index: number) => void;
  selectOption: (value: string) => void;
  openDropdown: () => void;
  closeDropdown: () => void;
  getNextEnabledIndex: (currentIndex: number, direction: MoveDirection) => number;
}

type KeyHandler = (context: KeyboardNavigationContext) => KeyActionResult;

const handleActivate: KeyHandler = (context) => {
  if (!context.isOpen) {
    context.openDropdown();
    return 'handled';
  }
  const highlightedOption = context.options[context.highlightedIndex];
  if (context.highlightedIndex >= 0 && highlightedOption && !highlightedOption.disabled) {
    context.selectOption(highlightedOption.value);
  }
  return 'handled';
};

const handleEscape: KeyHandler = (context) => {
  if (!context.isOpen) {
    return 'ignored';
  }
  context.closeDropdown();
  return 'handled';
};

const moveHighlight = (
  context: KeyboardNavigationContext,
  currentIndex: number,
  direction: MoveDirection
): KeyActionResult => {
  const nextIndex = context.getNextEnabledIndex(currentIndex, direction);
  if (nextIndex < 0) {
    return 'ignored';
  }
  context.setHighlightedIndex(nextIndex);
  return 'handled';
};

const handleArrowDown: KeyHandler = (context) => {
  if (!context.isOpen) {
    context.openDropdown();
    moveHighlight(context, -1, 'down');
    return 'handled';
  }
  return moveHighlight(context, context.highlightedIndex, 'down');
};

const handleArrowUp: KeyHandler = (context) => {
  if (!context.isOpen) {
    context.openDropdown();
    moveHighlight(context, context.options.length, 'up');
    return 'handled';
  }
  return moveHighlight(context, context.highlightedIndex, 'up');
};

const handleHome: KeyHandler = (context) => {
  if (!context.isOpen) {
    context.openDropdown();
    return 'handled';
  }
  return moveHighlight(context, -1, 'down');
};

const handleEnd: KeyHandler = (context) => {
  if (!context.isOpen) {
    context.openDropdown();
    return 'handled';
  }
  return moveHighlight(context, context.options.length, 'up');
};

const handleTab: KeyHandler = (context) => {
  if (!context.isOpen) {
    return 'ignored';
  }
  context.closeDropdown();
  return 'handled-no-prevent';
};

const KEY_HANDLERS: Partial<Record<string, KeyHandler>> = {
  Enter: handleActivate,
  ' ': handleActivate,
  Escape: handleEscape,
  ArrowDown: handleArrowDown,
  ArrowUp: handleArrowUp,
  Home: handleHome,
  End: handleEnd,
  Tab: handleTab,
};

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
    (currentIndex: number, direction: MoveDirection): number =>
      findNextSelectableIndex(options, currentIndex, direction),
    [options]
  );

  const handleKeyAction = useCallback(
    (key: string): KeyActionResult => {
      if (disabled) {
        return 'ignored';
      }
      const handler = KEY_HANDLERS[key];
      if (!handler) {
        return 'ignored';
      }
      return handler({
        options,
        isOpen,
        highlightedIndex,
        setHighlightedIndex,
        selectOption,
        openDropdown,
        closeDropdown,
        getNextEnabledIndex,
      });
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
