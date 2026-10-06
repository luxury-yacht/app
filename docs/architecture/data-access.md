# Data Access Contract

Frontend reads go through one of two brokers; components and feature hooks
never call backend read transports directly. Timing, retention, and request
intents are owned by [data-freshness.md](data-freshness.md).

## Broker Choice

| Broker | Package | Use for |
| --- | --- | --- |
| `dataAccess` | `frontend/src/core/data-access` | Refresh domains, cluster/resource RPC reads, permission/capability reads |
| `appStateAccess` | `frontend/src/core/app-state-access` | Settings, kubeconfig inventory, app info, app logs, session lists, persisted UI state |

- Feature components never call generated cluster-data Wails read bindings,
  `QueryPermissions`, `fetchScopedDomain`, or refresh manual-trigger helpers.
  Add a typed reader wrapper under the owning broker (`readers.ts`) and call
  through it, declaring diagnostics labels, adapter type, request reason, and
  scope.
- Commands and mutations may use action-specific bindings with full cluster and
  object identity.
- `dataAccess` honors paused auto-refresh: passive reads are blocked while user
  reads run ([request intents](data-freshness.md#request-intents)). A blocked
  read is not an error and shows no passive loading spinner.
- `appStateAccess` stays independent of refresh-domain lifecycle policy.
  Settings schema, mutations, rollback, and runtime effects follow the
  [app preferences contract](app-preferences.md).
- Other starting points: refresh HTTP client
  `frontend/src/core/refresh/client.ts`; settings metadata cache
  `frontend/src/core/settings/appPreferences.ts`.

## Request correlation

- Every executed `dataAccess` read gets a `broker-read-N` request id; do not
  create a second correlation id.
- Refresh reads forward it as `X-Correlation-ID` on manual-refresh, job-status,
  and snapshot requests. The backend reuses it as the snapshot-build and queued
  manual-refresh operation identity, so diagnostics, structured errors, and
  breadcrumbs name the same request.
- The refresh orchestrator presents handled failures before the broker call
  completes, so it passes the live id into the shared error boundary. Telemetry
  resolves only ids still registered as active broker requests, never an
  arbitrary caller-supplied id.

## Wails command boundary

Composition and dependency directions are owned by
[backend-services.md](backend-services.md).

- `backend.DesktopService` is the sole registered Wails service. Each command
  delegates to exactly one owner-shaped interface (table below); lifecycle and
  `/api/v2` handling are separate collaborators. Rejected: one interface with
  every command, and a `DesktopService` back-pointer to the composition root.
- `backend.ApplicationRuntime` is not a service and has no methods, so owners
  need no `//wails:ignore` directives.
- Wails generates the callable module at
  `frontend/bindings/github.com/luxury-yacht/app/backend/desktopservice.ts` and
  shared DTOs in the adjacent `models.ts`; DTOs from nested Go packages stay in
  matching generated subdirectories.

| Owner | Commands | Responsibility |
| --- | ---: | --- |
| `FavoritesService` | 5 | Favorites persistence |
| `UIStateStore` | 7 | Grid and cluster-tab UI persistence |
| `PreferencesService` | 13 | Settings, themes, zoom, and kubeconfig search-path reads |
| `DataManagementCoordinator` | 5 | Import, export, and factory reset |
| `ClusterAttentionService` | 6 | Attention ignore and restore rules |
| `WorkspaceCoordinator` | 6 | Window selection, namespace scope, diagnostics, and search-path mutation |
| `ClusterRuntimeManager` | 3 | Kubeconfig inventory, client diagnostics, and auth retry |
| `ResourceGateway` | 17 | Resource reads, permissions, YAML, logs, and object actions |
| `OperationsCoordinator` | 10 | Shell, port-forward, drain, and live-operation lifecycle |
| `UpdateCoordinator` | 6 | Update checks, download, skip, and restart |
| `AppLogService` | 5 | Process log reads, writes, and clear |
| `DesktopShell` | 6 | Native dialogs, CSV and log save, workspace-menu dispatch, and process UI visibility |
| `DesktopShell` (`PanelWindowCommands`) | 25 | Native panel-window and shared panel-workspace protocol: open, dock, close, tab/cluster transfer, quit preflight |
| `PanelMetricsService` | 2 | Object panels' live metric samples: append and series reads |

### ResourceGateway

- Owns request-shaped resource work: exact catalog resolution, capability
  queries, typed details, YAML, object actions, Helm and node-log operations,
  response and SSRR caches, and permission-aware cache validation. It receives
  narrow collaborators and never stores the composition root; cluster-client,
  dependency-resolution, and transport-health collaborators point directly to
  `ClusterRuntimeManager`.
- The object catalog is its only production GVK-to-GVR and object-existence
  resolver; the generated kind registry is the per-kind vocabulary. Resource
  requests never fall back to kind-only discovery, infer a cluster, or read
  preferences. It reads the shared `ContainerLogsSelectionPolicy` and
  `PermissionFetchPolicy`, which successful settings operations push into.
- Cache-invalidation rules: [refresh-system.md](refresh-system.md#snapshot-caches).

### Generated binding anchor

The generated internal `BindingModelAnchor` method on `*DesktopService` carries
a type-level `wails:inject` directive that keeps every resource detail DTO
reachable although the implementation-only `ResourceGateway.Get<Kind>`
wrappers are not commands. `genappbindings.Render` emits the anchor and those
wrappers in package `backend`, so `DesktopService`, `ResourceGateway`, and the
generated file must stay there; moving either type first requires a tested
target-package option in that generator.
