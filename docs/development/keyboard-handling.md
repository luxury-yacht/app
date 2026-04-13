# Keyboard Handling

This document describes how keyboard handling works in the frontend today.

It replaces the completed keyboard-surface planning docs.

## Overview

The app now uses one shared runtime keyboard model centered on:

- global shortcut registration and dispatch in [context.tsx](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/context.tsx)
- explicit surface ownership through [surfaces.ts](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/surfaces.ts)
- shared modal behavior documented in [modals.md](/Volumes/git/luxury-yacht/app/docs/development/UI/modals.md)

The old split between shortcut routing and `Tab` scope routing is gone:

- `KeyboardNavigationProvider` is no longer part of runtime routing
- `useKeyboardNavigationScope` is retired
- `data-allow-shortcuts` is gone
- `pushContext` / `popContext` are gone

## Core Model

Keyboard ownership is based on active surfaces, not merged context metadata.

Surface kinds in runtime:

- `modal`
- `palette`
- `menu`
- `dropdown`
- `panel`
- `region`
- `editor`

For each key event, the provider:

1. Finds the deepest active surface containing the event target.
2. Falls back to the topmost active blocking surface if focus is outside all surfaces.
3. Gives that surface first chance to handle the event.
4. Falls through to registered global shortcuts only if no surface owns it.
5. Preserves native browser behavior when nothing handles the key.

## Shared APIs

Use these first:

- `useShortcut()` and `useShortcuts()` in [hooks.ts](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/hooks.ts)
- `useKeyboardSurface()` in [surfaces.ts](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/surfaces.ts)
- shared modal primitives in [ModalSurface.tsx](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/modals/ModalSurface.tsx) and [useModalFocusTrap.ts](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/modals/useModalFocusTrap.ts)

Use local `onKeyDown` only for truly local behavior such as:

- form-field `Enter` commit
- search-input `Enter` / `Shift+Enter`
- editor-local key behavior that should not become app-global

Do not add:

- direct `document` or `window` key listeners for ordinary app behavior
- ad hoc focus-walker systems
- shortcut ownership via context metadata

## Surface Rules

### Blocking Surfaces

Blocking surfaces own the keyboard before the rest of the app.

Current blocking surfaces include:

- app modals
- command palette
- shortcut help

Blocking modals also block the command palette.

`menu:close` is not surface-routed. In this app it is app/window close behavior.

### Layered Surfaces

Layered non-modal surfaces include:

- dropdowns
- context menus

They should register through `useKeyboardSurface()` and own keys like arrows, `Enter`, `Space`, and `Escape` while active.

### Panels And Regions

Panels and regions own focused or active keyboard behavior without becoming fully blocking.

Current examples:

- `ObjectPanel`
- `AppLogsPanel`
- `DiagnosticsPanel`
- `PortForwardsPanel`
- `GridTable` filter/body regions
- `Sidebar`

### Editor Surfaces

Editors register as `editor` surfaces.

Current examples:

- YAML tab
- Helm manifest tab
- Helm values tab

Default rule:

- app-level `Escape` wins by default

Allowed override:

- a specific editor surface may take `Escape` first if needed for editor-local transient UI

## Shortcuts Vs Ownership

There are two separate concerns:

- surface ownership: who gets the key first
- shortcut eligibility: what shortcuts a surface registers

The runtime no longer uses business metadata like `view`, `tabActive`, `resourceKind`, or `panelOpen` to decide ownership.

Shortcut registration still uses per-shortcut priority, but ownership is surface-driven.

## Inputs And Native Editing

Native text editing behavior is preserved by default.

This includes:

- typing
- selection
- copy/cut/paste
- undo/redo
- select all

Shared helpers for input detection live in [utils.ts](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/utils.ts).

If a control needs keyboard behavior while focused, prefer one of:

- local `onKeyDown` for field-local behavior
- a surrounding registered surface for higher-level navigation

Do not reintroduce attribute-based escape hatches like `data-allow-shortcuts`.

## Native Actions

The keyboard layer also bridges native menu actions from Wails.

Current native actions routed into the active surface stack:

- `menu:copy`
- `menu:selectAll`

These are handled in [context.tsx](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/context.tsx).

`menu:close` is intentionally not routed through surfaces.

## Search Routing

`Cmd/Ctrl+F` is not a normal global shortcut. It is routed to the best active search target.

Search target infrastructure lives in:

- [searchShortcutRegistry.ts](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/searchShortcutRegistry.ts)
- [useSearchShortcutTarget.ts](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/useSearchShortcutTarget.ts)
- [SearchShortcutHandler.tsx](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/components/SearchShortcutHandler.tsx)

