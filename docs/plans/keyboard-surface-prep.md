# Keyboard Surface Pre-Implementation Prep

## Purpose

This document converts the design in `keyboard-surface.md` and the inventory in
`keyboard-surface-audit.md` into implementation-ready prep work.

Blocking modal work is intentionally split out into `docs/development/UI/modals.md`. That
foundation is now implemented for the main blocking modals. This document keeps the broader
keyboard-surface prep focused on what remains after that prerequisite.

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

| Current surface           | Proposed kind | Blocking | Trap focus | Notes                                                           |
| ------------------------- | ------------- | -------- | ---------- | --------------------------------------------------------------- |
| Settings modal            | `modal`       | Yes      | Yes        | On shared modal surface                                         |
| Log Settings modal        | `modal`       | Yes      | Yes        | On shared modal surface                                         |
| About modal               | `modal`       | Yes      | Yes        | On shared modal surface; contains ordinary links                |
| Object Diff modal         | `modal`       | Yes      | Yes        | On shared modal surface; contains nested dropdowns              |
| Favorites save/edit modal | `modal`       | Yes      | Yes        | On shared modal surface; contains dropdowns and text inputs     |
| Confirmation modal        | `modal`       | Yes      | Yes        | On shared modal surface; must support nesting over other modals |
| Scale modal               | `modal`       | Yes      | Yes        | On shared modal surface; still owns `Escape` locally            |
| Rollback modal            | `modal`       | Yes      | Yes        | On shared modal surface; still owns `Escape` locally            |
| Port forward modal        | `modal`       | Yes      | Yes        | On shared modal surface; still owns `Escape` locally            |
| Shortcut help modal       | `modal`       | Yes      | Yes        | Special case: also suppresses most other shortcuts              |

### Layered non-modal surfaces

These should sit above their parent surface but not necessarily inert the entire app.

| Current surface     | Proposed kind | Blocking    | Trap focus | Notes                               |
| ------------------- | ------------- | ----------- | ---------- | ----------------------------------- |
| Command palette     | `palette`     | Usually yes | Yes        | Must not open over a blocking modal |
| Dropdown menu/popup | `dropdown`    | No          | Local only | Owns arrows/enter/escape while open |
| Context menu        | `menu`        | No          | Local only | Portal-based menu surface           |

### Major regional surfaces

These define keyboard regions, but they do not block the rest of the app.

| Current surface               | Proposed kind | Blocking | Trap focus | Notes                                        |
| ----------------------------- | ------------- | -------- | ---------- | -------------------------------------------- |
| Object panel controls         | `panel`       | No       | No         | Owns panel-level `Tab` entry/cycling         |
| App logs panel                | `panel`       | No       | No         | Owns shortcuts plus region-level `Tab` rules |
| Diagnostics panel             | `panel`       | No       | No         | Same pattern as app logs                     |
| Port forwards panel           | `panel`       | No       | No         | Currently uses direct `Escape` listener      |
| Sidebar                       | `region`      | No       | No         | Has custom keyboard cursor semantics         |
| GridTable filters             | `region`      | No       | No         | Tab-entry region                             |
| GridTable body                | `region`      | No       | No         | Row navigation region                        |
| Kubeconfig selector container | `region`      | No       | No         | Small entry region for dropdown trigger      |

### Editor-owned surfaces

These are surfaces where an embedded editor or editor-like control should get first refusal.

| Current surface           | Proposed kind | Blocking | Trap focus | Notes                                        |
| ------------------------- | ------------- | -------- | ---------- | -------------------------------------------- |
| YAML tab editor           | `editor`      | No       | No         | CodeMirror plus app-level save/cancel/search |
| Helm manifest editor/view | `editor`      | No       | No         | Search/input plus CodeMirror behavior        |
| Helm values editor/view   | `editor`      | No       | No         | Search/input plus CodeMirror behavior        |

### Local-control contracts only

These should not become top-level surfaces. They should keep local keyboard behavior.

| Current control type                | Proposed treatment        | Notes                                                     |
| ----------------------------------- | ------------------------- | --------------------------------------------------------- |
| Text inputs with `Enter` commit     | Local field behavior      | Example: Log Settings, inline editors in Settings         |
| Inline editors with `Escape` cancel | Local field behavior      | Must still be able to stop propagation                    |
| Button-like spans/cards             | Local control behavior    | Example: grid/table cells, object links, pod-status cards |
| Tab strip items                     | Local widget behavior     | ARIA tablist contract                                     |
| Resize handles                      | Local affordance behavior | Must stay tabbable if currently focusable                 |

## Direct Listener Classification

These listeners currently bypass the shared shortcut system and need an explicit migration decision.

### Migrate into shared surface system

These should be removed after equivalent surface behavior exists.

