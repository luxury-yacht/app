# Refresh System Contract

The implementation boundary for per-cluster snapshots, queries, signals, manual
jobs, retained frontend state, and diagnostics. Timing and visibility rules
live in [data-freshness.md](data-freshness.md); store, ingest, and governor in
[data-layer.md](data-layer.md).

## Domain contract

`backend/refresh/domain/refresh-domain-contract.json` is the join key for
backend registration, DTO registration
(`backend/internal/genrefreshcontracts/registry.go`), stream routing, source
clocks, `refreshPayloadType`, and frontend registration, scheduling,
diagnostics, and tests.

- `go generate ./backend` writes `backend/refresh/domain/policy_generated.go`
  and `frontend/src/core/refresh/types.generated.ts` after rejecting duplicate
  domains/orders and unknown vocabulary; never hand-edit either. The
  stale-artifact and domain-inventory parity tests enforce them.
- Backend registration and frontend orchestration stay keyed callbacks ordered
  by the generated policy; no aliases or parallel registration tables.
- Wiring steps: [domain wiring](../../.agents/skills/refresh-subsystem/references/domain-wiring.md).

## Transport boundary

- `backend/refresh/api/` owns mount-relative handlers, published atomically
  (`backend/refresh_transport.go`) through the same-origin Wails service route
  `/api/v2`. The route owns snapshots and validators, permission-shaped
  failures, manual-refresh enqueue/status, telemetry summaries, metrics
  activation, correlation identity, and request-context cancellation.
- Resource doorbells and container logs use the named Wails JSON streams
  `refresh-resources` and `refresh-container-logs`, with structured frames in
  both directions. They own replay/reset, log delivery, backpressure,
  cancellation, manager replacement, and shutdown.
- A handler is published or replaced only after its owning aggregate is ready;
  an earlier request gets a bounded service-unavailable response. Preserve
  cluster scoping, complete identity, RBAC, and request validation.
- Rejected: an application loopback listener, runtime base-URL bridge, CORS
  layer, raw browser WebSocket, EventSource, HTTP upgrade or event-stream
  routes, and any fallback transport.

## Scope and identity

