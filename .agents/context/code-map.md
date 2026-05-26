# Agent Code Map

This is a compact entrypoint map for agents. It complements `docs/README.md`;
the docs own the architecture contracts, while this file points to the code.

## Backend

| Area                         | Start Here                                                                                                                                                                   | Notes                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Refresh domain registration  | `backend/refresh/system/registrations.go`                                                                                                                                    | Domain order and permission style matter.                                                  |
| Refresh manager/system setup | `backend/refresh/system/manager.go`, `backend/app_refresh_setup.go`, `backend/app_refresh_update.go`, `backend/app_refresh_subsystems.go`, `backend/app_refresh_recovery.go` | Multi-cluster subsystem init, add/remove, replacement, and recovery lifecycle live here.   |
| Snapshot payloads            | `backend/refresh/snapshot/*.go`                                                                                                                                              | Canonical source for list/table/snapshot data.                                             |
| Resource streams             | `backend/refresh/resourcestream`, `backend/refresh/resourcestream/stream_registration_*.go`, `backend/refresh/resourcestream/domains.go`                                    | Stream rows must match snapshot row shape; WebSocket resource scopes are single-cluster. Keep registration split by behavior. |
| Stream route wiring          | `backend/refresh/system/streams.go`                                                                                                                                          | Events/catalog/logs/resources use different transports.                                    |
| Refresh HTTP API             | `backend/refresh/api/server.go`                                                                                                                                              | Loopback Wails webview API, not a browser security boundary.                               |
| Object catalog               | `backend/objectcatalog`, `backend/objectcatalog/identity.go`, `backend/refresh/snapshot/catalog.go`                                                                          | Source of truth for discovery, GVK/GVR identity, browse, namespaces, and cluster listings. |
| Shared resource semantics    | `backend/resourcemodel`                                                                                                                                                      | Owns identity, status, facts, lifecycle, and links.                                        |
| Rich detail/actions          | `backend/resources`, `backend/object_detail_provider.go`                                                                                                                     | Detail and imperative operations only, not list/table refresh data. Typed detail fetchers require exact-GVK capability metadata. |
| Object YAML read/apply       | `backend/object_yaml*.go`                                                                                                                                                    | YAML paths must carry clusterId and full GVK identity.                                     |
| Container/node/app logs      | `backend/refresh/containerlogsstream`, `backend/resources/pods/logs.go`, `backend/resources/nodes/logs.go`, `backend/app_logs.go`                                            | Logs have separate workflows, settings, and stream behavior.                               |
| Shell/debug sessions         | `backend/shell_sessions.go`, `backend/resources/pods/debug.go`                                                                                                               | Session lifecycle, RBAC, stream cleanup, and cluster identity matter.                      |
| Port-forward sessions        | `backend/portforward*.go`                                                                                                                                                    | Target resolution, ports, cleanup, and cluster removal behavior live here.                 |
| Node maintenance             | `backend/nodemaintenance`, `backend/refresh/snapshot/node_maintenance.go`, `backend/refresh/snapshot/service.go`                                                             | Long-running maintenance/drain state is refresh-backed, uncached, and singleflight-bypassed. |
| Permission checks            | `backend/capabilities`, `backend/app_permissions.go`, `backend/resource_permission.go`, `backend/refresh/system/permission_gate.go`, `backend/refresh/system/registrations.go`, `backend/refresh/snapshot/permission_checks.go`             | Keep QueryPermissions, action checks, refresh gates, diagnostics, and runtime checks aligned. |
| Wails bindings               | `backend` exported app methods, `frontend/wailsjs/go/models.ts`                                                                                                              | `wails generate` may not be reliable in every local run; validate with frontend typecheck. |

## Frontend

