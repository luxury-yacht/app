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
| `PreferencesService` | settings schema and mutation, themes, window settings, physical settings-file locking/persistence, coalesced lazy-load readiness and explicit startup-default installation, narrow repositories for persisted Attention and namespace-scope sections, and post-commit settings-effect detection/dispatch | Favorites, grid state, native UI calls, Attention live application, namespace-scope rebuild orchestration, or any runtime effect target; callers never lock its state or perform raw settings loads, and effects use owner-shaped write-only sinks |
| `FavoritesService` | favorites validation, migration, ordering, independent favorites-file locking and persistence | Settings or grid persistence |
| `UIStateStore` | cluster-tab order, grid persistence, independent persistence-file locking and persistence | Ephemeral shell visibility, live workspace selection, or frontend table data |
| `DataManagementCoordinator` | portable settings/favorites import and export across their real owners | A duplicate persistence model or native dialog implementation |
| `ClusterAttentionService` | effective cluster/global ignore-rule domain, `attentionRulesMu`, the six Ignore/Restore commands, persisted-rule transactions through `PreferencesService`, and registered live Attention-index targets | The physical settings-file lock, refresh subsystem ownership, or catalog identity |
| `ErrorReportingService` | error reporter configuration/lifecycle, startup enablement, installation-registration telemetry and `installationTelemetryMu`, and the reporter side of preference effects | Application log buffering, settings persistence, or refresh-domain telemetry |
| `ContainerLogsSelectionPolicy` | the process-wide per-scope container target cap, its default/clamping, and the selection/warning policy shared by direct pod-log reads and live streams | Settings persistence, stream/subsystem lifecycle, or global concurrent-target allocation |
| `ClusterRuntimeManager` | kubeconfig discovery, cluster clients, auth state/recovery, cluster lifecycle, dependency resolution, live and future-client Kubernetes QPS/burst application, heartbeat scheduling/probing, and typed health-event publication | Refresh subsystem state, replayable workspace projection state, peer-window ownership, or frontend view state |
| `RefreshCoordinator` | refresh manager, service handler publication, subsystems, streams, governor, spill state, catalog runtime, live and future-subsystem metrics cadence, refresh-domain `telemetryRecorder` publication, and the process-wide `containerLogsTargetLimiter` plus its lazy-init mutex | Settings reads/persistence, kubeconfig persistence, error-reporting configuration, per-scope container-log selection policy, or live-operation state |
| `ClusterWorkspaceProjection` | `clusterWorkspaceMu`, aggregate revision consistency, replayable cluster health and scope-revision maps, and narrow change/cleanup sinks used by cluster, refresh, and workspace owners | Cluster clients, selection workflows, persistence, heartbeat scheduling, or subsystem lifecycle |
| `WorkspaceCoordinator` | peer selection ownership, serialized selection commands, generation/supersession, foreground intent, selection diagnostics, aggregate workspace-state assembly from owner snapshots, namespace-scope commands and rebuild coalescing, and ordering between cluster and refresh owners | Duplicate clients, projection state, subsystems, settings-file locking, or component-owned domain state |
| `ResourceGateway` | complete-object-identity validation, catalog resolution, permission-aware dependencies, detail/YAML/action orchestration, response cache | Cluster selection guesses or refresh-domain list ownership |
| `OperationsCoordinator` | runtime-operation registry, shell sessions, port forwards, drain-operation registration and cluster-scoped cleanup | Cluster client ownership or stale snapshot authority |
| `UpdateCoordinator` | update discovery, staging, durable update state, scheduler, projection events | Window or settings persistence |
| `AppLogService` | log buffer, frontend log ingestion, typed log events | General event routing or error-reporting configuration ownership |

This table is a provisional target-owner set until the Phase 0 ledger accounts
for every current field, lock, command, event, lifecycle hook, and package-level
entry point. Phase 0 may add a focused owner row when it finds another cohesive
unassigned area; it must not assign a leftover to the nearest existing
component merely to close the ledger. The table becomes authoritative only
when every ledger row has exactly one owner and removal phase.

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
- `ErrorReportingService` owns reporter configuration and installation
  registration. `AppLogService` may emit through an injected reporter sink but
  cannot enable, disable, or otherwise configure it.
- `PreferencesService` has one complete `SettingsEffectDispatcher` seam for the
  five current `settingsSideEffects` flags. The stateless dispatcher fans them
  out through owner-shaped write-only sinks: error-reporting enablement to
  `ErrorReportingService`; Kubernetes client QPS/burst to
  `ClusterRuntimeManager`; the per-scope container target cap to
  `ContainerLogsSelectionPolicy`; and the global container target cap plus
  metrics cadence to `RefreshCoordinator`. The dispatcher is not a new state
  owner, and no target implements a broad settings or App interface.
