# UI Modals

This document describes how blocking modals work in the frontend today and how new modals should
be implemented.

## Overview

Blocking modals now use one shared foundation:

- [`frontend/src/shared/components/modals/ModalSurface.tsx`](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/modals/ModalSurface.tsx)
- [`frontend/src/shared/components/modals/useModalFocusTrap.ts`](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/modals/useModalFocusTrap.ts)
- [`frontend/src/shared/components/modals/getTabbableElements.ts`](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/modals/getTabbableElements.ts)
- shared visuals in [`frontend/src/ui/modals/modals.css`](/Volumes/git/luxury-yacht/app/frontend/src/ui/modals/modals.css)

All live blocking app modals should use this foundation. Do not render a custom `.modal-overlay`
directly for a new blocking modal.

## What The Shared Modal Surface Guarantees

`ModalSurface` provides:

- portal rendering to `document.body`
- full-app backdrop coverage
- `role="dialog"`
- `aria-modal="true"`
- `aria-labelledby`
- a focusable modal root with `tabIndex={-1}`
- backdrop-close handling when enabled

`useModalFocusTrap` provides:

- initial focus into the modal on open
- `Tab` / `Shift+Tab` containment within the topmost modal
- focus restore to the previously focused element on close
- background inerting while a blocking modal is open
- nested-modal handoff by tracking the topmost open modal surface

The trap discovers real tabbables from the modal root instead of relying on hand-maintained
`data-*-focusable` selectors.

## How Background Blocking Works

When a blocking modal opens, `useModalFocusTrap` marks every `document.body` child except the
topmost modal surface as:

- `inert`
- `aria-hidden="true"`

Those attributes are managed automatically and removed when the modal stack changes or closes.

This means:

- native `Tab` cannot escape into the background
- focus is redirected back into the topmost modal if something tries to move it outside
- nested confirmation dialogs work correctly because only the topmost modal stays active

## How To Build A Modal

Use this pattern:

```tsx
const modalRef = useRef<HTMLDivElement>(null);

useModalFocusTrap({
  ref: modalRef,
  disabled: !shouldRender,
});

return (
  <ModalSurface
    modalRef={modalRef}
    labelledBy="my-modal-title"
    onClose={onClose}
    containerClassName="my-modal"
    overlayClassName="my-modal-overlay"
    isClosing={isClosing}
    closeOnBackdrop={!isBusy}
  >
    <div className="modal-header">
      <h2 id="my-modal-title">Title</h2>
      ...
    </div>
    <div className="modal-content">...</div>
  </ModalSurface>
);
```

Required rules:

- Render the modal body inside `ModalSurface`.
- Pass a stable `modalRef` to both `ModalSurface` and `useModalFocusTrap`.
- Give the title element an `id` and pass the same value through `labelledBy`.
- Use `closeOnBackdrop={false}` when backdrop clicks must not dismiss.
- Disable the trap when the modal is not rendered yet, or when a child modal should own focus.

## What The Shared Layer Does Not Do

These remain modal-specific responsibilities:

- open/close animation state such as `shouldRender` and `isClosing`
- `Escape` behavior
- any modal-local shortcut registration with `useShortcut`
- `document.body.style.overflow` scroll locking
- busy-state dismissal rules

Several app modals still intentionally manage those behaviors locally. The shared modal layer is
about rendering, blocking, focus, and accessibility, not business logic.

## Escape And Shortcut Ownership

If a modal should close on `Escape`, wire that explicitly in the modal component.

Current patterns:

- app-owned modals like Settings, About, Log Settings, and Object Diff use `useShortcut`
- some shared/action modals like Scale, Rollback, and Port Forward use a capture-phase
  `document` listener for `Escape`

For nested modals, the parent should usually disable its own shortcut/trap while the child modal is
open if the child is supposed to own dismissal.

Example:

```ts
useModalFocusTrap({
  ref: modalRef,
  disabled: !isOpen || showDeleteConfirm,
});
```

## Tabbable Discovery And Opt-Outs

The default tabbable set includes:

- links
- buttons
- inputs
- selects
- textareas
- `summary`
- `contenteditable`
- positive/zero `tabindex` nodes

Elements are excluded if they are:

- `hidden`
- `aria-hidden="true"`
- inside an inert or hidden ancestor
- `display: none`
- `visibility: hidden`
- inside `[data-focus-trap-ignore="true"]`
- `tabIndex={-1}`

Use opt-outs sparingly. The current main case is a link that should stay clickable by mouse but not
participate in the modal tab cycle.

## Backdrop Behavior

`ModalSurface` closes on backdrop click by default.

Use `closeOnBackdrop={false}` when the modal should only close through explicit controls, for
example:

- Scale modal
- Rollback modal

Use `closeOnBackdrop={!isLoading}` when dismissal should stop during an in-flight action, for
example Port Forward.

## Animations

`ModalSurface` does not manage mount/unmount timing. If a modal uses the shared fade/slide classes
from `modals.css`, it should keep the modal mounted until the close animation finishes.

Current pattern:

- `isOpen` drives whether the modal is logically open
- `shouldRender` keeps it mounted during close animation
- `isClosing` adds the shared `closing` class for the transition

When using this pattern, pass `disabled: !shouldRender` to `useModalFocusTrap` so focus remains
contained until the modal actually unmounts.

## Testing Guidance

Because `ModalSurface` portals to `document.body`, tests should usually query `document`, not the
original render container.

Recommended assertions:

- dialog exists and has `role="dialog"` / `aria-modal="true"`
- title id matches `aria-labelledby`
- overlay click closes or does not close, depending on `closeOnBackdrop`
- focused element stays inside on `Tab`
- focus returns to the previous element on close

See:

- [`useModalFocusTrap.test.tsx`](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/modals/useModalFocusTrap.test.tsx)
- [`AboutModal.test.tsx`](/Volumes/git/luxury-yacht/app/frontend/src/ui/modals/AboutModal.test.tsx)
- [`ScaleModal.test.tsx`](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/modals/ScaleModal.test.tsx)

## Current Modal Inventory

These modals currently use the shared modal surface:

- Settings modal
- Log Settings modal
- About modal
- Confirmation modal
- Scale modal
- Rollback modal
- Object Diff modal
- Favorites save/edit modal
- Port Forward modal

If a new blocking modal is added, it should follow the same pattern rather than introducing another
overlay/trap implementation.
