# Keyboard Contract

Keyboard behavior is owned by active surfaces and registered shortcuts. Do not
add global document/window listeners for ordinary app behavior.

## Agent Contract

- Register global commands through the shortcut system.
- Register surface ownership through the keyboard surface APIs.
- Local `onKeyDown` is for field/editor-local behavior only.
- Blocking surfaces such as modals and the command palette own keys before the
  rest of the app.
- Menus, dropdowns, panels, regions, and editors should register as surfaces
  when they need keyboard ownership.
- Preserve native text editing behavior for inputs and editors.
- `Tab` is local navigation inside the active surface; cross-surface movement
  uses app-level shortcuts.

## Surface Model

The active surface gets first chance to handle a key. If no surface handles it,
registered global shortcuts may run. If nothing handles it, native browser
behavior should remain intact.

Surface kinds include:

- `modal`
- `palette`
- `menu`
- `dropdown`
- `panel`
- `region`
- `editor`

## Ownership

- Shortcut provider and dispatch: `frontend/src/ui/shortcuts/context.tsx`
- Surface registration: `frontend/src/ui/shortcuts/surfaces.ts`
- Shortcut hooks: `frontend/src/ui/shortcuts/hooks.ts`
- Shared modal focus trap: `frontend/src/shared/components/modals`
- YAML editor behavior: [yaml-editor.md](yaml-editor.md)
- Modal behavior: [modals.md](modals.md)

## Rules By Surface

- Modals trap focus and own `Escape` unless explicitly delegated.
- Command palette owns its local navigation while open.
- Dropdowns and menus own arrows, `Enter`, `Space`, and `Escape` while active.
- Comboboxes keep DOM focus on the trigger or search field and expose the
  highlighted option through `aria-activedescendant`; popup options are not
  additional tab stops.
- Virtualized tables keep DOM focus on their native table element while shared
  state marks the active row, allowing native table semantics and row recycling
  without moving focus to an element that can unmount.
- Adjustable separators support the appropriate arrow keys and Home/End while
  publishing their current, minimum, and maximum values.
- Panels and table regions own focused keyboard behavior without blocking the
  whole app.
- Editors may own editor-specific keys; app-level `Escape` wins unless the
  editor has a documented transient UI reason.

## Change Checklist

When changing keyboard behavior:

1. Identify the surface that should own the key.
2. Prefer registered surfaces and shortcuts over direct listeners.
3. Confirm inputs and native editing shortcuts still work.
4. Test modal/palette/menu layering when the new key can fire there.
5. Add focused tests for ownership, fallback, and cleanup.

## Validation

Run targeted shortcut/surface tests and relevant component tests. For focus
changes, also verify manually in the app.
