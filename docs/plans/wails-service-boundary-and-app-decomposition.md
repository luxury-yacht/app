# Wails Service Boundary and Backend App Decomposition

Status: proposed; implementation not started.

This is a temporary implementation plan. Durable ownership and lifecycle
contracts must move into the owning architecture and workflow documents before
this plan is removed.

## Outcome

Replace the current `backend.App` god object with:

- one thin `DesktopService` registered with Wails;
- an unbound application composition root;
- focused backend components that each own one area of mutable state and
  lifecycle; and
- explicit coordinators for workflows that cross component boundaries.

The generated Wails command surface must remain the frontend's typed transport
contract. Backend implementation methods must not need `//wails:ignore` merely
because they happen to be exported Go methods.

## Why this is needed

Production currently registers one `*backend.App` as the Wails service in
`main.go`. That one type also implements the refresh HTTP route, Wails service
lifecycle, native runtime access, peer-window lifecycle callbacks, cluster and
refresh coordination, resource operations, settings, logs, updates, and live
operations.

Current breadth:

- 585 production methods have an `*App` receiver, 192 of them exported
  (`go/parser` AST inventory over top-level non-test `backend/*.go` files:
  `585` and `192`; recursive text search incorrectly adds the two generator
  format strings at `backend/internal/genappbindings/render.go:240,254`);
- `App` has 98 top-level field declarations (`backend/app.go:29-209`, field
  declaration scan: `98`);
- 11 production structs store an `*App` back-pointer, and 38 production-file
  package functions accept `*App`, including 23 functions in
  `backend/menu.go` (`go/parser` AST inventory: `11`, `38`, and `23`; five of
  the 38 functions are test-support helpers in `backend/app_testing.go`);
- the intentional frontend boundary exports 87 generated commands through
  `frontend/src/core/backend-api/index.ts` (explicit export scan: `87`);
- 103 `//wails:ignore` directives occur under `backend/`, including two
  generator-template directives and 38 generated resource-detail directives
  (`rg '//wails:ignore' backend`: `103`; generated-file scan: `38`);
- 62 of the 90 top-level `backend/*_test.go` files construct `App` directly or
  through `newTestAppWithDefaults`, and `backend/test_entrypoints_test.go`
  defines 19 test-only `*App` methods (file-pattern scans: `62`, `90`, and
  receiver scan: `19`); and
- consumers outside the backend package hold the concrete `*backend.App` in
  `main.go`, `internal/appwindow/registry.go`, and backend test support (direct
  type-reference inventory over non-test Go files).

The ignore directives protect the current boundary, and
`cmd/project/wails_bindings_test.go` detects binding drift. Separately,
`cmd/project/wails_project_contract_test.go` enforces direct Wails application
injection and composition ordering. The architecture still defines the
frontend boundary by subtracting methods from the registered implementation
object. The target makes the allowed boundary structural: only the transport
service is registered, while retaining direct concrete access to Wails native
APIs.

## Review domains

1. **Wails boundary:** service registration, generated commands and models,
   typed events, `/api/v2`, named JSON streams, and frontend imports.
2. **State ownership:** every field, mutex, cache, goroutine, subscription, and
   cleanup callback currently owned by `App`.
3. **Lifecycle ordering:** process startup, first-window readiness, peer-window
   close, cluster selection, auth recovery, refresh replacement, and shutdown.
4. **Cross-component workflows:** operations that must coordinate multiple
   owners without introducing back-pointers or circular dependencies.
5. **Coupling surface:** structs and package functions that currently accept or
   retain `*App`, including menu construction and test seams.
6. **Regression enforcement:** tests, diagnostics, documentation, generators,
   test fixtures, and agent routing that must move with the owners.

## Target model

```text
React
  |
  | generated calls and typed events
  v
DesktopService                 the only Wails-bound backend service
  |-- command delegates        exact frontend command surface
  |-- ServiceStartup/Shutdown  delegate to ApplicationLifecycle
  `-- ServeHTTP                delegate to RefreshTransport at /api/v2
          |
          v
ApplicationRuntime             unbound composition root; component references only
  |-- ApplicationLifecycle
  |-- DesktopShell
  |-- PreferencesService
  |     `-- SettingsEffectDispatcher  stateless, owner-shaped write sinks
  |-- FavoritesService
  |-- UIStateStore
  |-- DataManagementCoordinator
  |-- ClusterAttentionService
  |-- ErrorReportingService
  |-- ContainerLogsSelectionPolicy
  |-- PermissionFetchPolicy
  |-- ClusterWorkspaceProjection
  |-- WorkspaceCoordinator
  |     |-- ClusterRuntimeManager
  |     `-- RefreshCoordinator
  |-- ResourceGateway
  |-- OperationsCoordinator
  |-- UpdateCoordinator
  `-- AppLogService

Wails application.App
  |
  `-- direct concrete injection into ApplicationRuntime and DesktopShell
