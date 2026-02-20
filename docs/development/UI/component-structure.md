# Frontend Component Structure

This document describes where frontend components live and the rules for placing new ones.

## Directory Layout

```text
frontend/src/
  ui/                  → App-shell: layout, navigation, panels, overlays
  shared/components/   → Reusable primitives used across multiple features
  shared/utils/        → Cross-cutting utility functions and helpers
  modules/<feature>/   → Domain-specific feature UI (one directory per feature)
  core/                → Application infrastructure (refresh, contexts, connections)
```

## Placement Rules

### `ui/` — App-Shell Components

Components that are part of the application shell — the chrome around feature content. These are
tied to app-level layout, state, or Wails runtime APIs.

| Subdirectory         | Purpose                                          | Examples                                         |
| -------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `ui/layout`          | Top-level page structure, header, sidebar        | `AppHeader.tsx`, `AppLayout.tsx`                 |
| `ui/dockable`        | Dockable panel system (layout infrastructure)    | `DockablePanel.tsx`, `DockableTabBar.tsx`        |
| `ui/modals`          | App-owned modals (settings, about, diff viewer)  | `SettingsModal.tsx`, `AboutModal.tsx`            |
| `ui/overlays`        | Full-screen overlays (auth failure, etc.)        | `AuthFailureOverlay.tsx`                         |
| `ui/panels`          | Global content panels                            | `panels/app-logs/AppLogsPanel.tsx`               |
| `ui/settings`        | App settings content                             | `Settings.tsx`                                   |
| `ui/status`          | Header status indicators (connectivity, metrics) | `ConnectivityStatus.tsx`                         |
| `ui/errors`          | App-shell error boundaries                       | `AppErrorBoundary.tsx`, `PanelErrorBoundary.tsx` |
| `ui/navigation`      | Sidebar and cluster navigation                   |                                                  |
| `ui/command-palette` | Command palette                                  | `CommandPalette.tsx`                             |
| `ui/shortcuts`       | Keyboard shortcut system                         |                                                  |

**Put a component here if:** it is part of the app frame, orchestrated by layout state, or depends
on Wails runtime APIs. It should NOT contain domain/feature logic.

### `shared/components/` — Reusable Primitives

Generic, domain-agnostic components reused by multiple features or by the app shell itself. These
must not import from `ui/` or `modules/`.

| Subdirectory                   | Purpose                                   | Examples                                        |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------- |
| `shared/components/errors`     | Generic error boundary and fallback       | `ErrorBoundary.tsx`, `ErrorFallback.tsx`        |
| `shared/components/modals`     | Reusable modal primitives                 | `ConfirmationModal.tsx`, `useModalFocusTrap.ts` |
| `shared/components/status`     | Reusable status indicators                | `StatusIndicator.tsx`                           |
| `shared/components/tables`     | Grid table and column factories           | `GridTable.tsx`, `columnFactories.tsx`          |
| `shared/components/kubernetes` | Shared Kubernetes UI (actions menu, etc.) | `ActionsMenu.tsx`                               |
| `shared/components/dropdowns`  | Dropdown primitives                       | `Dropdown/`                                     |
| `shared/components/icons`      | Icon components                           | `MenuIcons.tsx`                                 |
| `shared/components/inputs`     | Input primitives                          | `SearchInput.tsx`                               |
| `shared/components/tabs`       | Tab primitives                            | `Tabs/`                                         |

**Put a component here if:** it is generic, has no feature-specific logic, and is used (or likely to
be used) by more than one feature or by the app shell.

### `shared/utils/` — Cross-Cutting Helpers

Utility functions and React helpers that are not components themselves.

| Path                                      | Purpose                                    |
| ----------------------------------------- | ------------------------------------------ |
| `shared/utils/react/withLazyBoundary.tsx` | HOC for lazy-loading with error boundaries |
| `shared/utils/metricsAvailability.ts`     | Metrics availability helpers               |
| `shared/utils/resourceCalculations.ts`    | Resource calculation utilities             |

### `modules/<feature>/` — Feature UI

Domain-specific components scoped to a single feature. Each module owns its own components,
hooks, and tests.

| Module                   | Feature                           |
| ------------------------ | --------------------------------- |
| `modules/cluster`        | Cluster management and connection |
| `modules/namespace`      | Namespace resource views          |
| `modules/object-panel`   | Kubernetes object detail panel    |
| `modules/browse`         | Catalog browsing                  |
| `modules/shell-session`  | Shell/exec sessions               |
| `modules/active-session` | Active session tracking           |
| `modules/port-forward`   | Port forward management           |
| `modules/kubernetes`     | Kubernetes-specific utilities     |

**Put a component here if:** it implements feature-specific behavior and is not reused outside its
feature. If a module component starts being imported by other modules, move it to
`shared/components/`.

## Import Direction Rules

Dependencies flow downward only:

```text
modules/ ──→ ui/
   │            │
   │            ▼
   └──────→ shared/
               │
               ▼
             core/
```

- `modules/` may import from `ui/`, `shared/`, and `core/`.
- `ui/` may import from `shared/` and `core/`.
- `shared/` may import from `core/` only. Never from `ui/` or `modules/`.
- `core/` should not import from `ui/`, `shared/`, or `modules/`.

## Checklist for Adding a New Component

1. **Is it feature-specific?** → `modules/<feature>/components/`
2. **Is it reusable across features?** → `shared/components/<category>/`
3. **Is it part of the app shell/layout?** → `ui/<category>/`
4. **Is it a utility function, not a component?** → `shared/utils/`
5. Keep CSS adjacent to the component (e.g., `Foo.tsx` + `Foo.css`).
6. Keep tests adjacent (e.g., `Foo.tsx` + `Foo.test.tsx`).
7. Use path aliases (`@ui/`, `@shared/`, `@modules/`) instead of deep relative imports.
