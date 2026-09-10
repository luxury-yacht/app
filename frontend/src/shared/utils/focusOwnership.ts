// Portaled controls retain the region/modal ownership of their invoking control.
export const getFocusPortalOwner = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Element)) {
    return null;
  }
  const ownerId = target.closest<HTMLElement>('[data-focus-portal-owner]')?.dataset
    .focusPortalOwner;
  if (!ownerId) {
    return null;
  }
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]')).find(
      (owner) => owner.getAttribute('aria-controls') === ownerId
    ) ?? null
  );
};