```

`DesktopService` is thin, not necessarily tiny: it may have one method for each
intentional frontend command, but it owns no domain state and contains no
business rules. Its methods validate transport inputs where necessary and
delegate to the owning component.

`ApplicationRuntime` constructs and exposes the component graph. It does not
become a second service locator used throughout the backend: components receive
only the narrow collaborators they require at construction.

### Preserved direct-Wails decision

The Wails v3 migration deliberately removed the former desktop-adapter layer
(`git log -S WithoutDesktopAdapter`: `6947d880`; the enforcement starts at
`cmd/project/wails_project_contract_test.go:249`). This decomposition preserves
that decision:

- `application.App` is injected directly into concrete backend composition and
  the concrete `DesktopShell` owner;
- `DesktopService` is the generated command/service boundary, not an adapter
  around Wails native APIs;
- do not add `NewAdapter`, a generic `Desktop` interface in
  `backend/app_runtime.go`, `MenuModel`, or an `internal/desktop` package; and
- when `backend.NewApp(wailsApp, reporter)` is eventually renamed, update
  `TestWailsApplicationIsInjectedDirectlyWithoutDesktopAdapter` to enforce the
  same direct-injection decision under the new composition name instead of
  silently deleting the test.

`TestUpdaterTempRootIsConfiguredBeforeAnyProcessDispatch` must continue to
enforce temp setup, exec-wrapper dispatch, reporter setup, backend composition,
update configuration, and service registration in that order when constructor
names change (`cmd/project/wails_project_contract_test.go:272`).

### Generated receiver package constraint

`DesktopService` and `ResourceGateway` initially live in package `backend`.
This is a correctness constraint, not merely a convenient starting point:
`genappbindings.Render` emits `package backend` at
`backend/internal/genappbindings/render.go:167`, its generated detail-fetcher
companion does the same at line 216, and Go permits methods only on types
declared in the same package. Therefore Phase 1 can generate
`(*DesktopService).BindingModelAnchor` and Phase 4 can generate
`(*ResourceGateway).Get<Kind>` only while those receiver types remain in
`backend`.

Moving either receiver type to another package is out of scope until
`genappbindings` first gains and tests a target-package option that emits valid
package declarations, imports, model anchors, and detail dispatch for that
package. Other components may move after their dependency direction is narrow;
these two generated-receiver types do not have that freedom under the current
generator.

## Target ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| `DesktopService` | Wails method signatures, service hooks, refresh route delegation, generated-model reachability | Domain state, caches, locks, Kubernetes clients, workflow logic |
| `ApplicationLifecycle` | application context, runtime readiness, startup sequence, once-only quit preparation, ordered shutdown | Cluster or operation implementation state |
| `DesktopShell` | Wails native app/window/dialog/clipboard/menu access, targeted native events, and the process-wide ephemeral `sidebarVisible`, `diagnosticsPanelVisible`, and `appLogsPanelVisible` shell state | Persisted grid/tab state, Kubernetes data, or process-wide cluster selection |
| `PreferencesService` | settings schema and mutation, themes, window settings, physical settings-file locking/persistence, coalesced lazy-load readiness and atomic startup fallback, narrow repositories for persisted Attention, namespace-scope, and kubeconfig-search-path sections, and post-commit settings-effect detection/dispatch | Favorites, grid state, native UI calls, Attention live application, namespace-scope/search-path orchestration, or any runtime effect target; callers never lock its state or perform raw settings loads, and effects use owner-shaped write-only sinks |
| `FavoritesService` | favorites validation, migration, ordering, independent favorites-file locking and persistence | Settings or grid persistence |
| `UIStateStore` | cluster-tab order, grid persistence, independent persistence-file locking and persistence | Ephemeral shell visibility, live workspace selection, or frontend table data |
| `DataManagementCoordinator` | portable settings/favorites import and export across their real owners, plus total in-app Factory Reset orchestration through owner-specific reset/cleanup operations | A duplicate persistence model, raw deletion of live owners' files, or native dialog implementation |
| `ClusterAttentionService` | effective cluster/global ignore-rule domain, `attentionRulesMu`, the six Ignore/Restore commands, persisted-rule transactions through `PreferencesService`, and registered live Attention-index targets | The physical settings-file lock, refresh subsystem ownership, or catalog identity |
| `ErrorReportingService` | error reporter configuration/lifecycle, startup enablement, installation-registration telemetry and `installationTelemetryMu`, and the reporter side of preference effects | Application log buffering, settings persistence, or refresh-domain telemetry |
| `ContainerLogsSelectionPolicy` | the process-wide per-scope container target cap, its default/clamping, and the selection/warning policy shared by direct pod-log reads and live streams | Settings persistence, stream/subsystem lifecycle, or global concurrent-target allocation |
| `PermissionFetchPolicy` | the process-wide SSRR fetch-concurrency value, its default/clamping, and the read-only policy consumed by permission fan-out | Settings persistence, permission-cache contents, or permission decisions |
| `ClusterRuntimeManager` | kubeconfig discovery and watcher-path retargeting, cluster clients, auth state/recovery, cluster lifecycle, dependency resolution, live and future-client Kubernetes QPS/burst application, heartbeat scheduling/probing, typed health-event publication, and the typed owner-local `ClusterRuntimeIntent` queue for asynchronous cross-owner work | Kubeconfig-search-path persistence or cross-owner selection pruning, refresh subsystem state, replayable workspace projection state, peer-window ownership, a `WorkspaceCoordinator` callback/back-pointer, or frontend view state |
| `RefreshCoordinator` | refresh manager, service handler publication, subsystems, streams, governor, spill state, catalog runtime, live and future-subsystem metrics cadence, refresh-domain `telemetryRecorder` publication, and the process-wide `containerLogsTargetLimiter` plus its lazy-init mutex | Settings reads/persistence, kubeconfig persistence, error-reporting configuration, per-scope container-log selection policy, or live-operation state |
| `ClusterWorkspaceProjection` | `clusterWorkspaceMu`, aggregate revision consistency, replayable cluster health and scope-revision maps, and narrow change/cleanup sinks used by cluster, refresh, and workspace owners | Cluster clients, selection workflows, persistence, heartbeat scheduling, or subsystem lifecycle |
| `WorkspaceCoordinator` | peer selection ownership, serialized selection commands, generation/supersession, foreground intent, selection diagnostics, aggregate workspace-state assembly from owner snapshots, namespace-scope commands/rebuild coalescing, kubeconfig-search-path change/import orchestration and resulting selection pruning, consumption of `ClusterRuntimeIntent`, and ordering between cluster and refresh owners | Duplicate clients, projection state, subsystems, settings-file locking, kubeconfig discovery implementation, or component-owned domain state |
| `ResourceGateway` | complete-object-identity validation, catalog resolution, permission-aware dependencies, detail/YAML/action orchestration, response cache, and consumption of the read-only `PermissionFetchPolicy` | Cluster selection guesses, preference reads, or refresh-domain list ownership |
| `OperationsCoordinator` | runtime-operation registry, shell sessions, port forwards, drain-operation registration and cluster-scoped cleanup | Cluster client ownership or stale snapshot authority |
| `UpdateCoordinator` | update discovery, staging, durable update state, scheduler, projection events, and owner-validated reset of skipped/pending/prepared/attempt/cleanup state plus dynamic staging/log artifacts under the configured update roots | Window or settings persistence, raw deletion of unvalidated dynamic paths, or the static app-state manifest |
| `AppLogService` | log buffer, frontend log ingestion, typed log events | General event routing or error-reporting configuration ownership |

This table is the authoritative target-owner set. The completed Phase 0 ledger
accounts for every current field, lock, command, event, lifecycle hook, mutable
package-global in scope, and package-level entry point with exactly one owner
and removal phase. A later discovery of another cohesive responsibility must
add a focused owner row and update the machine-checked ledger; it must not
assign a leftover to the nearest existing component by proximity.

Existing package owners remain authoritative. For example,
`backend/refresh/system`, `backend/objectcatalog`, `backend/resources`, and
`backend/internal/appupdates` should be composed behind these components, not
reimplemented beside them.

Existing in-package seams are promoted rather than replaced:

| Existing seam | Target role |
| --- | --- |
| `clusterLifecycle` | Internal lifecycle state machine of `ClusterRuntimeManager` |
| `clusterOperationCoordinator` | Independent per-cluster serialization primitive injected into cluster/workspace/refresh orchestration |
| `runtimeOperationRegistry` | Active-operation envelope inside `OperationsCoordinator` |
| `kubernetesAPIMetricsRegistry` | Metrics owner inside `ClusterRuntimeManager` |
| `refreshServiceHandler` | Atomically published transport handler inside `RefreshCoordinator` |
| `appupdates.Coordinator` | Existing implementation behind the application update command/lifecycle boundary |

## Ownership rules

- Every mutable field, package global, singleton, and mutex has exactly one
  owning component.
- Moving a field moves all of its reads, writes, locking, tests, and cleanup in
  the same phase. Do not dual-write or mirror state during migration.
- Extracted owners do not store `*App`, `*ApplicationRuntime`, or each other
  through a general-purpose back-pointer.
- Cross-component operations live in a named coordinator whose dependencies
  point one way. Components do not call back into their coordinator.
- Cluster-originated work that must enter workspace serialization crosses one
  typed, owner-local `ClusterRuntimeIntent` queue exposed by
  `ClusterRuntimeManager`; it is not a callback to `WorkspaceCoordinator` or a
  generic application event bus. Its closed intent set covers kubeconfig-source
  changes with the changed paths, auth rebuild/teardown requests with
  `clusterId` and applicable generation/diagnostic data, and transport rebuild
  requests with `clusterId` and cause. Publication is non-blocking even from an
  auth-manager-held lock: owner-held pending state coalesces by cluster/intent
  kind and preserves the newest generation, while a bounded wake channel merely
  prompts the consumer to drain it. Shutdown cancels the stream and clears
  pending work. The current `App` consumes it until Phase 5C;
  `WorkspaceCoordinator` then becomes the sole consumer, rejects stale
  generations, and runs the resulting mutation through its normal serialized
  cluster/refresh workflow.
- Physical persistence ownership and domain ownership are distinct but
  explicit: `PreferencesService` serializes the shared settings file, while
  `ClusterAttentionService` owns Attention transactions and
  `WorkspaceCoordinator` owns namespace-scope command/rebuild orchestration
  through narrow repositories.
- `RefreshCoordinator` registers and unregisters narrow per-cluster
  Attention-index targets with `ClusterAttentionService`; Attention mutations
  apply to those registered targets without calling back into refresh.
- `ClusterRuntimeManager` owns health polling and writes results through the
  leaf `ClusterWorkspaceProjection`; it emits the typed health event without
  calling `WorkspaceCoordinator`. `WorkspaceCoordinator` reads the projection
  when assembling replay state.
- `WorkspaceCoordinator` persists namespace scope first through
  `PreferencesService`, then sequences the cluster/refresh rebuild, advances
  the scope revision through `ClusterWorkspaceProjection`, and emits the typed
  convergence event.
- `WorkspaceCoordinator` also owns the kubeconfig-search-path change workflow.
  It serializes against selection mutations, persists normalized paths through
  `PreferencesService`, asks `ClusterRuntimeManager` to rediscover kubeconfigs
  and retarget the watcher, classifies invalid selections, and then sequences
  refresh reconciliation/teardown, selection commit, client/auth removal,
  operation cleanup, projection cleanup, and remaining-selection persistence in
  the current order. `DataManagementCoordinator` invokes this same workflow
  after settings import instead of duplicating its post-commit behavior.
- `ErrorReportingService` owns reporter configuration and installation
  registration. `AppLogService` may emit through an injected reporter sink but
  cannot enable, disable, or otherwise configure it.
- `PreferencesService` has one complete `SettingsEffectDispatcher` seam for the
  five current `settingsSideEffects` flags plus the current direct
  `PermissionSSRRFetchConcurrency` read, which becomes an explicit sixth route
  during extraction. The stateless dispatcher fans values out through
  owner-shaped write-only sinks: error-reporting enablement to
  `ErrorReportingService`; Kubernetes client QPS/burst to
  `ClusterRuntimeManager`; SSRR fetch concurrency to `PermissionFetchPolicy`;
  the per-scope container target cap to `ContainerLogsSelectionPolicy`; and the
  global container target cap plus metrics cadence to `RefreshCoordinator`.
  The dispatcher is not a new state owner, and no target implements a broad
  settings or App interface.
- `PreferencesService` owns one lazy settings state machine exposed through
  `EnsureLoaded()` and the startup-policy wrapper `EnsureLoadedForStartup()`.
  That state machine owns its synchronization, coalesces concurrent first
  callers, retries after an ordinary load failure, and returns an immutable
  snapshot only after the successful load's post-unlock container-log and
  permission-policy pushes have completed. No caller may acquire the preferences
  lock, call a raw loader, install `appSettings`, or observe a loaded-but-not-
  effect-ready snapshot.
- Ordinary `EnsureLoaded()` failure installs no snapshot and dispatches no load
  effects: settings reads and updates return the error, and error-reporting
  startup remains disabled. Startup cluster restoration alone calls the
  Preferences-owned atomic `EnsureLoadedForStartup()` operation. It participates
  in the same coalesced load state machine as `EnsureLoaded`; after the load
  attempt fails, it installs one immutable default snapshot only if no ready
  snapshot exists and no retry is in flight. A concurrent successful load wins,
  and no caller can separately apply fallback using stale failure state. After
  releasing the preferences lock, it pushes both default container-log limits
  and the default permission-fetch concurrency before workspace restoration
  uses the snapshot.
- Immutable settings snapshots carry load provenance that distinguishes a
  successful file/default-file load from startup defaults installed after a
  load error. Error reporting may enable only from successful-load provenance;
  it remains disabled for the fallback snapshot even if initialization order
  changes or another owner observes that snapshot later.
- Error-reporting startup is sequenced by an unbound composition function: it
  calls `PreferencesService.EnsureLoaded()` and passes only the immutable
  snapshot/provenance or error to `ErrorReportingService`. The reporting owner
  never stores or calls Preferences. This preserves the one-way live-effect
  dependency `PreferencesService` → `ErrorReportingService` instead of creating
  a startup callback cycle.
- `DataManagementCoordinator` owns the total in-app Factory Reset workflow. It
  first routes cluster/refresh/operation/projection cleanup through
  `WorkspaceCoordinator`, waits for installation registration through
  `ErrorReportingService`, and then invokes owner-specific reset operations for
  Preferences, Favorites, UI persistence, update state, and cache/spill state.
  `PreferencesService` removes its persisted settings and invalidates snapshot,
  provenance, and lazy-load readiness atomically. After releasing its lock, the
  coordinator dispatches the default values through all six runtime setting
  sinks, including disabling error reporting and resetting both container-log
  policies and permission concurrency; `ClusterAttentionService` clears its
  in-memory persisted-rule projection. The next `EnsureLoaded()` performs a new
  coalesced load and all load-time post-unlock policy pushes. Live reset never
  deletes another owner's file directly or relies on process restart to clear
  in-memory state. It attempts every independent owner reset, aggregates errors,
  and reports success only when the full contract completed; the frontend does
  not reload after a partial failure. Preserve the existing installation-
  registration-before-preferences lock/deletion order and make repeated reset
  safe.
- Every owner of durable or settings-derived mutable state exposes only its own
  idempotent reset/default operation. Reset is not a general filesystem or
  lifecycle interface: Preferences removes settings/readiness, Favorites removes
  favorites, UI state removes its persistence, Update quiesces and removes update
  state, Attention clears its rule projection, Refresh tears down producers and
  removes cache/spill state, Workspace sequences runtime cleanup, and the six
  settings sinks accept default values. No leaf owner calls the coordinator or
  resets another owner.
- `UpdateCoordinator.Reset` covers the complete configured updater state, not
  only skipped or pending versions. It rejects reset while an application/
  restart attempt must remain recoverable; otherwise it cancels and quiesces
  checks/downloads, resolves the actual configured `StatePath` and `TempRoot`,
  validates every prepared/attempt/cleanup staging path through the updater
  state package, attempts all recorded cleanup entries and updater log/staging
  artifacts under that root, aggregates cleanup failures, and only then clears
  durable and in-memory state. It never follows an unvalidated path from the
  state document or silently substitutes default roots for configured ones.
- The offline `cmd/project` reset task and the live coordinator share one
  manifest of statically located Go-owned config/cache artifacts, implemented
  as a stateless path/owner inventory under `internal/appstate`. Dynamic
  updater artifacts remain owner-resolved because their locations come from
  configured roots and durable updater state; the manifest names that owner and
  reset contract instead of accepting raw dynamic paths. Path resolution is
  side-effect-free: resolving settings, favorites, UI-state, updater, cache, or
  spill locations never creates their parent directories; write paths perform
  directory creation separately. The manifest performs no live deletion. The
  offline task may remove the app directories only under an explicit documented
  app-stopped precondition because no owners may be running; the live path must
  use the owner-directed workflow above. The frontend clears its own web storage
  and may reload only after backend success; the reset contract must already be
  complete before that reload. Update copy that claims a native application
  restart unless implementation adds an actual relaunch operation.
- The workspace startup path calls `EnsureLoadedForStartup()` before entering
  its selection mutation. Only restoration of the returned selected-kubeconfig
  snapshot and subsequent client work run under the selection coordinator;
  lazy-load/fallback dispatch never runs while a caller-owned selection lock is
  held.
- Settings mutation/import captures the committed snapshot and effect flags
  under the preferences lock, persists successfully, releases that lock, and
  only then dispatches effects. A failed persistence dispatches none. Each sink
  may lock only its own owner and must not read preferences, call back into
  `PreferencesService`, invoke another effect owner while locked, or retain the
  mutable settings object. One target failure must not prevent independent
  enabled effects from running.
- Settings load preserves the two existing container-log initialization pushes:
  `ContainerLogsSelectionPolicy` starts at
  `defaultObjPanelLogsTargetPerScopeLimit`, and the refresh owner constructs the
  global limiter with `defaultObjPanelLogsTargetGlobalLimit` when first needed;
  after a successful load, preferences pushes both configured limits after
  releasing its lock. `PermissionFetchPolicy` likewise starts at
  `defaultPermissionSSRRFetchConcurrency`, and successful load, startup fallback,
  preference update, and settings import push the selected concurrency through
  the same dispatcher. Error-reporting startup remains fail-closed, while
  initial Kubernetes rate limits and metrics cadence are supplied to future
  owner construction separately from their live-update sinks.
- `containerLogsTargetLimiterMu` remains a leaf init lock: its accessor and
  global-limit sink never read preferences, call another owner, or acquire a
  refresh/subsystem lock while it is held. The metrics-cadence sink snapshots
  the subsystem registry under its lock, releases that lock, and only then calls
  subsystem managers. More generally, no settings-effect call may create a
  settings-lock/owner-lock nesting cycle.
- `sidebarVisible`, `diagnosticsPanelVisible`, and `appLogsPanelVisible` remain
  process-wide, ephemeral shell state owned by `DesktopShell`. They do not move
  to persisted `UIStateStore` and do not become per-window state without a
  separate behavior decision.
- Consumer-defined narrow interfaces are preferred where a workflow needs only
  part of another component. This does not permit a generic abstraction over
  Wails native APIs: `DesktopShell` remains a concrete direct consumer of
  `application.App`.
- `DesktopService` stores separate owner-shaped command collaborators plus
  lifecycle and HTTP collaborators, never a `*App`-typed field, a general App
  interface, or `*ApplicationRuntime`. The same `*App` may initially satisfy
  those separate interfaces, but each interface is swapped to its extracted
  owner in that owner's phase. The collaborator interfaces are the permanent
  transport seams; the App-backed implementations are not.
- Cluster-scoped commands, state, events, caches, and cleanup retain
  `clusterId`.
- Boundary-crossing object references retain `clusterId`, `group`, `version`,
  `kind`, `namespace`, and `name` as applicable.
- The object catalog remains the source of object existence and GVK/GVR
  identity. Decomposition must not create a parallel resolver.
- Refresh snapshots and streams retain their current readiness, publication,
  replacement, and teardown ordering.
- The frontend continues to import generated commands only through
  `frontend/src/core/backend-api`; changing generated module paths must not
  spread generated imports through application code.
- Typed Wails events remain registered centrally and producers emit their
  registered payload types through an injected event sink.
- Response-cache invalidation points one way from refresh construction to the
  `ResourceGateway` cache invalidator. `ResourceGateway` does not call back into
  `RefreshCoordinator`, and invalidation sinks do not retain either composition
  root.
- There is no long-lived compatibility implementation. Each migrated slice
  switches all affected consumers and deletes the displaced state and logic in
  the same phase.

## Non-goals

- Changing frontend behavior, visual design, command names, event names, or
  persisted formats, except correcting the Factory Reset completeness and
  reload/restart copy contract identified by this ownership audit.
- Rewriting the refresh subsystem, object catalog, per-kind resource services,
  update coordinator, or operation registry.
- Introducing dependency-injection frameworks, a global service locator, or a
  generic event bus.
- Splitting code into packages only to reduce file size. A new component must
  own state, lifecycle, an external boundary, or a coherent workflow.
- Combining independent mutexes merely because they currently live on `App`.
- Changing cluster identity, object identity, permission, refresh, or data
  access contracts.
- Keeping both old and new command paths after a slice is migrated.

## Shippable checkpoints and stop rules

Each checkpoint below is independently mergeable and shippable only after its
exit criterion, focused coverage, durable owner documentation, and
`qc:prerelease` pass. Do not accumulate several phases on one long-lived
migration branch merely because the final composition root still exists.

| Checkpoint | Independently shippable value |
| --- | --- |
| Phase 0 | Enforced baseline, complete coupling/test ledger, and executable migration contracts |
| Phase 1 | Wails exposure is structurally defined by `DesktopService` while runtime behavior stays unchanged |
| Phase 2 | Live-operation state and cleanup have one owner |
| Phase 3 | Process leaf state, persistence, atomic settings readiness/startup fallback, the complete six-route settings-effect seam, shared container-log and permission-fetch policies, total Factory Reset, Attention, error reporting, native shell work, updates, and logs have focused owners |
| Phase 4 | Resource reads/mutations/cache have one request-shaped owner with refresh-to-cache invalidation and an explicit permission-fetch policy |
| Phase 5A | Cluster clients/auth/lifecycle/metrics/heartbeat, live rate-limit effects, the typed cluster-runtime intent producer, all non-refresh cluster collaborators, and the replay projection have focused owners |
| Phase 5B | Refresh, catalog runtime, streams, governor, handler, telemetry, metrics-cadence effects, global container-log limiting, and Attention-target publication have one owner |
| Phase 5C | Peer selection, diagnostics, namespace-scope and kubeconfig-search-path orchestration, aggregate replay assembly, and cross-owner sequencing have one owner |
| Phase 6 | The god object is gone; only composition remains |
| Phase 7 | Final durability audit is complete and this temporary plan is removed |

Never stop or ship with:

- a field mirrored by old and new owners;
- two startup, readiness, cluster-cleanup, refresh-publication, or shutdown
  paths;
- an extracted owner retaining `*App` or the composition root, or
  `DesktopService` gaining a `*App`-typed/general App collaborator instead of
  the explicitly temporary owner-shaped interfaces;
- an extracted owner whose `DesktopService` collaborator is still implemented
  by `App` rather than that owner;
- Phase 3 with fewer than all six runtime setting routes behind the dispatcher,
  an unowned package-global effect target, a direct permission-to-preferences
  read, any external/raw settings-load caller, a two-call startup-fallback
  protocol, or a ready settings snapshot published before load effects complete;
- Phase 3 with Factory Reset omitting an app-owned durable artifact, deleting a
  live owner's file directly, retaining in-memory state until a frontend reload,
  resolving artifact paths by creating directories, leaving configured updater
  staging/log/cleanup state behind, or claiming a native restart that it does
  not perform;
- Phase 5A with an App-backed Kubernetes client rate-limit sink, an App-backed
  cluster-runtime collaborator outside the explicitly deferred current
  App-owned workspace/refresh orchestration, a cluster owner calling back into
  workspace, or a blocking/unbounded cluster-runtime intent handoff;
- Phase 5B with either App-backed refresh settings sink, more than one global
  limiter instance, or any settings pull from the refresh owner;
- an old and new Wails command path for the same operation; or
- one Phase 5 owner partially extracted across old and new state. Phase 5 may
  stop after 5A or 5B only when that subphase's complete owner and lifecycle
  have moved and its exit criterion passes.

## Cross-phase test-support migration

Test migration is a first-class workstream, not deferred cleanup. The baseline
is 62 of 90 top-level backend test files constructing `App`, plus 19 test-only
`*App` methods in `backend/test_entrypoints_test.go`.

- [ ] Classify every direct/full-App test as a component test, cross-component
  workflow test, or full composition/lifecycle test in the Phase 0 ledger.
- [ ] Move affected tests to focused component fixtures in the same phase as
  their production owner; do not leave them compiling through new App-level
  forwarding methods.
- [ ] Keep a full runtime fixture only for tests that prove composition,
  lifecycle ordering, Wails routing, or cross-owner workflows.
- [ ] Move or replace each of the 19 test-only `*App` methods with the component
  that owns the live behavior it exercises, then delete the App method in that
  same phase.
- [ ] Record the remaining direct-App test-file and test-entrypoint counts at
  every shippable checkpoint.

Per-phase exit criterion: no test for an extracted owner constructs `App` or
uses an App-only test seam. Final exit criterion: no `*App` test receiver or
direct App construction remains after the type is retired; full integration
tests construct `ApplicationRuntime` explicitly.

## Phase 0 — Freeze the contracts and complete the ownership ledger

The machine-checked inventory for this checkpoint is
[`wails-service-boundary-and-app-decomposition-ledger.json`](wails-service-boundary-and-app-decomposition-ledger.json).

- [x] Record every `App` field in a migration ledger with its current readers,
  writers, mutex, startup path, shutdown path, tests, and target owner.
- [x] Extend the ledger beyond `App` fields to every mutable package-global,
  singleton, or direct cross-owner settings reader. At minimum, record all five
  current `settingsSideEffects` flags and appliers plus the live
  `PermissionSSRRFetchConcurrency` read, their update/import/load producers,
  runtime targets and consumers, and replacement sinks. This must include
  `backend/internal/containerlogs.currentPerScopeTargetLimit`, which is currently
  written by settings load/update and read by both
  `backend/resources/pods/logs.go` and
  `backend/refresh/containerlogsstream/streamer.go`, and
  `permissionSSRRFetchConcurrency()`, which is currently read by
  `fetchSSRRRulesForNamespaces` for each permission fan-out.
- [x] Close the provisional ownership table against that ledger. Add a focused
  row for any newly discovered cohesive responsibility instead of assigning
  otherwise-unrelated fields to an owner by code proximity.
- [x] Explicitly ledger the currently omitted surfaces: `attentionRulesMu` and
  all Attention rule methods; `requestClusterScopeRebuildFn`,
  `scopeRebuildQueued`, `clusterWorkspaceMu`, `clusterWorkspaceRevision`,
  `clusterHealth`, and `clusterScopeRevisions`; `errorReporter` and
  `installationTelemetryMu`; refresh `telemetryRecorder`;
  `containerLogsTargetLimiterMu` and `containerLogsTargetLimiter` with all three
  accessor callers (`backend/app_settings.go:751,1220` and
  `backend/app_refresh_setup.go:295`); `selectionDiag`; and the process-wide
  `sidebarVisible`, `diagnosticsPanelVisible`, and `appLogsPanelVisible` fields.
- [x] Close the settings-effect sub-ledger explicitly: error reporting belongs
  to `ErrorReportingService`; live/future-client QPS and burst belong to
  `ClusterRuntimeManager`; SSRR fetch concurrency belongs to
  `PermissionFetchPolicy`; the per-scope container target cap belongs to
  `ContainerLogsSelectionPolicy`; and the global container target limiter plus
  live/future-subsystem metrics cadence belong to `RefreshCoordinator`. Record
  the current five flags and the sixth route that replaces the direct settings
  read without misreporting the baseline.
- [x] Ledger all four production `loadAppSettings` call sites and their distinct
  failure policies: `GetAppSettings` and `prepareAppPreferenceUpdate` belong to
  `PreferencesService`; `InitializeErrorReporting` belongs to
  `ErrorReportingService` and fails closed; and
  `initializeSelectedClustersAtStartup` belongs eventually to
  `WorkspaceCoordinator` and continues through atomic
  `EnsureLoadedForStartup()`. Record the lock idiom at each current caller and
  the Phase 3 rule that none survives as an external/raw loader call or a
  separate stale-failure fallback call.
- [x] Inventory the 24 direct `loadAppSettings` test calls across
  `backend/app_settings_test.go`, `backend/app_cluster_settings_test.go`, and
  `backend/app_data_management_test.go`. Classify each as a public
  `EnsureLoaded`/`EnsureLoadedForStartup` contract test, a lower-level
  persistence codec/repository test, or a caller-specific failure-policy test
  instead of retaining a backdoor lazy initializer.
- [x] Record the limiter's lock-order proof and startup/update contract in the
  ledger: no settings read or other lock acquisition under
  `containerLogsTargetLimiterMu`; construction uses the default; successful
  `EnsureLoaded`, atomic startup fallback, and global-limit updates immediately
  push the selected configured/default value through `SetLimit`; every subsystem
  receives the same process-wide limiter instance.
  Preserve the source contract documented at
  `backend/app_refresh_setup.go:385-393` as an executable lock/order test, not
  only as a comment.
- [x] Assign the six Attention Ignore/Restore commands to
  `ClusterAttentionService`; assign `GetClusterAllowedNamespaces`,
  `SetClusterAllowedNamespaces`, and `GetSelectionDiagnostics` to the
  `WorkspaceCoordinator` collaborator; assign health events to
  `ClusterRuntimeManager`, the scope-changed event to `WorkspaceCoordinator`,
  and their replay state to `ClusterWorkspaceProjection`.
- [x] Ledger `GetKubeconfigSearchPaths`, `SetKubeconfigSearchPaths`, settings
  import, and kubeconfig-watcher changes as one search-path/selection workflow.
  Assign physical search-path persistence to `PreferencesService`, discovery and
  watcher retargeting to `ClusterRuntimeManager`, and serialized post-persist
  rediscovery/pruning/cleanup to `WorkspaceCoordinator`; make
  `DataManagementCoordinator` invoke that same workflow after import.
- [x] Ledger the three asynchronous cluster-originated paths that currently
  re-enter selection orchestration: kubeconfig watcher changes, auth rebuild/
  teardown requests, and transport-failure rebuild requests. Record the current
  producer lock/callback context, payload identity and generation data, current
  App consumer, serialization entry point, cancellation/teardown behavior, and
  the Phase 5A `ClusterRuntimeIntent` producer plus Phase 5C workspace consumer.
  The replacement must be non-blocking while the auth-manager mutex is held and
  must have explicit bounded/coalesced backpressure rather than an unbounded
  goroutine or generic event bus.
- [x] Classify every consumer of cluster-runtime behavior, not only Wails
  commands or `DesktopService`: include `OperationsCoordinator` dependency/
  retry seams, `ResourceGateway` dependency resolution and transport-health
  recording, current workspace selection/search-path orchestration, refresh
  construction/readiness, and every other consumer found by the ledger. Name
  the owner-shaped interface and the exact subphase that replaces its App-backed
  implementation; refresh-owned consumers may be deferred only to Phase 5B.
- [x] Inventory Factory Reset as a total cross-owner workflow, not only a
  preferences-readiness operation. Record the in-app `ClearAppState` command,
  the offline `cmd/project` reset task, every app-owned config/cache artifact
  including `favorites.json` and `application-update.json`, every in-memory
  owner that must reset before frontend reload, the existing cluster/refresh/
  operation/projection cleanup, and installation-registration ordering. For the
  updater, include configured `StatePath`/`TempRoot`, skipped, prepared, attempt,
  and cleanup document entries, protected/staging directories, and updater logs;
  distinguish an active check/download that can be quiesced from an active
  application/restart attempt that must make reset fail without deleting its
  recovery state. Define one shared static artifact manifest plus owner-resolved
  dynamic artifacts while keeping live owner-directed cleanup separate from
  offline directory removal.
- [x] Inventory every filesystem path resolver used by Factory Reset. Split
  resolution from parent-directory creation wherever a getter currently calls
  `MkdirAll`, so live/offline inventory and missing-path reset checks have no
  filesystem side effects; retain directory creation only in the corresponding
  write/open operation.
- [x] Record `InitializeErrorReporting` and its `main.go` call as a non-command
  composition entry point sequencing `PreferencesService` into the behavior
  owned by `ErrorReportingService`. Preserve the
  current reason for its package-level shape through Phase 1: it must not appear
  in the `DesktopService` allowlist or generated frontend bindings. Phase 3 may
  replace it with an unbound service/composition call, never a Wails command.
- [x] Pin the composition ordering that initializes error reporting after
  backend/preferences construction and before `application.Run`. Combined with
  snapshot provenance, this preserves fail-closed behavior both in the normal
  startup order and if a later internal caller has already completed atomic
  startup fallback.
- [x] Record all 11 production structs with `*App` fields and all 38
  production-file package-level functions with exact `*App` parameters,
  including the 23 menu functions and five test-support helpers in
  `backend/app_testing.go`. For each, name the replacement collaborator,
  callback, or owner and the phase that removes the signature.
- [x] Record every intentional Wails command with its frontend broker/consumer,
  target component, cluster/object identity requirements, and error contract.
- [x] Record every non-command `App` entry point used by `main.go`,
  `appwindow.Registry`, menus, refresh handlers, generators, and test support.
- [x] Inventory the 62 direct/full-App backend test files and 19 App test-only
  methods using the cross-phase test-support classification and target owner.
- [x] Extend `cmd/project/wails_bindings_test.go` to identify the registered
  service type and exact command parity without assuming that the generated
  file is permanently named `backend/app.ts`.
- [x] Extend `cmd/project/wails_project_contract_test.go` to distinguish the
  generated Wails service boundary from the prohibited native desktop-adapter
  pattern while preserving direct `application.App` injection.
- [x] Record the composition-order literals enforced by
  `TestUpdaterTempRootIsConfiguredBeforeAnyProcessDispatch`; constructor and
  service names may change, but the required ordering may not.
- [x] Add composition tests proving `/api/v2`, both named streams, typed custom
  events, and peer-window hooks still have exactly one owner.
- [x] Add or identify lifecycle tests proving both sides of every readiness
  gate: invalid early native/event work is blocked, while the operation needed
  to reach ready state remains allowed.
- [x] Capture focused race-test baselines for workspace selection, auth
  recovery, refresh replacement, application shutdown, shell cleanup, and
  port-forward cleanup.

Exit criterion: the provisional ownership table is closed; every current field,
lock, mutable package-global settings target, direct cross-owner settings read,
command, event, back-pointer, App-parameter function, test seam, and boundary
entry point has exactly one target owner and removal phase; all six runtime
setting routes have a producer, owner-shaped sink, target, startup/update rule,
and validation case; every cluster-runtime consumer and asynchronous
cluster-originated workflow has a named producer, typed handoff, consumer, and
replacement phase; search-path change/import and total Factory Reset have named
coordinators and complete static/dynamic owner/artifact inventories; no ledger row is
marked miscellaneous or assigned only by proximity; both project contract-test
files pass normally and are proven to fail against intentional fixture mutations
that violate their boundary/composition decisions; and the tests characterize
the behavior later phases must preserve. Phase 0 is an independently shippable
green test-and-inventory checkpoint.

## Phase 1 — Establish the structural Wails boundary

- [x] Add `DesktopService` in package `backend` as the sole registered backend
  service and keep the existing `/api/v2` route. Preserve direct
  `application.App` injection into backend composition; this service is not a
  native desktop adapter.
- [x] Give `DesktopService` explicit typed methods for the current frontend
  command allowlist. Group its collaborators by the target owners in the
  ownership table—one owner-shaped interface per command-owning component,
  plus separate lifecycle and HTTP seams—not as one 87-method backend
  interface. Components with no direct frontend command do not get empty
  transport interfaces. Initially the same `*App` value may satisfy each
  separate interface, but `DesktopService` has no `*App`-typed field, general
  App collaborator, or `*ApplicationRuntime` reference.
- [x] Assign every command to exactly one owner-shaped collaborator in the
  Phase 0 ledger. In each later extraction phase, replace that collaborator's
  App-backed implementation with the new owner and delete the corresponding
  `App` methods in the same checkpoint; do not move commands between seams
  without updating the ledger and binding tests.
- [x] Keep `InitializeErrorReporting` as a package-level composition entry point
  during this phase, outside `DesktopService` and its command collaborators.
  Add a negative binding assertion and a composition-order assertion that it
  runs before `application.Run`, so the Phase 3 rewrite to an unbound
  `ErrorReportingService` initializer cannot accidentally make startup
  configuration frontend-callable or move it behind application startup.
- [x] Move `ServiceStartup`, `ServiceShutdown`, and `ServeHTTP` onto the service
  boundary and delegate them to explicit lifecycle and refresh-handler
  collaborators.
- [x] Move named-stream registration out of `NewApp` and into explicit
  application composition before window creation.
- [x] Replace `appwindow.Registry`'s concrete `*backend.App` dependency with a
  consumer-owned interface covering runtime-ready, peer release, and quit
  preparation.
- [x] Replace menu and workspace-window creation dependencies on concrete
  `*App` with narrow command/lifecycle interfaces or callbacks.
- [x] Treat model reachability as the phase's highest-risk migration item. The
  pinned Wails beta has no model-only registration directive (`go.mod:15`; its
  collector recognizes `inject`, `include`, `internal`, `ignore`, and `id`, and
  discovers models through service signature types in the Wails module's
  `internal/generator/collect/service.go:273-329` and
  `internal/generator/collect/imports.go:114-160`). Edit
  `backend/internal/genappbindings/render.go` so the generated, internal
  `BindingModelAnchor()` method is received by `*DesktopService`, and move the
  type-level `//wails:inject t*:void BindingModelAnchor;` directive from `App`
  to `DesktopService`. Add a generator/binding contract proving every detail
  DTO remains reachable in generated `models.ts`.
