# Keyboard Surface Design

## Overview

The app currently handles keyboard input through multiple overlapping systems:

- global shortcut dispatch in `frontend/src/ui/shortcuts/context.tsx`
- local component `onKeyDown` handlers
- direct `document` and `window` key listeners in several components

This works for some simple cases, but it is not stable enough for modal behavior, layered UI
surfaces, or predictable developer ergonomics.

The blocking-modal prerequisite documented in `docs/development/UI/modals.md` is now complete for
the main app modals. This plan starts from that new baseline instead of treating modal correctness
as future work.

The goal of this design is to define a single keyboard surface model that is:

- stable and production-ready
- explicit about ownership of keyboard input
- easy for developers to apply consistently
- correct for modals, command palette, menus, panels, tables, and form controls

## Current Status

Completed foundation and early migrations:

- ✅ Shared modal baseline in `docs/development/UI/modals.md`
- ✅ Shared keyboard surface manager and native action bridge
- ✅ Direct `Escape` listener migrations for:
  - `ScaleModal`
  - `RollbackModal`
  - `PortForwardModal`
  - `PortForwardsPanel`
- ✅ `ShortcutHelpModal` migrated onto the shared surface model
- ✅ `CommandPalette` migrated to the shared surface model and blocked by active blocking modals
- ✅ `ContextMenu` migrated to the shared surface model
- ✅ `Dropdown` migrated to the shared surface model
- ✅ Regional/panel migrations for:
  - `GridTable` filter/body `Tab` transitions
  - `AppLogsPanel`
  - `DiagnosticsPanel`
  - `ObjectPanel`
  - `SidebarKeys`
- ✅ Redundant tab-scope cleanup for `KubeconfigSelector`
- ✅ Editor-surface integration for:
  - YAML tab
  - Helm manifest tab
  - Helm values tab
- ✅ Nested-surface routing now prefers the deepest containing surface over its parent region/modal
- ✅ Runtime shortcut dispatch no longer depends on `KeyboardNavigationProvider`
- ✅ `useKeyboardNavigationScope` is no longer exported from the active shortcut barrel
- ✅ Legacy tab-scope implementation removed
- ✅ Blocking modals now rely on the shared modal surface for blocking and `Escape` ownership
  instead of duplicating that behavior through modal-local shortcut context wiring

Still remaining:

- broader cleanup/reduction of remaining legacy shortcut-context helpers where appropriate

## Execution Reference

This section replaces the old prep doc and is the implementation source of truth alongside the
design and migration phases below.

### Runtime Surface Mapping

Blocking surfaces:

- `modal`
  - Settings modal
  - Log Settings modal
  - About modal
  - Object Diff modal
  - Favorites save/edit modal
  - Confirmation modal
  - Scale modal
  - Rollback modal
  - Port forward modal
  - Shortcut help modal

Layered non-modal surfaces:

- `palette`
  - Command palette
- `dropdown`
  - dropdown menus/popovers
- `menu`
  - context menus

Regional and panel surfaces:

- `panel`
  - Object panel controls
  - App logs panel
  - Diagnostics panel
  - Port forwards panel
- `region`
  - Sidebar
  - GridTable filters
  - GridTable body
- legacy regional cleanup already completed
  - Kubeconfig selector no longer needs its old entry scope

Editor-owned surfaces:

- `editor`
  - YAML tab
  - Helm manifest tab
  - Helm values tab

### Remaining Legacy Pathways

Production `useKeyboardNavigationScope` usage still remaining:

- none

Legacy keyboard infrastructure still present:

- shortcut context metadata in `context.tsx`
  - still coexists with the surface manager for business eligibility

Intentional out-of-band listeners still remaining:

- `AppLayout.tsx`
  - debug overlay toggles and debug state updates only

### Safe Next Work

Next implementation slice:

- continue cleanup/reduction of legacy shortcut-context helpers where the surface manager now owns
  the behavior

After that:

- continue broader cleanup/reduction of legacy helpers around shortcut contexts where appropriate

### Key Rules For Remaining Work

- Keep app-level `Escape` as the default in editor surfaces, with explicit per-surface override
  when an editor needs editor-first `Escape`.
- Keep `menu:close` as an app/window close action, not a surface-routed close.
- Blocking modals continue to block the command palette.

## Current Problems

### The old split keyboard model created long-lived complexity

The app used to have one shared system for shortcuts and a separate shared system for `Tab`
navigation.

- `frontend/src/ui/shortcuts/context.tsx` handled shortcut registration and dispatch
- `frontend/src/ui/shortcuts/keyboardNavigationContext.tsx` handled `Tab` scope navigation