- `PreferencesService.EnsureLoaded()` is the sole lazy settings initializer.
  It owns its synchronization, coalesces concurrent first callers, retries after
  an ordinary load failure, and returns an immutable snapshot only after the
  successful load's post-unlock container-log pushes have completed. No caller
  may acquire the preferences lock, call a raw loader, install `appSettings`, or
  observe a loaded-but-not-effect-ready snapshot.
- Ordinary `EnsureLoaded()` failure installs no snapshot and dispatches no load
  effects: settings reads and updates return the error, and error-reporting
  startup remains disabled. Startup cluster restoration alone may select the
  existing fallback policy by calling a separate Preferences-owned
  `InstallStartupDefaultsAfterLoadFailure()` operation. That operation installs
  one immutable default snapshot only when no ready snapshot exists and the
  immediately preceding coalesced load failed; it never overwrites a successful
  load. After releasing the preferences lock, it pushes both default container-
  log limits before workspace restoration uses the snapshot.
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
- Factory Reset invalidates the snapshot, provenance, and lazy-load readiness
  through a Preferences-owned reset operation after persisted settings are
  removed. The next `EnsureLoaded()` performs a new coalesced load and its two
  post-unlock pushes; callers do not reset readiness by assigning a nil field.
  Preserve the existing installation-registration-before-preferences lock and
  deletion order.
- The workspace startup path calls `EnsureLoaded()` and, if needed, installs the
  explicit fallback before entering its selection mutation. Only restoration of
  the returned selected-kubeconfig snapshot and subsequent client work run
  under the selection coordinator; lazy-load dispatch never runs while a
  caller-owned selection lock is held.
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
  releasing its lock. Applicable preference updates and settings import use the
  same dispatcher. Error-reporting startup remains fail-closed, while initial
  Kubernetes rate limits and metrics cadence are supplied to future owner
  construction separately from their live-update sinks.
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
  persisted formats.
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
| Phase 3 | Process leaf state, persistence, coalesced settings readiness/fallback, the complete settings-effect seam, shared container-log selection policy, Attention, error reporting, native shell work, updates, and logs have focused owners |
| Phase 4 | Resource reads/mutations/cache have one request-shaped owner with refresh-to-cache invalidation |
| Phase 5A | Cluster clients/auth/lifecycle/metrics/heartbeat, live rate-limit effects, and the replay projection have focused owners |
| Phase 5B | Refresh, catalog runtime, streams, governor, handler, telemetry, metrics-cadence effects, global container-log limiting, and Attention-target publication have one owner |
| Phase 5C | Peer selection, diagnostics, namespace-scope orchestration, aggregate replay assembly, and cross-owner sequencing have one owner |
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
- Phase 3 with fewer than all five settings effects behind the dispatcher or an
  unowned package-global effect target, any external/raw settings-load caller,
  or a ready settings snapshot published before load effects complete;
- Phase 5A with an App-backed Kubernetes client rate-limit sink;
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

- [ ] Record every `App` field in a migration ledger with its current readers,
  writers, mutex, startup path, shutdown path, tests, and target owner.
- [ ] Extend the ledger beyond `App` fields to every mutable package-global or
  singleton targeted by settings. At minimum, record all five
  `settingsSideEffects` flags and appliers, their update/import/load producers,
  their runtime targets and consumers, and their replacement sinks. This must
  include `backend/internal/containerlogs.currentPerScopeTargetLimit`, which is
  currently written by settings load/update and read by both
  `backend/resources/pods/logs.go` and
  `backend/refresh/containerlogsstream/streamer.go`.
- [ ] Close the provisional ownership table against that ledger. Add a focused
  row for any newly discovered cohesive responsibility instead of assigning
  otherwise-unrelated fields to an owner by code proximity.
- [ ] Explicitly ledger the currently omitted surfaces: `attentionRulesMu` and
  all Attention rule methods; `requestClusterScopeRebuildFn`,
  `scopeRebuildQueued`, `clusterWorkspaceMu`, `clusterWorkspaceRevision`,
  `clusterHealth`, and `clusterScopeRevisions`; `errorReporter` and
  `installationTelemetryMu`; refresh `telemetryRecorder`;
  `containerLogsTargetLimiterMu` and `containerLogsTargetLimiter` with all three
  accessor callers (`backend/app_settings.go:751,1220` and
  `backend/app_refresh_setup.go:295`); `selectionDiag`; and the process-wide
  `sidebarVisible`, `diagnosticsPanelVisible`, and `appLogsPanelVisible` fields.
- [ ] Close the settings-effect sub-ledger explicitly: error reporting belongs
  to `ErrorReportingService`; live/future-client QPS and burst belong to
  `ClusterRuntimeManager`; the per-scope container target cap belongs to
  `ContainerLogsSelectionPolicy`; and the global container target limiter plus
  live/future-subsystem metrics cadence belong to `RefreshCoordinator`.