- [x] Change the resource-detail generator template, not the checked-in output,
  so its still-unbound implementation wrappers no longer emit
  `//wails:ignore`. Removing the two template directives and running
  `go generate ./backend` removes all 38 generated directives in the same
  change—40 source/generated occurrences total—and keeps
  `TestAppBindingsGeneratedInSync` green.
- [x] Regenerate bindings and update only the central frontend backend-API
  adapter from the removed `backend/app.ts` module to the generated
  `DesktopService` module, preserving all higher-level imports. Keep the Phase 0
  binding test's registered-service discovery dynamic rather than restoring a
  hard-coded generated filename.
- [x] Update `cmd/project/wails_project_contract_test.go` to assert that
  `DesktopService` alone is registered while retaining the direct-Wails
  injection decision and its checks against `NewAdapter`, a generic `Desktop`
  interface, `MenuModel`, and `internal/desktop`.
- [x] Update the composition-order assertions in
  `TestUpdaterTempRootIsConfiguredBeforeAnyProcessDispatch` for any new service
  construction/registration literals without weakening the required temp,
  dispatch, reporter, backend, update, and registration ordering.
- [x] Remove the remaining 63 hand-written `//wails:ignore` directives from the
  now-unregistered implementation type. Require `rg '//wails:ignore' backend`
  to be empty at this checkpoint, except for a framework exception documented
  adjacent to the directive and proved by an executable binding test.
