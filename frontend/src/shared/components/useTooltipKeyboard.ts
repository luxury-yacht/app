import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

export function useTooltipKeyboard({
  triggerRef,
  tooltipRef,
  visible,
  disabled,
  keyboardEnabled,
  setVisible,
  clearTimers,
}: {
  triggerRef: RefObject<HTMLElement | null>;
  tooltipRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
  disabled: boolean;
  keyboardEnabled: boolean;
  setVisible: (value: boolean) => void;
  clearTimers: () => void;
}) {
  const keyboardOpen = useRef(false);
  const focusedControl = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    const lostFocus =
      document.activeElement === document.body &&
      focusedControl.current !== null &&
      !focusedControl.current.isConnected;
    if (lostFocus || tooltipRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
    focusedControl.current = null;
    keyboardOpen.current = false;
    clearTimers();
    setVisible(false);
  }, [clearTimers, setVisible, tooltipRef, triggerRef]);

  useEffect(() => {
    if (disabled && visible) {
      close();
    }
  }, [close, disabled, visible]);

  const moveFocus = (backwards: boolean, atTrigger: boolean) => {
    keyboardOpen.current = true;
    clearTimers();
    const controls = getTabbableElements(tooltipRef.current);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    const entryIndex = backwards ? controls.length - 1 : 0;
    const direction = backwards ? -1 : 1;
    const next = atTrigger ? entryIndex : index + direction;
    if (controls[next]) {
      controls[next].focus();
    } else {
      close();
    }
  };

  const onKeyDown = (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => {
    if (!keyboardEnabled || disabled || event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    const atTrigger = event.target === triggerRef.current;
    if (atTrigger && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      clearTimers();
      keyboardOpen.current = !visible;
      setVisible(!visible);
      return true;
    }
    if (!visible || !['Tab', 'Escape'].includes(event.key)) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      close();
      return true;
    }
    moveFocus(event.shiftKey, atTrigger);
    return true;
  };

  useKeyboardSurface({
    kind: 'dropdown',
    rootRef: triggerRef,
    active: keyboardEnabled && !disabled,
    priority: 350,
    onKeyDown,
  });
  useKeyboardSurface({
    kind: 'dropdown',
    rootRef: tooltipRef,
    active: keyboardEnabled && visible && !disabled,
    priority: 350,
    onKeyDown,
  });

  useEffect(() => {
    if (!visible) {
      return;
    }
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (tooltipRef.current?.contains(target)) {
        focusedControl.current = event.target as HTMLElement;
        clearTimers();
      } else if (!triggerRef.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [clearTimers, close, tooltipRef, triggerRef, visible]);

  return { close, onKeyDown, keyboardOpen };
}