That split model is now retired from production runtime, but it is important context for why some
tests and compatibility layers still carry legacy assumptions.

### Context is not the same thing as active surface ownership

The current shortcut system uses a merged `contextStack` to decide which shortcuts apply.

That is useful for business context such as:

- current view
- current panel
- current tab
- resource kind

But it is not a reliable way to model topmost interactive surfaces such as:

- a modal over the app
- the command palette over a modal
- a context menu inside a panel
- a dropdown inside a modal

These are surface-ownership problems, not metadata-merging problems.

### The app still has overlapping ownership models even after the modal rewrite

The modal rewrite removed the biggest focus-containment problems, but the broader keyboard
architecture is still split across multiple ownership models:

- shortcut contexts
- local `onKeyDown`
- a small number of direct document listeners in non-surface infrastructure

Modal rendering, focus containment, and inert background behavior are intentionally documented in
`docs/development/UI/modals.md`. This plan picks up after that work and focuses on unified key
routing and surface ownership.

### The app still carries legacy shortcut-context overlap

Several runtime surfaces have already been migrated to the shared surface model, but the app still
has overlapping ownership between:

- business-eligibility shortcut contexts in `context.tsx`
- local component `onKeyDown` handlers for field- and surface-local behavior
- a small amount of out-of-band keyboard/debug infrastructure

The remaining work is to reduce that overlap where the surface manager already owns the runtime
behavior, without breaking legitimate business-context filtering.

### Developers currently need to know too much

To make a surface keyboard-correct today, a developer may need to know about:

- `useShortcut`
- `pushContext` / `popContext`
- `data-allow-shortcuts`
- local `onKeyDown`
- document-level `keydown` listeners
- whether the surface should portal to `document.body`

That is too much implicit system knowledge for a routine UI change.

## Design Goals

- One clear owner for a key event at any given time
- Correct modal behavior by default
- Predictable layering for nested surfaces
- Small, obvious API for developers
- Compatibility with text inputs and native editing commands
- Strong accessibility semantics
- Easy testing of keyboard behavior

## Non-Goals

- Replacing all existing keyboard interactions in one step
- Building a generic accessibility framework beyond the app's UI needs
- Rewriting every component before the shared model exists

## Proposed Model

Introduce a shared keyboard surface manager.

Conceptually, the app should treat major interactive regions as surfaces:

- app shell
- dockable panel
- floating panel
- modal
- command palette
- context menu
- dropdown
- table/filter region

Only one surface should have first right of refusal for a key event: the topmost active surface.

### Surface stack

The manager maintains a stack of active surfaces, ordered by:

1. blocking behavior
2. explicit priority
3. registration order

Each surface registers:

- `id`
- `kind`
- `rootRef`
- `priority`
- `active`
- `blocking`
- `trapFocus`
- `restoreFocus`
- `onEscape`
- `shortcuts`
- optional tab-navigation hooks

The stack is the source of truth for input ownership.

### Surface kinds

Recommended built-in kinds:

- `modal`
- `palette`
- `menu`
- `dropdown`
- `panel`
- `region`
- `editor`

These are mainly for default behavior and diagnostics, not for styling.

### Routing rules

For each `keydown`:

1. Resolve the topmost active surface containing the focused element.
2. If none contains focus, use the topmost active blocking surface.
3. Give that surface the first chance to handle the event.
4. If unhandled, optionally bubble to the next eligible surface below it.
5. If still unhandled, allow native browser behavior.

This replaces the current split between shortcut-context matching and separate tab-scope fallback.

## Modal Baseline

Blocking modal behavior is defined separately in `docs/development/UI/modals.md`.

That prerequisite now provides:

- portal-based blocking modals
- inert background behavior
- standardized focus lifecycle
- nested modal handoff

This means modals can now be treated as ordinary blocking surfaces within the broader routing model
instead of as a special unstable case.

## Shortcut Design

Shortcut matching should remain surface-aware but stop depending on merged context as the primary
routing model.

### Separate two concerns

There are two distinct concepts:

1. Keyboard surface ownership
2. Business shortcut eligibility

Surface ownership answers:

- who gets the event first?

Business eligibility answers:

- if this surface sees the event, is this shortcut valid in the current app state?

The current `view`, `panelOpen`, `tabActive`, `resourceKind`, and `objectKind` metadata can still
exist, but they should be inputs to shortcut matching within the active surface, not the global
ownership model.

### Default shortcut behavior inside inputs

