# Frontend Component Structure

This document describes how the frontend is organized today, where new code should go, and which
dependency directions are preferred for new work.

## Current Top-Level Layout

```text
frontend/src/
  assets/              → Static assets
  core/                → Application infrastructure and state orchestration
  hooks/               → App-level hooks
  modules/             → Feature-specific UI and behavior
  shared/              → Reusable primitives, hooks, constants, and helpers
  types/               → Shared TypeScript types
  ui/                  → App shell, global surfaces, and app-owned UI
  utils/               → App-level utilities not scoped under shared/
```

## Placement Rules

### `core/` — Application Infrastructure

Put code here if it owns application-wide state, orchestration, persistence, connections, or
cross-cutting infrastructure.

Examples:

- `core/refresh`
- `core/contexts`
- `core/settings`
- `core/capabilities`

`core/` should stay independent of React UI layers whenever possible.

### `modules/` — Feature-Owned UI

Use `modules/<feature>/` for domain-specific behavior that belongs to one feature area.

Current feature modules:

- `modules/browse`
- `modules/cluster`
- `modules/kubernetes`
- `modules/namespace`
- `modules/object-panel`
- `modules/port-forward`

Put a component here if it implements feature-specific behavior and is not a reusable primitive.

### `ui/` — App Shell And App-Owned Surfaces

`ui/` contains the application frame and global UI systems. This includes shell-level layout and
navigation, but it is not limited to purely presentation-only code.

Current `ui/` areas:

| Subdirectory         | Purpose                                      | Examples                              |
| -------------------- | -------------------------------------------- | ------------------------------------- |
| `ui/layout`          | Top-level app structure and sidebar/header   | `AppLayout.tsx`, `Sidebar.tsx`        |
| `ui/dockable`        | Dockable panel infrastructure                | `DockablePanel.tsx`                   |
| `ui/modals`          | App-owned blocking modals                    | `SettingsModal.tsx`, `AboutModal.tsx` |
| `ui/overlays`        | Full-screen overlays                         | `AuthFailureOverlay.tsx`              |
| `ui/panels`          | Global panels                                | `AppLogsPanel.tsx`                    |
| `ui/settings`        | Settings content                             | `Settings.tsx`                        |
| `ui/status`          | Header/system status UI                      | `ConnectivityStatus.tsx`              |
| `ui/errors`          | App-shell error boundaries                   | `AppErrorBoundary.tsx`                |
| `ui/navigation`      | Sidebar and cluster navigation types/helpers | `types.ts`                            |
| `ui/command-palette` | Command palette                              | `CommandPalette.tsx`                  |
| `ui/shortcuts`       | Keyboard shortcut system                     | `context.tsx`                         |
| `ui/favorites`       | App-owned favorites save/edit flow           | `FavToggle.tsx`, `FavSaveModal.tsx`   |

Put code here if it is part of the app shell, a global UI system, or an app-owned flow that is
used across multiple features.

### `shared/` — Reusable Building Blocks

`shared/` contains reusable code that is not owned by one feature module.

Current areas:

| Subdirectory                   | Purpose                                   | Examples                                    |
| ------------------------------ | ----------------------------------------- | ------------------------------------------- |
| `shared/components/errors`     | Generic error handling UI                 | `ErrorBoundary.tsx`                         |
| `shared/components/modals`     | Reusable modal primitives and shared ones | `ModalSurface.tsx`, `ConfirmationModal.tsx` |
| `shared/components/status`     | Reusable status indicators                | `StatusIndicator.tsx`                       |
| `shared/components/tables`     | Shared table system                       | `GridTable.tsx`, `columnFactories.tsx`      |
| `shared/components/kubernetes` | Reusable Kubernetes-oriented UI           | `ActionsMenu.tsx`                           |
| `shared/components/dropdowns`  | Dropdown primitives                       | `Dropdown/`                                 |
| `shared/components/icons`      | Shared icon components                    | `MenuIcons.tsx`                             |
| `shared/components/inputs`     | Shared input primitives                   | `SearchInput.tsx`                           |
| `shared/components/tabs`       | Shared tab primitives                     | `Tabs/`                                     |
| `shared/components/IconBar`    | Shared icon-bar UI                        | `IconBar.tsx`                               |
| `shared/components/diff`       | Shared diff viewer pieces                 |                                             |
| `shared/hooks`                 | Reusable hooks                            | `useNavigateToView.ts`                      |
| `shared/constants`             | Shared constants                          | `builtinGroupVersions.ts`                   |
| `shared/utils`                 | Shared helpers                            | `metricsAvailability.ts`                    |

Put code here if it is reusable and not owned by a single feature.

### `hooks/`, `utils/`, and `types/`

These top-level directories are real parts of the current structure and should not be ignored.

- `hooks/` is for app-level hooks that are not naturally feature-owned.
- `utils/` is for app-level utility code that is not under `shared/`.
- `types/` is for shared TypeScript types and typing helpers.

### `assets/`

Static assets and asset-specific support files live here.

## Preferred Dependency Direction

The codebase is not perfectly layered today, so the rules below are the preferred direction for new
code, not a claim that every existing file already follows them.

Preferred flow:

```text
modules/ ───────→ shared/ ───────→ core/
    │               ▲
    │               │
    └────────────→ ui/
```

Guidelines:

- `core/` should not import from `ui/`, `shared/`, or `modules/`.
- `shared/` should prefer importing from `shared/` and `core/`.
- `ui/` may import from `shared/` and `core/`.
- `modules/` may import from `modules/`, `shared/`, `ui/`, and `core/` when needed.

## Current Exceptions

The codebase currently has some real exceptions to the preferred layering. The doc should be honest
about them:

- Some `shared/` components currently depend on `ui/` keyboard infrastructure.
  Example: [`ContextMenu.tsx`](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/ContextMenu.tsx).
- Some `shared/` components currently depend on module-owned state.
  Example: [`KubeconfigSelector.tsx`](/Volumes/git/luxury-yacht/app/frontend/src/shared/components/KubeconfigSelector.tsx).
- `ui/favorites` is app-owned and reused across feature views, but it also depends on module and
  core state.

Do not treat those exceptions as the pattern to extend by default. When adding new code, prefer the
dependency direction above unless there is a clear reason not to.

## Practical Placement Checklist

1. Is it owned by one feature? Put it in `modules/<feature>/`.
2. Is it a reusable primitive or helper? Put it in `shared/`.
3. Is it part of the app shell, a global surface, or an app-owned cross-feature flow? Put it in
   `ui/`.
4. Is it infrastructure, orchestration, persistence, or a provider? Put it in `core/`.
5. Is it a top-level shared hook, type, or utility rather than a component? Use `hooks/`,
   `types/`, or `utils/` as appropriate.

## File Organization Conventions

- Keep CSS adjacent to the component when there is a dedicated stylesheet.
- Keep tests adjacent to implementations with `*.test.ts` or `*.test.tsx`.
- Prefer the configured aliases such as `@core`, `@modules`, `@shared`, and `@ui` instead of deep
  relative imports.