| File                    | Current listener purpose                          | Migration target                                               |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `ScaleModal.tsx`        | `Escape` close                                    | Shared surface-owned modal dismissal                           |
| `RollbackModal.tsx`     | `Escape` close                                    | Shared surface-owned modal dismissal                           |
| `PortForwardModal.tsx`  | `Escape` close                                    | Shared surface-owned modal dismissal                           |
| `PortForwardsPanel.tsx` | `Escape` close                                    | Shared panel surface                                           |
| `ShortcutHelpModal.tsx` | `Escape` and `/` close                            | Shared modal surface, with explicit shortcut suppression rules |
| `SidebarKeys.ts`        | Arrow/home/end/enter/space/escape region behavior | Shared region surface API                                      |

### Keep as explicit exceptions

These are acceptable to leave outside the main routing model, but they must be documented.

| File            | Current listener purpose                      | Reason to keep out-of-band       |
| --------------- | --------------------------------------------- | -------------------------------- |
| `AppLayout.tsx` | Debug overlay toggles and debug state updates | Debug-only shell instrumentation |

### Shared infrastructure, not exceptions

These remain part of the core shared model.

| File                            | Current listener purpose   | Role                                    |
| ------------------------------- | -------------------------- | --------------------------------------- |
| `context.tsx`                   | Global shortcut dispatch   | Core keyboard dispatcher until replaced |
| `keyboardNavigationContext.tsx` | Shared `Tab` scope routing | To be subsumed into surface manager     |

## High-Risk Surface Contracts

These are the areas most likely to regress if the migration is too abstract or too broad. Their
target behavior should be treated as locked before implementation begins.

### Command palette contract

The command palette currently splits responsibility between:

- shared shortcut registration
- keyboard-navigation scope registration
- direct input `onKeyDown`

Target contract for the refactor:

- the palette surface owns navigation and dismissal keys while open
- the text input keeps only true text-field behavior
- the palette must continue to work while focus remains in the input
- the palette must not open while a blocking modal is active

Pre-implementation rule:

- do not migrate the command palette until the target ownership table for these keys is explicit:
  - `Cmd/Ctrl+Shift+P`
  - `ArrowUp`
  - `ArrowDown`
  - `PageUp`
  - `PageDown`
  - `Home`
  - `End`
  - `Enter`
  - `Escape`
  - `Cmd/Ctrl+A`

### Shortcut help modal contract

`ShortcutHelpModal` is not an ordinary modal migration target. It currently:

- disables the global keyboard provider while open
- uses a direct capture-phase listener
- intentionally suppresses most other shortcuts

Target contract for the refactor:

- it remains a blocking modal surface
- ordinary app shortcuts remain suppressed while it is open
- only its explicit close actions remain active
- it does not become a proving ground for the first generic modal-surface migration, because the
  shared modal baseline already exists and this component is behaviorally unusual

Pre-implementation rule:

- migrate `ShortcutHelpModal` after the surface manager exists and after command palette/menu
  routing is established
- treat it as a special-case migration with dedicated regression coverage

### Remaining direct `Escape` listeners

The remaining direct `Escape` paths are not equivalent and should not be removed in one batch.

| File                    | Current `Escape` meaning   | Migration note                                   |
| ----------------------- | -------------------------- | ------------------------------------------------ |
| `ScaleModal.tsx`        | cancel modal               | simple modal dismissal; good first conversion    |
| `RollbackModal.tsx`     | close modal                | nested-confirmation interaction must stay intact |
| `PortForwardModal.tsx`  | close modal unless loading | dismissal is state-dependent                     |
| `PortForwardsPanel.tsx` | close panel                | panel-level, not modal-level                     |
| `ShortcutHelpModal.tsx` | close help                 | special-case because it suppresses the provider  |

Pre-implementation rule:

- convert these one by one, in that order, instead of treating “remove document `Escape`
  listeners” as a single task

### Mixed-precedence scenarios

These are the cases most likely to expose bugs in the new routing model:

- logs surface shortcuts versus parsed-view GridTable behavior
- GridTable filter/body region transitions
- active search-target arbitration for `Cmd/Ctrl+F`
- editor surfaces versus app-level cancel/search

Pre-implementation rule:

- these scenarios must be called out explicitly in the migration notes for the slice that touches
  them
- do not rely on “the surface manager should probably make this work” as a test strategy

## Modal Dependency

The detailed blocking-modal contract now lives in `docs/development/UI/modals.md`.

That work is now complete for the main blocking modals and provides:

- true blocking modal rendering through `document.body`
- inert/background suppression
- focus lifecycle
- nested modal behavior
- root-based tabbable discovery instead of hand-maintained focus selectors

The broader keyboard-surface implementation can now start from that baseline.

## Native Accelerator Bridge

Current native menu events:

- `menu:close`
- `menu:copy`
- `menu:selectAll`

### Recommended bridge design

