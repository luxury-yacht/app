# App Areas

Use this map when a task is broad, ambiguous, or asks for app-wide understanding.
It keeps workflow-specific work in perspective with the rest of Luxury Yacht.

## Core Architecture Areas

| Area                         | What It Owns                                                                                               | Start With                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Multi-cluster model          | Cluster identity, selected/background clusters, cluster-scoped cache/store keys, aggregate backend routing/muxing | `.agents/skills/cluster-auth-lifecycle/SKILL.md`, `docs/architecture/multi-cluster.md` |
| Refresh system               | Snapshot domains, streams, manual refresh, diagnostics, telemetry, per-cluster refresh subsystems          | `docs/architecture/refresh-system.md`, `.agents/skills/refresh-subsystem/SKILL.md` |
| Object catalog               | Discovery, GVK/GVR identity, browse, existence checks, namespace and cluster listings                      | `docs/architecture/catalog.md`                                                     |
| Shared resource model        | Canonical object refs, status, lifecycle, facts, owner/relationship links                                  | `.agents/skills/shared-resource-model/SKILL.md`, `docs/architecture/shared-resource-model.md` |
| Frontend data access         | Resource reads, app state reads, broker paths, paused-read behavior                                        | `docs/architecture/data-access.md`                                                 |
| Permissions and capabilities | RBAC checks, permission-denied diagnostics, action availability                                            | `.agents/skills/permissions-capabilities/SKILL.md`, `docs/architecture/permissions.md` |
| Auth and recovery            | Per-cluster auth failures, client recovery, auth overlays, retry/rebuild behavior                          | `.agents/skills/cluster-auth-lifecycle/SKILL.md`, `docs/architecture/auth.md`      |
| Large data                   | Table limits, pagination/load-more, virtualization, high-volume diagnostics                                | `docs/architecture/large-data.md`                                                  |

## User-Facing Product Areas

| Area                          | Important Paths                                                                                                                         | Notes                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Cluster and namespace views   | `.agents/skills/browse-tables/SKILL.md`, `frontend/src/modules/cluster`, `frontend/src/modules/namespace`, refresh snapshot builders    | These are primary browsing surfaces and must stay multi-cluster aware.                      |
| Browse/catalog                | `.agents/skills/browse-tables/SKILL.md`, `frontend/src/modules/browse`, `backend/objectcatalog`, catalog refresh snapshots              | Catalog is the identity/existence source of truth, not a secondary table.                   |
| Shared tables                 | `.agents/skills/browse-tables/SKILL.md`, `frontend/src/shared/components/tables`, `docs/frontend/gridtable.md`                          | Use `GridTable` and shared column factories; avoid ad-hoc tables.                           |
| Object panel                  | `.agents/skills/object-panel/SKILL.md`, `frontend/src/modules/object-panel`, `backend/resources`, object detail providers               | Details, YAML, logs, shell, events, map, Helm, and actions converge here.                   |
| YAML and apply/edit flows     | `.agents/skills/object-panel/SKILL.md`, object-panel YAML components, backend YAML read/merge/apply paths                               | Full cluster/GVK identity is mandatory.                                                     |
| Logs                          | `.agents/skills/operations-workflows/SKILL.md`, `docs/workflows/logs/overview.md`, backend log stream packages, object-panel/app log UI | Container logs, node logs, and application logs have separate settings and transport rules. |
| Shell and debug containers    | `.agents/skills/operations-workflows/SKILL.md`, `docs/workflows/shell-debug.md`, shell/debug backend and object-panel UI                | High-risk because it combines RBAC, pod/container identity, streams, and UI lifecycle.      |
| Port-forward                  | `.agents/skills/operations-workflows/SKILL.md`, `frontend/src/modules/port-forward`, backend port-forward/session code                  | Session lifecycle, cleanup, cluster identity, and permissions matter.                       |
| Node maintenance/drain        | `.agents/skills/operations-workflows/SKILL.md`, `backend/nodemaintenance`, shared drain components                                      | Long-running operation state must remain current and cancelable.                            |
| Object map                    | `.agents/skills/object-map/SKILL.md`, `docs/workflows/object-map.md`                                                                    | Important graph workflow, but use its skill only when the task is map-specific.             |
| Settings and preferences      | `.agents/skills/app-shell/SKILL.md`, `frontend/src/ui/settings`, `frontend/src/core/settings`, app-state access                         | Changes often affect persistence, modals, command palette, and app shell behavior.          |
| App shell/navigation          | `.agents/skills/app-shell/SKILL.md`, `frontend/src/ui/layout`, `frontend/src/ui/navigation`, dockable panels                            | Sidebar, cluster tabs, object panels, and global layout are tightly connected.              |
| Command palette and shortcuts | `.agents/skills/app-shell/SKILL.md`, `frontend/src/ui/command-palette`, `frontend/src/ui/shortcuts`, `docs/frontend/keyboard.md`        | Keep command labels, categories, icons, and shortcut ownership aligned.                     |
| Modals and overlays           | `.agents/skills/app-shell/SKILL.md`, `frontend/src/ui/modals`, `frontend/src/shared/components/modals`, `docs/frontend/modals.md`       | Use shared modal primitives and preserve focus/drag behavior.                               |
| Favorites and saved views     | `.agents/skills/app-shell/SKILL.md`, `frontend/src/ui/favorites`, relevant view modules and persistence                                 | Crosses app state, navigation, filters, and selected cluster/namespace context.             |
| Release/build/package flows   | `magefile.go`, `wails.json`, release docs/workflows                                                                                     | Platform-specific behavior may require targeted validation beyond local tests.              |

## How To Use This Map

1. Identify the user-facing area and the architecture areas it depends on.
2. Read the owning docs before changing code.
3. Use `.agents/context/code-map.md` for exact entrypoints.
4. Choose a workflow-specific skill only when the task actually matches it.
5. Validate at the closest level first, then run `mage qc:prerelease` for
   non-documentation work.