| Area                         | Start Here                                                                                                         | Notes                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Refresh domain types         | `frontend/src/core/refresh/types.ts`                                                                               | Add `RefreshDomain` and `DomainPayloadMap` entries together.                       |
| Refresher names/config       | `backend/refresh/domain/refresh-domain-contract.json`, `frontend/src/core/refresh/domainRegistry.ts`, `frontend/src/core/refresh/refresherTypes.ts`, `frontend/src/core/refresh/refresherConfig.ts` | Domain metadata is consumed directly from the shared contract; keep explicit behavior aligned. |
| Refresh execution            | `frontend/src/core/refresh/orchestrator.ts`, `frontend/src/core/refresh/RefreshManager.ts`                         | Orchestrator fetches one cluster scope at a time through per-cluster runtimes; manager schedules. Coordinator owns lifecycle, runtimes own cluster data. `object-maintenance` allows concurrent aggregate and node scopes. |
| Resource stream descriptors  | `frontend/src/core/refresh/streaming/resourceStreamDomains.ts`, `resourceStreamRows.ts`, `resourceStreamSubscriptions.ts`, `resourceStreamConnection.ts`, `resourceStreamManager.ts` | Descriptors own row/scope rules; rows owns pure merge math; subscriptions/connection own lifecycle; manager owns resync, drift, health, telemetry, and store writes. |
| Refresh client               | `frontend/src/core/refresh/client.ts`                                                                              | Only approved direct `fetch` path.                                                 |
| Refresh diagnostics          | `backend/refresh/domain/refresh-domain-contract.json`, `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts` | Diagnostics stream/refresher metadata comes from the shared domain contract.        |
| Frontend resource reads      | `frontend/src/core/data-access`, `frontend/src/core/app-state-access`                                              | Use the documented access layers.                                                  |
| Tables                       | `frontend/src/shared/components/tables/GridTable.tsx`, `frontend/src/shared/components/tables/columnFactories.tsx` | Do not build ad-hoc tables.                                                        |
| Object panel                 | `frontend/src/modules/object-panel/components/ObjectPanel`                                                         | Details, YAML, logs, map, and related object workflows.                            |
| Object map UI                | `frontend/src/modules/object-map`                                                                                  | Model, visible state, layout, G6 renderer, debug store, styles.                    |
| Browse/catalog UI            | `frontend/src/modules/browse`                                                                                      | Catalog-backed discovery and browsing surfaces.                                    |
| Cluster and namespace UI     | `frontend/src/modules/cluster`, `frontend/src/modules/namespace`                                                   | Primary resource browsing views and namespace/cluster state.                       |
| Port-forward UI              | `frontend/src/modules/port-forward`                                                                                | Session UI and workflow state.                                                     |
| Settings                     | `backend/app_settings.go`, `frontend/src/core/settings`, `frontend/src/core/app-state-access`, `frontend/src/ui/settings` | Backend-owned persisted preferences, schema hydration, optimistic frontend cache, and settings UI. |
| Command palette/shortcuts    | `frontend/src/ui/command-palette`, `frontend/src/ui/shortcuts`                                                     | Global commands, shortcut ownership, categories, and icons.                        |
| Dockable panels/modals       | `frontend/src/ui/dockable`, `frontend/src/ui/modals`, `frontend/src/shared/components/modals`                      | Object panels, modal surfaces, focus, and drag behavior.                           |
| Shared status/link rendering | `frontend/src/shared/utils/backendStatusPresentation.ts`, `frontend/src/shared/utils/resourceLinkIdentity.ts`      | Render backend status and links instead of deriving primary semantics in frontend. |
| App shell/global UI          | `frontend/src/ui`                                                                                                  | Layout, dockable panels, command palette, settings, modals, shortcuts.             |
| Reusable UI                  | `frontend/src/shared`                                                                                              | Shared components, hooks, constants, table system, icons, inputs.                  |

## High-Risk Contracts

- Multi-cluster behavior: `docs/architecture/multi-cluster.md`.
- Refresh system: `docs/architecture/refresh-system.md`.
- Shared resource model: `docs/architecture/shared-resource-model.md`.
- Object catalog: `docs/architecture/catalog.md`.
- Frontend data access: `docs/architecture/data-access.md`.
- Large-data behavior: `docs/architecture/large-data.md`.
- Logs workflows: `docs/workflows/logs/overview.md`.
- Shell/debug workflow: `docs/workflows/shell-debug.md`.
- Frontend infrastructure: `docs/frontend/*.md`.
- Object map workflow: `docs/workflows/object-map.md`.

## Validation Shortcuts

Use targeted checks while iterating, then the final required gate.

| Change Type                        | Targeted Checks                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Backend resource model or snapshot | Focused `go test` package(s), then broader `go test ./backend/...` if shared behavior changed |
| Frontend component/hook            | Targeted Vitest spec, `npm run typecheck --prefix frontend`                                   |
| Refresh domain                     | Backend snapshot/system tests, frontend refresh tests, diagnostics panel check                |
| Logs/shell/port-forward/drain      | Focused backend session/stream tests, `go test ./backend/refresh/snapshot`, and UI lifecycle/orchestrator tests when present |
| Settings/app shell                 | Targeted Vitest specs, typecheck, browser/story validation for visual behavior                |
| Object map                         | Backend object-map tests plus targeted object-map Vitest specs                                |
| Broad frontend/shared cleanup      | Targeted tests, `npm run typecheck --prefix frontend`, `mage qc:knip`                         |
| Final non-doc completion           | `mage qc:prerelease`, then inspect `git status`                                               |
