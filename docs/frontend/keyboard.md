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
- The native macOS menu and app-rendered Windows/Linux menu label
  `Cmd/Ctrl+W` as context-neutral `Close`; the focused window role decides what
  closes. In a workspace, it closes the active cluster tab through
  `KubeconfigContext`, or the workspace when it has no cluster tabs. In a panel
  window, the shortcut guards and closes the active object tab; closing the
  last tab closes that native panel window. The panel titlebar closes the whole
  group through the same guards.
- The app-rendered workspace menu is a `menu` keyboard surface. It owns arrows,
  `Enter`, `Space`, and `Escape` while open, restores the prior content focus
  before executing a command, and uses the same renderer command owner as its
  keyboard accelerators. Only process-wide and native-window work crosses the
  backend boundary.
- `ApplicationMenuShortcuts` is the single Windows/Linux accelerator owner for
  both workspace and panel windows. On macOS the same registrations remain
  discoverable in shortcut help but are dispatch-disabled because the native
  application menu owns them. A panel keeps dispatch disabled until that native
  panel has acknowledged readiness.
- Application-menu accelerators get the active surface's first chance and then
  may cross `suppressShortcuts`. They do not implicitly dismiss a palette,
  modal, dropdown, or context menu; a surface that intentionally reacts receives
  the typed command identity. The app-rendered menu closes itself before its own
  accelerator runs. Ordinary registered shortcuts remain suppressed. Standard
  cut, copy, paste, and select-all keys remain native editing operations.
- Panel windows mount `PanelWindowShortcuts`, not workspace
  `GlobalShortcuts`. Close, zoom, inspector, and window commands execute in the
  child renderer.
  Workspace commands such as Settings, About, Open Cluster, sidebar,
  diagnostics, object diff, and Application Logs focus the immutable owner and
  route there through the backend's authenticated native-window descriptor.
- Blocking modals and editors keep their existing priority. An unsaved YAML
  draft or in-flight mutation may reject a tab/group/window close and focuses
  the first deterministic blocker.

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
