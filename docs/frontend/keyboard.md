# Keyboard Contract

Active surfaces and registered shortcuts own keyboard behavior. Do not add
global document/window listeners for ordinary app behavior.

## Ownership Model

- Global commands register through the shortcut system, surface ownership
  through the surface APIs; local `onKeyDown` is only for field/editor-local
  behavior.
- Surface kinds: `modal`, `palette`, `menu`, `dropdown`, `panel`, `region`,
  `editor`. Register one whenever a component needs key ownership.
- Except for region commands, the active surface handles a key first, then
  registered global shortcuts, else native behavior. Blocking surfaces
  (modals, command palette) own keys before the rest of the app.
- Preserve native text editing in inputs and editors.
- `Tab` is local navigation inside the active surface; cross-surface movement
  uses app-level shortcuts.

Owners: `frontend/src/ui/shortcuts/{context.tsx,surfaces.ts,hooks.ts}`
(provider/dispatch, surfaces, hooks); modal focus trap in
`frontend/src/shared/components/modals` ([modals.md](modals.md)); editors in
[yaml-editor.md](yaml-editor.md).

## Region Navigation

- `Tab`/`Shift+Tab` explicitly focus the next/previous control in the current
  app region and wrap, so order holds where native webview preferences would
  skip buttons. Sidebar entries stay an arrow-navigated group; Tab leaves it
  for the sidebar's other controls, whose Enter/Space run their own action.
  List keys apply only while focus is in the list.
- `Ctrl+Tab`/`Ctrl+Shift+Tab` cycle header (with cluster tabs), visible sidebar
  (with resize handle), main content, visible dockable panels, then visible
  error notifications. Control is literal on macOS (no Command substitution);
  Alt/Command+Tab are unclaimed.
- Re-entering a region restores its last available control, discarding hidden,
  disabled, inert, and disconnected targets. An empty content region can take
  focus itself. Focusing a panel raises it without selecting another tab.
  Sidebar entry restores a list item or the active item, never the collapse
  button or another utility.
- KeyboardProvider normalizes clicked button/tab focus before activation so
  WebKit pointer behavior cannot leave the next key in the old region. Its
  shared focus observer runs before local capture handlers and clears keyboard
  indication on pointer use and provider cleanup.
- `frontend/styles/utilities/focus.css` owns the keyboard background highlight,
  including programmatic focus after pointer use. Editable fields need the
  shared keyboard marker so clicking does not tint them; typing clears it until
  the next keyboard focus move. Dropdown/context-menu backgrounds and option
  colors, YAML editors, and log output are excluded. Forced-color mode keeps a
  system outline.
- The first Tab after pointer use and each region change briefly outline the
  destination region. `ui/shortcuts/regionFocusIndicator.ts` waits for the
  final focus target, accounts for app zoom, and cleans up frames and overlays.
  Never change region layout or overflow to show the cue.
- `data-tab-native="true"` surfaces (shell terminals) keep ordinary Tab;
  Control+Tab leaves them. Blocking dialogs and the palette keep region
  commands inside themselves.
- A focused tab strip moves its cursor with Left/Right and selects with Enter.
  Region navigation never changes cluster, object, or view selection.
- Workspace and native panel windows mount the same registrations, listed in
  shortcut help.

Implementation: `ui/layout/{appFocusRegions.ts,AppRegionNavigation.tsx,AppLayout.tsx}`,
`PanelWindowApp.tsx`, `ui/shortcuts/context.tsx`. Regression tests:
`appFocusRegions`, `DockablePanel`, `GridTable.keyboard`,
`CommandPalette.keyboard`, `useModalFocusTrap` (`*.test.tsx`).

## Rules By Surface

- Modals trap focus and own `Escape` unless explicitly delegated; the palette
  owns its navigation while open.
- Dropdowns, menus, table rows, and tab strips own list keys while the
  list/combobox has focus; child action buttons keep their Enter/Space.
- Searchable dropdowns give search, Select all, Select none, and the list
  separate Tab stops. The list uses roving focus; row actions are Tab-reachable.
  Tab/Shift+Tab wraps in the open popup; Escape closes it and restores the
  trigger. Closing or disabling a focused action first restores a usable
  target. Control+Tab finds the originating region via shared portal ownership.
