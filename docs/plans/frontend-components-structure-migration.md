# Frontend Components Structure Migration

## Goal

Remove the legacy catch-all `frontend/src/components` directory by relocating components into the repo's intended structure:

- `frontend/src/shared/components` for reusable, domain-agnostic primitives.
- `frontend/src/ui` for app-shell/layout/panel/modals/overlay behavior.
- `frontend/src/modules/<feature>` for domain-specific feature UI.

This migration must preserve behavior and preserve multi-cluster safety (no changes to `clusterId` flow, scoped keys, or refresh scope wiring).

## Current State

- `frontend/src/components` and `frontend/src/shared/components` are both active.
- `frontend/src/components` currently contains mostly app-shell UI plus some reusable primitives.

## Target Layout

```text
frontend/src/
  shared/
    components/
      errors/        ← already has ResourceBarErrorBoundary, ErrorNotificationSystem
      modals/        ← already has ScaleModal
      status/
    utils/
      react/
  ui/
    dockable/
    errors/
    modals/
    overlays/
    panels/
      app-logs/
    settings/
    status/
  modules/
    ... (unchanged by this migration)
```

### Pre-existing files in target directories

These files already live in shared target directories and must not be overwritten or omitted from
new barrel files:

- `frontend/src/shared/components/errors/ResourceBarErrorBoundary.tsx` (+ test)
- `frontend/src/shared/components/errors/ErrorNotificationSystem.tsx`
- `frontend/src/shared/components/modals/ScaleModal.tsx`
- `frontend/src/shared/components/modals/ScaleModal.css`

## Concrete Move Map

