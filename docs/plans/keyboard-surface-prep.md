# Keyboard Surface Pre-Implementation Prep

## Purpose

This document converts the design in `keyboard-surface.md` and the inventory in
`keyboard-surface-audit.md` into implementation-ready prep work.

Blocking modal work is intentionally split out into `docs/development/UI/modals.md`. This document
keeps the broader keyboard-surface prep and references the modal documentation as a prerequisite.

It covers:

- surface mapping
- direct-listener classification
- modal contract
- native accelerator bridge
- editor ownership boundaries
- accessibility contracts
- compatibility scenarios
- migration sequence
- test matrix
- unresolved product/behavior decisions

## Completed Prep Work

- ✅ Inventory of current keyboard pathways in `keyboard-surface-audit.md`
- ✅ High-level replacement design in `keyboard-surface.md`
- ✅ Initial surface mapping and routing rules in this document
- ✅ Direct-listener migration plan in this document
- ✅ Modal, native accelerator, and editor contract proposals in this document
- ✅ Test matrix and rollout sequencing in this document

## Surface Mapping

This maps current keyboard owners to the proposed surface model.

### Blocking surfaces

These should own keyboard input first and prevent background focus escape.

| Current surface | Proposed kind | Blocking | Trap focus | Notes |
| --- | --- | --- | --- | --- |
| Settings modal | `modal` | Yes | Yes | Standard blocking modal |
| Log Settings modal | `modal` | Yes | Yes | Current production failure case |
| About modal | `modal` | Yes | Yes | Contains ordinary links |
| Object Diff modal | `modal` | Yes | Yes | Contains nested dropdowns |
| Favorites save/edit modal | `modal` | Yes | Yes | Contains dropdowns and text inputs |
| Confirmation modal | `modal` | Yes | Yes | Must support nesting over other modals |
| Scale modal | `modal` | Yes | Yes | Currently uses direct capture listener |
| Rollback modal | `modal` | Yes | Yes | Must support nested confirmation |
| Port forward modal | `modal` | Yes | Yes | Currently only handles `Escape` |
| Shortcut help modal | `modal` | Yes | Yes | Special case: also suppresses most other shortcuts |

### Layered non-modal surfaces

These should sit above their parent surface but not necessarily inert the entire app.

| Current surface | Proposed kind | Blocking | Trap focus | Notes |
| --- | --- | --- | --- | --- |
| Command palette | `palette` | Usually yes | Yes | Needs explicit decision on whether it may open over modals |
| Dropdown menu/popup | `dropdown` | No | Local only | Owns arrows/enter/escape while open |
| Context menu | `menu` | No | Local only | Portal-based menu surface |

### Major regional surfaces

These define keyboard regions, but they do not block the rest of the app.

| Current surface | Proposed kind | Blocking | Trap focus | Notes |
| --- | --- | --- | --- | --- |
| Object panel controls | `panel` | No | No | Owns panel-level `Tab` entry/cycling |
| App logs panel | `panel` | No | No | Owns shortcuts plus region-level `Tab` rules |
| Diagnostics panel | `panel` | No | No | Same pattern as app logs |
| Port forwards panel | `panel` | No | No | Currently uses direct `Escape` listener |
| Sidebar | `region` | No | No | Has custom keyboard cursor semantics |
| GridTable filters | `region` | No | No | Tab-entry region |
| GridTable body | `region` | No | No | Row navigation region |
| Kubeconfig selector container | `region` | No | No | Small entry region for dropdown trigger |

### Editor-owned surfaces

These are surfaces where an embedded editor or editor-like control should get first refusal.

| Current surface | Proposed kind | Blocking | Trap focus | Notes |
| --- | --- | --- | --- | --- |
| YAML tab editor | `editor` | No | No | CodeMirror plus app-level save/cancel/search |
| Helm manifest editor/view | `editor` | No | No | Search/input plus CodeMirror behavior |
| Helm values editor/view | `editor` | No | No | Search/input plus CodeMirror behavior |

### Local-control contracts only

These should not become top-level surfaces. They should keep local keyboard behavior.

| Current control type | Proposed treatment | Notes |
| --- | --- | --- |
| Text inputs with `Enter` commit | Local field behavior | Example: Log Settings, inline editors in Settings |
| Inline editors with `Escape` cancel | Local field behavior | Must still be able to stop propagation |
| Button-like spans/cards | Local control behavior | Example: grid/table cells, object links, pod-status cards |
| Tab strip items | Local widget behavior | ARIA tablist contract |
| Resize handles | Local affordance behavior | Must stay tabbable if currently focusable |

## Direct Listener Classification

These listeners currently bypass the shared shortcut system and need an explicit migration decision.

### Migrate into shared surface system

