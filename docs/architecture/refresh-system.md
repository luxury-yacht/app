# Refresh System Contract

The refresh system is the implementation boundary for per-cluster snapshots,
queries, signals, manual jobs, retained frontend state, and diagnostics. The
normative timing and visibility rules live in
[data-freshness.md](data-freshness.md).

## Domain contract

`backend/refresh/domain/refresh-domain-contract.json` is the join key for:

- backend registration in `backend/refresh/system/registrations.go`;
- backend DTO registration in `backend/internal/genrefreshcontracts/registry.go`;
- stream routing and source clocks;
- generated frontend domain/payload types;
- frontend registration, scheduling, diagnostics, and tests.

The contract generator emits the typed backend policy table in
`backend/refresh/domain/policy_generated.go` and the typed frontend policy plus
wire contracts in `frontend/src/core/refresh/types.generated.ts`. Backend
registration functions and frontend orchestration functions remain keyed
callbacks; generated policy supplies their order and metadata. Generation
rejects duplicate domains/orders and unknown policy vocabulary before either
table is written.

Do not add aliases or parallel registration tables, and never hand-edit either
generated file. Change the authored entry, keyed backend/frontend callback when
needed, DTO registry, and parity tests together, then run `go generate ./backend`.

## Scope and identity

Every API scope names exactly one cluster:

```text
clusterId|
clusterId|namespace:default
clusterId|<domain-owned-tail>
```

Cross-cluster views read multiple single-cluster entries. Concrete object rows
carry a complete `ResourceRef`: `clusterId`, `group`, `version`, `kind`,
`namespace`, and `name` (cluster-scoped objects omit namespace).

## Ownership

- `backend.RefreshCoordinator` is the sole process owner of the atomically
  published HTTP handler, per-cluster subsystems and streams, aggregate
  routing, governor and spill state, object-catalog runtimes, refresh telemetry,
  refresh teardown, and the shared global container-log limiter.
- `backend.ClusterRuntimeManager` supplies cluster-scoped clients, lifecycle,
  metadata, and dependency resolution. Refresh may call Cluster Runtime;
  Cluster Runtime never calls back into Refresh or Workspace.
- Refresh registers `ResourceGateway` cache invalidators during subsystem
  construction. The invalidation direction is Refresh to Resources; resource
  request code never acquires refresh/subsystem state. Catalog-service and
  telemetry reads cross a shared leaf `refreshResourceProjection`: Refresh
  publishes replacements into it and Resources only reads it, avoiding a
  reverse callback into `RefreshCoordinator`.
- Refresh registers and unregisters each subsystem's Attention index with
  `ClusterAttentionService`. Attention applies persisted/live rules without a
  callback into Refresh.
- Registry, permission gates, manual jobs: `backend/refresh/system`
- List/table payloads: `backend/refresh/snapshot`
- Query-backed change signals: `backend/refresh/resourcestream`
- HTTP API: `backend/refresh/api/server.go`
- Scheduler: `frontend/src/core/refresh/RefreshManager.ts`
- Executor and per-cluster runtimes: `frontend/src/core/refresh/orchestrator.ts`
- Store and hooks: `frontend/src/core/refresh/store.ts`,
  `frontend/src/core/refresh/hooks`
- Request policy: `frontend/src/core/data-access`

`backend/resources` owns details and imperative helpers, not list/table refresh
payloads. `frontend/src/core/refresh/types.generated.ts` is generated; register
Go DTOs and run `go generate ./backend` instead of editing it.

Handler and stream replacement publish the new aggregate generation before
stopping the old producers. Global teardown reverses that visibility first:
unpublish the handler and stream generation, then stop their producers. Factory
Reset uses the same owner-directed teardown before clearing refresh spill/cache
state, so no request can resolve state while it is being deleted.

Preferences reaches Refresh only through two write-only sinks. The metrics
interval is retained for future subsystem construction; a live update snapshots
subsystem pointers under the registry read lock, releases it, and then retimes
their managers. The global container-log limit mutates one shared limiter. Both
sinks are push-only and never read Preferences. The limiter mutex is a leaf init
lock and must never nest a settings or subsystem lock.

Scoped frontend leases have two demand modes:

- `query` retains liveness metadata and the consumer's current query page, but
  does not reconcile or retain the domain's bounded snapshot payload;
- `snapshot` retains the bounded snapshot payload used by non-table consumers.