- [x] Update binding tests so the generated `DesktopService` exports exactly
  the frontend allowlist and no internal component receives generated callable
  bindings.
- [x] Migrate the Phase 1-affected test fixtures and test-only entry points to
  the service collaborators, and record the remaining direct-App counts.
- [x] Update `docs/architecture/application-lifecycle.md` with service
  registration, lifecycle/HTTP delegation, and direct-Wails composition; update
  `docs/architecture/data-access.md` with the generated `DesktopService` module,
  owner-shaped collaborator boundary, model-anchor reachability, and the
  generator's package constraint.

Exit criterion: the Wails boundary is defined by the registered service type,
not by ignoring methods on the backend implementation object. Runtime behavior
and the frontend command/event vocabulary are unchanged; each command maps to
one owner-shaped collaborator and no monolithic backend interface exists; all
detail DTOs remain in generated models; checked-in generated resource details
match their generator; and the direct-Wails and updater-order contract tests
enforce the preserved decisions. The backend contains no unproved
`//wails:ignore` directive. Phase 1 is independently shippable.

## Phase 2 — Extract live operations

- [x] Promote the existing `runtimeOperationRegistry`, shell-session lifecycle,
  port-forward lifecycle, and drain registration into
  `OperationsCoordinator`; do not create parallel registries or cleanup paths.
- [x] Move the shell, port-forward, and runtime-operation fields and locks from
  `App` into that owner without changing session or event DTOs.
- [x] Inject narrow cluster dependency resolution, permission checking, event
  emission, logging, and context dependencies; do not inject the composition
  root. Record the cluster dependency/retry collaborator as temporarily
  App-backed and require Phase 5A to replace its implementation with
  `ClusterRuntimeManager` without changing the operations owner.
- [x] Route the relevant `DesktopService` commands directly to the new owner.
  Replace the App-backed `OperationsCoordinator` collaborator as one unit.
- [x] Route cluster removal and application shutdown through one idempotent
  `StopCluster(clusterId)` / `Shutdown()` lifecycle instead of type-specific
  cleanup from unrelated owners.
- [x] Preserve the runtime-operation registry as the active-operation envelope;
  workflow detail events must not resurrect removed operations.
- [x] Delete the displaced `App` fields, methods, and test-only access paths in
  the same slice.
- [x] Move every affected direct-App test and test-only entry point to an
  `OperationsCoordinator` fixture, retaining a full runtime only for lifecycle
  integration tests, and record the remaining direct-App counts.
- [x] Update `docs/workflows/operation-lifecycle.md` with
  `OperationsCoordinator` ownership, per-cluster cleanup, registry semantics,
  and shutdown ordering; update `docs/workflows/shell-debug.md` where the new
  owner changes shell-session routing.
- [x] Prove startup listing, live typed events, per-cluster cleanup, repeated
  cleanup, and process shutdown under race tests.

Exit criterion: one component owns all live-operation state and cleanup, with
no `App` state, test seam, or lifecycle path remaining for those workflows.
Phase 2 is independently shippable.

## Phase 3 — Extract process-owned leaf services and persisted app state

- [ ] Compose the existing application-update coordinator directly behind a
  narrow `UpdateCoordinator` boundary and move its event subscriptions and
  shutdown ownership out of `App`. Add an owner-specific reset operation that
  covers the full updater state machine: skipped version, pending projection,
  prepared update, application attempt, cleanup entries, protected/staging
  directories, updater logs, and the corresponding in-memory state. Resolve the
  actual configured `StatePath` and `TempRoot`, validate dynamic paths with
  `updatestate`, and attempt/aggregate all cleanup work. Cancel and quiesce an
  active check/download before cleanup; reject reset without deleting recovery
  state when an application/restart attempt is active. Factory Reset must never
  delete updater state beneath live work or raw-delete a document-supplied path.
- [ ] Extract `AppLogService`, including the buffer, frontend ingestion,
  sequence reads, and typed log event projection.
- [ ] Extract `PreferencesService`, `FavoritesService`, and `UIStateStore` with
  their current independent files, schemas, and locks. Preserve the current
  rule that favorites I/O does not block grid persistence; share only stateless
  atomic-file helpers where appropriate.
