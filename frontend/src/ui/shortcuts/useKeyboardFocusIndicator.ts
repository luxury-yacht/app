import { useEffect } from 'react';

const FOCUS_CLASS = 'keyboard-programmatic-focus';

// Observe before document-level traps: local surfaces and native Tab moves
// must show focus even after pointer use suppresses :focus-visible in WebKit.
export function useKeyboardFocusIndicator() {
  useEffect(() => {
    let keyboardNavigation = false;
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
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.altKey && !event.metaKey) {
        keyboardNavigation = true;
        indicateFocus();
      }
    };
    const handlePointerDown = () => {
      keyboardNavigation = false;
      clearIndicator();
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
        control.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('click', handleClick, true);
    window.addEventListener('focusin', indicateFocus, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('focusin', indicateFocus, true);
      clearIndicator();
    };
  }, []);
}