- [ ] Ledger all four production `loadAppSettings` call sites and their distinct
  failure policies: `GetAppSettings` and `prepareAppPreferenceUpdate` belong to
  `PreferencesService`; `InitializeErrorReporting` belongs to
  `ErrorReportingService` and fails closed; and
  `initializeSelectedClustersAtStartup` belongs eventually to
  `WorkspaceCoordinator` and continues with an explicitly installed default
  snapshot. Record the lock idiom at each current caller and the Phase 3 rule
  that none survives as an external/raw loader call.
- [ ] Inventory the 24 direct `loadAppSettings` test calls across
  `backend/app_settings_test.go`, `backend/app_cluster_settings_test.go`, and
  `backend/app_data_management_test.go`. Classify each as a public
  `EnsureLoaded` contract test, a lower-level persistence codec/repository test,
  or a caller-specific failure-policy test instead of retaining a backdoor lazy
  initializer.
- [ ] Record the limiter's lock-order proof and startup/update contract in the
  ledger: no settings read or other lock acquisition under
  `containerLogsTargetLimiterMu`; construction uses the default; successful
  `EnsureLoaded`, explicit startup fallback, and global-limit updates immediately
  push the selected configured/default value through `SetLimit`; every subsystem
  receives the same process-wide limiter instance.
  Preserve the source contract documented at
  `backend/app_refresh_setup.go:385-393` as an executable lock/order test, not
  only as a comment.
- [ ] Assign the six Attention Ignore/Restore commands to
  `ClusterAttentionService`; assign `GetClusterAllowedNamespaces`,
  `SetClusterAllowedNamespaces`, and `GetSelectionDiagnostics` to the
  `WorkspaceCoordinator` collaborator; assign health events to
  `ClusterRuntimeManager`, the scope-changed event to `WorkspaceCoordinator`,
  and their replay state to `ClusterWorkspaceProjection`.
- [ ] Record `InitializeErrorReporting` and its `main.go` call as a non-command
  composition entry point sequencing `PreferencesService` into the behavior
  owned by `ErrorReportingService`. Preserve the
  current reason for its package-level shape through Phase 1: it must not appear
  in the `DesktopService` allowlist or generated frontend bindings. Phase 3 may
  replace it with an unbound service/composition call, never a Wails command.
- [ ] Pin the composition ordering that initializes error reporting after
  backend/preferences construction and before `application.Run`. Combined with
  snapshot provenance, this preserves fail-closed behavior both in the normal
  startup order and if a later internal caller has already installed fallback
  defaults.
- [ ] Record all 11 production structs with `*App` fields and all 38
  production-file package-level functions with exact `*App` parameters,
  including the 23 menu functions and five test-support helpers in
  `backend/app_testing.go`. For each, name the replacement collaborator,
  callback, or owner and the phase that removes the signature.
- [ ] Record every intentional Wails command with its frontend broker/consumer,
  target component, cluster/object identity requirements, and error contract.
- [ ] Record every non-command `App` entry point used by `main.go`,
  `appwindow.Registry`, menus, refresh handlers, generators, and test support.
- [ ] Inventory the 62 direct/full-App backend test files and 19 App test-only
  methods using the cross-phase test-support classification and target owner.
- [ ] Extend `cmd/project/wails_bindings_test.go` to identify the registered
  service type and exact command parity without assuming that the generated
  file is permanently named `backend/app.ts`.
- [ ] Extend `cmd/project/wails_project_contract_test.go` to distinguish the
  generated Wails service boundary from the prohibited native desktop-adapter
  pattern while preserving direct `application.App` injection.
- [ ] Record the composition-order literals enforced by
  `TestUpdaterTempRootIsConfiguredBeforeAnyProcessDispatch`; constructor and
  service names may change, but the required ordering may not.
- [ ] Add composition tests proving `/api/v2`, both named streams, typed custom
  events, and peer-window hooks still have exactly one owner.
- [ ] Add or identify lifecycle tests proving both sides of every readiness
  gate: invalid early native/event work is blocked, while the operation needed
  to reach ready state remains allowed.
- [ ] Capture focused race-test baselines for workspace selection, auth
  recovery, refresh replacement, application shutdown, shell cleanup, and
  port-forward cleanup.

Exit criterion: the provisional ownership table is closed; every current field,
lock, mutable package-global settings target, command, event, back-pointer,
App-parameter function, test seam, and boundary entry point has exactly one
target owner and removal phase; all five settings effects have a producer,
owner-shaped sink, target, startup/update rule, and validation case; no ledger
row is marked miscellaneous or assigned only by proximity; both project
contract-test files fail for the intended boundary/composition drift; and the
tests characterize the behavior later phases must preserve. Phase 0 is an
independently shippable test-and-inventory checkpoint.

## Phase 1 — Establish the structural Wails boundary

- [ ] Add `DesktopService` in package `backend` as the sole registered backend
  service and keep the existing `/api/v2` route. Preserve direct
  `application.App` injection into backend composition; this service is not a
  native desktop adapter.
