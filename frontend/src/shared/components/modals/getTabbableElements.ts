const DEFAULT_TABBABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'area[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'summary:not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  '[contenteditable="plaintext-only"]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const isExcluded = (element: HTMLElement) => {
  if (element.closest('[data-focus-trap-ignore="true"]')) {
    return true;
  }

  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return true;
  }

  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) {
    return true;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return true;
  }

  return false;
};

export const getTabbableElements = (
  root: HTMLElement | null,
  selector = DEFAULT_TABBABLE_SELECTOR
): HTMLElement[] => {
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => !isExcluded(element)
  );
};
