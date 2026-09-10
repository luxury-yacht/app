import { getFocusPortalOwner } from '@shared/utils/focusOwnership';
import type { KeyboardSurfaceKeyResult } from '@ui/shortcuts/context';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { getTabbableElements } from './getTabbableElements';

interface UseModalFocusTrapOptions {
  ref: RefObject<HTMLElement | null>;
  focusableSelector?: string;
  disabled?: boolean;
  suppressShortcuts?: boolean;
  onKeyDown?: (event: KeyboardEvent) => KeyboardSurfaceKeyResult;
  onEscape?: (event: KeyboardEvent) => boolean | undefined;
}

interface OpenModalEntry {
  id: symbol;
  root: HTMLElement;
  surface: HTMLElement | null;
}

const MANAGED_INERT_ATTR = 'data-modal-managed-inert';
const MANAGED_ARIA_HIDDEN_ATTR = 'data-modal-managed-aria-hidden';

const openModalStack: OpenModalEntry[] = [];

const isOwnedFocusPortalTarget = (root: HTMLElement, target: EventTarget | null) => {
  const owner = getFocusPortalOwner(target);
  return owner !== null && root.contains(owner);
};

const getTrackedBodyChildren = () =>
  Array.from(document.body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  );

const pruneDisconnectedModalEntries = () => {
  for (let i = openModalStack.length - 1; i >= 0; i -= 1) {
    const surface = openModalStack[i]?.surface;
    if (!surface?.isConnected) {
      openModalStack.splice(i, 1);
    }
  }
};

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

  pruneDisconnectedModalEntries();

  const topmostModal = openModalStack[openModalStack.length - 1] ?? null;
  const topmostSurface = topmostModal?.surface ?? null;

  getTrackedBodyChildren().forEach((element) => {
    const belongsToTopmostModal =
      topmostModal !== null && isOwnedFocusPortalTarget(topmostModal.root, element);
    setManagedBackgroundState(
      element,
      topmostSurface !== null && element !== topmostSurface && !belongsToTopmostModal
    );
  });
};

export const __resetModalFocusTrapForTest = () => {
  openModalStack.splice(0, openModalStack.length);
  if (typeof document === 'undefined') {
    return;
  }
  getTrackedBodyChildren().forEach((element) => {
    setManagedBackgroundState(element, false);
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

const isLocalTabEvent = (event: KeyboardEvent) =>
  event.key === 'Tab' && !event.defaultPrevented && !event.altKey && !event.metaKey;

const claimModalTab = (event: KeyboardEvent) => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
};

const focusNextModalControl = (root: HTMLElement, items: HTMLElement[], backwards: boolean) => {
  if (items.length === 0) {
    root.focus();
    return;
  }
  const active = document.activeElement;
  const index = items.findIndex((item) => item === active || item.contains(active));
  const fallbackIndex = backwards ? items.length - 1 : 0;
  const nextIndex =
    index < 0 ? fallbackIndex : (index + (backwards ? -1 : 1) + items.length) % items.length;
  items[nextIndex].focus();
};

export const useModalFocusTrap = ({
  ref,
  focusableSelector,
  disabled = false,
  suppressShortcuts = false,
  onKeyDown,
  onEscape,
}: UseModalFocusTrapOptions) => {
  const modalIdRef = useRef(Symbol('modal-focus-trap'));
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useKeyboardSurface({
    kind: 'modal',
    rootRef: ref,
    active: !disabled,
    blocking: true,
    suppressShortcuts,
    onKeyDown,
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
    const target =
      items.find((item) => item.dataset.modalInitialFocus !== undefined) ?? items[0] ?? root;
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

    const surface = root.closest<HTMLElement>('[data-modal-surface="true"]') ?? root;
    registerOpenModal({ id: modalId, root, surface });

    return () => {
      unregisterOpenModal(modalId);

      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (!previous?.isConnected) {
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
    if (
      active instanceof Node &&
      (root.contains(active) || isOwnedFocusPortalTarget(root, active))
    ) {
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
      if (!isTopmostModal(modalId) || !isLocalTabEvent(event)) {
        return;
      }

      if (event.ctrlKey) {
        claimModalTab(event);
        return;
      }
      const activeRoot = ref.current;
      if (!activeRoot || isOwnedFocusPortalTarget(activeRoot, document.activeElement)) {
        return;
      }

      claimModalTab(event);
      focusNextModalControl(activeRoot, getFocusableItems(), event.shiftKey);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTopmostModal(modalId)) {
        return;
      }

      const activeRoot = ref.current;
      const target = event.target;
      if (
        !activeRoot ||
        !(target instanceof Node) ||
        activeRoot.contains(target) ||
        isOwnedFocusPortalTarget(activeRoot, target)
      ) {
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
  }, [disabled, focusFirst, getFocusableItems, ref]);
};