These should be removed after equivalent surface behavior exists.

| File | Current listener purpose | Migration target |
| --- | --- | --- |
| `ScaleModal.tsx` | `Escape`, `Tab` trap | Shared modal primitive |
| `RollbackModal.tsx` | `Escape`, `Tab` trap | Shared modal primitive |
| `PortForwardModal.tsx` | `Escape` close | Shared modal primitive |
| `PortForwardsPanel.tsx` | `Escape` close | Shared panel surface |
| `ShortcutHelpModal.tsx` | `Escape` and `/` close | Shared modal surface, with explicit shortcut suppression rules |
| `SidebarKeys.ts` | Arrow/home/end/enter/space/escape region behavior | Shared region surface API |

### Keep as explicit exceptions

These are acceptable to leave outside the main routing model, but they must be documented.

| File | Current listener purpose | Reason to keep out-of-band |
| --- | --- | --- |
| `AppLayout.tsx` | Debug overlay toggles and debug state updates | Debug-only shell instrumentation |

### Shared infrastructure, not exceptions

These remain part of the core shared model.

| File | Current listener purpose | Role |
| --- | --- | --- |
| `context.tsx` | Global shortcut dispatch | Core keyboard dispatcher until replaced |
| `keyboardNavigationContext.tsx` | Shared `Tab` scope routing | To be subsumed into surface manager |

## Modal Dependency

The detailed blocking-modal contract now lives in `docs/development/UI/modals.md`.

This keyboard-surface prep assumes modal-surface work will provide:

- true blocking modal rendering through `document.body`
- inert/background suppression
- focus lifecycle
- nested modal behavior
- replacement of selector-based modal traps and modal-specific key listeners

The broader keyboard-surface implementation should not begin until the modal plan is complete for
the main blocking modals.

## Native Accelerator Bridge

Current native menu events:

- `menu:close`
- `menu:copy`
- `menu:selectAll`

### Recommended bridge design

Native menu events should not bypass the active surface model. They should dispatch as explicit
surface actions:

- `menu:close` -> request close on the active closable surface, otherwise fall back to app-shell
  cluster-tab close behavior
- `menu:copy` -> ask the active surface to provide copy text, otherwise fall back to current
  selection logic
- `menu:selectAll` -> ask the active surface to handle select-all, otherwise fall back to current
  focused-element behavior

### Recommended implementation shape

Add a small action bridge layer:

```ts
dispatchNativeAction('close')
dispatchNativeAction('copy')
dispatchNativeAction('selectAll')
```

The surface manager resolves these against the active surface stack.

### Open question

- For `menu:close`, should blocking modals be closed first, or should native close continue to mean
  “close cluster tab / quit” regardless of modal state?

My recommendation:

- close the active blocking modal first
- if none exists, preserve current cluster-tab close behavior

## Editor Ownership Boundaries

Editors must be able to reject app-level shortcuts while still allowing intentional app shortcuts.

### Recommended rules

- When an editor surface has focus, editor-local keymaps get first refusal.
- App-level shortcuts only run if the editor declines the event.
- Certain app shortcuts may still be intentionally allowed through:
  - save
  - cancel edit
  - focus search

### Current editor-adjacent cases to preserve

- YAML tab:
  - editor-local behavior
  - `Cmd/Ctrl+S`
  - `Escape` to cancel edit
  - `Cmd/Ctrl+F` to focus tab search
- Helm manifest / values:
  - editor-local behavior
  - `Cmd/Ctrl+F` to focus search

### Open question

- Do you want app-level `Escape` inside an active editor to always prefer “cancel edit”, or should
  the editor ever be allowed to consume `Escape` first if it has its own internal state?

My recommendation:

- preserve current behavior and keep “cancel edit” as the first app-level `Escape` action in these
  surfaces

## Accessibility Contracts

The surface model should encode these widget expectations.

### Dialog

- `Escape` dismisses if dismissible
- focus moves into the dialog on open
- focus remains inside while open
- focus restores on close

### Menu

- arrow-key navigation
- `Enter` and `Space` activate
- `Escape` dismisses

### Tablist

- `ArrowLeft` / `ArrowRight`
- `Home` / `End`
- `Enter` / `Space` activate
- `Delete` / `Backspace` close tabs where supported

### Dropdown / combobox

- trigger can open/close
- arrows move highlight
- `Enter` / `Space` select
- searchable dropdown input keeps native typing behavior

### Grid/table region

- arrows/page/home/end move focus or selection
- `Enter` / `Space` open or activate focused row
- `Shift+F10` opens context menu where supported

### Button-like custom controls

- `Enter` and `Space` activate

## Platform And Input Method Rules

These are required implementation constraints.

### Modifier mapping