- Dropdown arrows move the highlight from search, the active list control, or
  its Only button (Only keeps its Enter/Space). Listboxes expose virtual focus
  via `aria-activedescendant`; popups with row action buttons use dialog
  semantics. Focus recovery stays in shared `Dropdown`.
- Context-menu Tab/Shift+Tab and Escape return focus to the invoker. Favorites
  reveals row actions on focus-within and returns to its trigger on Escape.
- Menus become visible before taking focus. Restore the invoker before running
  an action so a new dialog inherits focus and intentional focus changes
  survive dismissal; capture the invoker before menu focus and keep it across
  StrictMode effect replay. Long context menus scroll within the zoom-adjusted
  viewport, keeping the highlight visible.
- Status popovers register trigger and portal as surfaces: Enter/Space opens
  details, Tab/Shift+Tab visits actions, Escape restores the trigger, modified
  Tab stays with region navigation.
- Pointer focus in a hover popover never pins it open; keyboard entry does.
  Pointer dismissal restores the trigger before removing a focused action.
- DockablePanel owns local Tab order (including App Logs, Diagnostics, and the
  focused tab's action buttons); consumers keep one roving tab stop and no
  competing walkers. From a pointer-focused read-only body, resume at the
  nearest preceding/following control in DOM order.
- Virtualized tables keep DOM focus on the native table element while shared
  state marks the active row, so recycling never unmounts focus. Tab enters
  only the current keyed row's links/buttons; Escape, or the focused control
  disappearing or becoming unavailable, restores the table; embedded controls
  keep Enter/Space independent of row activation.
- Panels and table regions own focused keys without blocking the whole app.
- Manually added namespace removal shows on row focus; removal restores the
  stable namespace selector; the inline Add editor restores its button on
  commit or cancel.
- Shortcut help derives categories, rows, and labels from registrations via
  `ui/shortcuts/shortcutHelp.ts`; same-description registrations in a category
  share one row. `?` and `/` close help except in its filter field (they type);
  Escape always closes.
- Adjustable separators handle the relevant arrows and Home/End and publish
  current/min/max values.
- Editors may own editor keys; app-level `Escape` wins unless the editor has a
  documented transient UI reason. An unsaved YAML draft or in-flight mutation
  may reject a tab/group/window close, focusing the first deterministic blocker.

## Application Menu and Windows

- Native macOS and app-rendered Windows/Linux menus label `Cmd/Ctrl+W`
  `Close`; the focused window role decides what closes. Workspace: the active
  cluster tab via `KubeconfigContext`, or the workspace without tabs. Panel
  window: guards then closes the active object tab; the last tab closes the
  window. The panel titlebar closes the whole group through the same guards.
- The app-rendered workspace menu is a `menu` surface owning arrows, Enter,
  Space, and Escape while open; it restores prior content focus before a
  command and shares the renderer command owner with its accelerators. Only
  process-wide and native-window work crosses to the backend.
- `ApplicationMenuShortcuts` is the single Windows/Linux accelerator owner for
  workspace and panel windows. On macOS its registrations appear in help but
  are dispatch-disabled (the native menu owns them). A panel keeps dispatch
  disabled until the native panel acknowledges readiness.
- Menu accelerators get the active surface's first chance, then may cross
  `suppressShortcuts`. They never implicitly dismiss a palette, modal,
  dropdown, or context menu; a reacting surface receives the typed command
  identity. The app-rendered menu closes itself before its own accelerator
  runs. Ordinary shortcuts stay suppressed; cut/copy/paste/select-all stay
  native editing.
- Panel windows mount `PanelWindowShortcuts`, not `GlobalShortcuts`. Close,
  zoom, inspector, and window commands run in the child renderer; workspace
  commands (Settings, About, Open Cluster, sidebar, diagnostics, object diff,
  Application Logs) focus the immutable owner and route through the backend's
  authenticated native-window descriptor.

## Validation Gaps

For a key change, test ownership, fallback, cleanup, native editing, and
modal/palette/menu layering wherever the key can fire; verify focus changes
manually. Recorded checks cover macOS native and
accessibility-tree behavior only; Windows/Linux Control+Tab delivery and
spoken VoiceOver/NVDA output are unverified, and accessibility-tree exposure or
automated key dispatch does not prove them.
