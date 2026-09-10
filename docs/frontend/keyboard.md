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

## Region navigation

- `Tab` and `Shift+Tab` explicitly focus the next/previous control inside the
  current app region and wrap at its boundaries. This keeps the order consistent
  when native webview preferences would skip buttons. Sidebar entries remain an
  arrow-navigated group. Tab leaves that group for the sidebar's other controls;
  Enter and Space on those controls use the focused button's own action. List
  navigation keys are handled only while focus belongs to the list.
- `Ctrl+Tab` and `Ctrl+Shift+Tab` move forward/backward through the header
  (including cluster tabs), visible sidebar (including its resize handle), main
  content, visible dockable panels, then visible error notifications. Control is
  literal on macOS too; Command is not substituted.
- Returning to a region restores its last available control. Hidden, disabled,
  inert, and disconnected targets are discarded. An empty content region can
  receive focus itself. Focusing a panel raises it without selecting another tab.
- KeyboardProvider normalizes clicked button/tab focus before activation, so
  native WebKit pointer behavior cannot leave the next key in the old region.
  Its shared focus observer runs before local capture handlers and clears
  keyboard indication on pointer use and provider cleanup.
- Both local Tab navigation and region switching show an explicit focus ring,
  including immediately after a mouse click. The ring follows the final focused
  item when a composite root redirects focus.
- Surfaces marked `data-tab-native="true"`, such as shell terminals, retain
  ordinary Tab for native behavior; Control+Tab leaves their region. Blocking
  dialogs and the command palette keep region commands inside the blocking
  surface. Alt/Command+Tab are not claimed.
- A focused tab strip uses Left/Right to move its cursor and Enter to select.
  Region navigation does not change cluster, object, or view selection.
- The same navigation registrations are mounted in workspace and native panel
  windows and appear in keyboard shortcut help.

Implementation: `ui/layout/appFocusRegions.ts`, `ui/layout/AppRegionNavigation.tsx`,
`ui/layout/AppLayout.tsx`, `PanelWindowApp.tsx`, and `ui/shortcuts/context.tsx`.
Regression coverage: `appFocusRegions.test.tsx`, `DockablePanel.test.tsx`,
`GridTable.keyboard.test.tsx`, `CommandPalette.keyboard.test.tsx`, and
`useModalFocusTrap.test.tsx` beside their owners.

## Surface Model

Except for the region commands above, the active surface gets first chance to
handle a key. If no surface handles it,
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
- Dropdowns and menus own their list keys while the list/combobox owns focus.
  Child action buttons retain their own Enter/Space behavior. The same guard
  applies to table rows and tab strips.
- Dropdown Tab visits search, bulk and option-action controls, returning to the
  trigger at the popup boundary. Closing or disabling the focused action must
  restore a usable focus target before it disappears. Control+Tab resolves the
  originating region through shared portal ownership.
- Context-menu Tab/Shift+Tab and Escape return focus to the invoking control;
  Favorites reveals actions on focus within its row and returns to its trigger
  on Escape.
- Menus become visible before taking focus. Restore the invoker before running
  an action, so a newly opened dialog inherits that focus and intentional action
  focus changes survive menu dismissal. Capture the invoker before menu focus
  and preserve it across StrictMode effect replay.
- Status popovers register both their trigger and portal as keyboard surfaces.
  Enter/Space opens details; Tab/Shift+Tab visits actions; Escape restores the
  trigger. Modified Tab remains owned by region navigation.
- DockablePanel owns local Tab order, including App Logs and Diagnostics.
  Consumers retain one roving tab stop and do not install competing walkers.
  Include the focused tab's action buttons in that order. From a pointer-focused
  read-only body, resume at the nearest preceding/following control in DOM order.
- Comboboxes keep DOM focus on the trigger or search field and expose the
  highlighted option through `aria-activedescendant`; popup options are not
  additional tab stops.
- Virtualized tables keep DOM focus on their native table element while shared
  state marks the active row, allowing native table semantics and row recycling
  without moving focus to an element that can unmount.
  Tab may enter links/buttons in the current keyed row; other rows' controls
  remain outside Tab order. Escape or removal of the focused control restores
  the table. Embedded controls retain their own Enter/Space actions.
- Manually added namespace removal is visible on row focus. Removing an entry
  restores the stable namespace selector; the inline Add editor restores its
  button on commit or cancellation.
- Keyboard shortcut help includes a navigation guide for tables, tab actions,
  status popovers, object maps, the sidebar and editor escape routes.
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