- [ ] Give `DesktopService` explicit typed methods for the current frontend
  command allowlist. Group its collaborators by the target owners in the
  ownership table—one owner-shaped interface per command-owning component,
  plus separate lifecycle and HTTP seams—not as one 87-method backend
  interface. Components with no direct frontend command do not get empty
  transport interfaces. Initially the same `*App` value may satisfy each
  separate interface, but `DesktopService` has no `*App`-typed field, general
  App collaborator, or `*ApplicationRuntime` reference.
- [ ] Assign every command to exactly one owner-shaped collaborator in the
  Phase 0 ledger. In each later extraction phase, replace that collaborator's
  App-backed implementation with the new owner and delete the corresponding
  `App` methods in the same checkpoint; do not move commands between seams
  without updating the ledger and binding tests.
- [ ] Keep `InitializeErrorReporting` as a package-level composition entry point
  during this phase, outside `DesktopService` and its command collaborators.
  Add a negative binding assertion and a composition-order assertion that it
  runs before `application.Run`, so the Phase 3 rewrite to an unbound
  `ErrorReportingService` initializer cannot accidentally make startup
  configuration frontend-callable or move it behind application startup.
- [ ] Move `ServiceStartup`, `ServiceShutdown`, and `ServeHTTP` onto the service
  boundary and delegate them to explicit lifecycle and refresh-handler
  collaborators.
- [ ] Move named-stream registration out of `NewApp` and into explicit
  application composition before window creation.
- [ ] Replace `appwindow.Registry`'s concrete `*backend.App` dependency with a
  consumer-owned interface covering runtime-ready, peer release, and quit
  preparation.
- [ ] Replace menu and workspace-window creation dependencies on concrete
  `*App` with narrow command/lifecycle interfaces or callbacks.
- [ ] Treat model reachability as the phase's highest-risk migration item. The
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
- [ ] Change the resource-detail generator template, not the checked-in output,
  so its still-unbound implementation wrappers no longer emit
  `//wails:ignore`. Removing the two template directives and running
  `go generate ./backend` removes all 38 generated directives in the same
  change—40 source/generated occurrences total—and keeps
  `TestAppBindingsGeneratedInSync` green.
- [ ] Regenerate bindings and atomically update the hard-coded generated path
  in `cmd/project/wails_bindings_test.go` from the `backend/app.ts` module to
  the `DesktopService` module. Update only the central frontend backend-API
  adapter for that module-path change and preserve all higher-level imports.
- [ ] Update `cmd/project/wails_project_contract_test.go` to assert that
  `DesktopService` alone is registered while retaining the direct-Wails
  injection decision and its checks against `NewAdapter`, a generic `Desktop`
  interface, `MenuModel`, and `internal/desktop`.
- [ ] Update the composition-order assertions in
  `TestUpdaterTempRootIsConfiguredBeforeAnyProcessDispatch` for any new service
  construction/registration literals without weakening the required temp,
  dispatch, reporter, backend, update, and registration ordering.
- [ ] Remove the remaining 63 hand-written `//wails:ignore` directives from the
  now-unregistered implementation type. Require `rg '//wails:ignore' backend`
  to be empty at this checkpoint, except for a framework exception documented
  adjacent to the directive and proved by an executable binding test.
- [ ] Update binding tests so the generated `DesktopService` exports exactly
  the frontend allowlist and no internal component receives generated callable
  bindings.
- [ ] Migrate the Phase 1-affected test fixtures and test-only entry points to
  the service collaborators, and record the remaining direct-App counts.
- [ ] Update `docs/architecture/application-lifecycle.md` with service
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

- [ ] Promote the existing `runtimeOperationRegistry`, shell-session lifecycle,
  port-forward lifecycle, and drain registration into
  `OperationsCoordinator`; do not create parallel registries or cleanup paths.
- [ ] Move the shell, port-forward, and runtime-operation fields and locks from
  `App` into that owner without changing session or event DTOs.
- [ ] Inject narrow cluster dependency resolution, permission checking, event
  emission, logging, and context dependencies; do not inject the composition
  root.
- [ ] Route the relevant `DesktopService` commands directly to the new owner.
  Replace the App-backed `OperationsCoordinator` collaborator as one unit.
- [ ] Route cluster removal and application shutdown through one idempotent
  `StopCluster(clusterId)` / `Shutdown()` lifecycle instead of type-specific
  cleanup from unrelated owners.
- [ ] Preserve the runtime-operation registry as the active-operation envelope;
  workflow detail events must not resurrect removed operations.
- [ ] Delete the displaced `App` fields, methods, and test-only access paths in
  the same slice.
- [ ] Move every affected direct-App test and test-only entry point to an
  `OperationsCoordinator` fixture, retaining a full runtime only for lifecycle
  integration tests, and record the remaining direct-App counts.
- [ ] Update `docs/workflows/operation-lifecycle.md` with
  `OperationsCoordinator` ownership, per-cluster cleanup, registry semantics,
  and shutdown ordering; update `docs/workflows/shell-debug.md` where the new
  owner changes shell-session routing.
