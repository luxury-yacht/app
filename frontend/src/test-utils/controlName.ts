/**
 * The name a form control is announced with: its aria-label, or the text of the
 * labels tied to it. A placeholder does not count. This covers how the app names
 * its controls; it is not a full accessible-name computation.
 */
export const controlName = (control: Element): string => {
  const ariaLabel = control.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel;
  }
  const labels = (control as HTMLInputElement).labels ?? [];
  return Array.from(labels, (label) => label.textContent?.trim() ?? '')
    .join(' ')
    .trim();
};