Both modes share one source subscription, readiness, permission, stream health,
source clocks, and polling fallback. Their reference counts are independent;
releasing one mode cannot stop the other mode's work.

## Frontend runtime state

`ClusterRefreshRuntime` owns one record for each `(clusterId, domain, scope)`.
That record is the source of truth for:

- activation plus independent query and snapshot demand counts;
- deferred cluster-readiness intent and the scoped permission epoch;
- snapshot request ownership and its coalesced trailing stream signal;
- stream policy, scheduled initialization, connection ownership, cancellation,
  and health.

Do not add parallel maps or sets for those fields. Add an event to the relevant
discriminated state and keep network, timer, store, and cleanup work in the
orchestrator. Async start, settle, cancel, cleanup, and health events carry the
request or task identity they belong to; an event from a replaced owner is a
no-op.

Cluster auth availability belongs to its `ClusterRefreshRuntime`. Auth recovery
resets only that runtime's scoped permission epoch before enabled scopes are
reconciled. A namespace-scope rebuild is a new permission epoch for every
runtime. Store `permissionDenied` remains a presentation projection, not the
retry gate.

`RefreshManager` separately reduces scheduler intent (`enabled`, `paused`, or
`disabled`), timing (`idle` or `cooldown` with its owned handles), and execution
(`idle` or an ID-owned run). Its public `RefresherState` is derived from those
states plus refresh metadata. Global metrics demand is independently reduced as
`idle`, `requesting`, or `waiting-retry`; only the matching demand key may
complete or schedule a retry.

### Frontend resource-stream protocol

Each `(clusterId, domain, scope)` resource-stream subscription owns one protocol
state. Modern source-clock signals and legacy typed frames are normalized into
the same acknowledged, heartbeat, changed, reset, and error events before they
reach that state. The explicit phases are connecting, awaiting acknowledgement,
synchronized, resyncing, permission-blocked, and stopping.

The protocol reducer owns replay-token progression, initial-versus-later reset
meaning, update coalescing, resync admission, synchronization, and health
classification. It does not perform I/O. Socket sends, timer handles, source
clock/store writes, health publication, telemetry, and permission events are
effects executed by `ResourceStreamManager`.

An ACK makes a quiet subscription healthy. Advancing sequences reject replayed
changes. A token-less first RESET completes the initial handshake, while a
later RESET or manager-replacement COMPLETE re-arms the subscription. Pending
source clocks are emitted before resync clears coalescing state. Permission
denial remains terminal until the owning scope/auth lifecycle replaces the
subscription, and stopping is terminal so late frames or timers cannot affect a
replacement owner.

Initial and manual lifecycle resubscriptions retain previously confirmed
synchronized/delivering health while awaiting their next ACK. Gap, error,
overflow, visibility, and reconnect recovery do not retain that confirmation;
they remain degraded or unhealthy so snapshot polling can provide fallback.

## Behavior classes

- Snapshot domains replace one scoped payload.
- Resource-stream table domains render snapshot/query pages and use change
  signals only as refetch identity.
- Doorbell-snapshot domains have no streamed rows; the signal tells their
  snapshot consumer to refetch.
- Complete-resync streams send scope-level reconciliation signals.
- Log, detail, graph, Helm, YAML, and operation domains keep their specialized
  reducers and payload rules.