| Current path                                                        | Target path                                                                                       | Why                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `frontend/src/components/dockable/*`                                | `frontend/src/ui/dockable/*`                                                                      | Docking is app-shell layout infrastructure, not shared primitive UI. |
| `frontend/src/components/content/AppLogsPanel/AppLogsPanel.tsx`     | `frontend/src/ui/panels/app-logs/AppLogsPanel.tsx`                                                | Global panel tied to shell layout/state.                             |
| `frontend/src/components/content/AppLogsPanel/AppLogsPanel.css`     | `frontend/src/ui/panels/app-logs/AppLogsPanel.css`                                                | Keep CSS with component.                                             |
| `frontend/src/components/content/AppLogsPanel/AppLogsPanel.test.tsx` | `frontend/src/ui/panels/app-logs/AppLogsPanel.test.tsx`                                           | Keep tests with moved component.                                     |
| `frontend/src/components/content/Settings.tsx`                      | `frontend/src/ui/settings/Settings.tsx`                                                           | App settings content owned by UI shell.                              |
| `frontend/src/components/content/Settings.css`                      | `frontend/src/ui/settings/Settings.css`                                                           | Keep CSS with component.                                             |
| `frontend/src/components/modals/ConfirmationModal.tsx`              | `frontend/src/shared/components/modals/ConfirmationModal.tsx`                                     | Reusable modal used by multiple modules and shared components.       |
| `frontend/src/components/modals/ConfirmationModal.css`              | `frontend/src/shared/components/modals/ConfirmationModal.css`                                     | Keep CSS with reusable modal.                                        |
| `frontend/src/components/modals/useModalFocusTrap.ts`               | `frontend/src/shared/components/modals/useModalFocusTrap.ts`                                      | Reusable modal accessibility helper.                                 |
| `frontend/src/components/modals/useModalFocusTrap.test.tsx`         | `frontend/src/shared/components/modals/useModalFocusTrap.test.tsx`                                | Keep tests with moved helper.                                        |
| `frontend/src/components/modals/ConfirmationModal.test.tsx`         | `frontend/src/shared/components/modals/ConfirmationModal.test.tsx`                                | Keep tests with moved component.                                     |
| `frontend/src/components/modals/AboutModal.tsx`                     | `frontend/src/ui/modals/AboutModal.tsx`                                                           | App-specific modal tied to Wails app info and runtime API.           |
| `frontend/src/components/modals/AboutModal.css`                     | `frontend/src/ui/modals/AboutModal.css`                                                           | Keep CSS with modal.                                                 |
| `frontend/src/components/modals/AboutModal.test.tsx`                | `frontend/src/ui/modals/AboutModal.test.tsx`                                                      | Keep tests with modal.                                               |
| `frontend/src/components/modals/SettingsModal.tsx`                  | `frontend/src/ui/modals/SettingsModal.tsx`                                                        | App-specific container modal for settings view.                      |
| `frontend/src/components/modals/SettingsModal.css`                  | `frontend/src/ui/modals/SettingsModal.css`                                                        | Keep CSS with modal.                                                 |
| `frontend/src/components/modals/SettingsModal.test.tsx`             | `frontend/src/ui/modals/SettingsModal.test.tsx`                                                   | Keep tests with modal.                                               |
| `frontend/src/components/modals/ObjectDiffModal.tsx`                | `frontend/src/ui/modals/ObjectDiffModal.tsx`                                                      | Global app modal orchestrated by layout state.                       |
| `frontend/src/components/modals/ObjectDiffModal.css`                | `frontend/src/ui/modals/ObjectDiffModal.css`                                                      | Keep CSS with modal.                                                 |
| `frontend/src/components/modals/ObjectDiffModal.test.tsx`           | `frontend/src/ui/modals/ObjectDiffModal.test.tsx`                                                 | Keep tests with modal.                                               |
| `frontend/src/components/modals/objectDiffUtils.ts`                 | `frontend/src/ui/modals/objectDiffUtils.ts`                                                       | Helper is only for `ObjectDiffModal`.                                |
| `frontend/src/components/modals/objectDiffUtils.test.ts`            | `frontend/src/ui/modals/objectDiffUtils.test.ts`                                                  | Keep tests with helper.                                              |
| `frontend/src/components/modals/modals.css`                         | `frontend/src/ui/modals/modals.css`                                                               | Shared styles for app-owned modal set.                               |
| `frontend/src/components/errors/ErrorBoundary.tsx`                  | `frontend/src/shared/components/errors/ErrorBoundary.tsx`                                         | Generic reusable boundary.                                           |
| `frontend/src/components/errors/ErrorFallback.tsx`                  | `frontend/src/shared/components/errors/ErrorFallback.tsx`                                         | Generic fallback used by boundary.                                   |
| `frontend/src/components/errors/ErrorFallback.css`                  | `frontend/src/shared/components/errors/ErrorFallback.css`                                         | Keep CSS with shared fallback.                                       |
| `frontend/src/components/errors/types.ts`                           | `frontend/src/shared/components/errors/types.ts`                                                  | Shared error types.                                                  |
| `frontend/src/components/errors/recovery/strategies.ts`             | `frontend/src/shared/components/errors/recovery/strategies.ts`                                    | Reusable strategy logic.                                             |
| `frontend/src/components/errors/recovery/strategies.test.ts`        | `frontend/src/shared/components/errors/recovery/strategies.test.ts`                               | Keep tests with moved strategy.                                      |
| `frontend/src/components/errors/ErrorBoundary.test.tsx`             | `frontend/src/shared/components/errors/ErrorBoundary.test.tsx`                                    | Keep tests with moved boundary.                                      |
| `frontend/src/components/errors/ErrorFallback.test.tsx`             | `frontend/src/shared/components/errors/ErrorFallback.test.tsx`                                    | Keep tests with moved fallback.                                      |
| `frontend/src/components/errors/specialized/AppErrorBoundary.tsx`   | `frontend/src/ui/errors/AppErrorBoundary.tsx`                                                     | App-shell specialized boundary.                                      |
| `frontend/src/components/errors/specialized/PanelErrorBoundary.tsx` | `frontend/src/ui/errors/PanelErrorBoundary.tsx`                                                   | App-shell specialized boundary.                                      |
| `frontend/src/components/errors/specialized/RouteErrorBoundary.tsx` | `frontend/src/ui/errors/RouteErrorBoundary.tsx`                                                   | App-shell specialized boundary.                                      |
| `frontend/src/components/errors/TestErrorBoundary.tsx`              | `frontend/src/ui/errors/TestErrorBoundary.tsx`                                                    | Dev/test app-shell boundary.                                         |
| `frontend/src/components/errors/index.ts`                           | split into `frontend/src/ui/errors/index.ts` and `frontend/src/shared/components/errors/index.ts` | Stop mixing app-shell and shared exports in one barrel. See barrel notes below. |

**Barrel split notes for `errors/index.ts`:**

- `frontend/src/ui/errors/index.ts` exports: `AppErrorBoundary`, `RouteErrorBoundary`,
  `PanelErrorBoundary`. (`TestErrorBoundary` is lazy-loaded by direct path, not barrel-exported.)