- [ ] Give `PreferencesService` narrow, atomic repositories for the persisted
  Attention, per-cluster namespace-scope, and kubeconfig-search-path sections.
  It owns the physical settings-file lock and schema; the Attention and
  workspace owners retain their domain validation, commands, ordering, and live
  effects. Route `GetKubeconfigSearchPaths` to this repository, but keep
  `SetKubeconfigSearchPaths` behind a separate workspace workflow collaborator.
- [ ] Replace the raw `loadAppSettings` lazy initializer with one Preferences-
  owned coalesced load state machine. Route `GetAppSettings`, preference-update
  preparation, and error-reporting startup through `EnsureLoaded()`; route
  selected-cluster startup through `EnsureLoadedForStartup()`, which shares that
  state machine and adds only its atomic fallback policy. Callers receive an
  immutable snapshot carrying successful-load versus load-error-fallback
  provenance and never hold or manipulate the preferences mutex. Do not return
  a successful/ready snapshot to any waiter until both post-unlock container-log
  initialization pushes and the permission-fetch-policy push finish.
- [ ] Preserve each caller's failure contract. A normal `EnsureLoaded` failure
  installs nothing and dispatches nothing, so reads/updates surface the error
  and `ErrorReportingService` remains disabled. Selected-cluster startup uses a
  single Preferences-owned `EnsureLoadedForStartup()` call that performs the
  coalesced attempt and permitted fallback atomically. It logs the load failure,
  installs defaults only if no successful snapshot exists and no retry is in
  flight, and pushes both default container-log limits plus default permission
  concurrency after unlocking. Error reporting treats that snapshot's fallback
  provenance as disabled. Invoke this operation before entering
  `runSelectionMutation`, then restore only the returned selected-kubeconfig
  snapshot inside the serialized workspace mutation. Do not expose a separate
  no-argument fallback method whose decision can race a newer load attempt.
- [ ] Replace `applySettingsSideEffects` with one complete, stateless
  `SettingsEffectDispatcher` owned at the `PreferencesService` boundary. Cover
  the five current flags plus the current direct permission-concurrency read as
  six owner-shaped write-only routes: error-reporting enablement to
  `ErrorReportingService`; Kubernetes client QPS/burst to the current App
  cluster-runtime implementation; SSRR fetch concurrency to
  `PermissionFetchPolicy`; the per-scope container target cap to
  `ContainerLogsSelectionPolicy`; and the global container target cap plus
  metrics cadence to the current App refresh-runtime implementation. Phase 5A
  swaps the cluster sink and Phase 5B swaps the two refresh sinks; neither phase
  changes preference semantics. Change the
  `appPreferencePermissionSSRRFetchConcurrency` descriptor from its current no-
  effect form so update/import sets the sixth dispatch flag.
- [ ] Extract `ContainerLogsSelectionPolicy` from the package-global
  `backend/internal/containerlogs.currentPerScopeTargetLimit`. Give direct pod-
  log reads and live streams the same read-only policy collaborator (or an
  explicit captured limit) and make selection/warning helpers receive that
  limit instead of reading hidden global state. The policy starts at
  `defaultObjPanelLogsTargetPerScopeLimit`; successful `EnsureLoaded`,
  applicable updates, and settings import push the configured value through its
  sink.
- [ ] Extract `PermissionFetchPolicy` from the direct
  `permissionSSRRFetchConcurrency()` settings read. Give permission fan-out a
  read-only policy collaborator and make the policy start at
  `defaultPermissionSSRRFetchConcurrency`; successful `EnsureLoaded`, atomic
  startup fallback, applicable updates, and settings import push the selected
  value through its write-only sink. Replace the current App permission fan-out
  read with that policy and delete `permissionSSRRFetchConcurrency()` in this
  phase; Phase 4 carries the same collaborator into `ResourceGateway`.
- [ ] Preserve transactional and lock direction for the whole effect seam.
  Capture flags and an immutable settings snapshot under the preferences lock,
  persist, release the lock, and then dispatch; persistence failure dispatches
  nothing. Sinks never read/call back into `PreferencesService` or call another
  effect owner while holding an owner lock. Preserve the global limiter's
  default-then-push behavior and leaf init lock while the App implements that
  sink: no preferences, refresh, or subsystem lock is acquired under
  `containerLogsTargetLimiterMu`.
- [ ] Preserve the distinct startup rules while consolidating dispatch. Every
  successful `EnsureLoaded` pushes both configured container-log limits and
  configured permission concurrency after releasing the preferences lock;
  atomic startup fallback pushes all three defaults; `ErrorReportingService`
  applies its fail-closed startup value; new cluster clients and refresh
  subsystems receive the loaded QPS/burst and metrics interval during
  construction; and applicable updates/imports retarget existing owners live.
  Preserve best-effort independent dispatch so an error-reporting failure is
  logged without suppressing the other enabled effects.
- [ ] Extract `ClusterAttentionService` with `attentionRulesMu`, effective
  cluster/global rule calculation, persistence transactions through the
  preferences repository, the six Ignore/Restore commands, object-pruning, and
  a cluster-indexed registry of live Attention-index targets. Move all 15
  current App-receiver methods in `backend/app_cluster_attention.go`. Current
  refresh construction registers/unregisters those targets in this phase;
  Phase 5B changes the registrar, not the service direction.
- [ ] Extract `ErrorReportingService` with `errorReporter`, startup preference
  application, live enable/disable effects, installation-registration
  telemetry, and `installationTelemetryMu`. Replace
  `InitializeErrorReporting(*App)` with an unbound composition call from
  `main.go` that invokes `PreferencesService.EnsureLoaded()` and passes only its
  immutable result/error into `ErrorReportingService`. The reporting owner must
  not retain or call Preferences; it enables only for successful-load
  provenance. Keep the initializer absent from `DesktopService` and the
  generated command surface, and preserve the rule that reset waits for
  registration before deleting durable state.
- [ ] Preserve `UpdateAppPreferences` as the only general preference mutation
  contract, and keep theme/window-settings writes aligned with their settings
  document owner.
- [ ] Route kubeconfig search-path changes through one narrow workspace workflow
  collaborator used by both `SetKubeconfigSearchPaths` and settings import. In
  this phase the current App implements the collaborator without being stored as
  `*App`; Phase 5C swaps it to `WorkspaceCoordinator`. Preserve serialized
  persist-before-rediscovery, watcher retargeting, selection pruning, refresh/
  client/operation/projection cleanup, and remaining-selection persistence.
- [ ] Extract `DataManagementCoordinator` over the real preference, favorite,
  UI-state, update, workspace, refresh/cache, operation, projection, and error-
  reporting, settings-policy, and Attention owners; do not create a second
  portable-state store. Its Factory Reset operation must finish live owner
  cleanup, wait for installation registration, remove/reset every app-owned
  durable and in-memory state through owner-shaped collaborators, and invalidate
  Preferences readiness only as part of the Preferences reset. After persistence
  locks are released, dispatch defaults through all six runtime setting sinks and
  clear Attention's in-memory rule projection before frontend reload. Include
  `favorites.json`, `application-update.json`, and Update-owned configured/dynamic
  staging, cleanup, and log artifacts; preserve repeated-reset safety and
  existing cleanup order, and make the next `EnsureLoaded` perform a real load
  and all load-time post-unlock pushes. Current App-backed workspace/refresh reset
  collaborators are temporary and are replaced in Phases 5B/5C. Attempt
  every independent owner reset, aggregate failures, and return success only for
  a complete reset so the frontend never reloads after partial cleanup.
- [ ] Define one app-state artifact manifest shared with the offline
  `cmd/project` reset task as a stateless `internal/appstate` path/owner inventory
  for static Go-owned roots with no live deletion behavior. Make every shared
  path resolver side-effect-free and move parent-directory creation into write/
  open paths, so merely inventorying or resetting a missing artifact creates no
  directories. Represent configured/durable updater staging and logs as
  `UpdateCoordinator`-resolved dynamic artifacts, not raw paths for the generic
  manifest to delete. Keep offline whole-directory removal separate from live
  owner-directed reset, and change Factory Reset UI copy from “restarts the app”
  to “reloads the app” unless this phase implements and tests an actual native
  relaunch. Frontend storage clearing/reload happens only after the backend reset
  has completed and is not a substitute for backend cleanup.
- [ ] Keep the settings-effect dispatcher dependency-complete but not broad: it
  knows the six runtime setting values and their typed sinks, not `App`,
  `ApplicationRuntime`, arbitrary preferences, or owner internals. Adding a
  future effect requires an explicit ledger row, target owner, sink, startup
  rule, and failure/ordering test.
- [ ] Extract native file dialogs, window geometry, appearance/menu projection,
  targeted peer events, and the process-wide ephemeral `sidebarVisible`,
  `diagnosticsPanelVisible`, and `appLogsPanelVisible` state into a concrete
  `DesktopShell` that receives `application.App` directly. Preserve the existing
  menu/current-window event projection without moving these fields into
  persisted `UIStateStore`. Do not introduce a generic `Desktop` interface,
  `MenuModel`, `NewAdapter`, or `internal/desktop` package.
- [ ] Route the corresponding Wails commands through these owners and remove
  their displaced `App` fields and methods. Replace each affected App-backed
  leaf-service collaborator as its complete owner moves.
- [ ] Update the direct-Wails project contract test for the concrete
  `DesktopShell` owner without weakening its prohibited-adapter assertions.
- [ ] Move affected direct-App tests and test-only entry points to focused leaf
  service or concrete shell fixtures, and record the remaining counts. Replace
  the 24 direct test calls to `loadAppSettings` with public `EnsureLoaded`,
  `EnsureLoadedForStartup`, persistence-repository, or caller-failure tests as
  appropriate; do not retain a raw-loader or separate fallback test escape
  hatch.
- [ ] Update `docs/architecture/application-lifecycle.md` with concrete
  `DesktopShell`, process-wide ephemeral shell visibility, settings-effect
  dispatch ordering, `EnsureLoaded`/`EnsureLoadedForStartup` readiness, total
  Factory Reset and frontend-reload contract, the non-Wails error-reporting
  startup path, update/log lifecycle ownership, and leaf service shutdown
  ordering; update `docs/architecture/data-access.md` with the complete six-route
  effect seam, lazy-load/failure contracts, post-commit dispatch, and owner-
  shaped sink rule; update `docs/architecture/permissions.md` with
  `PermissionFetchPolicy` ownership and its settings-to-policy direction;
  update
  `docs/architecture/error-reporting.md` with `ErrorReportingService`, update
  `docs/architecture/multi-cluster.md` with `ClusterAttentionService`, and
  update `docs/architecture/namespace-scope.md` with the physical settings
  repository owner while leaving rebuild orchestration assigned to Phase 5C;
  update `docs/workflows/logs/container-logs.md` with
  `ContainerLogsSelectionPolicy`, both load/update limit pushes, the global
  limiter sink, and their lock direction. Do not edit
  `docs/frontend/navigation.md` for a
  backend-only Attention owner rename because its routing/facet contract is
  unchanged; update it only if implementation changes that frontend behavior;
  update `docs/workflows/application-updates.md`, including the complete updater-
  state reset, configured-root and path-validation rules, active-work rejection/
  quiescence, and dynamic-artifact ownership, and
  `docs/workflows/logs/application-logs.md` with their extracted owners.
- [ ] Prove atomic preference batches, rollback on persistence failure,
  coalesced first-load readiness, first-paint settings reads, theme/favorite
  round trips, window-specific geometry, process-wide shell visibility/menu
  projection, Attention
  mutation/persistence/live application, error-reporting opt-in/out,
  installation-registration/reset serialization, all six runtime setting routes
  for preference updates and settings import, no effects on persistence failure,
  both container-log and permission-policy configured/default load pushes,
  concurrent load/retry/startup-fallback behavior, total and repeated Factory
  Reset including favorites/updater state, Attention rules, default dispatch to
  all six runtime sinks, and other live in-memory owners, shared offline/live
  static artifact-manifest coverage, side-effect-free path resolution, updater
  reset of prepared/attempt/cleanup state and configured staging/log roots,
  updater reset versus active work, partial-reset
  error aggregation without frontend reload, caller-specific load-error
  behavior, absence of the error-reporting initializer from generated bindings,
  live QPS/burst and metrics retiming, update scheduler uniqueness, and app-log
  sequence/event behavior.