- [ ] Prove startup listing, live typed events, per-cluster cleanup, repeated
  cleanup, and process shutdown under race tests.

Exit criterion: one component owns all live-operation state and cleanup, with
no `App` state, test seam, or lifecycle path remaining for those workflows.
Phase 2 is independently shippable.

## Phase 3 — Extract process-owned leaf services and persisted app state

- [ ] Compose the existing application-update coordinator directly behind a
  narrow `UpdateCoordinator` boundary and move its event subscriptions and
  shutdown ownership out of `App`.
- [ ] Extract `AppLogService`, including the buffer, frontend ingestion,
  sequence reads, and typed log event projection.
- [ ] Extract `PreferencesService`, `FavoritesService`, and `UIStateStore` with
  their current independent files, schemas, and locks. Preserve the current
  rule that favorites I/O does not block grid persistence; share only stateless
  atomic-file helpers where appropriate.
- [ ] Give `PreferencesService` narrow, atomic repositories for the persisted
  Attention and per-cluster namespace-scope sections. It owns the physical
  settings-file lock and schema; the Attention and workspace owners retain
  their domain validation, commands, ordering, and live effects.
- [ ] Replace the raw `loadAppSettings` lazy initializer with
  `PreferencesService.EnsureLoaded()`. Route all four production paths through
  it: `GetAppSettings`, preference-update preparation, error-reporting startup,
  and selected-cluster startup. Callers receive an immutable snapshot carrying
  successful-load versus load-error-fallback provenance and never hold or
  manipulate the preferences mutex. Coalesce concurrent first callers, and do
  not return a successful/ready snapshot to any waiter until both post-unlock
  container-log initialization pushes finish.
- [ ] Preserve each caller's failure contract. A normal `EnsureLoaded` failure
  installs nothing and dispatches nothing, so reads/updates surface the error
  and `ErrorReportingService` remains disabled. Selected-cluster startup logs
  the load error and calls the Preferences-owned
  `InstallStartupDefaultsAfterLoadFailure()` operation; that operation installs
  the default snapshot only after a failed load and only if no successful
  snapshot won the race, then pushes both default container-log limits after
  unlocking. Error reporting treats that snapshot's fallback provenance as
  disabled. Invoke these preference operations before entering
  `runSelectionMutation`, then restore only the returned selected-kubeconfig
  snapshot inside the serialized workspace mutation.
- [ ] Replace `applySettingsSideEffects` with one complete, stateless
  `SettingsEffectDispatcher` owned at the `PreferencesService` boundary. Cover
  all five current flags through owner-shaped write-only sinks: error-reporting
  enablement to `ErrorReportingService`; Kubernetes client QPS/burst to the
  current App cluster-runtime implementation; the per-scope container target
  cap to `ContainerLogsSelectionPolicy`; and the global container target cap
  plus metrics cadence to the current App refresh-runtime implementation. Phase
  5A swaps the cluster sink and Phase 5B swaps the two refresh sinks; neither
  phase changes preference semantics.
- [ ] Extract `ContainerLogsSelectionPolicy` from the package-global
  `backend/internal/containerlogs.currentPerScopeTargetLimit`. Give direct pod-
  log reads and live streams the same read-only policy collaborator (or an
  explicit captured limit) and make selection/warning helpers receive that
  limit instead of reading hidden global state. The policy starts at
  `defaultObjPanelLogsTargetPerScopeLimit`; successful `EnsureLoaded`,
  applicable updates, and settings import push the configured value through its
  sink.
- [ ] Preserve transactional and lock direction for the whole effect seam.
  Capture flags and an immutable settings snapshot under the preferences lock,
  persist, release the lock, and then dispatch; persistence failure dispatches
  nothing. Sinks never read/call back into `PreferencesService` or call another
  effect owner while holding an owner lock. Preserve the global limiter's
  default-then-push behavior and leaf init lock while the App implements that
  sink: no preferences, refresh, or subsystem lock is acquired under
  `containerLogsTargetLimiterMu`.
- [ ] Preserve the distinct startup rules while consolidating dispatch. Every
  successful `EnsureLoaded` pushes both configured container-log limits after
  releasing the preferences lock; explicit startup fallback pushes both default
  limits; `ErrorReportingService` applies its fail-closed startup value; new
  cluster clients and refresh subsystems receive the loaded QPS/burst and
  metrics interval during construction; and applicable updates/imports retarget
  existing owners live. Preserve best-effort independent dispatch so an error-
  reporting failure is logged without suppressing the other enabled effects.
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
- [ ] Extract `DataManagementCoordinator` over the real preference and favorite
  owners; do not create a second portable-state store. Route Factory Reset
  through a Preferences-owned readiness reset after settings-file deletion so
  the next `EnsureLoaded` performs a real load and post-unlock pushes; preserve
  installation-registration completion before that reset/deletion sequence.