Every API scope names exactly one cluster (format:
[multi-cluster.md](multi-cluster.md#identity-and-scopes)). Refresh domains
never accept multi-cluster scopes; aggregate handlers route through the
per-cluster mux, and cross-cluster views fan out over single-cluster entries
above refresh state. Concrete rows carry a complete `ResourceRef`
(cluster-scoped objects omit namespace); stream identity crosses the wire in
the top-level full `ref`.

## Ownership

- `backend.RefreshCoordinator` (`backend/refresh_*.go`) solely owns the
  published handler, per-cluster subsystems, streams and aggregate routing,
  governor/spill state, object-catalog runtimes, refresh telemetry,
  Attention-target registration, teardown, and the global container-log
  limiter. Refresh may read Cluster Runtime and invoke gateway invalidators;
  neither calls back into Refresh. Dependency directions (including the leaf
  `refreshResourceProjection`) are in [backend-services.md](backend-services.md).
- Backend: `backend/refresh/system` (registry, permission gates, manual jobs;
  `ManualQueue` in `backend/refresh/types.go`), `backend/refresh/snapshot`
  (list/table payloads, never `backend/resources`),
  `backend/refresh/resourcestream` (query-backed signals).
- Frontend (`frontend/src/core/refresh`): `RefreshManager.ts` scheduler,
  `orchestrator.ts` executor, `refreshRuntime.ts` per-cluster runtimes,
  `store.ts` and `hooks/`; request policy in `frontend/src/core/data-access`.

### Construction, publication, and teardown

- `buildRefreshSubsystemForSelection` is the one construction chokepoint for
  startup, selector open, auth recovery, and governor re-warm; per-cluster
  readiness, invalidation, and lifecycle wiring belong there.
- Per-cluster order: informer factory and permission checker, permission
  preflight, ordered domain registration, snapshots/queues/streams, manager
  start, then revalidation.
- Construction uses the caller's context and has no total deadline (a slow
  reachable cluster still connects); only caller cancellation aborts, and a
  cancelled build publishes no permission-denied fallback domains. The context
  is separate from the process refresh lifetime. `PermissionPrimeTimeout` and
  `PermissionPreflightTimeout` bound only their priming batches; registration
  checks reviews a batch left uncached; `PermissionCheckTimeout` bounds each
  review.
- Replacement publishes the new handler/stream generation before stopping old
  producers. Teardown, including Factory Reset before clearing spill/cache,
  unpublishes first, then stops producers.
- Replacement moves queued or running manual jobs to the new queue; succeeded,
  failed, and cancelled jobs stay terminal.
- Preferences effects arrive through two write-only sinks
  ([app-preferences.md](app-preferences.md)). The metrics interval is kept for
  future construction; a live update snapshots subsystem pointers under the
  registry read lock, releases it, then retimes their managers. The global
  container-log limit mutates one shared limiter; its mutex is a leaf init lock
  that must never nest a settings or subsystem lock.

## Frontend runtime state

`ClusterRefreshRuntime` owns one record per `(clusterId, domain, scope)`: the
only source of truth for activation and query/snapshot demand counts, deferred
readiness intent, the scoped permission epoch, snapshot request ownership,
trailing reads, pending reconciliation and backoff, and stream policy,
initialization, connection ownership, cancellation, and health.

- Add no parallel maps or sets for those fields; add an event to the relevant
  discriminated state and keep network, timer, store, and cleanup work in the
  orchestrator. Async events carry their request or task identity; an event
  from a replaced owner is a no-op.
- Snapshot request ownership is a per-scope `idle`/`fetching` machine: only the
  owning request may settle or cancel, and repeated signals latch one trailing
  fetch.
- Cluster auth availability lives on that cluster's `ClusterRefreshRuntime`.
  Auth recovery and namespace-scope or permission rebuilds reset only that
  cluster runtime's permission epoch before reconciling enabled scopes. Store
  `permissionDenied` is presentation, not the retry gate.
- `RefreshManager` reduces scheduler intent (`enabled`/`paused`/`disabled`),
  timing (`idle`/`cooldown` with owned handles), and execution (`idle` or an
  ID-owned run); `RefresherState` is derived. The orchestrator separately
  reduces global metrics demand (`metricsDemandState.ts`) as
  `idle`/`requesting`/`waiting-retry`; only the matching demand key completes
  or schedules a retry.
- Context changes abort, then reconcile, even when rapid. Global pause blocks
  passive work only.
- `preserveState` disable keeps stream-owned data for a remount. Resetting a
  streaming scope no consumer has enabled also resets its owner
  (`stop(scope, { reset: true })`) so closed-panel data is released; an
  enabled scope keeps its stream and resets only store state.
- One-shot broker reads hold independent leases through completion; overlapping
  reads coalesce without aborting owners, and a caller arriving mid-read waits
  for the trailing snapshot. Manual refresh commands keep their separate
  stream-refresh behavior.
- A failed snapshot keeps reconciliation pending even with a healthy stream;
  retries back off to at most 60 seconds until success or a settled permission
  denial. Typed query errors surface while displayed rows stay; missing
  warm-up data is a separate state.

### Resource-stream protocol

Each `(clusterId, domain, scope)` subscription owns one protocol state.
Source-clock signals and legacy typed frames normalize into acknowledged,
heartbeat, changed, reset, and error events. Phases: connecting, awaiting
acknowledgement, synchronized, resyncing, permission-blocked, stopping.

- The reducer (`streaming/resourceStreamProtocol.ts`) owns replay-token
  progression, initial-versus-later reset meaning, update coalescing, resync
  admission, synchronization, and health classification, and performs no I/O.
  `ResourceStreamManager` executes the effects: sends, timers, source-clock and
  store writes, health publication, telemetry, and permission events.
- Health means connected plus server-confirmed synchronized, not recent
  delivery. `computeSubscriptionHealth` derives it from descriptor metadata,
  never hardcoded domain lists; marking health on send can suppress polling for
  a rejected domain.
- An ACK makes a quiet subscription healthy; advancing sequences reject
  replayed changes. A token-less first RESET completes the handshake, and
  confirms a retained tail only when it advances a declared clock. A later
  RESET or manager-replacement COMPLETE re-arms the subscription. Pending
  clocks are emitted before resync clears coalescing state.
- Permission denial is terminal until the owning scope/auth/permission
  lifecycle replaces the subscription; stopping is terminal so late frames or
  timers cannot affect a replacement.
- Initial and manual resubscriptions keep confirmed health while awaiting their
  next ACK. Gap, error, overflow, visibility, and reconnect recovery do not, so
  snapshot polling provides fallback.

## Behavior classes

Snapshot domains replace one scoped payload. Resource-stream table domains
render snapshot/query pages and use signals only as refetch identity.
Doorbell-snapshot domains have no streamed rows; the signal tells their
snapshot consumer to refetch. Complete-resync streams send scope-level
reconciliation signals. Log, detail, graph, Helm, YAML, and operation domains
keep specialized reducers and payload rules. Snapshot and stream rows share
projection helpers; the row parity rule (`backend/refresh/snapshot/parity_test.go`)
is in [domain wiring](../../.agents/skills/refresh-subsystem/references/domain-wiring.md#streamed-tables).

A new domain defines scope, identity, permission, cache, source clocks, signal
behavior, fallback polling, diagnostics, and merge/replace semantics; a new
list/table domain needs a declared push source or an explicit fallback-only
reason. Typed table domains embed the normalized `ResourceQueryEnvelope` and
typed `Rows` ([large-data.md](large-data.md), [GridTable](../frontend/gridtable.md)).

## Permission and readiness

- Permission checks match the data source's scope; gates align with
  `backend/refresh/system/permission_gate.go`. Denied domains
  (`RegisterPermissionDeniedDomain`) return typed settled state with
  `PermissionIssue` diagnostics instead of vanishing or retrying forever.
  Permission and discovery failures keep distinct diagnostics.
- Each completed cluster client is published `connected` inside its
  per-cluster operation without waiting for siblings; startup selection
  ordering is in [multi-cluster.md](multi-cluster.md#startup-and-search-paths).
  Late `connecting`/`connected` results never demote `loading`,
  `loading_slow`, `degraded`, or `ready`, and an older `degraded` snapshot
  never demotes a latched `ready` (`backend/cluster_lifecycle.go`).
- `loading` admits frontend requests. `startPublishedClusterReadiness`
  (`backend/refresh_setup.go`) emits it only when a generation commits after
  HTTP and aggregate route publication (never during construction) and starts
  the server-owned namespace readiness build, repairing doorbells rung before
  routing existed. Startup, selector opens, auth recovery, and governor
  rebuilds share this boundary; `transitionClusterToLoading` keeps a Ready
  cluster Ready through re-warm and continuously served replacement.
- `ready` requires a real initial sync or explicit permission skip for every
  tracked Pod/workload source. When the startup deadline settles every source
  with one incomplete, the namespaces snapshot marks the cluster `degraded`:
  operational, partial-data labels kept, promoted by background LIST+WATCH
  recovery. Governor Cold admission still requires actual sync.
- The backend self-builds the namespaces snapshot on each pending/degraded
  namespaces doorbell (`runNamespacesReadinessSelfBuild` via
  `Subsystem.NamespacesDoorbell`), never waiting for a frontend request.
  Post-settle notify is one-shot, aggregate refresh is atomic, and
  permission-denied builds still notify ready. Idle re-arm ticks inspect only
  source readiness; workload rollups rebuild on an ingest event, a readiness
  edge, or a throttled pending change.
- The frontend holds requests while lifecycle is unknown or not serving;
  workspace-state publication (live event, hydration, or command response)
  resumes them. Foreground activation holds last until their own completion.

## Snapshot caches

- Cache only cache-tolerant data; live app-managed operation state bypasses
  snapshot/singleflight caches. Only final batches are cached, never truncated
  or partial ones.
- `backend/refresh/snapshot/service.go` singleflights by cache key; same-key
  callers keep independent wait contexts, and the build is cancelled only when
  every waiter leaves.
- Invalidation advances a domain generation as well as deleting entries: new
  requests cannot join pre-invalidation builds, which cannot populate the new
  generation's cache.
- Generation retirement rotates the service's cancellation epoch, cancelling
  permission, readiness, and build work without closing the service (cooled
  subsystems keep serving from retained stores).
- A domain joining another store folds that store's revision into its
  validator watermark (nodes and workloads with pods), or joined updates can
  get a wrong `304`.
- The `ResourceGateway` response cache (details, header metadata, Helm content;
  `backend/response_cache.go`) stores a fetch only if its entry was not evicted
  after the fetch began. Kinds whose details embed pods set `DetailListsPods`;
  any pod change in a namespace evicts their cached details there, since a pod
  row does not name its workload (a stale pod list hides a new pod's logs).

## Streaming start lifecycle

A view lease can flap enable/disable/re-enable during mount. An obsolete
cancellation must restart if the scope is enabled again, teardown has exactly
one owner, and a newly healthy stream with no retained data performs one
immediate non-manual reconciliation fetch when snapshot demand exists.
Snapshotless streams are exempt. Query-only acknowledgement rules are in
[retention and leases](data-freshness.md#retention-and-leases); reconnect
replay-or-reset rules in
[signals and source clocks](data-freshness.md#signals-and-source-clocks).

Regression harnesses: `frontend/src/core/refresh/orchestrator.streamingFlap.test.ts`
(lease flaps), `frontend/src/core/refresh/streaming/resourceStreamManager.test.ts`
(resume/reset gaps), and `backend/refresh_aggregate_resourcestream_test.go`
(manager replacement). First paint near a fallback interval, retained data
surviving a non-replayable reset without a clock change, or a replacement
manager with zero subscribers means this contract regressed.

## Backend subscription lifetime

- A closed update channel always produces COMPLETE, even if its reason channel
  closes at the same time. Delivery is tied to the exact subscription owner so
  an old frame or COMPLETE cannot affect its replacement. Manager shutdown
  closes subscribers, rejects new subscriptions, and serializes channel closure
  with delivery.
- A replay that cannot fit the remaining outgoing queue sends ACK then RESET for
  that scope instead of a partial replay; other scopes' queued updates stay.
- Live-delivery overflow of the shared session queue closes the session, so
  every scope whose queued signal may have been lost reconciles through resume
  or reset. Resetting only the incoming frame's scope cannot repair an evicted
  frame from another scope.
- When a governor re-warm or recovery replaces a cluster's stream manager, the
  aggregate router points at the replacement first, then sends COMPLETE for
  only that cluster's subscriptions. Clients re-subscribe through the current
  adapter and the ACK/replay/reset handshake re-establishes trust; the
  aggregate named stream and other clusters' subscriptions stay connected.

## Diagnostics surfaces

- **Cluster Data** is a `cluster -> refresh domain -> scope` tree. A domain has
  at most one stream, so delivery, resync, and fallback counters are columns on
  the domain row, never a level above it; broker reads that fetch a domain
  (`adapter: refresh-domain`) hang off that row.
- **Connections** is flat by design: socket rows, stream children whose keys
  are not refresh domains, and reads belonging to no domain, with a Cluster
  column. They share no parent; do not invent a hierarchy.
- The telemetry summary reports every open cluster's streams, snapshots, and
  metrics polling, tagged by cluster; summary cards describe only the active
  cluster, combining a stream's socket entry with its delivery entries
  (catalog and event-table domains, log targets).
- Snapshot telemetry is keyed by complete `(cluster, domain, scope)`; never
  copy a domain aggregate onto scope rows. Each recorder keeps the 512 most
  recently updated snapshot identities.
- `telemetry.StreamStatus` carries `Leaf` and `LeafKind` (resources key by
  refresh domain, container logs by pod target); join only leaves of the same
  kind and cluster. Leaf-less rows are socket level, for transport-wide
  problems only; a one-domain failure such as a rejected subscribe goes on that
  domain's leaf.
- Broker-read rows are keyed by cluster, broker, resource, adapter, and reason;
  a scope naming several clusters stays an app-level row.
- A stream fallback is counted where decided: the orchestrator reports it when
  a scope polls only because its stream is not delivering, including
  query-only consumers before they advance their reconciliation identity. No
  other snapshot counts as a fallback.

## Custom-resource delivery

Custom and resource-family tables are filtered catalog queries on the existing
`catalog` domain, its shared resource-stream doorbell, and live page hydration.
`cluster-custom` and `namespace-custom` are navigation/table persistence
identifiers, not refresh domains; do not restore separate full-list snapshot
builders under those names. Source ownership and reconciliation follow
[the catalog contract](catalog.md#watch-to-query-ordering).