- `frontend/src/shared/components/errors/index.ts` exports: `ErrorBoundary`, `ErrorFallback`,
  `types` (re-exported types), `strategies`. Must also export the pre-existing
  `ResourceBarErrorBoundary` and `ErrorNotificationSystem` that already reside there.
- **Type export boundary:** The current barrel exports `ErrorBoundaryProps`, `ErrorBoundaryState`,
  and `ErrorFallbackProps`. After the split these types live in the shared barrel only. Current
  barrel consumers (`App.tsx`, `AppLayout.tsx`) only import components, not types, so this is safe.
| `frontend/src/components/overlays/AuthFailureOverlay.tsx`           | `frontend/src/ui/overlays/AuthFailureOverlay.tsx`                                                 | App-level overlay tied to active cluster auth state.                 |
| `frontend/src/components/overlays/AuthFailureOverlay.css`           | `frontend/src/ui/overlays/AuthFailureOverlay.css`                                                 | Keep CSS with overlay.                                               |
| `frontend/src/components/status/StatusIndicator.tsx`                | `frontend/src/shared/components/status/StatusIndicator.tsx`                                       | Reusable primitive status indicator.                                 |
| `frontend/src/components/status/StatusIndicator.css`                | `frontend/src/shared/components/status/StatusIndicator.css`                                       | Keep CSS with primitive.                                             |
| `frontend/src/components/status/ConnectivityStatus.tsx`             | `frontend/src/ui/status/ConnectivityStatus.tsx`                                                   | Header-specific app status unit.                                     |
| `frontend/src/components/status/MetricsStatus.tsx`                  | `frontend/src/ui/status/MetricsStatus.tsx`                                                        | Header-specific app status unit.                                     |
| `frontend/src/components/status/SessionsStatus.tsx`                 | `frontend/src/ui/status/SessionsStatus.tsx`                                                       | Header-specific app status unit.                                     |
| `frontend/src/components/hoc/withLazyBoundary.tsx`                  | `frontend/src/shared/utils/react/withLazyBoundary.tsx`                                            | Cross-cutting helper; not app-shell specific.                        |
| `frontend/src/components/errors/specialized/`                       | delete after move                                                                                 | Empty after its three files move to `ui/errors/`.                    |
| `frontend/src/components/progress/`                                 | delete (if present)                                                                               | Empty directory; may already be removed.                             |

## Import Rewrite Map

Both alias prefixes are valid in this repo today, so Phase 2 must rewrite both `@components/*` and `@/components/*`.

| Old import                                       | New import                                    |
| ------------------------------------------------ | --------------------------------------------- |
| `@components/dockable`                           | `@ui/dockable`                                |
| `@/components/dockable`                          | `@ui/dockable`                                |
| `@components/dockable/*`                         | `@ui/dockable/*`                              |
| `@/components/dockable/*`                        | `@ui/dockable/*`                              |
| `@components/content/AppLogsPanel/AppLogsPanel`  | `@ui/panels/app-logs/AppLogsPanel`            |
| `@/components/content/AppLogsPanel/AppLogsPanel` | `@ui/panels/app-logs/AppLogsPanel`            |
| `@components/modals/ConfirmationModal`           | `@shared/components/modals/ConfirmationModal` |
| `@/components/modals/ConfirmationModal`          | `@shared/components/modals/ConfirmationModal` |
| `@components/modals/AboutModal`                  | `@ui/modals/AboutModal`                       |
| `@/components/modals/AboutModal`                 | `@ui/modals/AboutModal`                       |
| `@components/modals/SettingsModal`               | `@ui/modals/SettingsModal`                    |
| `@/components/modals/SettingsModal`              | `@ui/modals/SettingsModal`                    |
| `@components/modals/ObjectDiffModal`             | `@ui/modals/ObjectDiffModal`                  |
| `@/components/modals/ObjectDiffModal`            | `@ui/modals/ObjectDiffModal`                  |
| `@components/errors/ErrorBoundary`               | `@shared/components/errors/ErrorBoundary`     |
| `@/components/errors/ErrorBoundary`              | `@shared/components/errors/ErrorBoundary`     |
| `@components/errors`                             | `@ui/errors`                                  |
| `@/components/errors`                            | `@ui/errors`                                  |
| `@components/errors/TestErrorBoundary`           | `@ui/errors/TestErrorBoundary`                |
| `@/components/errors/TestErrorBoundary`          | `@ui/errors/TestErrorBoundary`                |
| `@components/status/StatusIndicator`             | `@shared/components/status/StatusIndicator`   |
| `@/components/status/StatusIndicator`            | `@shared/components/status/StatusIndicator`   |
| `@components/status/ConnectivityStatus`          | `@ui/status/ConnectivityStatus`               |
| `@/components/status/ConnectivityStatus`         | `@ui/status/ConnectivityStatus`               |
| `@components/status/MetricsStatus`               | `@ui/status/MetricsStatus`                    |
| `@/components/status/MetricsStatus`              | `@ui/status/MetricsStatus`                    |
| `@components/status/SessionsStatus`              | `@ui/status/SessionsStatus`                   |
| `@/components/status/SessionsStatus`             | `@ui/status/SessionsStatus`                   |
| `@components/hoc/withLazyBoundary`               | `@shared/utils/react/withLazyBoundary`        |
| `@/components/hoc/withLazyBoundary`              | `@shared/utils/react/withLazyBoundary`        |
| `@components/overlays/AuthFailureOverlay`        | `@ui/overlays/AuthFailureOverlay`             |
| `@/components/overlays/AuthFailureOverlay`       | `@ui/overlays/AuthFailureOverlay`             |