Native menu events should not all be treated the same way.

- `menu:close` should remain app-level window close behavior. In Wails' single-window model, that
  means quit the app rather than routing through modal/panel/palette ownership.
- `menu:copy` should ask the active surface to provide copy text, otherwise fall back to current
  selection logic.
- `menu:selectAll` should ask the active surface to handle select-all, otherwise fall back to
  current focused-element behavior.

### Recommended implementation shape

Add a small action bridge layer:

```ts
dispatchNativeAction('copy');
dispatchNativeAction('selectAll');
```

The surface manager resolves `copy` and `selectAll` against the active surface stack.

`menu:close` should stay outside that bridge and continue to be handled by the app shell/window
layer.

## Editor Ownership Boundaries

Editors must be able to reject app-level shortcuts while still allowing intentional app shortcuts.

### Recommended rules

- When an editor surface has focus, editor-local keymaps get first refusal.
- App-level shortcuts only run if the editor declines the event.
- Certain app shortcuts may still be intentionally allowed through:
  - save
  - cancel edit
  - focus search
- `Escape` should default to app-level cancel/search behavior, but the surface API should allow an
  explicit per-surface override for editor-first `Escape` when needed.

### Current editor-adjacent cases to preserve

- YAML tab:
  - editor-local behavior
  - `Cmd/Ctrl+S`
  - `Escape` to cancel edit
  - `Cmd/Ctrl+F` to focus tab search
- Helm manifest / values:
  - editor-local behavior
  - `Cmd/Ctrl+F` to focus search

### Escape policy

- Default: preserve current app behavior and keep app-level cancel/search as the first `Escape`
  action in these surfaces.
- Override: allow a specific editor surface to opt into editor-first `Escape` handling when it has
  a concrete need, such as editor-owned transient UI.

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
- Command palette input with navigation keys still focused in the input
- Native copy/select-all while a blocking modal is open
- Logs `Home` / `End` precedence over parsed table behavior
- Shortcut help modal suppresses unrelated shortcuts while open

### Editor scenarios

- YAML editor focused with save/cancel/search shortcuts
- Helm manifest search while editor/view has focus
- Helm values search while editor/view has focus

## Pre-Implementation Baseline Notes

These notes should exist before the first code slice lands.

### Command palette key ownership table

Create a short implementation note that lists, for each palette-relevant key, whether it belongs
to:

- the palette surface
- the palette input as a local field
- the app shell when the palette is closed

### Direct-listener replacement checklist

For each remaining direct listener, capture:

- current behavior
- owning surface after migration
- whether the behavior is unconditional or state-dependent
- the regression test that proves it still works

### Special-case migration note for shortcut help

Write a small implementation note for `ShortcutHelpModal` before touching it. At minimum it should
state:

- how shortcut suppression will work after provider disabling is removed or reduced
- which close keys remain active
- whether it still needs any out-of-band behavior

### First implementation slice

The safest first code slice after this prep is:

1. Build the shared surface manager and native action bridge.
2. Leave existing behavior in place behind adapters.
3. Migrate the simplest remaining direct `Escape` case first: `ScaleModal`.

Do not start with command palette or shortcut help.

## Proposed Migration Sequence

### Phase 0: Compatibility mapping review

Goal:

- verify the mapping tables in this document against the existing app behavior
- write the command palette ownership table
- write the direct-listener replacement checklist
- write the shortcut-help special-case note

Exit criteria:

- every current key owner has an assigned target surface strategy
- high-risk surfaces have an explicit migration contract

### Phase 0.5: Modal prerequisite

Completed. The shared modal foundation in `docs/development/UI/modals.md` now covers the main app
modals and is the baseline for the remaining keyboard work.

### Phase 1: Surface manager foundation

Build:

- active surface stack
- surface registration/unregistration
- key routing precedence
- native action bridge
- adapters that let current shortcut/context call sites coexist during migration

Do not migrate all call sites yet.

Exit criteria:

- foundation can coexist with current shortcut metadata model
- the first direct-listener migration can land without changing command palette behavior

### Phase 2: Layered popup surfaces

Migrate:

- command palette
- dropdown
- context menu
- shortcut help modal

Exit criteria:

- no duplicated input/global handling in command palette
- dropdown and menu ownership are explicit
- shortcut help suppression behavior is preserved intentionally

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
- remove obsolete pre-surface-manager keyboard helpers and any superseded legacy tab-scope glue
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
- command palette input keeps navigation behavior without duplicating the same logic in two layers
- shortcut help suppresses unrelated shortcuts while open
- each migrated direct `Escape` listener preserves its old state-dependent behavior
- YAML save/cancel shortcuts still work while editing
- `Cmd/Ctrl+F` still chooses the correct active target

## Questions Needing Your Input

No further product decisions are currently blocking implementation in this document.
