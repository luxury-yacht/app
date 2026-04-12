# Keyboard Surface Audit

## Scope

This document audits the current production keyboard handling in `frontend/src`.

It includes:

- shared shortcut infrastructure
- shared `Tab` navigation infrastructure
- global shortcuts
- panels, modals, menus, dropdowns, and command palette
- local `onKeyDown` handlers on interactive controls

It excludes:

- test-only code
- mouse-only interactions

Audit method:

- searched for `useShortcut`, `useShortcuts`, `useKeyboardNavigationScope`
- searched for `onKeyDown`
- searched for direct `document` / `window` `keydown` listeners
- searched for `keyup` / `keypress` listeners

Result:

- many `keydown` pathways exist
- no production `keyup` or `keypress` handlers were found

## Shared Infrastructure

### `frontend/src/ui/shortcuts/context.tsx`

Mechanism:

- global shortcut registry
- merged `contextStack`
- one `document` `keydown` listener

Current behavior:

- calls the shared tab-navigation layer first
- suppresses bare-key shortcuts while typing in most inputs
- preserves standard edit commands like copy, paste, cut, select all
- dispatches the highest-priority matching registered shortcut
- also handles native menu copy/select-all events from Wails

Compatibility requirements:

- any new surface manager must preserve standard editing behavior in inputs
- shortcut matching still needs business context such as view, panel, tab, resource kind

### `frontend/src/ui/shortcuts/keyboardNavigationContext.tsx`

Mechanism:

- shared `Tab` scope registry
- ordered scopes with priorities
- fallback from one scope to the next

Current behavior:

- only handles `Tab`
- intentionally allows native `Tab` in inputs and elements inside `data-tab-native="true"`
- supports region entry and region-local tab routing

Compatibility requirements:

- region-entry behavior must remain available
- native tabbing exceptions must be explicitly preserved where intended
- blocking surfaces must be able to override this behavior

### `frontend/src/ui/shortcuts/hooks.ts`

Mechanism:

- `useShortcut`
- `useShortcuts`

Current behavior:

- registers shortcuts into the global registry
- supports convenience metadata such as `view`, `whenPanelOpen`, `whenTabActive`, `priority`

Compatibility requirements:

- existing declarative shortcut call sites should remain easy to express

### `frontend/src/ui/shortcuts/searchShortcutRegistry.ts`
### `frontend/src/ui/shortcuts/useSearchShortcutTarget.ts`
### `frontend/src/ui/shortcuts/components/SearchShortcutHandler.tsx`

Mechanism:

- registry of active search targets
- global `Cmd/Ctrl+F` shortcut

Current behavior:

- active search targets compete by priority and recency
- current production users:
  - GridTable filters
  - YAML tab
  - Helm manifest tab
  - Helm values tab
  - log viewer filter

Compatibility requirements:

- the new system must preserve active-search redirection
- modal or surface ownership must not break `Cmd/Ctrl+F`

## Global And App Shell

### `frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx`

Mechanism:

- shared shortcuts via `useShortcut`
- updates base keyboard context with `setContext`
- handles native `menu:close` Wails event

Current shortcuts:

- `Shift+?`: open shortcut help
- `Cmd/Ctrl+B`: toggle sidebar
- `Ctrl+Shift+L`: toggle logs panel
- `Cmd/Ctrl+,`: toggle settings
- `Cmd/Ctrl+D`: toggle object diff viewer
- `Cmd/Ctrl+R`: refresh current view
- `Ctrl+Shift+D`: toggle diagnostics panel
- `Cmd/Ctrl+=`: zoom in
- `Cmd/Ctrl+-`: zoom out
- `Cmd/Ctrl+0`: reset zoom
- `Cmd+Alt+Left` or `Ctrl+Alt+Left`: previous cluster tab
- `Cmd+Alt+Right` or `Ctrl+Alt+Right`: next cluster tab
- `Escape`: close overlay or panel by current app-level priority rules

Compatibility requirements:

- app-shell shortcuts must continue to work when no higher-priority blocking surface owns the event
- native menu close behavior must still close cluster tabs or quit appropriately

### `frontend/src/ui/layout/AppLayout.tsx`

Mechanism:

- direct `window` `keydown` listeners

Current behavior:

- `Ctrl+Alt+P`: toggle panel debug overlay
- `Ctrl+Alt+K`: toggle keyboard focus overlay
- `Ctrl+Alt+E`: toggle error overlay
- additional `window` `keydown` listeners update debug overlay state

Compatibility requirements:

- debug-only listeners can remain out-of-band if documented
- they should not interfere with production surface ownership

## Layered Surfaces

### `frontend/src/ui/command-palette/CommandPalette.tsx`

Mechanisms:

- pushes shortcut context when open
- registers a keyboard navigation scope
- registers shared shortcuts while open
- also handles keys directly on the input
- closes on outside click

Current shortcuts:

- `Cmd/Ctrl+Shift+P`: open command palette
- while open:
  - `ArrowDown`
  - `ArrowUp`
  - `PageDown`
  - `PageUp`
  - `Home`
  - `End`
  - `Enter`
  - `Escape`

Current local input behavior:

- duplicates the same navigation keys on the search input
- `Cmd/Ctrl+A` selects the input text

Compatibility requirements:

- this is a top-level owned surface
- it must work while focus is in its input
- it must not require duplicate local and global handling after the refactor

### `frontend/src/shared/components/dropdowns/Dropdown/Dropdown.tsx`

Mechanisms:

- pushes shortcut context while focused or open
- shared shortcuts while focused or open
- local `onKeyDown` on dropdown trigger
- uses `data-allow-shortcuts="true"` to opt into shortcut handling around interactive controls

Current shortcuts while focused/open:

- `ArrowDown`
- `ArrowUp`
- `Home`
- `End`
- `Enter`
- `Space`
- `Escape`

Current local behavior:

- trigger handles open/close/navigation locally
- searchable dropdown search input remains a real text input

Compatibility requirements:

- dropdowns are layered surfaces, especially inside modals
- they must continue to own arrows/enter/escape when focused or open
- their text input must preserve native text editing

### `frontend/src/shared/components/ContextMenu.tsx`

Mechanisms:

- pushes context
- shared `Escape` shortcut
- local `onKeyDown` on the menu root
- rendered through `createPortal`

Current keys:

- `Escape`: close
- `ArrowDown`: move focus
- `ArrowUp`: move focus
- `Enter`: activate focused item
- `Space`: activate focused item

Compatibility requirements:

- context menus should become menu surfaces
- they need stronger integration with layered surface ownership

## Modals

### Shared modal trap

`frontend/src/shared/components/modals/useModalFocusTrap.ts`

Mechanism:

- wraps `useKeyboardNavigationScope`
- relies on a caller-provided `focusableSelector`

Current behavior:

- only influences shared `Tab` scope behavior
- does not provide a full modal focus trap

Compatibility requirements:

- this is not sufficient as the long-term modal implementation

### `frontend/src/ui/modals/SettingsModal.tsx`

Mechanisms:

- pushes context
- shared `Escape`
- local `useKeyboardNavigationScope`

Current behavior:

- `Escape` closes modal
- `Tab` cycles only among `[data-settings-focusable="true"]`

Compatibility requirements:

- currently selector-based
- must become a true modal surface

### `frontend/src/ui/modals/LogSettingsModal.tsx`

Mechanisms:

- pushes context
- shared `Escape`
- `useModalFocusTrap`
- rendered through `createPortal(document.body)`

Current behavior:

- `Escape` closes modal
- `Tab` depends on `[data-log-settings-focusable="true"]`

Compatibility requirements:

- this is the current failing case
- must become a true blocking modal with inert background and root-based tabbable discovery

### `frontend/src/ui/modals/AboutModal.tsx`

Mechanisms:

- pushes context
- shared `Escape`
- `useModalFocusTrap`

Current behavior:

- `Escape` closes modal
- `Tab` only knows about `[data-about-focusable="true"]`
- the modal also contains ordinary links

Compatibility requirements:

- proves selector-based trapping is incomplete even outside Log Settings

### `frontend/src/ui/modals/ObjectDiffModal.tsx`

Mechanisms:

- pushes context
- shared `Escape`
- `useModalFocusTrap`

Current behavior:

- `Escape` closes modal
- `Tab` uses broad selector `.dropdown-trigger, button, input`