New list/table domains need a declared push source or an explicit reason that
only fallback polling exists. Source clocks and polling behavior must follow
[the freshness contract](data-freshness.md#signals-and-source-clocks).

## Query payloads

Typed table domains embed the normalized `ResourceQueryEnvelope` and typed
`Rows`. The backend owns filtering, sorting, facets, totals, cursor identity,
and keyset pagination. Catalog exposes the same query contract with its richer
kind metadata. See [large-data.md](large-data.md) and
[GridTable](../frontend/gridtable.md).

## Permission and readiness

- Runtime permission checks must match the scope of the data source.
- Permission-denied domains return typed settled state and diagnostics rather
  than disappearing or retrying indefinitely.
- The server owns cluster loading-to-ready progression. A governor replacement
  must not demote an already-ready cluster.
- Snapshot caches are allowed only for cache-tolerant data. Live app-managed
  operation state bypasses stale snapshot/singleflight paths.
- Frontend snapshot request ownership is an explicit per-scope `idle`/`fetching`
  state machine. Start, stream-signal, settle, and cancel events are reduced in
  one place; only the owning request may settle or cancel the scope, and
  repeated stream signals latch exactly one trailing fetch.
- Same-key snapshot callers share one build but retain independent wait
  contexts. Canceling one caller releases only that waiter; the shared build is
  canceled when every waiter leaves.
- Generation retirement rotates the snapshot service's cancellation epoch and
  cancels its current permission, readiness, and build work. The service is not
  permanently closed because governor-cooled subsystems continue serving new
  reads from retained stores.

## Stream start invariant

A view lease can flap enable/disable/re-enable during mount. An obsolete
cancellation must restart if the scope is enabled again, cleanup must have one
owner, and a newly healthy stream with no retained data must perform one
immediate non-manual reconciliation fetch when snapshot demand exists. A
query-only source instead starts its subscription before the initial page read;
the stream `ACK` or initial `RESET` advances an acknowledgement identity that
forces an acknowledged page reconciliation. If the stream is unhealthy, the
fallback scheduler advances a query-reconciliation identity so the consumer
reissues its current page; it never materializes an unused base snapshot. A
reconnect may keep retained data
without another fetch only after the server successfully replays from its
resume token. A reset that cannot prove continuity advances a declared signal
clock and performs one immediate non-manual reconciliation before that retained
snapshot is trusted. Snapshotless streams are exempt.

When a governor re-warm or recovery replaces a cluster's stream manager, the
aggregate router points at the replacement first, then sends `COMPLETE` for only
that cluster's existing subscriptions. The client re-subscribes through the
current adapter and the normal ACK/replay/reset handshake re-establishes trust;
the aggregate named stream and other clusters' subscriptions remain connected.

The regression harnesses are
`frontend/src/core/refresh/orchestrator.streamingFlap.test.ts` for lease flaps
and `frontend/src/core/refresh/streaming/resourceStreamManager.test.ts` for
resume/reset gaps, plus
`backend/refresh_aggregate_resourcestream_test.go` for manager replacement.
First-paint latency near a fallback interval, retained data surviving a
non-replayable reset without a clock change, or a replacement manager with zero
subscribers indicates this contract regressed.

## Diagnostics surfaces

Diagnostics presents the refresh system as two views, cut along the one join
that actually exists.

**Cluster Data** is a tree of `cluster -> refresh domain -> scope`. Every domain
maps to at most one stream in the authored contract, so a stream is an
ATTRIBUTE of a domain — delivery, resync and fallback counters are columns on
the domain row, never a level above it. The broker reads that fetch a domain
(`adapter: refresh-domain`) hang off the same row.

**Connections** is flat by design. It owns the transport itself: one row per
socket, the stream children whose keys are not refresh domains, and every read
that belongs to no domain. Those members share no parent, so nesting them would
invent a hierarchy the data does not have.

Four rules keep the two views joinable:

- Snapshot telemetry is keyed and joined by the complete
  `(cluster, domain, scope)` identity. A domain-level aggregate must never be
  copied onto each scope row. The backend retains only the 512 most recently
  updated snapshot identities per recorder so query scopes cannot grow
  diagnostics memory without bound.
- `telemetry.StreamStatus` carries `Leaf` plus `LeafKind`. The three streams key
  their children differently — resources by refresh domain, events by event
  scope, container logs by pod target — so a consumer may only join leaves of
  the same kind and the same cluster. A leaf-less row is socket level.
- A broker-read row is keyed by cluster as well as broker, resource, adapter and
  reason. A scope naming several clusters has no single owner and stays an
  app-level row.
- A stream fallback is counted where the decision is made: the orchestrator
  reports it when a scope polls only because its stream is not delivering. Every
  other snapshot has its own reason and is not a fallback. Query-only consumers
  count this before advancing their reconciliation identity even though they
  reissue their own query instead of fetching a retained base snapshot.

## Change checklist

1. Update the authored domain entry, backend/frontend registrations, DTO
   registry, and generated types.
2. Define scope, identity, permission, cache, source clocks, signal behavior,
   fallback polling, diagnostics, and merge/replace semantics.
3. Trace producer, consumers, ordering, teardown, and permission recovery.
4. Add contract parity plus behavior tests at the real snapshot/stream/consumer
   seams.
5. Run focused backend/frontend tests and `wails3 task qc:prerelease`.