- [ ] Keep the settings-effect dispatcher dependency-complete but not broad: it
  knows the five effect values and their typed sinks, not `App`,
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
  persistence-repository, explicit-startup-fallback, or caller-failure tests as
  appropriate; do not retain a raw-loader test escape hatch.
- [ ] Update `docs/architecture/application-lifecycle.md` with concrete
  `DesktopShell`, process-wide ephemeral shell visibility, settings-effect
  dispatch ordering, `EnsureLoaded` readiness, workspace default fallback, the
  non-Wails error-reporting startup path, update/log lifecycle ownership, and
  leaf service shutdown ordering; update
  `docs/architecture/data-access.md` with the complete five-effect seam,
  lazy-load/failure contracts, post-commit dispatch, and owner-shaped sink rule;
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
  update `docs/workflows/application-updates.md` and
  `docs/workflows/logs/application-logs.md` with their extracted owners.
- [ ] Prove atomic preference batches, rollback on persistence failure,
  coalesced first-load readiness, first-paint settings reads, theme/favorite
  round trips, window-specific geometry, process-wide shell visibility/menu
  projection, Attention
  mutation/persistence/live application, error-reporting opt-in/out,
  installation-registration/reset serialization, all five effect routes for
  preference updates and settings import, no effects on persistence failure,
  both container-log configured/default load pushes, caller-specific load-error
  behavior, absence of the error-reporting initializer from generated bindings,
  live QPS/burst and metrics retiming, update scheduler uniqueness, and app-log
  sequence/event behavior.

Exit criterion: process-owned leaf state has explicit owners, and persistence
and native desktop side effects meet through narrow interfaces rather than an
`App` back-pointer. Attention and error-reporting state, locks, commands, and
lifecycle have their named owners; shell visibility has an explicit
process-wide owner; and preferences drive all five runtime effects only through
the complete post-commit effect seam. The package-global per-scope limit is gone,
and the remaining App-backed cluster/refresh effect sinks are explicitly
temporary until Phases 5A/5B. Native access remains concrete and direct. Phase
3 is independently shippable only when no owner outside `PreferencesService`
can lock preference state or trigger a raw load.

## Phase 4 — Extract the resource boundary

- [ ] Introduce `ResourceGateway` in package `backend` as the request-shaped
  coordinator over the existing catalog, capability, per-kind resource, YAML,
  object-action, node-log, and Helm services. It remains in that package while
  `genappbindings` emits its generated receiver methods there.
- [ ] Move response-cache ownership and permission-aware cache validation into
  that boundary.
- [ ] Introduce a narrow cache-invalidation collaborator owned by
  `ResourceGateway`. Register it with the current refresh construction in this
  phase; Phase 5B changes only the caller to `RefreshCoordinator`. The
  dependency remains refresh-to-resource and never resource-to-refresh.
- [ ] Replace the response-cache ingest sink's `*App` back-pointer with that
  invalidator interface or function, and migrate every invalidation hook that
  currently receives a refresh `*system.Subsystem` without creating a callback
  into the composition root.
- [ ] Replace helper signatures that accept `*App` with narrow context,
  dependency-resolver, lifecycle, logging, event, and cache interfaces.
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
  refresh-to-cache invalidation ownership, plus its read-only dependency on the
  shared container-log selection policy.
- [ ] Prove complete identity, cluster-scoped dependency resolution, permission
  denial, auth retry, cache invalidation, YAML ownership/apply, and object-action
  behavior.

Exit criterion: resource reads and mutations no longer depend on `App`, guess a
cluster, or duplicate catalog and permission behavior. The cache and all
invalidation entry points have one owner, with current refresh construction
depending one-way on its invalidator so this phase does not wait for Phase 5.
Phase 4 is independently shippable.

## Phase 5 — Extract cluster, refresh, and workspace ownership

This is the highest-risk area. It is divided into three complete, independently
shippable vertical lifecycle slices. A subphase must move its owner's state,
locks, startup, readiness, teardown, consumers, and tests together; do not stop
inside a subphase with split ownership.

### Phase 5A — Cluster runtime

- [ ] Introduce `ClusterRuntimeManager` as the sole owner of kubeconfig
  discovery, cluster clients, auth state/recovery, cluster lifecycle, transport
  failure state, API metrics, cluster dependency resolution, heartbeat
  scheduling/probing, and typed health-event publication. It writes health
  changes through a projection sink and does not own replayable projection
  state.
- [ ] Extract `ClusterWorkspaceProjection` as the leaf owner of
  `clusterWorkspaceMu`, `clusterWorkspaceRevision`, `clusterHealth`, and
  `clusterScopeRevisions`. Give current cluster, selection, governor, lifecycle,
  and scope workflows narrow change/health/scope/cleanup sinks; move no source
  owner's clients, selections, or subsystem state into the projection.
- [ ] Promote the existing `clusterLifecycle` and
  `kubernetesAPIMetricsRegistry` into that owner rather than duplicating their
  state machines or registries.
