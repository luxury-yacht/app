# Modal Contract

Blocking modals use the shared modal foundation. A modal should not invent its
own focus trap, backdrop, escape handling, or app-background blocking.

## Agent Contract

- Use the shared modal primitives for blocking app modals.
- Topmost modal owns focus and `Escape`.
- `Tab` and `Shift+Tab` must stay inside the topmost modal.
- Background app content must be hidden from pointer and accessibility
  interaction while blocked.
- Modal form state belongs to the modal workflow; focus/backdrop/escape behavior
  belongs to the shared modal layer.
- A modal draft initializes once when the modal opens. Background refreshes may
  update source props while it remains open, but must not overwrite user-edited
  form state; closing and reopening starts a new draft from the latest props.
- Do not add direct document listeners unless the shared layer cannot express
  the behavior.
- Do not let command palette or global shortcuts bypass a blocking modal.

## Ownership

- Shared modal surface and focus trap:
  `frontend/src/shared/components/modals`
- App-owned modal routing/state:
  `frontend/src/ui/modals`,
  `frontend/src/core/contexts/ModalStateContext.tsx`
- Keyboard surface rules: [keyboard.md](keyboard.md)

## Behavior Rules

- Opening a modal should move focus into it.
- Closing a modal should restore focus where practical.
- Escape closes only when the workflow permits cancellation.
- Backdrop clicks close only when the workflow explicitly allows it.
- Destructive or long-running actions must have clear disabled/loading/error
  states.
- Nested modals are allowed only through the shared stack behavior.

## Change Checklist

When adding or changing a modal:

1. Use the shared modal surface.
2. Confirm focus enters, stays inside, and restores on close.
3. Confirm `Escape`, backdrop, submit, cancel, and disabled states.
4. Confirm background app shortcuts and pointer events are blocked.
5. Add tests for open, close, keyboard, and critical workflow behavior.

## Validation

Run focused modal/component tests. For visual or focus changes, verify manually
in the app.