Compatibility requirements:

- must work with dropdowns inside the modal
- must continue to support nested layered surfaces

### `frontend/src/ui/favorites/FavSaveModal.tsx`

Mechanisms:

- pushes context
- shared `Escape`
- `useModalFocusTrap`
- rendered through `createPortal`
- local input `onKeyDown`

Current behavior:

- `Escape` closes modal unless nested delete confirmation is open
- text inputs support `Cmd/Ctrl+A` select-all

Compatibility requirements:

- modal ownership must coexist with dropdowns and form inputs

### `frontend/src/shared/components/modals/ConfirmationModal.tsx`

Mechanisms:

- pushes context
- shared `Escape`
- `useModalFocusTrap`
- rendered through `createPortal`

Current behavior:

- `Escape` cancels dialog

Compatibility requirements:

- must support nested modal scenarios

### `frontend/src/shared/components/modals/ScaleModal.tsx`

Mechanisms:

- direct capture-phase `document` `keydown` listener
- local input `onKeyDown`

Current behavior:

- `Escape`: cancel
- `Tab`: cycles input -> Cancel -> Scale
- input `Enter`: apply if value changed

Compatibility requirements:

- currently bypasses the shared keyboard system
- should move onto the shared modal primitive

### `frontend/src/shared/components/modals/RollbackModal.tsx`

Mechanisms:

- direct capture-phase `document` `keydown` listener
- nested `ConfirmationModal`

Current behavior:

- `Escape`: close
- `Tab`: cycles buttons and inputs within modal

Compatibility requirements:

- must support nesting with confirmation modal

### `frontend/src/modules/port-forward/PortForwardModal.tsx`

Mechanism:

- direct `document` `keydown` listener

Current behavior:

- `Escape`: close, unless loading prevents it

Compatibility requirements:

- currently not integrated with shared modal ownership

### `frontend/src/ui/shortcuts/components/ShortcutHelpModal.tsx`

Mechanisms:

- disables the global keyboard provider while open
- direct capture-phase `document` `keydown` listener

Current behavior:

- `Escape`: close
- `/`: close

Compatibility requirements:

- this is effectively its own modal subsystem today
- should be migrated carefully because it intentionally disables other shortcuts

## Docked Panels And Regions

### `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.ts`

Mechanism:

- shared shortcuts

Current keys:

- `Escape`: close object panel
- `1` through `9`: switch visible object-panel tabs

Compatibility requirements:

- numeric tab switching must remain bound to visible tab order

### `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx`

Mechanism:

- shared `Tab` scope for panel-level controls

Current behavior:

- panel-level `Tab` entry and cycling among `[data-object-panel-focusable="true"]`
- native tab allowed in `.object-panel-body *`

Compatibility requirements:

- panel-level controls and body content need distinct focus behavior

### `frontend/src/ui/panels/app-logs/AppLogsPanel.tsx`

Mechanisms:

- shared shortcuts
- shared `Tab` scope

Current keys:

- `Escape`: close panel
- `s`: toggle auto-scroll
- `Shift+C`: clear logs

Current tab behavior:

- panel scope can enter filter controls or log container
- native tab allowed inside `.app-logs-panel-controls *`

Compatibility requirements:

- app logs panel is a region, not a blocking surface

### `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`

Mechanisms:

- shared `Escape`
- shared `Tab` scope

Current keys:

- `Escape`: close diagnostics panel

Current tab behavior:

- cycles among `[data-diagnostics-focusable="true"]`
- native tab allowed inside `.diagnostics-content *`

Compatibility requirements:

- same panel-region pattern as app logs

### `frontend/src/modules/port-forward/PortForwardsPanel.tsx`

Mechanism:

- direct `document` `keydown` listener

Current keys:

- `Escape`: close panel

Compatibility requirements:

- currently bypasses shared panel ownership

## Tables, Sidebar, And List Navigation

### `frontend/src/shared/components/tables/hooks/useGridTableShortcuts.ts`

Mechanisms:

- pushes shortcut context while active
- shared shortcuts

Current keys:

- `ArrowDown`
- `ArrowUp`
- `PageDown`
- `PageUp`
- `Home`
- `End`
- `Enter`
- `Space`
- `Shift+F10`

Current behavior:

- row navigation and open focused row
- opens row context menu with `Shift+F10`
- suppresses hover while keyboard navigation or context menu is active

Compatibility requirements:

- grid tables are a major keyboard region and must retain row navigation semantics

### `frontend/src/shared/components/tables/GridTableKeys.ts`

Mechanism:

- shared `Tab` scopes for filter bar and table body

Current behavior:

- separate filter-bar and table-body `Tab` regions
- explicit region entry/exit behavior between filters and table body

Compatibility requirements:

- this is one of the most important non-modal focus patterns to preserve

### `frontend/src/shared/components/tables/GridTableFiltersBar.tsx`

Mechanisms:

- local search-input `onKeyDown`
- active search shortcut target

Current keys:

- `Cmd/Ctrl+A` in search input selects text
- `Cmd/Ctrl+F` can focus this input when its target is active

Compatibility requirements:

- search routing and local text behavior must stay intact

### `frontend/src/ui/layout/SidebarKeys.ts`

Mechanisms:

- shared `Tab` scope
- direct container `keydown` listener

Current keys while sidebar focus is active:

- `ArrowDown`
- `ArrowUp`
- `Home`
- `End`
- `Enter`
- `Space`
- `Escape`

Current behavior:

- maintains keyboard preview/cursor state
- activates clicked item on `Enter` or `Space`
- `Escape` clears preview and refocuses current selection

Compatibility requirements:

- sidebar is a rich keyboard region with its own cursor semantics

### `frontend/src/shared/components/KubeconfigSelector.tsx`

Mechanism:

- shared `Tab` scope

Current behavior:

- on `Tab` entry, focuses the dropdown trigger

Compatibility requirements:

- small but important example of region-entry behavior

## Object Panel Content Tabs

### `frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabData.tsx`

Mechanism:

- shared shortcut

Current key:

- `s`: toggle encode/decode when viewing secret data

Compatibility requirements:

- object-panel content shortcuts still need to work without colliding with app-level keys

### `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx`

Mechanisms:

- shared shortcuts
- active search shortcut target
- local search input `onKeyDown`
- CodeMirror keymap extensions exist in this file as editor-local behavior

Current shared keys:

- `m`: toggle managedFields
- `Cmd+S`: save edits
- `Ctrl+S`: save edits
- `Escape`: cancel YAML edit

Current local search keys:

- `Cmd/Ctrl+A`: select search text
- `Enter`: find next
- `Shift+Enter`: find previous
- `Escape`: blur search and return focus to editor
- `Cmd/Ctrl+F`: via search shortcut target, focus the search input

Compatibility requirements:

- must preserve the distinction between editor-local keys, tab-level shortcuts, and search-input keys

### `frontend/src/modules/object-panel/components/ObjectPanel/Helm/ManifestTab.tsx`

Mechanisms:

- active search shortcut target
- local search input `onKeyDown`

Current local search keys:

- `Cmd/Ctrl+A`
- `Enter`
- `Shift+Enter`
- `Escape`
- `Cmd/Ctrl+F` via search shortcut target

Compatibility requirements:

- same search behavior as YAML tab

### `frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.tsx`

Mechanisms:

- active search shortcut target
- local search input `onKeyDown`

Current local search keys:

- `Cmd/Ctrl+A`
- `Enter`
- `Shift+Enter`
- `Escape`
- `Cmd/Ctrl+F` via search shortcut target

Compatibility requirements:

- same search behavior as YAML tab

### `frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogKeyboardShortcuts.ts`

Mechanisms:

- shared shortcuts
- active search shortcut target

Current keys:

- `r`: toggle auto-refresh
- `t`: toggle API timestamps
- `v`: toggle previous logs
- `h`: toggle match highlighting
- `i`: toggle inverse filtering
- `x`: toggle regex filtering
- `c`: toggle case-sensitive matching when regex is off
- `p`: toggle parsed/raw mode
- `o`: toggle ANSI colors
- `Shift+C`: copy logs
- `j`: toggle pretty JSON
- `w`: toggle wrap text
- `Home`: scroll to top
- `End`: scroll to bottom
- `Cmd/Ctrl+F`: via search shortcut target, focus filter input

Compatibility requirements:

- logs currently depend on explicit priority over GridTable for `Home` / `End`
- logs are a key compatibility hotspot because they overlap with parsed table mode

### `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogSettings.tsx`

Mechanism:

- local form-field `onKeyDown`

Current field behavior:

- numeric/text fields use `Enter` to blur and commit

Compatibility requirements:

- field-local commit behavior should remain local, not be absorbed into the global surface layer

## Local Control Handlers

These are not shared shortcuts, but they are real keyboard behavior that must remain correct.

### `frontend/src/modules/cluster/components/ClusterOverview.tsx`

Current behavior:

- clickable pod-status cards support keyboard activation through local `onKeyDown`
- key behavior is tied to button-like cards

### `frontend/src/shared/components/ObjectPanelLink.tsx`

Current behavior:

- `Enter` or `Space`: activate
- `Alt+Enter` or `Alt+Space`: alternate navigation behavior

### `frontend/src/shared/components/tables/columnFactories.tsx`

Current behavior:

- interactive text/kind cells use `Enter` or `Space`
- `Alt+Enter` or `Alt+Space` may trigger alternate navigation

### `frontend/src/shared/components/tabs/Tabs.tsx`

Current behavior:

- `ArrowRight`
- `ArrowLeft`
- `Home`
- `End`
- `Enter`
- `Space`
- `Delete`
- `Backspace`

This is the tab-strip roving/tab-activation behavior.

### `frontend/src/ui/settings/Settings.tsx`

Current behavior:

- many inline-edit fields use:
  - `Enter`: commit
  - `Escape`: cancel
  - `stopPropagation()` on other keys to prevent leaking into higher-level shortcuts

This is important because Settings intentionally contains many transient inline editors.

### `frontend/src/ui/favorites/FavSaveModal.tsx`

Current behavior:

- text fields use `Cmd/Ctrl+A` to select contents

### `frontend/src/shared/components/inputs/SearchInput.tsx`

Current behavior:

- does not define keyboard behavior itself
- simply forwards `onKeyDown`

## Current Architecture Risks

These are the highest-risk compatibility points for the proposed keyboard-surface refactor.

### Modal containment is currently fragmented

The app mixes:

- shared modal trap
- selector-based focus sets
- direct document listeners
- portal and non-portal modal rendering

Any migration must normalize this without breaking:

- nested confirmation modals
- dropdowns inside modals
- text inputs inside modals

### Search routing is cross-cutting

`Cmd/Ctrl+F` is not a simple global shortcut. It resolves to the best active search target.

Any new surface system must preserve:

- target priority
- recency tie-breaking
- surface-aware activation

### GridTable and log viewer have overlapping ownership

Logs parsed view can contain a GridTable while also defining its own `Home` / `End` behavior.

This is a real precedence case that must be preserved intentionally.

### Command palette currently duplicates handling

The palette works today because it handles keys both:

- as shared shortcuts
- directly on the input

The new system must remove duplication without regressing input-focused behavior.

### Settings has many inline editors that intentionally stop propagation

This is a real compatibility requirement, not cleanup noise.

Any future implementation must preserve the ability for local inline editors to keep in-progress
edits from leaking into global shortcuts.

## Compatibility Checklist For The New Design

Before implementing the keyboard-surface design, the new system must be able to preserve all of
the following:

- global shell shortcuts
- active-search redirection for `Cmd/Ctrl+F`
- GridTable row navigation
- GridTable filter/body tab-region transitions
- object-panel numeric tab switching
- log-viewer shortcuts and log scroll precedence
- command palette open/navigation/activation while input is focused
- dropdown navigation while searchable inputs still behave like inputs
- context-menu arrow navigation and activation
- sidebar cursor navigation semantics
- YAML/Helm search-box behavior
- field-local commit/cancel handlers in Settings and Log Settings
- nested modal behavior
- debug-only app-shell shortcuts that intentionally bypass normal ownership

## Recommendation

The proposed design in `keyboard-surface.md` is still the right direction, but this audit confirms
that the implementation must be compatibility-driven.

The safest order is:

1. build the surface manager
2. implement the shared blocking modal primitive
3. migrate command palette, dropdown, and context menu
4. migrate region-level tab routing
5. remove direct document listeners only after equivalent coverage exists