- [ ] Replace the Phase 3 App-backed Kubernetes client rate-limit sink with
  `ClusterRuntimeManager`. Supply the loaded QPS/burst as construction input for
  future clients and apply later settings-effect pushes to every existing
  client's mutable limiter, metrics registry entry, and REST configuration.
  The cluster owner must not read or call back into `PreferencesService`.
- [ ] Keep `clusterOperationCoordinator` as an independent per-cluster
  serialization primitive injected into the workflows that require it; do not
  turn it into a composition-root or owner back-pointer.
- [ ] Let the current `App` orchestrate the extracted cluster owner until Phase
  5C, but delete every displaced cluster field, lock, and implementation method
  from `App` in this subphase. Delete the displaced projection fields and lock
  too; no client, auth, health, or scope-revision state may be mirrored.
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
  initial/live client rate-limit application, replay-state sinks, and their
  one-way collaborators. Update
  `docs/architecture/application-lifecycle.md` with heartbeat/projection startup
  and teardown ordering.
- [ ] Prove discovery, no-selection startup, dependency readiness, transport
  failure, health classification/events/replay, aggregate revision consistency,
  auth failure/recovery, per-cluster projection cleanup, and repeated teardown
  under race tests.

Exit criterion: all cluster clients, auth/lifecycle state, transport failure
state, dependency resolution, API metrics, and heartbeat lifecycle have one
owner; replayable health/scope state has a separate leaf owner; and `App` is
only a caller for later cross-owner workflows. Phase 5A is independently
shippable.

### Phase 5B — Refresh runtime

- [ ] Introduce `RefreshCoordinator` as the sole owner of the refresh manager,
  atomically published service handler, subsystem maps, streams, governor,
  spill state, catalog runtimes, published refresh-domain `telemetryRecorder`,
  process-wide `containerLogsTargetLimiter` and
  `containerLogsTargetLimiterMu`, and refresh teardown.
- [ ] Promote the existing `refreshServiceHandler` into that owner rather than
  adding a second handler-publication mechanism.
- [ ] Inject narrow cluster-runtime dependencies from
  `ClusterRuntimeManager` and the cache invalidator from `ResourceGateway`.
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
- [ ] Move `sharedContainerLogsTargetLimiter` with the limiter fields. Every
  subsystem receives the same process-wide instance; lazy construction starts
  at `defaultObjPanelLogsTargetGlobalLimit`; and the Phase 3 preferences sink
  immediately pushes the selected configured/default value after
  `EnsureLoaded`, explicit startup fallback, or update whether that happens
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
  Attention publication ownership changes. Update
  `docs/workflows/logs/container-logs.md` with the final global-limiter owner,
  the independent selection-policy dependency, shared instance,
  default-then-push startup, and lock-order contract.
- [ ] Prove initial publication, refresh rebuild, stream replacement, auth
  recovery, cache invalidation, telemetry replacement, Attention target
  registration/removal, one shared limiter under concurrent subsystem builds,
  settings-load/update limit propagation in both startup orders, live and
  future-subsystem metrics retiming, shared per-scope policy use, deadlock-free
  lock ordering, unpublication, and repeated teardown under race tests.

Exit criterion: refresh, catalog-runtime, stream, governor, spill, and handler
publication/telemetry/limiter state have one owner; Attention targets follow the
same subsystem lifecycle; the limiter remains default-then-push and leaf-locked;
both refresh settings sinks have replaced their App-backed implementations; and
the preferences, selection-policy, cluster, Attention, and resource dependency
arrows are explicit and acyclic. Phase 5B is independently shippable.

### Phase 5C — Workspace orchestration

- [ ] Introduce `WorkspaceCoordinator` as the sole owner of peer-window
  selection sets, serialized selection mutations, generations/supersession,
  foreground intent, selection diagnostics, and aggregate workspace-state
  assembly. Move `selectionDiag` with all readers/writers and compose cluster,
  refresh, selection, foreground, and `ClusterWorkspaceProjection` snapshots
  without copying their state into the coordinator.
- [ ] Assign `GetSelectionDiagnostics`, `GetClusterAllowedNamespaces`, and
  `SetClusterAllowedNamespaces` to the `WorkspaceCoordinator` command
  collaborator. Namespace-scope reads/writes use the narrow repository owned by
  `PreferencesService`; the coordinator owns the cross-owner mutation contract.
- [ ] Move `requestClusterScopeRebuildFn` and `scopeRebuildQueued` into the
  workspace scope-change workflow. Preserve persist-before-rebuild, rapid-edit
  coalescing, serialized cluster operations, refresh teardown/rebuild, scope
  revision advancement through `ClusterWorkspaceProjection`, and final
  `cluster:scope:changed` emission in that order.
- [ ] Make `WorkspaceCoordinator` call `ClusterRuntimeManager` and
  `RefreshCoordinator` in the documented order. Neither owner may call back
  into the coordinator or store a pointer to the other.
