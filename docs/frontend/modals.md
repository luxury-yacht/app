# Modal Contract

Blocking modals use the shared modal foundation; a modal never invents its own
focus trap, backdrop, Escape handling, or app-background blocking.

## Ownership

- Shared modal surface, stack, and focus trap:
  `frontend/src/shared/components/modals`. Two-pane category sidebars
  (Settings, Keyboard Shortcuts) use `ModalSidebarNav` there; the owning modal
  passes `handleModalSidebarKeyDown` to its focus trap so arrows, Home, and End
  move between categories from one Tab stop and Enter/Space select.
- App-owned modal routing/state: `frontend/src/ui/modals`,
  `frontend/src/core/contexts/ModalStateContext.tsx`.
- Modal form state belongs to the modal workflow; focus, backdrop, and Escape
  belong to the shared layer. Add direct document listeners only when the
  shared layer cannot express the behavior.
- Keyboard surface rules: [keyboard.md](keyboard.md).

## Behavior Rules

- Opening moves focus into the modal; closing restores it where practical. The
  topmost modal owns focus and `Escape`, and `Tab`/`Shift+Tab` stay inside it.
- Background content is hidden from pointer and accessibility interaction
  while blocked. Command-palette and ordinary global shortcuts never bypass a
  blocking modal; application-menu accelerators keep their platform command
  semantics without implicitly dismissing it (verify them separately).
- Escape closes only when the workflow permits cancellation; backdrop clicks
  close only when the workflow explicitly allows it.
- A modal draft initializes once on open. Background refreshes may update
  source props while open but never overwrite user-edited form state;
  reopening starts a new draft from the latest props.
- Destructive or long-running actions need clear disabled/loading/error states.
- Nested modals only through the shared stack.
- Size modals with the shared `--modal-viewport-height` and
  `--modal-viewport-width`, which account for app zoom; never raw `vh`/`vw`
  under the zoomed body.
- The shared container caps its height to the backdrop's content box
  (excluding the titlebar and outer padding). Modal-specific limits go in
  `--modal-max-height` so they cannot bypass that cap. Content scrolls inside
  the modal; on very short windows the container also scrolls so header and
  footer controls stay reachable.

## Validation

Test open/close, focus entry, containment, and restore, Escape/backdrop/submit/
cancel/disabled states, and background shortcut and pointer blocking; verify
visual or focus changes manually.

Storybook `Modals/ModalSurface/Sizing` holds tall-content regression stories
for the shared surface and its sizing variants; their play checks assert
bounds, centering, and access to the header, footer, and final field. Run them
at 50%, 100%, 150%, and 200% app zoom, including a short window.