Exit criterion: process-owned leaf state has explicit owners, and persistence
and native desktop side effects meet through narrow interfaces rather than an
`App` back-pointer. Attention and error-reporting state, locks, commands, and
lifecycle have their named owners; shell visibility has an explicit
process-wide owner; and preferences drive all six runtime setting routes only
through the complete post-commit effect seam. The package-global per-scope limit
and direct permission-to-preferences read are gone, Factory Reset is total before
frontend reload, static path inventory is side-effect-free, dynamic updater
artifacts are validated and owner-resolved, and the remaining App-backed cluster/
refresh and workspace-reset/search-path collaborators are explicitly temporary
until Phases 5A–5C.
Native access remains concrete and direct. Phase 3 is independently shippable
only when no owner outside `PreferencesService` can lock preference state,
trigger a raw load, or separately install startup fallback.

## Phase 4 — Extract the resource boundary

- [ ] Introduce `ResourceGateway` in package `backend` as the request-shaped
  coordinator over the existing catalog, capability, per-kind resource, YAML,
  object-action, node-log, and Helm services. It remains in that package while
  `genappbindings` emits its generated receiver methods there.
- [ ] Move response-cache ownership and permission-aware cache validation into
  that boundary.
- [ ] Inject the Phase 3 read-only `PermissionFetchPolicy` into
  `ResourceGateway` and make every SSRR namespace fan-out obtain its bounded
  concurrency from that policy. Preserve the Phase 3 removal of
  `permissionSSRRFetchConcurrency()` and any direct resource/permission
  dependency on `PreferencesService`; settings continue to push updates one way
  into the policy.
- [ ] Introduce a narrow cache-invalidation collaborator owned by
  `ResourceGateway`. Register it with the current refresh construction in this
  phase; Phase 5B changes only the caller to `RefreshCoordinator`. The
  dependency remains refresh-to-resource and never resource-to-refresh.
- [ ] Replace the response-cache ingest sink's `*App` back-pointer with that
  invalidator interface or function, and migrate every invalidation hook that
  currently receives a refresh `*system.Subsystem` without creating a callback
  into the composition root.
- [ ] Replace helper signatures that accept `*App` with narrow context,
  dependency-resolver, transport-health, lifecycle, logging, event, and cache
  interfaces. Record the cluster resolver/transport-health implementations as
  temporarily App-backed and require Phase 5A to replace them with
  `ClusterRuntimeManager`.
- [ ] Inject the read-only `ContainerLogsSelectionPolicy` into the pod-log
  resource service. Direct/fallback fetch and live refresh streaming must use
  the same per-scope limit value and warning semantics without
  `ResourceGateway` depending on `RefreshCoordinator`.
- [ ] Keep generated `Get<Kind>` dispatch internal to `ResourceGateway`; expose
  only commands actually present in `DesktopService`. Make the receiver change
  in `backend/internal/genappbindings/render.go`, run `go generate ./backend`,
  and verify `TestAppBindingsGeneratedInSync`; do not hand-edit
  `backend/resource_details_generated.go`.
- [ ] Preserve the object catalog as the only existence and GVK/GVR resolver,
  and preserve the generated resource-kind registry as the per-kind vocabulary.
- [ ] Route resource commands directly from `DesktopService` and remove the
  displaced `App` methods and fields. Replace the App-backed
  `ResourceGateway` collaborator as one unit.
- [ ] Move affected direct-App resource tests and test-only entry points to a
  `ResourceGateway` fixture, and record the remaining counts.
- [ ] Update `docs/architecture/data-access.md` with `ResourceGateway`, catalog
  and permission dependency direction, generated receiver placement, and
  refresh-to-cache invalidation ownership, plus its read-only dependencies on
  the shared container-log selection and permission-fetch policies. Update
  `docs/architecture/permissions.md` with the ResourceGateway-to-policy read
  direction and absence of preference reads.
- [ ] Prove complete identity, cluster-scoped dependency resolution, permission
  denial, configured/default/live-updated SSRR concurrency, auth retry, cache
  invalidation, YAML ownership/apply, and object-action behavior.

Exit criterion: resource reads and mutations no longer depend on `App`, guess a
cluster, read Preferences directly, or duplicate catalog and permission
behavior. The cache and all invalidation entry points have one owner, current
refresh construction depends one-way on its invalidator, and permission fan-out
depends only on the read-only policy, so this phase does not wait for Phase 5.
Phase 4 is independently shippable.

## Phase 5 — Extract cluster, refresh, and workspace ownership

This is the highest-risk area. It is divided into three complete, independently
shippable vertical lifecycle slices. A subphase must move its owner's state,
locks, startup, readiness, teardown, consumers, and tests together; do not stop
inside a subphase with split ownership.

### Phase 5A — Cluster runtime

- [ ] Introduce `ClusterRuntimeManager` as the sole owner of kubeconfig
  discovery and watcher-path retargeting, cluster clients, auth state/recovery,
  cluster lifecycle, transport failure state, API metrics, cluster dependency
  resolution, heartbeat scheduling/probing, and typed health-event publication.
  It writes health changes through a projection sink and does not own replayable
  projection state.
- [ ] Extract `ClusterWorkspaceProjection` as the leaf owner of
  `clusterWorkspaceMu`, `clusterWorkspaceRevision`, `clusterHealth`, and
  `clusterScopeRevisions`. Give current cluster, selection, governor, lifecycle,
  and scope workflows narrow change/health/scope/cleanup sinks; move no source
  owner's clients, selections, or subsystem state into the projection.
- [ ] Promote the existing `clusterLifecycle` and
  `kubernetesAPIMetricsRegistry` into that owner rather than duplicating their
  state machines or registries.
- [ ] Replace the watcher/auth/transport callbacks that re-enter workspace
  selection with the owner-local typed `ClusterRuntimeIntent` queue. Emit the
  three ledgered intent kinds with complete cluster identity, generation, paths,
  and cause/diagnostic data as applicable. Publication must remain non-blocking
  when invoked under the auth-manager mutex and semantically lossless through
  bounded wakeup plus owner-held latest-pending coalescing; do not spawn an
  unbounded goroutine per signal. Give the queue explicit startup, cancellation,
  drain, and shutdown ownership. The current `App` consumes it through its
  existing serialized selection workflow in this phase; the cluster owner
  stores no App/workspace callback or back-pointer, and Phase 5C swaps only the
  consumer.
- [ ] Replace the Phase 3 App-backed Kubernetes client rate-limit sink with
  `ClusterRuntimeManager`. Supply the loaded QPS/burst as construction input for
  future clients and apply later settings-effect pushes to every existing
  client's mutable limiter, metrics registry entry, and REST configuration.
  The cluster owner must not read or call back into `PreferencesService`.
- [ ] Keep `clusterOperationCoordinator` as an independent per-cluster
  serialization primitive injected into the workflows that require it; do not
  turn it into a composition-root or owner back-pointer.
- [ ] Expose one narrow rediscover-and-retarget operation for the current App
  search-path workflow. It reports discovery/watcher outcomes without pruning
  workspace selections or calling refresh/operations/projection owners; Phase
  5C makes `WorkspaceCoordinator` its final caller.
- [ ] Let the current `App` orchestrate the extracted cluster owner until Phase
  5C, but delete every displaced cluster field, lock, and implementation method
  from `App` in this subphase. Delete the displaced projection fields and lock
  too; no client, auth, health, or scope-revision state may be mirrored.
- [ ] Replace every App-backed cluster-runtime collaborator already held by an
  extracted component, not only the settings sink or `DesktopService`: rewire
  `OperationsCoordinator` dependency resolution/retry, `ResourceGateway`
  dependency resolution and transport-health recording, and every additional
  non-refresh consumer in the Phase 0 ledger directly to narrow
  `ClusterRuntimeManager` interfaces. Rewire current App workspace orchestration
  to call those same manager interfaces rather than implementing cluster
  behavior itself. Refresh construction/readiness is the only permitted
  cluster-runtime consumer deferred to Phase 5B.
- [ ] Replace every App-backed `DesktopService` collaborator assigned to
  `ClusterRuntimeManager` in the Phase 0 command ledger; record an explicit
  empty set if no frontend command belongs directly to this owner.
- [ ] Preserve the readiness gate that blocks dependent refresh/resource work
  before clients are ready while allowing discovery, client construction, and
  auth recovery needed to reach readiness.
- [ ] Preserve lock ordering and keep client construction, callbacks, and
  teardown outside unrelated state locks.
- [ ] Move affected direct-App cluster tests and test-only entry points to a
  `ClusterRuntimeManager` fixture, retaining explicit composition tests for the
  readiness boundary, and record the remaining counts.
- [ ] Update `docs/architecture/multi-cluster.md` with
  `ClusterRuntimeManager` and `ClusterWorkspaceProjection` ownership,
  dependency readiness, auth recovery, lifecycle/metrics/heartbeat ownership,
  kubeconfig discovery/watcher retargeting, initial/live client rate-limit
  application, the typed non-blocking/coalesced cluster-runtime intent producer,
  its temporary App consumer, replay-state sinks, and their one-way
  collaborators. Update
  `docs/architecture/application-lifecycle.md` with heartbeat/projection startup
  and teardown ordering.
- [ ] Prove discovery, no-selection startup, dependency readiness, transport
  failure, health classification/events/replay, aggregate revision consistency,
  auth failure/recovery, non-blocking publication while the auth-manager lock is
  held, bounded/coalesced intent delivery, cancellation, stale-generation input,
  every non-refresh cluster-runtime consumer wired to the manager, per-cluster
  projection cleanup, and repeated teardown under race tests.

Exit criterion: all cluster clients, auth/lifecycle state, transport failure
state, dependency resolution, API metrics, and heartbeat lifecycle have one
owner; discovery/watcher retargeting is exposed without absorbing workspace
pruning; watcher/auth/transport producers publish through the typed owner-local
intent queue without calling workspace; replayable health/scope state has a
separate leaf owner; every non-refresh cluster-runtime collaborator points to
`ClusterRuntimeManager`; and `App` is only the explicitly temporary intent
consumer/caller for later workspace orchestration, not an implementation of
cluster dependencies. Phase 5A is independently shippable.

### Phase 5B — Refresh runtime

- [ ] Introduce `RefreshCoordinator` as the sole owner of the refresh manager,
  atomically published service handler, subsystem maps, streams, governor,
  spill state, catalog runtimes, published refresh-domain `telemetryRecorder`,
  process-wide `containerLogsTargetLimiter` and
  `containerLogsTargetLimiterMu`, and refresh teardown.
- [ ] Promote the existing `refreshServiceHandler` into that owner rather than
  adding a second handler-publication mechanism.
- [ ] Inject narrow cluster-runtime dependencies from
  `ClusterRuntimeManager`, replacing every refresh construction/readiness
  collaborator explicitly deferred by Phase 5A, and inject the cache invalidator
  from `ResourceGateway`.
  Preserve the one-way flow `RefreshCoordinator` → `ResourceGateway`
  invalidation; `ResourceGateway` must not call back into refresh.
- [ ] Inject the read-only `ContainerLogsSelectionPolicy` used by both pod-log
  reads and live streams. It remains an independent leaf owner so this shared
  policy does not create a reverse `ResourceGateway` → `RefreshCoordinator`
  dependency alongside refresh-to-resource cache invalidation.
- [ ] Let the current `App` orchestrate the extracted refresh owner until Phase
  5C, but delete every displaced refresh, stream, governor, catalog-runtime,
  handler, limiter, and teardown field from `App` in this subphase. No
  subsystem, publication, or limiter state may be mirrored.
- [ ] Replace every App-backed `DesktopService` lifecycle, HTTP, or command
  collaborator assigned to `RefreshCoordinator` in the Phase 0 ledger; record
  an explicit empty command set if refresh has no directly callable command.
- [ ] Preserve atomic handler publication and stream-generation replacement
  before old producers stop, including unpublication before producer release.
- [ ] Replace both Phase 3 App-backed refresh settings sinks with
  `RefreshCoordinator`: global container target limit updates mutate the one
  shared limiter, while metrics-interval updates retime every connected
  subsystem. Supply the loaded metrics interval during future subsystem
  construction; neither sink reads or calls back into `PreferencesService`.
- [ ] Replace the Phase 3 App-backed refresh/cache reset collaborator used by
  `DataManagementCoordinator`. It must stop/unpublish refresh producers before
  clearing refresh-owned spill/cache state, remain safe when called repeatedly,
  and expose no general refresh or filesystem interface.