- [ ] Move selected-cluster startup onto the Phase 3 Preferences contract, not
  the old raw loader: call `EnsureLoaded()` and the explicit startup-default
  fallback before acquiring the selection-mutation lock, then restore the
  immutable selected-kubeconfig snapshot inside the serialized mutation. Do not
  reintroduce preference locking or load-effect dispatch inside Workspace.
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
  ordering, settings-load/default-fallback ordering, readiness, and
  application-shutdown sequencing. Update
  `docs/architecture/namespace-scope.md` with the preferences repository,
  workspace rebuild/coalescing owner, and unchanged convergence ordering.
- [ ] Prove concurrent peer selection, superseded selection, foreground demand,
  selection diagnostics, namespace-scope persist/rebuild/event convergence,
  rapid-edit coalescing, configured/default startup settings before selection,
  aggregate health/scope replay, shared-cluster peer close, application quit,
  and repeated teardown under race tests.

Exit criterion: workspace selection has one owner; cluster and refresh owners
are invoked in one explicit direction; scope commands/rebuild, selection
diagnostics, and aggregate replay assembly have moved together without absorbing
the leaf projection; and startup, peer release, and shutdown have no duplicate
path. Phase 5C is independently shippable.

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
  owner-shaped collaborators, `EnsureLoaded` readiness/failure/fallback,
  complete settings-effect seam, `ContainerLogsSelectionPolicy`,
  `ResourceGateway`, cache invalidation, and stable frontend adapter boundary
  already introduced by Phases 1, 3, 4, and 6.
- [ ] Audit `docs/architecture/multi-cluster.md`,
  `docs/architecture/refresh-system.md`, and
  `docs/architecture/data-layer.md` for the
  Attention/cluster/workspace/projection/refresh owner names, live rate/metrics
  settings sinks, and ordering introduced by Phases 3 and 5A–5C.
- [ ] Audit `docs/architecture/namespace-scope.md`,
  `docs/architecture/data-freshness.md`, and
  `docs/architecture/error-reporting.md` respectively for scope orchestration,
  Attention-clock/target publication and refresh telemetry, and error-reporting
  ownership introduced by Phases 3 and 5A–5C.
- [ ] Audit `docs/workflows/operation-lifecycle.md`, application-update docs,
  and log docs for the component owners, shared container-log selection policy,
  and settings-to-runtime effect direction introduced by Phases 2, 3, and 5B.
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
  Attention commands, two namespace-scope commands, and selection diagnostics,
  plus every mutable package-global settings target including the current
  per-scope container-log atomic;
- a settings-effect contract proving the five current flags map exactly once to
  their four target owners, updates and imports dispatch only after successful
  persistence and lock release, persistence failure dispatches none, one target
  failure does not suppress independent effects, and a newly added flag cannot
  omit its owner, sink, startup rule, or test;
- `PreferencesService.EnsureLoaded` tests proving the four production caller
  paths use the same initializer, concurrent first callers cause one successful
  disk load and one pair of post-unlock container-log pushes, no caller observes
  ready state before those pushes complete, and ordinary failure remains
  retryable without installing a snapshot or dispatching effects;
- caller-policy tests proving settings reads/updates surface load failure,
  error-reporting startup runs before `application.Run`, remains disabled for
  load-error-fallback provenance, is non-Wails-bound, and passes a snapshot from
  composition without an ErrorReporting-to-Preferences dependency; selected-
  cluster startup explicitly installs defaults without overwriting a successful
  load, pushes both default log limits, then enters the selection mutation using
  the returned immutable snapshot;
- a Factory Reset test proving settings-file deletion invalidates snapshot
  provenance/readiness only through `PreferencesService`, waits for installation
  registration in the preserved order, and causes the next `EnsureLoaded` to
  perform a fresh load and both post-unlock pushes;
- a Phase 1 architecture check proving the two generator-template directives,
  38 regenerated directives, and 63 hand-written directives are gone and
  `rg '//wails:ignore' backend` is empty unless a tested exception is listed;
- Attention persistence, global/cluster isolation, object-pruning, and live
  target registration/removal tests;
- namespace-scope persist-before-rebuild, coalescing, revision, event, and
  `docs/architecture/namespace-scope.md` contract tests;
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
  mutable package globals and singleton settings targets;
- the final ownership table matching the closed ledger, with no provisional,
  miscellaneous, or proximity-only assignment;
- no production/test struct retaining `*App`, package function accepting
  `*App`, direct test construction of `App`, or test-only `*App` receiver;
- direct concrete `application.App` injection into composition and
  `DesktopShell`, with no generic desktop adapter layer;
- no App-backed `DesktopService` collaborator and no single interface combining
  the complete frontend command surface;
- no compatibility command path or dual lifecycle owner;
- durable documentation and skill routing updated to the final owner names; and
- `git diff --check` passing on the final worktree.