## CSS Import Rewrites

These CSS `@import` references are not covered by TypeScript import rewrites and must be updated in Phase 2:

| File                                                         | Old CSS import                                     | New CSS import                       |
| ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------ |
| `frontend/src/ui/shortcuts/components/ShortcutHelpModal.css` | `@import "../../../components/modals/modals.css";` | `@import "../../modals/modals.css";` |
| `frontend/src/shared/components/kubernetes/ActionsMenu.css`  | `@import "@components/modals/modals.css";`         | `@import "@ui/modals/modals.css";`   |
| `frontend/src/shared/components/modals/ScaleModal.css`       | `@import "@components/modals/modals.css";`         | `@import "@ui/modals/modals.css";`   |

## Legacy Specifier Inventory (Audit Snapshot)

Audit command used:
`rg -n "@components/|@/components/" frontend/src -g '*.ts' -g '*.tsx' -g '*.css' | grep -oE '(@components|@/components)/[^" )]+' | sed -E "s/[',;]+$//" | sort | uniq`

Legacy specifiers currently in use (must all be handled by Phase 2):

- `@components/dockable`
- `@components/dockable/DockablePanelProvider`
- `@components/errors`
- `@components/errors/TestErrorBoundary`
- `@components/hoc/withLazyBoundary`
- `@components/modals/ConfirmationModal`
- `@components/modals/modals.css`
- `@components/status/ConnectivityStatus`
- `@components/status/MetricsStatus`
- `@components/status/SessionsStatus`
- `@/components/content/AppLogsPanel/AppLogsPanel`
- `@/components/dockable`
- `@/components/dockable/tabGroupState`
- `@/components/dockable/useDockablePanelState`
- `@/components/errors`
- `@/components/errors/ErrorBoundary`
- `@/components/modals/AboutModal`
- `@/components/modals/ObjectDiffModal`
- `@/components/modals/SettingsModal`
- `@/components/overlays/AuthFailureOverlay`
- `@/components/status/StatusIndicator`

## Internal Relative Import Rewrites

These rewrites are required after file moves, because existing relative paths will break.

**Note:** Both `import` statements and `vi.mock()`/`vi.importActual()` calls using the same relative
path must be rewritten. For example, `SettingsModal.test.tsx` has both an `import` (line 13) and a
`vi.mock(...)` (line 33) referencing `'../content/Settings'` — both must be updated.

