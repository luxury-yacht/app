import { useEffect } from 'react';
import { createRegionFocusIndicator } from './regionFocusIndicator';
import { isInputElement } from './utils';

const FOCUS_CLASS = 'keyboard-programmatic-focus';

// Keys that move focus through lists, tab strips, and other composite
// controls. In a typing field they edit text instead, so they don't count.
const NAVIGATION_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const isTabNavigation = (event: KeyboardEvent) =>
  event.key === 'Tab' && !event.altKey && !event.metaKey;

const isListNavigation = (event: KeyboardEvent) =>
  NAVIGATION_KEYS.has(event.key) &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !isInputElement(event.target);

// The focus highlight follows keyboard navigation only: Tab or a navigation
// key starts it and pointer use ends it. Shared styles key on this marker, not
// WebKit's :focus-visible, which also matches after shortcuts and programmatic
// focus moves such as returning focus when the command palette closes.
// Listeners run in the capture phase, before document-level focus traps.
export function useKeyboardFocusIndicator() {
  useEffect(() => {
    const regionIndicator = createRegionFocusIndicator();
    let keyboardNavigation = false;
    // Only Tab navigation outlines regions; arrows stay within one.
    let tabNavigation = false;
    // A navigation key counts only if focus moves before the next task. The
    // owning list moves it from its key handler or the update that follows.
    let listKeyPending = false;
    let listKeyTimer: number | undefined;
    let indicated: HTMLElement | null = null;
    const clearIndicator = () => {
      indicated?.classList.remove(FOCUS_CLASS);
      indicated = null;
    };
    const indicateFocus = () => {
      clearIndicator();
      const active = document.activeElement;
      if (keyboardNavigation && active instanceof HTMLElement) {
        indicated = active;
        active.classList.add(FOCUS_CLASS);
        if (tabNavigation) {
          regionIndicator.update();
        }
      }
    };
    const endListKey = () => {
      window.clearTimeout(listKeyTimer);
      listKeyPending = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTabNavigation(event)) {
        keyboardNavigation = true;
        tabNavigation = true;
        indicateFocus();
      } else if (isListNavigation(event)) {
        endListKey();
        listKeyPending = true;
        listKeyTimer = window.setTimeout(endListKey, 0);
      }
    };
    const handleFocusIn = () => {
      if (listKeyPending) {
        keyboardNavigation = true;
      }
      indicateFocus();
    };
    const handlePointerDown = () => {
      keyboardNavigation = false;
      tabNavigation = false;
      endListKey();
      clearIndicator();
      regionIndicator.clear();
    };
    const handleBeforeInput = (event: Event) => {
      if (event.target === indicated) {
        // Editing dismisses the cue; the next keyboard focus move restores it.
        clearIndicator();
        regionIndicator.dismiss();
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const control = event.target.closest<HTMLElement>(
        'button, a[href], summary, [role="button"], [role="tab"]'
      );
      if (control && !control.matches(':disabled') && !control.closest('[inert]')) {
        // WebKit does not consistently focus buttons on click. Establish the
        // invoking control before its action opens a popup or changes regions.
        control.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('beforeinput', handleBeforeInput, true);
    window.addEventListener('click', handleClick, true);
    window.addEventListener('focusin', handleFocusIn, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('beforeinput', handleBeforeInput, true);
      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('focusin', handleFocusIn, true);
      endListKey();
      clearIndicator();
      regionIndicator.clear();
    };
  }, []);
}