The system should preserve native editing behavior by default:

- text entry
- selection
- copy/cut/paste
- undo/redo
- word navigation

Shortcuts that intentionally operate inside inputs should opt in explicitly.

This removes the need for ad hoc rules like `data-allow-shortcuts="true"` in most cases.

### Native and Wails accelerators

The design must explicitly account for native menu and Wails-driven actions.

Examples already in the app include:

- `menu:close`
- `menu:copy`
- `menu:selectAll`

The new keyboard model must define how native accelerator paths intersect with surface ownership.

Recommended rule:

- native menu actions remain out-of-band from browser `keydown`
- `menu:close` remains an app/window close action and is not surface-routed
- copy/select-all dispatch into the active surface stack through explicit action handlers
- copy/select-all continue to respect the focused surface and focused control

This must be treated as part of the design, not as a separate legacy behavior.

### Embedded editor ownership

The app contains editor-owned key behavior, especially in CodeMirror-backed surfaces.

The new surface model must not assume that all keys inside an editor belong to the app. Editors
must be able to register as `editor` surfaces with these rules:

- editor-local keymaps get first refusal while the editor has focus
- app shortcuts only run when the editor surface declines the event
- app-level save, cancel, and search affordances can still be layered intentionally
- `Escape` defaults to app-level ownership, but the surface must allow an explicit per-surface
  override when a specific editor needs editor-first `Escape`

This is especially important for YAML and Helm tabs.

## Tab Navigation Design

`Tab` should be handled as part of the surface system, not as a separate quasi-global mechanism.

### Rules

- Non-blocking regions may define custom `Tab` entry/exit behavior.
- Blocking surfaces such as modals must fully contain `Tab`.
- Regions may still define roving focus or focus-entry behavior.
- Native tabbing should be allowed inside a surface only when that does not violate the surface's
  ownership rules.

### Region-level navigation

For surfaces like:

- object panel
- grid filters + table body
- app logs panel
- sidebar

it is reasonable to keep local region navigation logic. But that logic should plug into the shared
surface manager instead of sitting beside it.

### Focusable affordances

The design must also account for tabbable affordances that are not major shortcut owners, such as:

- tab strips
- resize handles
- interactive cards
- button-like spans used in grids and tables

They do not need to become top-level surfaces, but they must remain valid participants in the
focus model and must not be stranded outside the new ownership system.

## Accessibility Contracts

The redesign must preserve or improve keyboard behavior expected by each ARIA/widget pattern.

Minimum contracts to document and enforce:

- `dialog`: modal focus containment, `Escape`, focus restore
- `menu`: arrow navigation, activation, dismissal
- `tablist`: roving focus, activation, close behavior where supported
- `combobox` / dropdown: open/close, option navigation, text-input behavior when searchable
- `grid` / table region: row navigation, context menu access, filter-entry behavior
- button-like custom controls: `Enter` and `Space`

The shared surface primitives should encode these contracts by default where practical.

## Platform And Input Method Concerns

The new system must explicitly handle platform and input-method concerns that are easy to miss in a
browser-only design.

Required considerations:

- macOS vs Windows/Linux modifier mappings
- non-US keyboard layouts
- IME / composition sessions
- `event.key` semantics versus physical key assumptions
- preserving browser-native editing shortcuts where appropriate

Implementation rule:

- shortcut matching should be layout-aware where necessary, and text-entry surfaces must defer while
  composition is active

These concerns should be part of the implementation checklist, not deferred until QA.

## Proposed API

### Base hook

Proposed shared primitive:

```ts
useKeyboardSurface({
  kind: 'modal' | 'palette' | 'menu' | 'dropdown' | 'panel' | 'region',
  rootRef,
  active,
  priority,
  blocking,
  trapFocus,
  initialFocus,
  restoreFocus,
  inertBackground,
  onEscape,
  shortcuts,
  onTabNavigate,
  onTabEnter,
});
```

### Modal wrapper

Most modal code should not call the base hook directly.

Provide a shared modal component or hook such as:

```ts
useModalSurface({
  rootRef,
  isOpen,
  onClose,
  initialFocus,
});
```

or

```tsx
<ModalSurface isOpen onClose title="...">
  ...
</ModalSurface>
```

This should bundle:

- portal rendering
- overlay
- dialog semantics
- inert background
- focus trap
- focus restore

`Escape` ownership should remain a surface-level concern handled through the surface manager or the
surface's own explicit dismissal contract, not hard-coded into the modal rendering primitive.

### Menu and palette wrappers