- [ ] Move `sharedContainerLogsTargetLimiter` with the limiter fields. Every
  subsystem receives the same process-wide instance; lazy construction starts
  at `defaultObjPanelLogsTargetGlobalLimit`; and the Phase 3 preferences sink
  immediately pushes the selected configured/default value after
  `EnsureLoaded`, atomic startup fallback, or update whether that happens
  before or after the first subsystem build.
- [ ] Keep `containerLogsTargetLimiterMu` a leaf init lock. The accessor and
  `SetLimit` sink must not read settings, call `PreferencesService`, or acquire
  refresh/subsystem locks while it is held. `PreferencesService` releases its
  own lock before invoking the sink, and Refresh never pulls preferences.
- [ ] Implement the metrics-interval sink by snapshotting subsystem pointers
  under the refresh registry read lock, releasing that lock, and then calling
  each manager. It must not hold the subsystem-map lock across manager calls or
  call another settings-effect owner.
- [ ] Move refresh-domain telemetry publication with the subsystem lifecycle and
  inject narrow telemetry recorder/snapshot collaborators into
  `ResourceGateway` and other consumers; do not put refresh telemetry under
  `ErrorReportingService` merely because both areas report diagnostics.
- [ ] Replace current App-owned Attention synchronization with one-way
  registration: `RefreshCoordinator` registers and unregisters each live
  cluster Attention-index target with `ClusterAttentionService`, which applies
  persisted and subsequent rules without retaining or calling refresh.
- [ ] Route auth recovery through the same cluster/refresh lifecycle contracts;
  do not add a recovery-only subsystem-construction path.
- [ ] Preserve lock ordering and keep informer/catalog startup, callbacks, and
  teardown outside unrelated state locks.
- [ ] Move affected direct-App refresh tests and test-only entry points to a
  `RefreshCoordinator` fixture, retaining explicit composition tests for
  cluster readiness and cache invalidation, and record the remaining counts.
- [ ] Update `docs/architecture/refresh-system.md` with
  `RefreshCoordinator` ownership, atomic handler/stream replacement, teardown,
  cluster dependencies, initial/live metrics cadence, settings-sink lock
  direction, refresh telemetry, Attention-target registration, and
  `ResourceGateway` invalidation direction; update
  `docs/architecture/data-layer.md` and
  `docs/architecture/data-freshness.md` where catalog-runtime, telemetry, or
  Attention publication ownership changes. Document the owner-directed Factory
  Reset teardown/cache-clearing operation and its unpublish-before-delete order.
  Update
  `docs/workflows/logs/container-logs.md` with the final global-limiter owner,
  the independent selection-policy dependency, shared instance,
  default-then-push startup, and lock-order contract.
- [ ] Prove initial publication, refresh rebuild, stream replacement, auth
  recovery, cache invalidation, telemetry replacement, Attention target
  registration/removal, one shared limiter under concurrent subsystem builds,
  settings-load/update limit propagation in both startup orders, live and
  future-subsystem metrics retiming, shared per-scope policy use, Factory Reset
  unpublish-before-cache-clear, deadlock-free lock ordering, unpublication, and
  repeated teardown under race tests.

Exit criterion: refresh, catalog-runtime, stream, governor, spill, and handler
publication/telemetry/limiter state have one owner; Attention targets follow the
same subsystem lifecycle; the limiter remains default-then-push and leaf-locked;
both refresh settings sinks and the refresh/cache reset collaborator have
replaced their App-backed implementations; and the preferences, selection-
policy, cluster, Attention, data-management, and resource dependency arrows are
explicit and acyclic. Phase 5B is independently shippable.

### Phase 5C — Workspace orchestration

- [ ] Introduce `WorkspaceCoordinator` as the sole owner of peer-window
  selection sets, serialized selection mutations, generations/supersession,
  foreground intent, selection diagnostics, and aggregate workspace-state
  assembly. Move `selectionDiag` with all readers/writers and compose cluster,
  refresh, selection, foreground, and `ClusterWorkspaceProjection` snapshots
  without copying their state into the coordinator.
- [ ] Assign `GetSelectionDiagnostics`, `GetClusterAllowedNamespaces`, and
  `SetClusterAllowedNamespaces`, and `SetKubeconfigSearchPaths` to the
  `WorkspaceCoordinator` command collaborator. Namespace-scope and search-path
  reads/writes use narrow repositories owned by `PreferencesService`; the
  coordinator owns their cross-owner mutation contracts.
- [ ] Move `requestClusterScopeRebuildFn` and `scopeRebuildQueued` into the
  workspace scope-change workflow. Preserve persist-before-rebuild, rapid-edit
  coalescing, serialized cluster operations, refresh teardown/rebuild, scope
  revision advancement through `ClusterWorkspaceProjection`, and final
  `cluster:scope:changed` emission in that order.
- [ ] Replace the Phase 3 App-backed search-path workflow used by both
  `SetKubeconfigSearchPaths` and settings import. Preserve serialized validation
  and persist-before-rediscovery, ask `ClusterRuntimeManager` to rediscover and
  retarget the watcher, classify removed selections, and then sequence refresh
  reconciliation/teardown, selection commit, client/auth removal, operation and
  projection cleanup, and remaining-selection persistence in the current order.
  Neither `PreferencesService`, `ClusterRuntimeManager`, nor
  `DataManagementCoordinator` may duplicate that sequence or call back into the
  workspace owner.
- [ ] Make `WorkspaceCoordinator` call `ClusterRuntimeManager` and
  `RefreshCoordinator` in the documented order. Neither owner may call back
  into the coordinator or store a pointer to the other.
- [ ] Replace the Phase 5A App intent consumer with `WorkspaceCoordinator` as the
  sole consumer of `ClusterRuntimeIntent`. Drain/coalesce kubeconfig-source,
  auth rebuild/teardown, and transport rebuild requests into the same serialized
  selection-mutation path used by commands; reject stale generations before
  side effects, retain `clusterId` through cleanup, and stop consumption before
  cluster-runtime shutdown. Do not replace the typed owner-local queue with a
  generic event bus or a callback stored by `ClusterRuntimeManager`.
- [ ] Move selected-cluster startup onto the Phase 3 Preferences contract, not
  the old raw loader: call atomic `EnsureLoadedForStartup()` before acquiring the
  selection-mutation lock, then restore the immutable selected-kubeconfig
  snapshot inside the serialized mutation. Do not reintroduce preference
  locking, a two-call fallback protocol, or load-effect dispatch inside
  Workspace.
- [ ] Replace the Phase 3 App-backed workspace reset collaborator used by
  `DataManagementCoordinator`. The workspace reset operation serializes against
  selection changes and sequences cluster, refresh, operation, and projection
  cleanup before durable owner reset begins; it does not delete persistence
  files itself.
- [ ] Preserve per-window foreground demand and cluster-tab ownership; a shared
  cluster remains alive until its final peer releases it.
- [ ] Preserve lock ordering and ensure no callbacks, client construction,
  informer/catalog startup, or teardown occur while an unrelated state lock is
  held.
- [ ] Route `ApplicationLifecycle` startup and shutdown through the extracted
  owners in the existing order, including operation cleanup before cluster
  teardown and refresh unpublication before producer release.
- [ ] Delete the displaced workspace selection/generation state and remaining
  cluster/refresh orchestration methods from `App`; do not retain forwarding
  methods except the permanent `DesktopService` collaborator boundary.
- [ ] Replace every App-backed `DesktopService` collaborator assigned to
  `WorkspaceCoordinator` in the Phase 0 command ledger.
- [ ] Move affected direct-App workspace tests and test-only entry points to a
  `WorkspaceCoordinator` fixture, retaining full runtime fixtures only for
  lifecycle and cross-owner ordering, and record the remaining counts.
- [ ] Update `docs/architecture/application-lifecycle.md` and
  `docs/architecture/multi-cluster.md` with `WorkspaceCoordinator` ownership,
  peer release, selection diagnostics, aggregate projection reads, selection
  ordering, kubeconfig-search-path persist/rediscover/prune ordering, atomic
  settings-load/default-fallback ordering, typed cluster-runtime intent
  consumption/coalescing/stale-generation rejection, Factory Reset workspace
  cleanup, readiness, and application-shutdown sequencing. Update
  `docs/architecture/namespace-scope.md` with the preferences repository,
  workspace rebuild/coalescing owner, and unchanged convergence ordering.
- [ ] Prove concurrent peer selection, superseded selection, foreground demand,
  selection diagnostics, namespace-scope persist/rebuild/event convergence,
  rapid-edit coalescing, search-path update/import discovery/watcher/pruning
  convergence, configured/default startup settings before selection, total-reset
  workspace cleanup, kubeconfig/auth/transport intent convergence through the
  one serialized consumer, stale-generation rejection, bounded/coalesced burst
  handling, cancellation, aggregate health/scope replay, shared-cluster peer
  close, application quit, and repeated teardown under race tests.

Exit criterion: workspace selection has one owner; cluster and refresh owners
are invoked in one explicit direction; scope commands/rebuild, kubeconfig-
search-path changes/import, total-reset cleanup, selection diagnostics, and
aggregate replay assembly have moved together without absorbing the leaf
projection; the App intent consumer is gone and cluster-originated work reaches
the same serialized mutation path without a reverse owner dependency; and
startup, peer release, and shutdown have no duplicate path. Phase 5C is
independently shippable.

## Phase 6 — Retire the god object

- [ ] Replace `App` with an `ApplicationRuntime` composition root containing
  component references and composition-time options only.
- [ ] Remove all remaining domain state, mutexes, caches, and business methods
  from the composition root.
- [ ] Rename `backend.NewApp(wailsApp, reporter)` only after updating
  `TestWailsApplicationIsInjectedDirectlyWithoutDesktopAdapter` to require the
  replacement composition literal and direct `application.App` argument while
  retaining every prohibited-adapter assertion.
- [ ] Update `TestUpdaterTempRootIsConfiguredBeforeAnyProcessDispatch` for the
  replacement constructor literal while preserving its full required ordering.
- [ ] Complete the cross-phase test-support audit: focused components are the
  default fixtures; the full runtime is used only for composition/lifecycle
  integration tests; no direct `App` construction remains; and all 19 original
  App-only test entry points have moved to owners or been deleted.
- [ ] Prove that no `DesktopService` collaborator remains App-backed and every
  command delegates directly to its final owner-shaped interface.
- [ ] Remove obsolete compatibility wrappers and remaining test entry points
  rather than forwarding them indefinitely.
- [ ] Add architecture tests proving that production registers only
  `DesktopService`, `appwindow` depends only on its lifecycle interface,
  internal components do not store the composition root, and generated
  commands match the frontend boundary.
- [ ] Re-run the Phase 1 `rg '//wails:ignore' backend` architecture guard and
  prove it remains empty; Phase 6 must not defer removal of any of the original
  103 directives. If a later framework-required exception was introduced, it
  must already have an adjacent explanation and executable binding test.
- [ ] Measure the resulting component method/field distribution. Treat a new
  god component as a failed migration even if `App` itself is small.
- [ ] Update `docs/architecture/application-lifecycle.md` with the final
  `ApplicationRuntime` composition root and removal of `App`; reconcile
  `docs/architecture/data-access.md` with the final service-to-owner command
  map and generated package layout.

Exit criterion: the old `App` implementation object no longer exists as a
state or behavior owner; no production or test struct, function, or method
depends on `*App`; the direct-Wails and composition-order tests enforce their
original decisions under the new name; and no replacement component has
absorbed the old responsibility set. Phase 6 is independently shippable.

## Phase 7 — Final durability audit and plan retirement

The relevant owner documentation and routing must already have been updated at
each independently shippable checkpoint. This phase audits the complete result;
it is not the first time durable contracts are written.

- [ ] Audit `docs/architecture/application-lifecycle.md` for the final
  `DesktopService`, `ApplicationLifecycle`, composition, readiness, window, and
  shutdown contracts already introduced by Phases 1, 3, 5A, 5C, and 6; fix any
  drift found by the audit.
