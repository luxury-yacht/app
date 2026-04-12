import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { getTabbableElements } from './getTabbableElements';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';

interface UseModalFocusTrapOptions {
  ref: RefObject<HTMLElement | null>;
  focusableSelector?: string;
  priority?: number;
  disabled?: boolean;
  onEscape?: (event: KeyboardEvent) => boolean | void;
}

interface OpenModalEntry {
  id: symbol;
  surface: HTMLElement | null;
}

const MANAGED_INERT_ATTR = 'data-modal-managed-inert';
const MANAGED_ARIA_HIDDEN_ATTR = 'data-modal-managed-aria-hidden';

const openModalStack: OpenModalEntry[] = [];

const getTrackedBodyChildren = () =>
  Array.from(document.body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  );

const setManagedBackgroundState = (element: HTMLElement, inert: boolean) => {
  if (inert) {
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute(MANAGED_INERT_ATTR, 'true');
    element.setAttribute(MANAGED_ARIA_HIDDEN_ATTR, 'true');
    return;
  }

  if (element.getAttribute(MANAGED_INERT_ATTR) === 'true') {
    element.removeAttribute('inert');
    element.removeAttribute(MANAGED_INERT_ATTR);
  }

  if (element.getAttribute(MANAGED_ARIA_HIDDEN_ATTR) === 'true') {
    element.removeAttribute('aria-hidden');
    element.removeAttribute(MANAGED_ARIA_HIDDEN_ATTR);
  }
};

const syncBodyInertState = () => {
  if (typeof document === 'undefined') {
    return;
  }

  const topmostSurface = openModalStack[openModalStack.length - 1]?.surface ?? null;

  getTrackedBodyChildren().forEach((element) => {
    setManagedBackgroundState(element, topmostSurface !== null && element !== topmostSurface);
  });
};

const registerOpenModal = (entry: OpenModalEntry) => {
  openModalStack.push(entry);
  syncBodyInertState();
};

const unregisterOpenModal = (id: symbol) => {
  let index = -1;
  for (let i = openModalStack.length - 1; i >= 0; i -= 1) {
    if (openModalStack[i]?.id === id) {
      index = i;
      break;
    }
  }
  if (index >= 0) {
    openModalStack.splice(index, 1);
  }
  syncBodyInertState();
};

const isTopmostModal = (id: symbol) => openModalStack[openModalStack.length - 1]?.id === id;

export const useModalFocusTrap = ({
  ref,
  focusableSelector,
  priority,
  disabled = false,
  onEscape,
}: UseModalFocusTrapOptions) => {
  void priority;
  const modalIdRef = useRef(Symbol('modal-focus-trap'));
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useKeyboardSurface({
    kind: 'modal',
    rootRef: ref,
    active: !disabled,
    blocking: true,
    onEscape,
  });

  const getFocusableItems = useCallback(() => {
    return getTabbableElements(ref.current, focusableSelector);
  }, [ref, focusableSelector]);

  const focusFirst = useCallback(() => {
    const root = ref.current;
    if (!root) {
      return false;
    }
    const items = getFocusableItems();
    const target = items[0] ?? root;
    target.focus();
    return true;
  }, [getFocusableItems, ref]);

  const focusLast = useCallback(() => {
    const root = ref.current;
    if (!root) {
      return false;
    }
    const items = getFocusableItems();
    const target = items[items.length - 1] ?? root;
    target.focus();
    return true;
  }, [getFocusableItems, ref]);

  useEffect(() => {
    const root = ref.current;
    if (!root || disabled) {
      return;
    }
    const modalId = modalIdRef.current;

    const activeElement = document.activeElement;
    previouslyFocusedRef.current =
      activeElement instanceof HTMLElement && !root.contains(activeElement) ? activeElement : null;

    const surface = root.closest<HTMLElement>('[data-modal-surface="true"]');
    registerOpenModal({ id: modalId, surface });

    return () => {
      unregisterOpenModal(modalId);

      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (!previous || !previous.isConnected) {
        return;
      }

      previous.focus();
    };
  }, [disabled, ref]);

  useEffect(() => {
    const root = ref.current;
    const modalId = modalIdRef.current;
    if (!root || disabled || !isTopmostModal(modalId)) {
      return;
    }

    const active = document.activeElement;
    if (active instanceof Node && root.contains(active)) {
      return;
    }

    focusFirst();
  }, [disabled, focusFirst, ref]);

  useEffect(() => {
    const root = ref.current;
    if (!root || disabled) {
      return;
    }
    const modalId = modalIdRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostModal(modalId) || event.key !== 'Tab') {
        return;
      }

      const activeRoot = ref.current;
      if (!activeRoot) {
        return;
      }

      const items = getFocusableItems();
      if (items.length === 0) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        activeRoot.focus();
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const currentIndex = items.findIndex((item) => item === active || item.contains(active));
      const fallbackIndex = event.shiftKey ? items.length - 1 : 0;
      const nextIndex =
        currentIndex === -1
          ? fallbackIndex
          : (currentIndex + (event.shiftKey ? -1 : 1) + items.length) % items.length;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      items[nextIndex]?.focus();
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTopmostModal(modalId)) {
        return;
      }

      const activeRoot = ref.current;
      const target = event.target;
      if (!activeRoot || !(target instanceof Node) || activeRoot.contains(target)) {
        return;
      }

      focusFirst();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
    };
  }, [disabled, focusFirst, focusLast, getFocusableItems, ref]);
};
