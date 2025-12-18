import { useCallback } from 'react';
import type { RefObject } from 'react';
import { useKeyboardNavigationScope } from '@ui/shortcuts';

interface UseModalFocusTrapOptions {
  ref: RefObject<HTMLElement | null>;
  focusableSelector: string;
  priority: number;
  disabled?: boolean;
}

export const useModalFocusTrap = ({
  ref,
  focusableSelector,
  priority,
  disabled = false,
}: UseModalFocusTrapOptions) => {
  const getFocusableItems = useCallback(() => {
    const root = ref.current;
    if (!root) {
      return [];
    }
    return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector));
  }, [ref, focusableSelector]);

  const focusAt = useCallback(
    (index: number) => {
      const items = getFocusableItems();
      if (index < 0 || index >= items.length) {
        return false;
      }
      items[index].focus();
      return true;
    },
    [getFocusableItems]
  );

  const focusFirst = useCallback(() => focusAt(0), [focusAt]);
  const focusLast = useCallback(() => {
    const items = getFocusableItems();
    return focusAt(items.length - 1);
  }, [focusAt, getFocusableItems]);

  const findFocusedIndex = useCallback(() => {
    const items = getFocusableItems();
    const active = document.activeElement as HTMLElement | null;
    return items.findIndex((element) => element === active || element.contains(active));
  }, [getFocusableItems]);

  useKeyboardNavigationScope({
    ref,
    priority,
    disabled,
    onNavigate: ({ direction }) => {
      const items = getFocusableItems();
      if (items.length === 0) {
        return 'bubble';
      }
      const current = findFocusedIndex();
      if (current === -1) {
        return direction === 'forward'
          ? focusFirst()
            ? 'handled'
            : 'bubble'
          : focusLast()
            ? 'handled'
            : 'bubble';
      }
      const next = direction === 'forward' ? current + 1 : current - 1;
      if (next < 0 || next >= items.length) {
        return 'bubble';
      }
      focusAt(next);
      return 'handled';
    },
    onEnter: ({ direction }) => {
      if (direction === 'forward') {
        focusFirst();
      } else {
        focusLast();
      }
    },
  });
};