| File moved                                      | Old internal import   | New internal import                           | Notes                                          |
| ----------------------------------------------- | --------------------- | --------------------------------------------- | ---------------------------------------------- |
| `frontend/src/ui/errors/AppErrorBoundary.tsx`   | `../ErrorBoundary`    | `@shared/components/errors/ErrorBoundary`     |                                                |
| `frontend/src/ui/errors/PanelErrorBoundary.tsx` | `../ErrorBoundary`    | `@shared/components/errors/ErrorBoundary`     |                                                |
| `frontend/src/ui/errors/RouteErrorBoundary.tsx` | `../ErrorBoundary`    | `@shared/components/errors/ErrorBoundary`     |                                                |
| `frontend/src/ui/modals/SettingsModal.tsx`      | `../content/Settings` | `@ui/settings/Settings`                       |                                                |
| `frontend/src/ui/modals/SettingsModal.test.tsx` | `../content/Settings` | `@ui/settings/Settings`                       | Both `import` (line 13) and `vi.mock` (line 33) |
| `frontend/src/ui/modals/AboutModal.tsx`         | `./useModalFocusTrap` | `@shared/components/modals/useModalFocusTrap` |                                                |
| `frontend/src/ui/modals/ObjectDiffModal.tsx`    | `./useModalFocusTrap` | `@shared/components/modals/useModalFocusTrap` |                                                |
| `frontend/src/ui/status/ConnectivityStatus.tsx` | `./StatusIndicator`   | `@shared/components/status/StatusIndicator`   |                                                |
| `frontend/src/ui/status/MetricsStatus.tsx`      | `./StatusIndicator`   | `@shared/components/status/StatusIndicator`   |                                                |
| `frontend/src/ui/status/SessionsStatus.tsx`     | `./StatusIndicator`   | `@shared/components/status/StatusIndicator`   |                                                |

**Preserved co-locations (no rewrite needed):** `ObjectDiffModal.tsx` imports `./objectDiffUtils` —
both files move to `frontend/src/ui/modals/`, so the relative path remains valid.

## Test String-Literal Rewrite Scope

`vi.mock(...)`, `vi.importActual(...)`, and dynamic `import(...)` module strings must be rewritten,
not only `import` statements.

Known files with legacy component module strings:

- `frontend/src/components/content/AppLogsPanel/AppLogsPanel.test.tsx`
- `frontend/src/core/refresh/components/DiagnosticsPanel.test.ts`
- `frontend/src/modules/active-session/ActiveSessionsPanel.test.tsx`
- `frontend/src/modules/namespace/components/NsViewConfig.test.tsx`
- `frontend/src/modules/namespace/components/NsViewCustom.test.tsx`
- `frontend/src/modules/namespace/components/NsViewNetwork.test.tsx`
- `frontend/src/modules/namespace/components/NsViewPods.test.tsx`
- `frontend/src/modules/namespace/components/NsViewQuotas.test.tsx`
- `frontend/src/modules/namespace/components/NsViewRBAC.test.tsx`
- `frontend/src/modules/namespace/components/NsViewStorage.test.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.test.tsx`
- `frontend/src/modules/object-panel/hooks/useObjectPanel.test.tsx`
- `frontend/src/modules/port-forward/PortForwardsPanel.test.tsx`
- `frontend/src/modules/shell-session/ShellSessionsPanel.test.tsx`

## Phased Execution Plan

- ✅ Phase 0: Define target structure and concrete move map (this document).
- ✅ Phase 1: Create destination folders and move files without behavior changes.
- ✅ Phase 2: Rewrite module paths and update barrels/aliases. Scope includes TypeScript/JavaScript
  `import` statements and test/runtime string literals (for example `vi.mock(...)`,
  `vi.importActual(...)`, and dynamic `import(...)` specifiers). Exit criteria (all must return no
  matches):
  `rg -n "(@components/|@/components/)" frontend/src`
  `rg -n "vi\\.mock\\(|vi\\.importActual\\(|import\\(" frontend/src -g '*.test.ts' -g '*.test.tsx' | rg "(@components/|@/components/)"`
  `rg -n "@import\\s+[\"'].*components/modals/modals\\.css[\"']" frontend/src -g '*.css'`
  `rg -n "frontend/src/components/" frontend/src -g '*.ts' -g '*.tsx' -g '*.css'`
- ✅ Phase 3: Run targeted tests for moved areas (`dockable`, `modals`, `errors`, `status`, `layout`).
- ✅ Phase 4: Remove legacy `frontend/src/components` and remove the `@components` alias from both
  `frontend/tsconfig.json` and `frontend/vite.config.ts`.
- ✅ Phase 5: Update docs that point to old paths (`docs/development/UI/dockable-panels.md`, `docs/development/auth-manager.md`).

## Guardrails

- No visual or behavior changes during the move.
- Preserve all existing cluster-scoped flows (`clusterId`, scoped keys, refresh scope builders).
- Do not move feature-domain components into `shared`; keep domain logic in `modules`.
- Keep tests adjacent to implementations after moves.
