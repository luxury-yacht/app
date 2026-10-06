# Backend Service Architecture

Canonical map of backend state owners and permitted dependency directions.
Detailed owner behavior lives in the linked domain docs; startup and shutdown
ordering in [application-lifecycle.md](application-lifecycle.md).

## Composition and transport

- `internal/bootstrap` creates the Wails application, passes it to
  `backend.NewApplicationRuntime` with updater and peer-window dependencies in
  `ApplicationRuntimeOptions`, builds `DesktopService` from the returned owners,
  and registers only that service.
- `ApplicationRuntime` is a reference-only result: owner pointers for bootstrap
  wiring, no behavior or mutable state; no owner may retain it.
- `NewApplicationRuntime` creates each stateful owner once through a dependency
  constructor: never an empty owner filled afterward or a post-construction
  `Configure`/`Bind`. `RefreshCoordinator` and `WorkspaceCoordinator` reject
  incomplete dependency graphs rather than build substitutes; tests use the
  shared owner fixtures instead of weakening constructors. Update configuration
  and the peer-window creation callback are construction inputs, never set
  afterward.
- `DesktopService` owns Wails command names, generated-binding reachability, the
  `/api/v2` entry point, and lifecycle delegation, but no behavior. Each of its
  fourteen command interfaces maps to one owner (`DesktopShell` serves both
  desktop-shell and panel-window commands); HTTP and lifecycle are separate
  collaborators. Owners are not Wails-bound and need no `//wails:ignore`.
  Command-to-owner table: [data-access.md](data-access.md#wails-command-boundary).

Five bind-once ports resolve construction-order edges:

| Port | Direction | Before its target exists |
| --- | --- | --- |
| Update check | `DesktopShell` to `UpdateCoordinator` | Returns an unavailable error |
| Kubeconfig search-path read | `DesktopShell` to `PreferencesService` | Returns an unavailable error |
| Installation telemetry repository | `ErrorReportingService` to `PreferencesService` | Returns an unavailable error |
| Kubernetes client rate-limit settings | `PreferencesService` to `ClusterRuntimeManager` | Retains the latest QPS/burst, pushes at bind |
| Refresh settings | `PreferencesService` to `RefreshCoordinator` | Retains the latest global-log limit and metrics interval, pushes at bind |

Ports reject a missing target and a second bind, call their target only after
releasing the bridge lock, and are bound inside owner constructors; they are
not general back-pointers or a license for later rewiring.

## Owner map

Includes internal-only owners that hold state or cross-owner sequencing.

| Owner | Responsibility |
| --- | --- |
| `ApplicationLifecycle` | Service startup/shutdown, runtime readiness, process context, ordered owner lifecycle |
| `DesktopShell` | Concrete Wails application/window/menu/dialog/clipboard/event/screen access; unpersisted process-wide sidebar, diagnostics-panel, and Application Logs visibility for macOS menu projection |
| `DesktopService` | Wails transport signatures and delegation only |
| `FavoritesService` | Favorites persistence and ordering |
| `UIStateStore` | Persisted grid and cluster-tab UI documents only; never live visibility flags |
| `PreferencesService` | `settings.json`, themes, zoom, search paths, coalesced lazy loading |
| `SettingsEffectDispatcher` | Stateless post-commit routing to write-only runtime sinks ([effects](app-preferences.md#loading-and-runtime-effects)) |
| `ErrorReportingService` | Reporter configuration and installation registration |
| `AppLogService` | Process log buffer and log commands |
| `UpdateCoordinator` | Update checks, download, staging, reconciliation, skip state, restart |
| `ClusterAttentionService` | Attention rules, persistence transactions, live targets, its lock |
| `ClusterWorkspaceProjection` | Replayable health, namespace-scope revisions, aggregate workspace revision |
| `ClusterRuntimeManager` | Kubeconfig discovery, clients, auth/recovery, transport health, API metrics, client rate limits |
| `RefreshCoordinator` | Per-cluster refresh/catalog lifecycles, HTTP/streams, publication, governor/spill state, global log limiter |
| `WorkspaceCoordinator` | Peer selections, serialized selection mutations, namespace-scope rebuilds, foreground demand, workspace assembly |
| `ResourceGateway` | Request-shaped resource reads/actions, permission and response caches, YAML, details, logs |
| `PanelMetricsService` | Open object panels' in-memory metric samples, dropped when the panel directory reports the panel closed |
| `nodemaintenance.Store` | Cluster-keyed node-drain jobs, cancellation handles, bounded history, its lock |
| `OperationsCoordinator` | Shell, port-forward, drain-operation registration, active-operation registry, cleanup |
| `DataManagementCoordinator` | Import/export and owner-directed live Factory Reset ([sequence](application-lifecycle.md#factory-reset)) |
| `ContainerLogsSelectionPolicy` | Shared per-scope container-log selection limit |
| `PermissionFetchPolicy` | Shared SSRR fetch-concurrency limit |

## Dependency direction

Dependencies point toward capabilities, never back to the composition root:

- `DesktopService` delegates to its command owners, `ApplicationLifecycle`,
  and the refresh HTTP handler; no owner calls back into it (outputs such as
  events, DTOs, HTTP, and streams cross the transport without such a call).
- `ApplicationLifecycle` orders owners at startup and shutdown without absorbing
  their state.
- `WorkspaceCoordinator` sequences `ClusterRuntimeManager` and
  `RefreshCoordinator`. Cluster Runtime publishes typed intents to an
  owner-local queue whose single consumer is Workspace; it never calls
  Workspace.
- `RefreshCoordinator` reads Cluster Runtime, registers Attention targets, and
  invokes `ResourceGateway` cache invalidators. Resource requests never call
  Refresh or take refresh/subsystem locks.
- Refresh publishes catalog and retry-telemetry state into leaf projections that
  `ResourceGateway` and `OperationsCoordinator` read instead of depending on
  Refresh.
- `OperationsCoordinator` uses narrow cluster, permission, event, logging, and
  projection collaborators and owns all operation cleanup.
- One `nodemaintenance.Store` is a shared leaf keyed by `clusterId` that owns its
  lock and calls no consumer: node actions write drain state, Refresh reads it
  for `object-maintenance` snapshots, Operations cancels through it.
- `DataManagementCoordinator` may sequence owner reset methods and narrow
  Workspace/Refresh functions; it never owns the state it resets.
- `DesktopShell` keeps the concrete Wails application. Never add a generic
  desktop adapter or move native state into `UIStateStore`.
- Cross-owner callbacks are narrow and one-directional. A leaf projection has
  one writer, any number of readers, and never calls them.

## Source placement

- Production files are named for their owner or a dependency contract and hold
  one state owner's methods; cross-owner workflows belong to the sequencing
  coordinator. Sole exception: `resource_details_generated.go`, where one
  generator emits internal `ResourceGateway` wrappers and the `DesktopService`
  model anchor from the resource-kind registry.
- `application_runtime_contract_test.go` enforces owner-oriented filenames,
  single-owner files, no owner embedding, interface-only cross-owner fields,
  composition-only `app.go`, and no post-construction configuration. Do not
  swap these guards for exact method or field counts.

## Placing new behavior

1. Frontend-callable signature on `DesktopService`; behavior and state on
   exactly one owner.
2. A lock, cache, persisted document, or lifecycle resource lives with the owner
   of the invariant it protects.
3. A workflow spanning owners belongs on a coordinator that receives narrow
   capabilities, never `ApplicationRuntime` or an all-backend interface.
4. Prefer one-way events, invalidators, or leaf projections when a direct call
   would create a cycle.
5. Route runtime preference changes through a write-only settings-effect sink
   ([app-preferences](app-preferences.md#loading-and-runtime-effects)).

## Detailed contracts

- Commands, resources, bindings, settings: [data-access.md](data-access.md)
- Cluster/workspace direction: [multi-cluster.md](multi-cluster.md)
- Refresh ownership and projections: [refresh-system.md](refresh-system.md)
- Namespace-scope sequencing: [namespace-scope.md](namespace-scope.md)
- Operations and cleanup: [operation-lifecycle.md](../workflows/operation-lifecycle.md)
- Permissions and caches: [permissions.md](permissions.md)