Similarly provide shared wrappers for:

- command palette
- context menu
- dropdown popovers

These are all layered surfaces and should not have to rebuild ownership logic independently.

## Validation Scenarios

The new design must be validated not just by component type, but by real nested combinations that
exist in the app.

Required scenario coverage:

- dropdown inside modal
- context menu inside floating panel
- confirmation modal over another modal
- command palette over a panel
- parsed logs table inside the logs surface
- editor surface inside object-panel tabs
- search-target competition across multiple active surfaces

These combinations should be treated as first-class compatibility targets.

## Developer Guidance

After this refactor, a developer should follow a simple rule set:

- If you are adding a modal, use the shared modal surface.
- If you are adding a layered popup, use the shared popup/menu surface.
- If you are adding shortcuts to a screen or panel, register them through the surface.
- Use local `onKeyDown` only for field-local behavior such as committing an input on `Enter`.
- Do not add raw `document.addEventListener('keydown', ...)` unless there is a very specific,
  documented reason.

## Migration Plan

### Phase 1: Build the shared surface layer

- ✅ Add the keyboard surface manager
- ✅ Keep the current shortcut metadata model temporarily
- ✅ Route keys through the surface stack first
- ✅ Define the bridge for native menu/Wails actions into the active surface model

### Phase 2: Migrate other layered surfaces

- ✅ Command palette
- ✅ Context menu
- ✅ Dropdown
- ✅ Shortcut help modal
- ✅ Editor-backed surfaces where editor ownership must be explicit

Implementation note:

- do not start this phase with `ShortcutHelpModal`; it is a special-case migration because it
  currently suppresses the keyboard provider
- do not start this phase with command palette until its input-versus-surface ownership table is
  written down explicitly

### Phase 3: Migrate major regions

- ✅ Sidebar
- ✅ Object panel
- ✅ App logs panel
- ✅ Grid table filter/body regions
- ✅ Diagnostics panel
- ✅ Port-forwards panel

### Phase 4: Remove legacy pathways

- ✅ retire the production use of `useKeyboardNavigationScope` after the sidebar migration
- ✅ delete the legacy tab-scope implementation once runtime usage was gone
- ⏳ reduce direct `pushContext` / `popContext` usage to business-state cases only
- ⏳ remove remaining raw document key listeners where they are no longer justified

## Testing Strategy

The new system should be verified at three levels.

### Unit tests

- surface stack ordering
- key routing precedence
- modal focus containment
- inert background behavior
- focus restore
- shortcut dispatch inside and outside inputs
- native menu action routing into the active surface
- editor-surface precedence over app shortcuts
- composition/IME guard behavior where testable

### Integration tests

- modal over app shell
- dropdown inside modal
- command palette over panel
- confirmation modal over another modal
- context menu inside a floating panel
- command palette over an active panel
- editor tab with active search target
- parsed logs table plus log-surface shortcuts

### Regression tests

Add explicit tests for the failures that prompted this design:

- `Tab` must not escape the Log Settings modal
- modal links and newly added controls must participate correctly without hand tagging
- background app controls must not receive focus while a blocking modal is open
- native copy/select-all must continue to target the correct active surface
- command palette navigation must still work while its input is focused
- GridTable and logs precedence cases must stay intact

## Pre-Implementation Validation

Before implementation begins, the design should be checked against the audit in
`docs/plans/keyboard-surface-audit.md`.

Minimum gating checklist:

- every current shortcut owner is mapped to a surface type
- every direct `document` / `window` key listener is either migrated or explicitly exempted
- every active search target is mapped to the new surface model
- every modal is classified as blocking and has a focus lifecycle plan
- every editor-owned key path is classified as `editor` ownership or explicit app ownership
- every known nested-surface scenario has an intended routing order
- native menu/Wails actions have an explicit bridge into the new model

## Non-Blocking Follow-Up Questions

- Whether to keep the current shortcut-context metadata shape as-is or simplify it after the
  surface model is in place
- Whether dropdowns should always be surfaces or only when open
- Whether floating dock panels should behave as blocking or non-blocking surfaces in all cases

## Recommendation

The plan remains sound after the modal rewrite. The next safe step is to start with the audit and
validation checklist above, then build the shared surface manager before migrating palette/menu/
dropdown and regional keyboard ownership.

The safest first code slice is the surface-manager foundation plus one simple direct-`Escape`
conversion such as `ScaleModal`, not command palette or shortcut help.

The failure mode here is not lack of ideas, it is hidden incompatibility with existing keyboard
behavior.