Current search-target users include:

- GridTable filters
- YAML tab
- Helm manifest tab
- Helm values tab
- log viewer filter

When changing keyboard behavior, preserve:

- target priority
- recency tie-breaking
- correct routing under blocking surfaces and nested regions

## Important Current Surfaces

### Global App Shortcuts

Global app-shell shortcuts are registered in [GlobalShortcuts.tsx](/Volumes/git/luxury-yacht/app/frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx).

These include things like:

- shortcut help
- sidebar toggle
- settings
- object diff
- refresh
- diagnostics
- zoom
- cluster-tab navigation
- app-level `Escape`

These only run when no active surface with higher ownership consumes the event.

### Command Palette

[CommandPalette.tsx](/Volumes/git/luxury-yacht/app/frontend/src/ui/command-palette/CommandPalette.tsx) is a blocking `palette` surface.

It owns:

- navigation keys
- activation
- dismissal

The input keeps only true field-local behavior such as text selection.

### Dropdowns And Menus

[Dropdown.tsx](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/dropdowns/Dropdown/Dropdown.tsx) and [ContextMenu.tsx](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/ContextMenu.tsx) are shared layered surfaces.

They must continue to work correctly inside modals and panels.

### Tables And Logs

`GridTable` and the log viewer are important overlap cases.

In particular:

- `GridTable` owns row navigation and filter/body region transitions
- logs can overlap with parsed table mode
- `Home` / `End` precedence must remain intentional

Relevant files:

- [useGridTableShortcuts.ts](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/tables/hooks/useGridTableShortcuts.ts)
- [GridTableKeys.ts](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/tables/GridTableKeys.ts)
- [useLogKeyboardShortcuts.ts](/Volumes/git/luxury-yacht/app/frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogKeyboardShortcuts.ts)

### Sidebar

[SidebarKeys.ts](/Volumes/git/luxury-yacht/app/frontend/src/ui/layout/SidebarKeys.ts) owns sidebar cursor/navigation behavior as a `region` surface.

That behavior includes:

- arrow navigation
- home/end
- activation
- `Escape` preview reset behavior

## Modals

Modal mechanics are documented in [modals.md](/Volumes/git/luxury-yacht/app/docs/development/UI/modals.md).

Keyboard-relevant modal rules:

- modals render through the shared modal surface
- focus is contained inside the topmost modal
- background content is inert while a blocking modal is open
- focus is restored on close
- modal-local key behavior is provided through the shared modal path, not duplicate registrations
- modal `Tab` trapping is handled at document capture phase in the shared modal trap, while other
  keys still route through the shared surface manager

For new modals, use the shared modal foundation instead of inventing local key handling.

## Accessibility Expectations

Preserve the keyboard contract for the widget pattern you are touching.

Important patterns in this app:

- dialogs
- menus
- dropdowns / comboboxes
- tablists
- grid/table regions
- button-like custom controls

At minimum, changes must not regress:

- focus visibility
- `Escape` dismissal where expected
- arrow-key navigation where expected
- `Enter` / `Space` activation for button-like controls

## Intentional Exceptions

There is one intentional out-of-band keyboard path:

- app-shell debug overlay toggles in [useAppDebugShortcuts.ts](/Volumes/git/luxury-yacht/app/frontend/src/ui/layout/useAppDebugShortcuts.ts)

These remain outside the shared surface system on purpose so they stay reachable even when
blocking surfaces suppress normal shortcuts.

Do not use that pattern for production features.

## Testing Guidance

When changing keyboard behavior:

- test the actual owning surface, not just a helper in isolation
- add regression coverage for precedence when surfaces overlap
- prefer real `KeyboardProvider` wiring in tests

High-risk regression areas:

- command palette while modals are open
- `Cmd/Ctrl+F` search-target arbitration
- GridTable vs log viewer precedence
- editor `Escape` / save / search behavior
- dropdowns and menus inside modals

For jsdom:

- tests should assert app behavior, not real browser navigation
- shared test setup in [vitest.setup.ts](/Volumes/git/luxury-yacht/app/frontend/vitest.setup.ts) already suppresses real anchor navigation attempts

## Developer Checklist

When adding new keyboard behavior:

1. Decide which surface owns the key first.
2. Register the surface through `useKeyboardSurface()` if it is not purely local.
3. Keep field-local behavior on the field.
4. Preserve native text editing in inputs.
5. Preserve search-target behavior if `Cmd/Ctrl+F` is relevant.
6. If the UI is a modal, use the shared modal foundation.
7. Add regression tests for overlapping-surface cases when applicable.

If a change seems to need a new document-level listener, that is usually the wrong direction.