- [ ] Audit `docs/architecture/data-access.md` for the generated service module,
  owner-shaped collaborators, `EnsureLoaded`/`EnsureLoadedForStartup` readiness
  and failure/fallback, complete six-route settings-effect seam,
  `ContainerLogsSelectionPolicy`, `PermissionFetchPolicy`, `ResourceGateway`,
  cache invalidation, and stable frontend adapter boundary already introduced by
  Phases 1, 3, 4, and 6. Audit `docs/architecture/permissions.md` for the
  settings-to-policy-to-resource direction.
- [ ] Audit `docs/architecture/multi-cluster.md`,
  `docs/architecture/refresh-system.md`, and
  `docs/architecture/data-layer.md` for the
  Attention/cluster/workspace/projection/refresh owner names, live rate/metrics
  settings sinks, kubeconfig-search-path orchestration, the typed cluster-runtime
  intent producer/consumer and backpressure contract, total-reset cleanup, and
  ordering introduced by Phases 3 and 5A–5C.
- [ ] Audit `docs/architecture/namespace-scope.md`,
  `docs/architecture/data-freshness.md`, and
  `docs/architecture/error-reporting.md` respectively for scope orchestration,
  Attention-clock/target publication and refresh telemetry, and error-reporting
  ownership introduced by Phases 3 and 5A–5C.
- [ ] Audit `docs/workflows/operation-lifecycle.md`, application-update docs,
  and log docs for the component owners, complete updater-state reset under
  configured roots with validated dynamic artifacts, shared container-log
  selection policy, and settings-to-runtime effect direction introduced by
  Phases 2, 3, and 5B.
- [ ] Reconcile backend/frontend `AGENTS.md` starting points and the affected
  app-shell, operations, cluster-auth-lifecycle, refresh-subsystem,
  permissions-capabilities, and shared-resource-model skills where routing or
  owner names changed.
- [ ] Remove obsolete comments, generator assumptions, concrete test helpers,
  and architecture checks tied to `backend.App`.
- [ ] Delete this plan after every durable contract has moved to its owner and
  the final validation gate passes.

Exit criterion: every final owner and cross-owner ordering contract is present
in durable documentation and agent routing, no obsolete `App` guidance remains,
and this temporary plan is deleted. Phase 7 is a documentation-only shippable
checkpoint.

## Open questions and resolution gates

These are implementation investigations, not invitations to preserve the
current architecture indefinitely.

1. **Package boundaries:** begin extractions as focused structs in `backend`
   when that is necessary to avoid import cycles. Move a component into a
   package only after its dependency direction is narrow and proved; package
   movement is not itself a completion criterion. `DesktopService` and
   `ResourceGateway` are not open placement questions under the current
   generator: both remain in `backend` because generated methods need
   same-package receivers. Moving either requires a prior, independently tested
   `genappbindings` target-package option; it is not part of this decomposition.
2. **Composition-root name:** use `ApplicationRuntime` in the target state unless
   implementation evidence identifies a clearer domain term. Do not retain
   `App` merely to avoid call-site churn.
3. **Desktop service size:** retain one registered service unless executable
   evidence shows that multiple Wails services improve lifecycle or route
   ownership without duplicating startup/shutdown. Internal component
   decomposition does not require multiple transport services.

## Validation

Every behavior-changing phase follows red/green/refactor TDD. Before moving an
owner, first run a failing test that proves the intended component boundary or
real lifecycle behavior; then move the smallest complete vertical slice and
refactor under green.

Focused validation by affected phase must include:

- `TestGeneratedWailsAppExportsMatchFrontendBoundary` (renamed when the bound
  service changes) for exact generated command parity and the generated module
  path, plus typed event coverage;
- `TestWailsApplicationIsInjectedDirectlyWithoutDesktopAdapter` for direct
  concrete Wails injection and the prohibited-adapter patterns, updated rather
  than removed when the composition constructor changes;
- `TestUpdaterTempRootIsConfiguredBeforeAnyProcessDispatch` for the required
  `main.go` composition order under each constructor/service rename;
- `go generate ./backend` and `TestAppBindingsGeneratedInSync` whenever the
  generated resource-detail receiver or directives change;
- a model-reachability assertion proving every detail DTO remains in generated
  `models.ts` after `BindingModelAnchor` and its inject directive move;
- a compile/generator contract proving generated `DesktopService` and
  `ResourceGateway` receiver methods remain in package `backend`; any future
  target-package work requires its own red test before either type moves;
- a command-to-collaborator contract proving every generated command maps to
  exactly one owner-shaped `DesktopService` interface and that extraction of an
  owner removes its App-backed implementation;
- a Phase 0 ledger-coverage check accounting for all 98 current `App` field
  declarations and all 87 frontend commands exactly once, including the six
  Attention commands, two namespace-scope commands, both kubeconfig-search-path
  commands, selection diagnostics, and Factory Reset, plus every mutable
  package-global settings target including the current per-scope container-log
  atomic and every direct cross-owner settings read including permission SSRR
  concurrency; every cluster-runtime consumer in Operations, Resource,
  workspace, refresh, lifecycle, and transport-health paths; and every
  watcher/auth/transport producer that asynchronously re-enters selection;
- a cluster-runtime collaborator composition contract enumerating every Phase 0
  consumer and proving Phase 5A points each non-refresh resolver, retry, rate-
  limit, and transport-health seam to `ClusterRuntimeManager`, with only the
  named refresh consumers deferred to Phase 5B;
- a settings-effect contract proving the five current flags plus the converted
  permission-concurrency read map exactly once as six routes to their five target
  owners, updates and imports dispatch only after successful persistence and lock
  release, persistence failure dispatches none, one target failure does not
  suppress independent effects, and a newly added runtime setting cannot omit
  its owner, sink, startup rule, or test;
- `PreferencesService.EnsureLoaded`/`EnsureLoadedForStartup` tests proving the
  four production caller paths share one coalesced state machine, concurrent
  first callers cause one successful disk load and one set of post-unlock
  container-log/permission-policy pushes, no caller observes ready state before
  those pushes complete, and ordinary failure remains retryable without
  installing a snapshot or dispatching effects;
- a bounded concurrency test in which an ordinary load fails while another
  caller retries, proving startup fallback either joins/waits for the in-flight
  retry or installs defaults atomically before a retry begins, never uses stale
  failure state, and never overwrites a successful snapshot;
- caller-policy tests proving settings reads/updates surface load failure,
  error-reporting startup runs before `application.Run`, remains disabled for
  load-error-fallback provenance, is non-Wails-bound, and passes a snapshot from
  composition without an ErrorReporting-to-Preferences dependency; selected-
  cluster startup uses atomic `EnsureLoadedForStartup`, pushes both default log
  limits and default permission concurrency when fallback is required, then
  enters the selection mutation using the returned immutable snapshot;
- Factory Reset tests proving workspace/cluster/refresh/operation/projection
  cleanup completes before durable reset; installation registration finishes in
  the preserved order; settings, favorites, UI persistence, updater state, and
  cache/spill artifacts plus their in-memory owners are reset; repeated reset is
  safe; Attention's persisted-rule projection is cleared; Preferences readiness
  is invalidated only through its owner; all six runtime setting targets receive
  defaults after lock release; the next `EnsureLoaded` performs a fresh load and
  all load-time post-unlock pushes; frontend reload occurs only after backend
  completion; partial failures are aggregated after every independent owner is
  attempted and suppress reload; active updater work is quiesced or rejects the
  reset before durable deletion; prepared staging is removed; configured
  `StatePath` and `TempRoot` are honored; cleanup entries and updater logs are
  attempted with errors aggregated; an active application/restart attempt
  rejects reset without deleting recovery state; updater document paths are
  validated before deletion; resolving missing settings/favorites/UI/update/
  cache artifacts creates no directories; and live/offline reset cover the same
  static manifest plus the same owner-resolved dynamic-artifact contract without
  live raw-directory deletion;
- a Phase 1 architecture check proving the two generator-template directives,
  38 regenerated directives, and 63 hand-written directives are gone and
  `rg '//wails:ignore' backend` is empty unless a tested exception is listed;
- Attention persistence, global/cluster isolation, object-pruning, and live
  target registration/removal tests;
- namespace-scope persist-before-rebuild, coalescing, revision, event, and
  `docs/architecture/namespace-scope.md` contract tests;
- kubeconfig-search-path tests proving normalized persist-before-rediscovery,
  watcher retargeting, selection pruning, refresh/client/operation/projection
  cleanup and remaining-selection persistence for both the direct command and
  settings import through one workspace workflow;
- cluster-runtime intent tests proving watcher, auth, and transport producers
  publish the exact typed payload; auth publication cannot block while its
  manager lock is held; wakeup is bounded while pending state coalesces by
  cluster/intent kind and newest generation; cancellation/drain/shutdown are
  deterministic; the Phase 5A App consumer and final Phase 5C workspace consumer
  both enter the same serialized mutation contract; stale generations cause no
  side effects; and no cluster owner stores/calls a workspace callback;
- heartbeat classification/event tests and revision-consistent
  `ClusterWorkspaceProjection` replay/cleanup tests;
- error-reporting startup/preference tests, installation-registration/reset
  serialization tests, and refresh-telemetry publication/replacement tests;
- container-log policy/limiter tests covering one shared selection policy and
  limiter instance, identical per-scope caps/warnings in direct fetch and live
  streams, both default-before-settings values, both settings-load pushes,
  settings-before-subsystem startup, live preference/import pushes, concurrent
  subsystem construction, the leaf-lock rule, and bounded deadlock/race
  execution;
- Kubernetes client rate-limit and refresh metrics-interval tests covering both
  already-running targets and targets constructed after settings load/update;
- permission-fetch-policy tests covering default-before-settings, configured
  load, atomic startup fallback, live update/import, bounded SSRR fan-out, and no
  direct ResourceGateway/permission read from `PreferencesService`;
- shell tests proving sidebar, diagnostics-panel, and app-logs-panel visibility
  remain process-wide and ephemeral while native menu/current-window event
  projection moves to `DesktopShell`;
- backend unit and integration tests for the extracted owner;
- `go test -race` for lifecycle, selection, refresh, and operation changes;
- frontend broker/consumer tests when a generated module or command adapter
  changes;
- multi-window readiness, focus, close, and application-quit tests;
- cluster isolation and complete-object-identity tests;
- invalid-early-state and reaches-ready-state gate tests;
- idempotent per-cluster and process shutdown tests;
- the per-checkpoint direct-App test-file and App-only test-entrypoint counts,
  with affected tests migrated in the same phase as their production owner;
- the owning durable-document updates named by that checkpoint, reviewed in
  the same change rather than deferred to Phase 7;
- direct affected backend and frontend coverage measurement, targeting at least
  80% statement coverage or reporting the measured gap; and
- a rendered Wails smoke covering startup, no-cluster, connected-cluster,
  settings, one representative object action, one live operation, peer-window
  close, and application quit once the boundary or lifecycle changes.

After each non-documentation phase, run:

```text
GOCACHE=/tmp/luxury-yacht-go-build \
STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck \
mise exec -- wails3 task qc:prerelease
```

Final completion additionally requires:

- no unintended generated binding diff;
- checked-in generated resource details matching
  `backend/internal/genappbindings.Render()`;
- no unowned or duplicate mutable state in the migration ledger, including
  mutable package globals, singleton settings targets, and direct cross-owner
  settings readers;
- one complete static Go-owned app-state artifact manifest shared by live owner-
  directed Factory Reset and offline reset, plus explicit owner resolution and
  updater-state validation for every dynamic staging/log/cleanup artifact under
  the configured roots, with side-effect-free path resolution, frontend-owned
  web storage covered by the post-backend-success UI path, and no durable or in-
  memory owner omitted;
- the final ownership table matching the closed ledger, with no provisional,
  miscellaneous, or proximity-only assignment;
- no production/test struct retaining `*App`, package function accepting
  `*App`, direct test construction of `App`, or test-only `*App` receiver;
- direct concrete `application.App` injection into composition and
  `DesktopShell`, with no generic desktop adapter layer;
- no App-backed `DesktopService` collaborator and no single interface combining
  the complete frontend command surface;
- no App-backed cluster-runtime collaborator, no cluster owner callback to
  workspace, and exactly one typed cluster-runtime intent consumer;
- no compatibility command path or dual lifecycle owner;
- durable documentation and skill routing updated to the final owner names; and
- `git diff --check` passing on the final worktree.