- preserve current macOS vs Windows/Linux modifier mapping
- do not bake physical-key assumptions into the high-level surface model

### Keyboard layout sensitivity

- shortcut logic that uses printable characters should continue to rely on `event.key`, not
  hard-coded US-layout scan assumptions, unless there is a specific reason otherwise

### IME / composition

- text-entry surfaces must not dispatch app shortcuts from composition events
- the surface manager should check composition state before handling text-oriented shortcuts

### Native editing

- copy/cut/paste/select-all/undo/redo and ordinary text editing must remain native by default in
  text-entry controls

## Compatibility Scenarios

These scenarios must be explicitly tested before the migration is considered safe.

### Blocking-surface scenarios

- Log Settings modal over app shell
- Confirmation modal over Favorites modal
- Confirmation modal over Rollback modal
- About modal with ordinary links in the content

### Layered-in-modal scenarios

- Dropdown inside Favorites modal
- Dropdown inside Object Diff modal
- Link and tooltip-adjacent controls inside modal content

### Region precedence scenarios

- GridTable filters <-> GridTable body `Tab` flow
- Logs parsed table inside the logs surface
- Object panel controls plus tab content body
- Diagnostics panel controls plus content body

### Cross-surface shortcut scenarios

- `Cmd/Ctrl+F` search target selection among multiple active search targets
- Command palette while a panel is active
- Native copy/select-all while a blocking modal is open
- Logs `Home` / `End` precedence over parsed table behavior

### Editor scenarios

- YAML editor focused with save/cancel/search shortcuts
- Helm manifest search while editor/view has focus
- Helm values search while editor/view has focus

## Proposed Migration Sequence

### Phase 0: Compatibility mapping review

Goal:

- verify the mapping tables in this document against the existing app behavior

Exit criteria:

- every current key owner has an assigned target surface strategy
- unresolved product decisions are answered

### Phase 0.5: Modal prerequisite

Implement the modal guidance in `docs/development/UI/modals.md` first.

At minimum, finish this for:

- Log Settings modal
- Settings modal
- About modal
- Confirmation modal

### Phase 1: Surface manager foundation

Build:

- active surface stack
- surface registration/unregistration
- key routing precedence
- native action bridge

Do not migrate all call sites yet.

Exit criteria:

- foundation can coexist with current shortcut metadata model

### Phase 2: Layered popup surfaces

Migrate:

- command palette
- dropdown
- context menu
- shortcut help modal

Exit criteria:

- no duplicated input/global handling in command palette
- dropdown and menu ownership are explicit

### Phase 3: Regional keyboard ownership

Migrate:

- GridTable filter/body regions
- sidebar
- object panel controls
- app logs panel
- diagnostics panel
- port-forwards panel

Exit criteria:

- direct region-level listeners are removed or reduced to narrow exceptions

### Phase 4: Editor integration

Migrate:

- YAML tab
- Helm manifest tab
- Helm values tab

Exit criteria:

- editor precedence is explicit
- app-level save/cancel/search still works correctly

### Phase 5: Cleanup

- remove dead helpers
- remove legacy modal traps
- remove redundant `data-allow-shortcuts` usage where the new system supersedes it
- document the final developer API

## Test Matrix

### Unit tests

- surface registration/unregistration order
- blocking vs non-blocking precedence
- nested surface precedence
- native action bridge resolution
- modal focus lifecycle
- inert/background toggling
- search target arbitration
- editor-surface precedence
- composition guard behavior where feasible

### Integration tests

- Log Settings modal traps focus against real content
- About modal includes links in the tab cycle correctly
- dropdown inside modal does not leak focus to the app shell
- command palette navigation works while input is focused
- context menu in a panel receives arrows/enter/escape correctly
- GridTable filter/body tab flow remains intact
- logs parsed table and logs shortcuts preserve intended precedence
- native copy/select-all target the correct active surface

### Regression tests

- `Tab` does not escape Log Settings modal
- adding a new link/button to modal content does not require manual trap tagging
- modal close restores focus sensibly
- YAML save/cancel shortcuts still work while editing
- `Cmd/Ctrl+F` still chooses the correct active target

## Questions Needing Your Input

These are the remaining decisions I cannot safely make unilaterally.

1. Should the command palette be allowed to open while a blocking modal is open?
Decision: no. Blocking modal should win.

2. For native `menu:close`, should the active blocking modal close first, or should it continue to
   mean “close cluster tab / quit” regardless of overlays?

My default recommendation:

- Close the active blocking modal first.

3. For YAML/Helm editor surfaces, should app-level `Escape` always preserve the current behavior of
   canceling edit/search first, or do you want editor-internal `Escape` handling to have priority
   if the editor introduces its own transient UI later?

My default recommendation:

- Preserve current app behavior and let cancel-edit/search win.
