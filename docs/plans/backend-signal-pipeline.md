# Backend Signal Pipeline

Temporary plan from the 2026-10-19 app-wide design review, finding #2: backend
data feeds and change signals have no single pipeline.

- **Status:** draft for John's approval (2026-10-20). Nothing is implemented.
  The [decisions](#decisions) list what needs his answer.
  - Revised the same day after review. Three requirements were added, each
    verified against the code: a synchronous shutdown barrier, relist
    publication at the partition boundary, and rings for scopes a row leaves.
    See [shutdown, relists, and scope changes](#shutdown-relists-and-scope-changes).
  - A second review the same day added a fourth requirement: relist batches
    belong to each source registration, because several sources feed one
    maintained store concurrently.
- **Precondition:** met. Finding #3 (PR 397) and finding #1 (PR 398, which
  moved response-cache eviction into the refresh coordinator) are on `main`.
- **Base:** `main` at `c03a0c24`. File references are relative to the
  repository root; line numbers are from that commit.
- **Evidence:** claims cite code read on 2026-10-20 or a probe run that day;
  anything else is marked [inferred] or [unverified]. The probes were
  throwaway tests in `backend/refresh/system`; they are not in the tree. A copy
  is in the side-session notes folder (`signal_order_probe_test.go.txt`) for
  Phase 0 to reuse.

## Summary

A store that a table reads can receive a change **after** that table's
doorbell has rung. When that happens, the read the doorbell triggers gets the
old rows and caches them, and the store's later apply rings nothing. A probe
proved this for Gateway-API rows; the same handler shape exists for four more
sources. A second probe showed an ingest-fed table (`namespace-rbac`) ringing
before its store applied the change. The code uses the same order for every
ingest-fed table except Pods. A lock hides that today, but nothing in the
design requires it.

The cause is structural. The code that applies a change and the code that
rings for it are separate registrations, wired at different times, ordered by
convention. This plan makes the store's own apply path the only place that
rings. It also gives every cluster one doorbell, built before any producer, so
nothing is wired after construction. Stopping that doorbell waits for every
producer callback already running. Relists ring once per affected scope, and a
change rings the scopes a row leaves as well as the ones it enters.

## Finding, re-verified on 2026-10-20

### Two feed technologies

| Feed | Owner | How stores receive changes |
| --- | --- | --- |
| Owned ingest (LIST+WATCH reflectors) | `ingest.IngestManager` (`backend/refresh/ingest/manager.go:171`), `ProjectingStore` (`projecting_store.go:120`) | Sinks, called under the store's write lock in a fixed class order: table sinks, then catalog sinks, then bundle sinks (`projecting_store.go:375-385`; relist `:786-799`) |
| Shared informers | `informer.Factory`: shared factory (`backend/refresh/informer/factory.go:185`), apiextensions (`:269`), Gateway-API (`:320-352`, built in `backend/cluster_runtime_clients.go:506-510`), Helm storage (`helm_storage.go:110`) | One handler per registration, each on its own goroutine. client-go updates the indexer **before** it notifies any handler (`k8s.io/client-go@v0.37.1/tools/cache/controller.go:855-863`, `shared_informer.go:1083-1116`, `:1478`). All four factories resync every 15 s (`backend/internal/config/config.go:33`). |

The kinds still on typed informers are listed with reasons in
`docs/architecture/data-layer.md:124-126`. Moving them to ingest is a
non-goal.

### Nine kinds of signal producers

"Order" says whether the store a table reads holds a change before its
doorbell rings.

| # | Producer | Fed by | Rings | Order today |
| --- | --- | --- | --- | --- |
| 1 | Resource-stream informer handlers: Gateway-API descriptors (`resourcestream/stream_descriptor_dispatch.go:22-71`), HPA (`stream_registration_direct.go:32-40`, `manager.go:462-505`), CRDs (`manager.go:307-339`), Helm storage (`stream_registration_direct.go:19-30`, `manager.go:347-460`) | Shared, Gateway, apiext, Helm informers | `namespace-network`, `cluster-config`, `namespace-autoscaling` (+ workload rows), `cluster-crds`, `namespace-helm` | **Unordered, proven.** The table's store is fed by a different handler on the same informer (see [the race](#proven-gateway-api-rows-are-served-stale-after-their-doorbell)). |
| 2 | Resource-stream ingest sinks: generic descriptor sink (`ingest_notify.go:38-114`, also rings `cluster-identities`), network (`ingest_notify_network.go:39-80`), nodes (`ingest_notify_nodes.go:69-106`), workloads (`ingest_notify_workloads.go:95-175`), pods (`stream_registration_related.go:20-28`, `ingest_notify_pods.go`) | Ingest catalog sinks (pods: bundle sink) | Every ingest-fed table, plus derived workload and node rows | **Rings before apply; probed for RoleBinding, same order in code for the rest; hidden by a lock.** Notify sinks are catalog sinks; maintained stores are bundle sinks (`snapshot/querypage_typed.go:960-973`, `namespace_network.go:148`, `namespace_workloads.go:177`, `nodes.go:134`), which run later. Pods is ordered: its store is a table sink (`pods.go:195`). |
| 3 | `NamespaceChangeNotifier` (`snapshot/namespace_notifier.go:24-89`) | Namespace and Events informers, workload and quota ingest bundle sinks (`snapshot/namespaces.go:276-356`) | `namespaces`, 500 ms debounce | Ordered in practice: the debounced flush runs after the fan-out that applied the change, and reads the same sources the builder reads (`namespace_notifier.go:82-84`) |
| 4 | `ObjectEventsChangeNotifier` (`object_events_notifier.go`) | Events informer handler (`object_events.go:93-125`) | `object-events`, 500 ms debounce | Ordered: the builder reads the informer index, which client-go updates first |
| 5 | `ObjectDetailsChangeNotifier` (`object_details_notifier.go`) | Response-cache eviction handlers (`backend/refresh_response_cache_invalidation.go:34-87`) | `object-details`, 500 ms debounce | Ordered: each handler evicts, then records |
| 6 | `EventTableChangeNotifier` ×2 (`event_table_notifier.go`) | The event stores' own handlers (`cluster_events.go:114-125`, `namespace_events.go:98`) | `cluster-events`, `namespace-events` | Ordered: the store's handler applies, then rings (the documented rule) |
| 7 | `ClusterAttentionIndex` (`cluster_attention.go:1098-1134`) | Ingest bundle sinks and an Events handler (`:1355-1397`), catalog subsets | `cluster-attention`, debounced | Ordered: the index applies, then flushes |
| 8 | Metrics collection observer (`metrics/poller.go:176-194`; `system/manager.go:409-416`, `:659-671`) | The poller, after it commits a sample under its lock (`poller.go:391-403`) | Metric-clock domains, `cluster-overview`, `namespace-metrics` | Ordered |
| 9 | Catalog doorbell bridge (`backend/refresh_object_catalog.go:291-307`) | The catalog's streaming updates, published after it applies (`objectcatalog/ingest_source.go:164-168`, `watch.go:127-131`) | `catalog` | Ordered |

One in-process consumer rides a doorbell: `NamespacesDoorbellObserver`
(`system/manager.go:594-624`). The coordinator sets it after construction to
self-build namespaces while a cluster loads (`backend/refresh_setup.go:496-527`).

Every ring goes through `resourcestream.Manager.broadcast`, which invalidates
the domain's snapshot cache and then fans out (`resourcestream/stream_hub.go:115-127`).
The cache refuses to store a build that began before an invalidation
(`snapshot/service.go:514-530`, `:538-553`). That protects reads already in
flight. It cannot protect a read that starts after the ring but before the
store applies the change.

### Wiring after construction

`grep -rn "SetBroadcast(" backend | grep -v _test.go` still returns 11 lines:

- 5 method definitions in `snapshot`: `cluster_attention.go:1098`,
  `namespace_notifier.go:107`, `event_table_notifier.go:37`,
  `object_details_notifier.go:36`, `object_events_notifier.go:40`;
- 5 calls in `system/manager.go`: `:399`, `:619`, `:631`, `:641`, `:654`;
- 1 interface method at `system/manager.go:647`.

Other late wiring in the same path:

- `SetSnapshotDomainInvalidator` (`system/manager.go:385`;
  `resourcestream/manager.go:286-293`);
- `SetCollectionObserver` (`system/manager.go:410-416`);
- the `note*` callbacks that hand notifiers out of registration
  (`system/registrations.go:30-48`, used at `:425`, `:510`, `:597`, `:688`,
  `:793`).

Why it exists: notifiers are created during domain registration
(`system/manager.go:464`). The resource-stream manager comes later (`:493`),
because it registers informer handlers and its invalidator needs the snapshot
service (`:469`).

What it costs:

- Every notifier keeps "pending until wired" state:
  - `changeKeyDebouncer.setSink` (`change_key_debouncer.go:39-47`);
  - `NamespaceChangeNotifier.SetBroadcast` and its flush
    (`namespace_notifier.go:107-117`, `:232`);
  - the attention index's dirty re-arm (`cluster_attention.go:1098-1108`).
- Teardown must list every notifier in `StopDoorbellNotifiers`
  (`system/manager.go:542-562`), called once at `backend/refresh_generation.go:284`.
  Two `Subsystem` fields exist only for that list: `ObjectEventsNotifier` and
  `EventTableNotifiers` (other uses: `grep` finds none outside
  `system/manager.go`).
- A new notifier needs the same edit in about six places: a `Subsystem` field,
  `streamObserverDeps`, `wireStreamObservers`, `StopDoorbellNotifiers`, a
  `note*` callback, and the constructor closure.

### The ordering rule is a convention

`docs/architecture/data-freshness.md:128-135` says an informer-fed maintained
store rings from its own handler after applying the change, because another
handler on the same informer can ring first. Only the event tables follow it
(producer 6). Nothing enforces it.

### Proven: Gateway-API rows are served stale after their doorbell

The probe wired the production owners:

- `RegisterNamespaceNetworkDomainWithGatewayAPI`, which builds the maintained
  store and its handler;
- `resourcestream.NewManager`, whose descriptor handler rings;
- `wireStreamObservers`, which installs the invalidator;
- a real `snapshot.Service`.

A test-only informer wrapper held back only the store's handler. client-go
runs each handler on its own goroutine, so this delay is a schedule production
allows. Results (`-count=3`, the same every run):

- The `namespace-network` doorbell rang while the store did not hold the new
  HTTPRoute. The read it triggered returned `[]`.
- After the store applied the route, a normal read still returned `[]` (the
  cached pre-change page). A cache-bypass read returned `[web]`.
- No second doorbell came after the store applied the change.

Without the wrapper, an immediate read after each of 300 doorbells missed the
new row 4, 14, 4, and 4 times in four runs. That read comes right after the
ring, so it is a worst case. A real refetch first crosses the named stream, a
150 ms coalesce (`frontend/src/core/refresh/streaming/resourceStreamManager.ts:53`),
and an HTTP round trip.

Same handler shape, verified by reading the code but not probed:

| Domain | Store's handler | Separate ringing handler |
| --- | --- | --- |
| `cluster-config` (GatewayClass) | `cluster_config.go:108` → `registerMaintainedHandlers` | `registerDescriptorStreams` |
| `namespace-autoscaling` (HPA) | `namespace_autoscaling.go:99` → `typed_table_domain.go:177` | `handleHPAEvent` |
| `cluster-crds` | `cluster_crds.go:89`, `changed` hook `nil` at `:97` | `registerCRDStream` |
| `namespace-helm` | `namespace_helm.go:126-145` | `registerHelmStorageStreams` |

User-visible effect [inferred from code; not run in the app]:

- A table can show the pre-change rows after a create, update, or delete.
- The resync echoes described next usually repair it within 15 s.
- Where no echo arrives, the rows stay stale until the next change in that
  domain and scope. Example: the last HTTPRoute in a namespace was deleted.
  Polling does not help, because it skips reads while the stream is healthy
  (`data-freshness.md:30-33`).

### Also found

- **Resync echoes ring.** The resource-stream informer handlers ring on every
  update (`stream_registration_helpers.go:30-46`), including resyncs that
  `InformerUpdateIsEcho` would reject (`snapshot/informer_echo.go:10-17`).
  - Probe: an unchanged HTTPRoute rang `namespace-network` 3 times in 3.5 s
    at a 1 s resync. client-go's floor is 1 s; production resyncs every 15 s.
  - This breaks `data-freshness.md:131-133` for producer 1. It also hides the
    race above. **Removing echo rings without fixing the order would make
    stale rows permanent**, so both must ship together.
- **Ingest notify sinks ring before the maintained store applies.**
  - The probe used `NewSubsystemWithServices`, a tracker-backed API server
    (the `identityTestAPI` pattern, `system/cluster_identities_test.go:147-215`),
    and a test catalog sink added after production's sinks.
  - With a RoleBinding create in progress, `namespace-rbac` rang **while the
    maintained store's bundle sink had not yet run**.
  - A build started at that moment blocked until the write finished, then
    returned the new row. The likely block [inferred: the probe did not
    capture a stack] is the build's readiness checks, which read the ingest
    store's synced flag under that store's read lock
    (`snapshot/service.go:260-299`, `ingest/manager.go:1098-1148`,
    `projecting_store.go:894-898`).
  - So the lock hides the order today. A build that passed readiness just
    before the write, but read the invalidation counter and the store after
    the ring, would cache old rows [unverified: not reproduced].
- **A ring with no store behind it.** ConfigMap-stored Helm releases ring
  `namespace-helm` (`resourcestream/manager.go:347-372`). The table reads only
  Secret-stored releases (`snapshot/namespace_helm.go:93-97`, `:126-145`).
- **`Update.Ref` is diagnostic only.** The frontend parser never reads `ref`
  (`grep` finds no `ref` in `streaming/resourceStreamProtocol.ts`). No
  production backend code reads it either; only tests do. The backend also
  ignores the request's `resourceVersion` (`grep -rn "\.ResourceVersion"` in
  `streammux` and the stream adapters finds nothing). Derived workload and
  node signals still look up a `Ref` in another ingest store while holding the
  pod store's write lock (`derived_rows.go:69-153`).

### Shutdown, relists, and scope changes

The 2026-10-20 review raised these three; each was checked against the code.

**Shutdown.**

- Only the namespace notifier's `Stop` waits for a flush already running. It
  marks itself stopped, then waits until `activeFlushes` is zero
  (`snapshot/namespace_notifier.go:168-182`, `:224-257`). A test pins it:
  `TestNamespaceNotifierStopWaitsForActiveBroadcastAndRejectsLateEvents`
  (`namespace_notifier_test.go:415`).
- The key debouncer behind object events, object details, and the event
  tables only cancels its timer (`change_key_debouncer.go:61-70`). A flush that
  already passed its stopped check still calls its sink after `stop` returns
  (`:81-107`). The attention index's `Stop` also only cancels timers
  (`cluster_attention.go:1079-1096`).
- `Manager.broadcast` invalidates the snapshot cache first and never checks
  `stopped` (`resourcestream/stream_hub.go:115-127`). A ring that arrives after
  teardown can still invalidate the cache a cooled generation keeps serving
  [inferred: not reproduced].

**Relists in scoped clusters.**

- Every owned reflector writes through a partition view
  (`ingest/manager.go:355-371`). An unscoped kind uses the single `""`
  partition (`:258-266`).
- The `""` partition relists through the classic `Replace`, which calls a
  sink's bulk `Replace` or `ReplaceBundles` (`partition.go:42-44`, `:63-71`;
  `projecting_store.go:786-799`).
- A namespace partition relists through `ReplacePartition`. It emits the
  partition's vanished keys as deletes and its new set as per-row upserts,
  never the bulk call, so sibling namespaces' rows survive
  (`partition.go:39-60`, `:72-89`).
- So a publisher that coalesces only in `ReplaceBundles` would still ring once
  per row in a scoped cluster. Today's notify sinks ring once per row on both
  paths: they implement neither `Replacer` nor `UpsertChanger`
  (`ingest_notify.go:76-90`; `projecting_store.go:801-814`, `:863-873`).

**Scope departures.**

- Bundle sinks receive only the new bundle (`projecting_store.go:375-379`,
  `:422-430`). The pod notify sink derives every scope from that one summary
  (`ingest_notify_pods.go:77-118`; `scopesForPod`,
  `resourcestream/manager.go:903-926`).
- Workload-scoped pod reads keep a row only while its current direct or
  collapsed owner matches the scope (`snapshot/pods.go:316-355`).
- So when an update changes a pod's owners, the old owner's scope gets no
  signal and its Pods list keeps the pod [inferred: not probed]. Example: a
  pod relabeled out of its ReplicaSet, which removes its ownerReference.
- Owner heals keep the direct owner, so the old scope is still rung in that
  case (`derived_rows.go:30-40`).
- Two handlers already ring the previous target, and the pipeline must keep
  that: HPA retargets (`resourcestream/manager.go:475-492`) and Helm release
  renames (`:382-400`).
- The maintained store already looks up the row it replaces under its own lock
  (`querypage/store.go:231-235`), and the row it deletes (`:296-312`). A
  publisher can therefore get "before" and "after" without new ingest
  plumbing.

## Target model

- **One doorbell per cluster generation, built before any producer.**
  - A `Bell` interface lives in a new leaf package, `backend/refresh/doorbell`.
    It imports `streammux` (for `Source` and `MessageType`) and
    `resourcemodel`. Neither imports `snapshot` or `resourcestream` (checked
    with `go list -deps`), so there is no import cycle.
  - `resourcestream.Manager` implements `Bell` with today's invalidate-then-fan-out
    path.
  - `NewSubsystemWithServices` builds the snapshot service first: it needs
    only the registry pointer, and domain readiness can be set after
    `domainRegistrations` returns. It then builds the Manager with the
    invalidator as a constructor argument and passes the `Bell` into every
    producer's constructor.
  - The Manager no longer registers any informer handler or ingest sink that
    rings.
- **The store's apply path is the only place that rings.**
  - Each maintained store gets a publisher when it is constructed.
  - Every mutation path calls the publisher after the store mutation returns:
    informer handler, ingest sink, bulk replace, reconcile.
  - Producers 3–9 already ring after their own apply. They keep their owners
    and only receive the `Bell` at construction.
- **Translation lives next to the store** ([decision 1](#decisions)).
  - The row→scope functions move from `resourcestream` into `snapshot`: own
    scopes, plus derived rows (pod → workload/node, HPA → workload,
    RBAC → identities). Snapshot already owns scope semantics for the event
    and details notifiers.
  - Scopes are built with the existing codec (`backend/refresh/scope_selector.go`).
  - `resourcestream` keeps subscriptions, resume buffers, fan-out, the metric
    domain list (`projection_descriptors.go`), and the ReplicaSet and Job
    owner-heal feeds (see [non-goals](#non-goals)).
- **Shutdown is a synchronous barrier.**
  - The `Bell` runs every timed producer callback. Debounce flushes, the
    namespace notifier's re-arm, and the attention index's notify and
    deadline timers use `Bell.AfterFunc` instead of `time.AfterFunc`. The
    `Bell` counts each callback while it runs.
  - `Ring` checks a stopped flag and counts itself while it invalidates and
    delivers. Once stopped, it returns at once without doing either. It never
    waits on `Stop`.
  - `Manager.Stop` does four things, in order:
    1. sets stopped, so new rings and callbacks are no-ops;
    2. cancels pending timers;
    3. waits until every running callback, and every ring past its check, has
       returned;
    4. closes subscriptions.
  - When `Stop` returns, no producer callback runs or will run for that
    generation, and nothing can invalidate or deliver. This extends the
    namespace notifier's `activeFlushes` wait to every producer. It replaces
    `StopDoorbellNotifiers` and its list.
  - **Deadlock rule.** A callback may call `Ring`, which returns at once after
    stop, but must not call `Stop`. While waiting, `Stop` holds no lock a
    callback needs. The namespaces readiness hook already hands its work to a
    new goroutine (`backend/refresh_setup.go:511-513`), so it never blocks a
    flush on coordinator locks.
  - Store publications from informer and ingest goroutines also go through
    `Ring`, so the same wait covers them. Those stores keep applying changes
    until teardown stops the feeds, but they ring nothing.
- **Relists publish at a partition boundary.**
  - `ProjectingStore` brackets every relist, both `Replace` and
    `ReplacePartition`, with calls to an optional sink interface. Proposal:
    `RelistBoundary` with `BeginRelist(partition)` and `EndRelist(partition)`.
    It sits beside the existing optional sink interfaces
    (`projecting_store.go:85-113`).
  - `EndRelist` runs after the partition's rows and indexes are committed,
    still under the write lock.
  - Between the two calls the source's sink defers its rings. It collects the
    affected scopes, own and derived, from each per-row delete and upsert. At
    `EndRelist` it rings each collected scope once.
  - A bulk `ReplaceBundles` inside the bracket redefines the whole kind, so
    `EndRelist` rings every subscribed scope of the domain and of its derived
    domains instead.
  - **Batches belong to each source registration, not to the domain.**
    - Several sources feed one maintained store:
      - `namespace-network`: four ingest kinds
        (`snapshot/namespace_network.go:135-149`), plus the Gateway-API
        informer handlers;
      - `namespace-workloads`: five ingest kinds (`namespace_workloads.go:176-177`);
      - the typed-table domains: one sink per ingest-owned descriptor
        (`querypage_typed.go:960-973`).
    - Each kind has its own ingest store and lock, and its reflectors run on
      their own goroutines (`ingest/manager.go:596-607`). So a Service relist
      and an EndpointSlice relist or update can overlap. With one batch per
      domain, they could flush or clear each other's collected scopes
      [inferred].
    - Each registration therefore gets its own sink instance, which holds its
      open batch. Today `bundleSinkFor` and `bundleSinkForKind` return value
      sinks with no state (`querypage_typed.go:991-1022`). The domain
      publisher stays stateless: scope functions plus the `Bell`.
    - A sink's batch is touched only under its source store's write lock. A
      store's partition relists and incremental changes all take that lock
      (`partition.go:46-59`, `projecting_store.go:534-566`), so a sink has at
      most one open batch and needs no lock of its own.
    - For the `""` partition, both boundary calls go inside `Replace`'s
      critical section (`projecting_store.go:738-763`).
      `replaceUnpartitioned` locks again only to mark the partition synced
      (`partition.go:63-71`).
    - A change from any other source rings at once. It never joins, flushes,
      or clears another sink's batch.
- **Departures ring as well as arrivals.**
  - A publication's scopes are the union of the scopes of the row before the
    change and the row after it, for the domain and every derived domain. They
    are computed after the apply.
  - The maintained store returns the replaced or deleted row from its
    querypage mutation, under the lock that applies it. This needs new
    variants of `Upsert` and `Delete` (`querypage/store.go:222-235`,
    `:296-312`). The publisher takes "before" from that row, not from the
    incoming event.

API sketch. The names are proposals.

```go
package doorbell

// Bell rings a domain's doorbell after the store the domain reads has
// committed a change.
type Bell interface {
	// Ring invalidates the domain's snapshot cache, then delivers. It takes
	// only leaf locks and never waits on Stop; after Stop it does neither.
	Ring(Change)
	// AfterFunc runs fn once after d as a generation callback: it never starts
	// after Stop, and Stop waits for it while it runs.
	AfterFunc(d time.Duration, fn func()) Timer
}

type Change struct {
	Domain  string
	Source  streammux.Source // object | metric | event | catalog | attention
	Target  Target           // Scopes(...), Subscribed(), or Matching(fn)
	Version string           // opaque clock; "" means the per-scope sequence
	Type    streammux.MessageType
	Ref     *resourcemodel.ResourceRef // optional, diagnostic, complete identity
	ResourceVersion string           // optional, diagnostic
}
```

`Target` is a sealed type with three constructors, so a change cannot name
explicit scopes and "all subscribed" at once. The three map to today's
`broadcast`, `broadcastDoorbellRefresh`, and `broadcastMatchingDoorbellRefresh`
(`resourcestream/stream_hub.go:115`, `manager.go:663-695`).

`Manager.Stop` is the barrier above. It belongs to the generation owner and is
not part of the interface producers receive.

## Guarantees

- **G1. The store applies, then the doorbell rings.** For every domain D and
  every source change C, D rings only after C is visible to D's build:
  - A maintained store rings from its own mutation path, after the querypage
    mutation returns.
  - A domain that reads an ingest store at serve time (pod aggregates,
    identities, endpoint counts) rings from inside that store's sink fan-out.
    The fan-out holds the store's write lock, and readers take its read lock
    (`projecting_store.go:118-119`, `:568-575`, `:894-898`). A read that
    starts after the ring waits for the commit (the ingest probe saw this).
  - A domain that reads an informer index rings from a handler. client-go
    updates the index before any handler runs.
  - The scopes rung are the union of the row's scopes before and after the
    change. A row that leaves a scope rings it, just as a row that enters
    one does.
- **G2. Invalidate before deliver.** Unchanged: `Ring` advances the domain's
  cache generation, then delivers (`stream_hub.go:115-127`,
  `service.go:514-553`). With G1, a read that starts after delivery sees the
  change, and a read from before the ring cannot repopulate the cache.
- **G3. One ringer per domain and source.** No handler or sink outside the
  store's own mutation path rings a domain. `resourcestream` registers no
  informer handler or ingest sink, except the two owner-heal feeds, which ring
  nothing themselves.
- **G4. Only real changes ring.**
  - An informer resync echo still applies to the store (idempotent) but does
    not ring.
  - An ingest relist, scoped or not, rings each affected scope once, at its
    partition boundary after the commit ([decision 4](#decisions)). A
    namespace partition's relist never rings a sibling namespace's scope.
  - Each source registration has its own batch. One source's relist never
    delays, flushes, or clears another source's rings.
  - A reconcile on re-warm rings every row it removes, for every informer-fed
    store; today only the event tables do (`querypage_typed.go:901-905`).
    Once echoes stop ringing, a ghost row removed by reconcile would otherwise
    never ring.
- **G5. Readiness.**
  - The `Bell` accepts rings from construction. There is no "not wired yet"
    state.
  - Rings during the initial sync reach only existing subscribers, as today
    (`resourcestream/manager.go:711-758` buffers only for active or recent
    subscribers).
  - A reconnect still reconciles through replay or RESET
    (`data-freshness.md`, "Signals and source clocks").
  - The namespaces readiness self-build still runs after the namespaces ring.
    It is the operation that takes a cluster to Ready.
- **G6. Teardown.**
  - `Manager.Stop` returns only after every running producer callback and
    every in-flight ring has finished.
  - After it returns, nothing invalidates the snapshot cache or delivers for
    that generation. A cooled generation keeps serving its cached snapshots.
  - Cooling and teardown already stop producers in one place
    (`backend/refresh_generation.go:271-303`). That call becomes the single
    `Manager.Stop`.
- **G7. Cluster scope.**
  - One `Bell` per cluster generation stamps `ClusterID` on every message, as
    `Manager` does today.
  - Generation replacement and aggregate routing do not change
    (`docs/architecture/refresh-system.md`, "Backend subscription lifetime").
  - Any `Ref` a signal carries has complete identity.
- **Locks.** `Ring` keeps today's lock profile: the snapshot cache mutex, the
  Manager's leaf mutex, and the telemetry recorder's, plus non-blocking channel
  sends. It never calls back into a store. Rings from ingest sinks still run
  under the source store's write lock, as the notify sinks do today.
  `Manager.Stop` waits only on its own counter's condition and holds no store
  or producer lock while waiting.

## Behavior changes

- `namespace-network`, `cluster-config`, `namespace-autoscaling`,
  `cluster-crds`, and `namespace-helm`:
  - they ring after their store applies, which fixes the stale rows;
  - they stop ringing on 15 s resync echoes, which removes a refetch per open
    scope every 15 s [inferred from the probe and the 15 s interval].
- Ingest relists ring each affected scope once, not once per row
  ([decision 4](#decisions)). This also holds for scoped clusters' per-namespace
  relists.
- Teardown and cooling wait for running object-events, object-details,
  event-table, and attention callbacks, as they already do for the namespace
  notifier. A late ring can no longer invalidate a stopped generation's cache.
- A pod whose owners change rings its previous owners' scopes too.
- ConfigMap-stored Helm releases stop ringing `namespace-helm`. The table does
  not show them, so nothing visible changes [inferred].
- Derived workload and node signals carry no `Ref`
  ([decision 5](#decisions)). No production consumer reads it.
- Reconcile removals ring for every informer-fed store (G4).
- No frontend change. The wire messages and source clocks stay the same
  (`backend/refresh/streammux/types.go:79-93`).

## Non-goals

- Moving the typed-informer kinds to ingest.
- Changing the stream protocol, the frontend refresh runtime, debounce
  windows, the 5 s snapshot cache TTL, or the 15 s resync interval.
- Changing the object catalog's internals (producer 9 already applies before
  it publishes) or response-cache eviction (PR 398).
- Moving the ReplicaSet and Job owner-heal feeds
  (`derived_rows.go:19-58`, `ingest_notify_workloads.go:112-146`) out of
  `resourcestream`. They feed the pod store, whose publisher rings. Moving them
  next to `snapshot/pod_owner_heal.go` would be a reasonable follow-up.
- Diffing ingest relists row by row.
- Showing ConfigMap-stored Helm releases in the table.

## Inventory: what changes

### Producers

| Area | Change |
| --- | --- |
| `backend/refresh/doorbell` (new) | `Bell`, `Change`, `Target`, generation timers |
| `refresh/querypage/store.go` | `Upsert` and `Delete` variants that return the replaced or removed row |
| `refresh/ingest/projecting_store.go`, `partition.go` | Relist boundary calls around `Replace` and `ReplacePartition`, inside the write lock |
| `resourcestream/manager.go`, `stream_hub.go` | Implement `Bell` (stopped check, in-flight count, generation timers); invalidator becomes a constructor argument; `Stop` becomes the barrier. Delete `SetSnapshotDomainInvalidator`, `registerCRDStream`, the HPA and Helm handlers, and the `Broadcast*Refresh` wrappers (`:537-695`) once their callers use `Ring`. |
| `resourcestream/stream_descriptor_dispatch.go`, `stream_registration_direct.go`, `stream_registration_helpers.go` | Delete (producer 1) |
| `resourcestream/ingest_notify*.go`, `derived_rows.go`, pod notify registration in `stream_registration_related.go` | Delete the notify sinks and lookups (producer 2). The scope functions (`manager.go:903-966`) move to `snapshot`. |
| `snapshot/querypage_typed.go` | Store publisher (stateless); one sink instance per source registration, holding that source's relist batch; one informer-handler helper (apply, skip echo, publish) replacing `registerMaintainedHandlers` and `registerMaintainedInformerHandler`; sink mutation and relist paths publish; reconcile publishes removals |
| `snapshot` domain registrations | `typed_table_domain.go`, `namespace_network.go`, `namespace_workloads.go`, `nodes.go`, `pods.go`, `cluster_crds.go`, `namespace_helm.go`, `namespace_autoscaling.go`, `cluster_config.go`, `cluster_rbac.go`, `namespace_*` table domains pass a publisher |
| `snapshot` notifiers | Producers 3–7 take the `Bell` in their constructors and schedule through `Bell.AfterFunc`; delete `SetBroadcast`, the pending-until-wired paths, and their own stop logic |
| `system/manager.go`, `registrations.go`, `streams.go` | New construction order; delete `wireStreamObservers`, `streamObserverDeps`, the `wire*Doorbell` helpers, `StopDoorbellNotifiers`, the `note*` callbacks that exist only for wiring, and the `ObjectEventsNotifier` and `EventTableNotifiers` fields |
| `metrics` wiring | The observer is passed at construction (`system/manager.go:298-319`) |
| `backend/refresh_object_catalog.go`, `refresh_generation.go` | Catalog bridge takes the `Bell`; the teardown call to `StopDoorbellNotifiers` goes away |

### Consumers

- **Frontend**, unchanged: stream protocol and manager
  (`frontend/src/core/refresh/streaming/`), orchestrator signal refetch
  (`orchestrator.ts:1307`), `useQueryStreamSignal`. Existing streaming tests
  stand as regression.
- **Snapshot cache:** `Service.InvalidateDomainCache` (`service.go:538`).
- **Readiness self-build:** `NamespacesDoorbellObserver`
  (`refresh_setup.go:496-527`). The observer slot is passed into the namespace
  notifier's constructor. The coordinator still sets its function later,
  because the aggregate service is built after all subsystems
  (`refresh_setup.go:505-506`). That late binding is justified and stays.
- **Cold preparation:** `NamespaceNotifier.WorkloadsReady`
  (`backend/refresh_governor.go:478`), unchanged.
- **Attention targets** (`backend/refresh_subsystems.go:36-95`) and
  **response-cache eviction** (`refresh_response_cache_invalidation.go:50`)
  keep their notifier handles.
- **Stream telemetry:** `recordBroadcastResult` (`stream_hub.go:159`),
  unchanged.

### Tests that encode the current wiring

These 21 files construct or call the current wiring and change with it. The
pattern used was `SetBroadcast(`, `wireStreamObservers(`,
`StopDoorbellNotifiers(`, `SetSnapshotDomainInvalidator(`, the handler names,
and the notify sink names.

- `backend/refresh/resourcestream`: `manager_test.go`,
  `ingest_notify_test.go`, `ingest_notify_pods_test.go`,
  `ingest_notify_network_test.go`, `ingest_notify_nodes_test.go`.
- `backend/refresh/system`: `namespaces_doorbell_test.go`,
  `objectevents_doorbell_test.go`, `event_table_doorbell_test.go`,
  `cluster_attention_doorbell_test.go`, `cluster_identities_test.go`,
  `custom_ingestion_test.go`, `subsystem_permission_budget_test.go`.
- `backend/refresh/snapshot`: `namespace_notifier_test.go`,
  `object_events_notifier_test.go`, `object_details_notifier_test.go`.
- `backend/refresh/ingest`: `manager_sink_locking_test.go`.
- `backend`: `refresh_object_details_doorbell_test.go`,
  `refresh_object_catalog_test.go`, `refresh_subsystems_swap_test.go`,
  `refresh_catalog_freshness_test.go`, `refresh_catalog_attention_test.go`.

Handler tests that only prove a translator emits an update move to the store's
publisher, or are deleted with the translator. Seam tests that build real
owners stay and are rewired.

### Docs

- `docs/architecture/data-freshness.md:103-147`, "Signals and source clocks".
- `docs/architecture/refresh-system.md:94`, Ownership.
- `docs/architecture/data-layer.md:190-198`, Delivery.
- `.agents/skills/refresh-subsystem/references/fragility.md:11-13`, Teardown.
- `.agents/skills/refresh-subsystem/references/domain-wiring.md`, "Streamed
  tables".
- `docs/release/pending.md`.

## Cross-layer contract

- **Producer and consumers:** stores in `snapshot` produce. The `Bell` (in
  `resourcestream`) fans out to the named-stream adapter and the frontend
  stream manager. The snapshot cache and the readiness observer consume in
  process.
- **Ordering and readiness:** G1–G6.
- **Circular dependencies:**
  - Packages: `doorbell` is a leaf, as checked above.
  - Construction: the snapshot service no longer comes after registration, so
    the invalidator exists before the `Bell`, and the `Bell` before every
    producer.
  - Locks: `Ring` adds no lock edge (see Locks under G7).
- **Regression tests:** listed per phase. Each table test uses production
  registrations and the production `Bell`, and must fail with the store's
  publication removed.
- **Gates:**
  - *Blocked:* after `Manager.Stop` returns, no producer callback runs and
    nothing invalidates or delivers (G6). This includes a callback that was
    already running when `Stop` began.
  - *Still allowed:* rings during the initial sync and the namespaces
    readiness self-build (G5).

## Phases

Red/green/refactor applies to every behavior change. A phase that changes no
behavior is a refactor under green: existing tests plus characterization
tests, with no red test invented.

### Phase 0: test harness

Tests only; no production change.

- [ ] Turn the probe into shared helpers in `backend/refresh/system`:
  - **Informer gate.** A factory wrapper that holds only the store's own
    handler registration. It finds the registration by the registering
    function's frame and asserts exactly one match, so a rename fails loudly.
  - **Ingest API.** Extend the `identityTestAPI` pattern into a
    tracker-backed API for RoleBinding, ServiceAccount, Deployment,
    ReplicaSet, Node, Service, EndpointSlice, and Pod, so
    `NewSubsystemWithServices` runs the production owned reflectors and the
    ReplicaSet informer that collapses pod owners.
  - **Blocking catalog sink.** A catalog sink added after production's sinks,
    which holds the ingest store write.
- [ ] Characterization, green on `main`: Pods ring after their store applies.
  Producers 3–9 already have seam tests:
  `TestEventTableDoorbellsReachEveryViewedScopeAfterTheStoreApplies`,
  `TestClusterAttentionDoorbellInvalidatesCacheBeforeBroadcast`,
  `TestNamespaceNotifierInvalidatesCacheThenBroadcastsDoorbell`,
  `TestObjectEventsNotifierInvalidatesCacheThenBroadcastsDoorbell`,
  `TestObjectDetailsSignalFollowsEvictionThroughProductionWiring`,
  `TestMetricsSignalObserverBroadcastsMetricDoorbells`, and
  `TestCatalogDoorbellBridgeBroadcastsCatalogSource`.

### Phase 1: one doorbell per generation, built before producers

Nothing changes for any consumer except shutdown, which gets the barrier
(red/green). The rest is a refactor under green.

- [ ] Red: `TestGenerationStopWaitsForRunningProducerCallbacks`.
  - **Wiring:** like `newEventTableHarnessWith`
    (`system/event_table_doorbell_test.go:45-81`), with real producers, the
    real Manager, and the real snapshot service. The test wraps the snapshot
    invalidator so its first call blocks; on `main` it installs the wrapper
    through `SetSnapshotDomainInvalidator`, and after this phase through the
    constructor.
  - **Cases:** one per timed producer (object events, object details, an
    event table, attention, the namespace notifier), plus one store
    publication.
  - **Steps:** make the producer ring, so its callback is held inside the
    invalidation. Stop the generation on another goroutine.
  - **Assertions:** `Stop` has not returned while the callback is held. After
    release it returns. Further producer inputs then cause no invalidation
    and no delivery for longer than the debounce window.
  - **Today:** fails for every case except the namespace notifier. Nothing
    else waits or checks `stopped` (`change_key_debouncer.go:61-70`,
    `cluster_attention.go:1079-1096`, `stream_hub.go:115-127`) [inferred;
    the test confirms it].
- [ ] Characterization of pending timers: mark every timed producer dirty,
  including the namespace notifier while its tracker is still syncing (its
  re-arm loop). Stop, wait past the debounce, and assert that a cached
  snapshot is still served, so nothing invalidated.
- [ ] Add `backend/refresh/doorbell`. `resourcestream.Manager` implements
  `Bell` by delegating to its current broadcast paths, and adds the stopped
  check, the in-flight count, and `AfterFunc`.
- [ ] Construction order in `NewSubsystemWithServices`:
  1. registry;
  2. snapshot service;
  3. Manager, with the invalidator as a constructor argument;
  4. `registrationDeps` with the `Bell`;
  5. registration;
  6. domain readiness.

  Delete `SetSnapshotDomainInvalidator`.
- [ ] Producers 3–7 take the `Bell` (and the namespaces observer slot) in their
  constructors. Delete:
  - the 5 `SetBroadcast` methods and calls, and the interface;
  - `setSink` and the other pending-until-wired paths;
  - `wireStreamObservers` and its helpers;
  - the `note*` callbacks used only for wiring;
  - the `ObjectEventsNotifier` and `EventTableNotifiers` fields.
- [ ] Pass the metrics observer at construction. The catalog bridge takes the
  `Bell`.
- [ ] Timed producers schedule through `Bell.AfterFunc`, and `Manager.Stop`
  becomes the barrier in the target model. Delete `StopDoorbellNotifiers`, its
  call in `refresh_generation.go:284`, and each producer's own stop logic. That
  includes the namespace notifier's `activeFlushes`, which the barrier
  replaces; its existing stop test moves to the generation.
- [ ] Rewire the existing doorbell tests' construction only; their assertions
  stay the same.

### Phase 2: informer-fed stores ring after they apply

Fixes the proven race and the echo rings together (G1, G4). Each red test is
table-driven over HTTPRoute (`namespace-network`), GatewayClass
(`cluster-config`), HPA (`namespace-autoscaling`), CRD (`cluster-crds`), and a
Helm release Secret (`namespace-helm`). Each uses production registrations and
the production `Bell`.

- [ ] Red: `TestInformerFedTableDoorbellFollowsItsStore`. Hold the store's
  handler and create an object.
  - No doorbell while the handler is held. After release: one doorbell; the
    read it triggers and a later cached read both show the object.
  - Repeat for an update, a deletion request held by a finalizer (still
    present, so an update), and a completed delete.
  - Another namespace's scope stays quiet.
  - For HPA: the target workload's row rings after the HPA store applies, and
    the workloads read shows the HPA context. When the HPA changes target,
    both the old and the new workload rows ring.
  - Fails today: probed for HTTPRoute; the other rows share its handler shape
    in code.
- [ ] Red: `TestInformerFedTableDoorbellsIgnoreResyncEchoes`. Use a 1 s resync.
  An unchanged object rings nothing for 2.5 s; a real update right after still
  rings. Set `resourceVersion` explicitly, because the fake tracker leaves it
  empty. Fails today: the HTTPRoute probe saw 3 rings; the other rows use the
  same echo-blind handlers (`stream_registration_helpers.go:30-46`,
  `resourcestream/manager.go:320-327`).
- [ ] Red: `TestInformerFedStoresRingWhenReconcileDropsRestoredRows`, modeled
  on `TestEventTableDoorbellsRingWhenReconcileDropsRestoredRows`. Fails today:
  reconcile does not ring for these stores.
- [ ] Green:
  - Store publisher on `typedMaintainedStore`. Scopes come from the
    descriptor: namespaced kinds ring their namespace and All Namespaces;
    cluster-scoped kinds ring the cluster scope. Each publication rings the
    union of the before and after rows' scopes, using the row the querypage
    mutation returns.
  - One informer-handler helper (apply, skip echo, publish) replaces both
    helpers. CRDs pass a publisher instead of `nil`.
  - The Helm reaggregate handler publishes after each upsert or delete. When
    an update changes the release key, it re-aggregates and publishes both the
    old and the new release. Today only the ring covers the old key
    (`manager.go:382-400`); the store's handler re-aggregates only the new
    object (`namespace_helm.go:139-143`) [verify with a red test whether the
    old release's row goes stale].
  - The HPA publisher rings the HPA row and the target workload row.
    `hpaWorkloadTarget` moves to `snapshot`.
  - Reconcile publishes removed rows.
- [ ] Delete producer 1, its helpers, and the HPA descriptor's
  `CustomStreamHandler` facet if it has no other reader.
- [ ] The response-cache eviction tests still pass. Those handlers share the
  same informers.

### Phase 3: ingest-fed stores ring after they apply

- [ ] Red: `TestIngestFedTableDoorbellFollowsItsStore`, through
  `NewSubsystemWithServices` and the Phase 0 ingest API. While the blocking
  catalog sink holds the write, no doorbell; after release, one doorbell, and
  the read shows the change. Rows:

  | Object | Rings |
  | --- | --- |
  | RoleBinding | `namespace-rbac`, derived `cluster-identities` |
  | Deployment | `namespace-workloads` |
  | Node | `nodes` |
  | Service, EndpointSlice | `namespace-network` |
  | Pod | `pods`, derived workload and node rows |

  Every row but Pod should fail today. RoleBinding was probed (it rang while
  held); the others follow from the same sink order in code. Pod is green
  characterization.
- [ ] Red (if decision 4 is yes): `TestScopedRelistRingsEachAffectedScopeOnce`.
  - **Setup:** a scoped cluster with namespaces `a` and `b`, through the
    production registration with `AllowedNamespaces`, so each namespaced kind's
    store has two partitions. Seed both namespaces, and subscribe to
    `namespace:a`, `namespace:b`, and `namespace:all`.
  - **Steps:** relist partition `a` through its `StorePartitionView.Replace`
    (the reflector's entry point) with one row added, one changed, and one
    dropped.
  - **Assertions:** `namespace:a` and `namespace:all` each ring exactly once,
    after the store holds `a`'s new set. `namespace:b` rings nothing. Reads
    of `namespace:b` and `namespace:all` still contain `b`'s rows.
  - **Unscoped case:** repeat through the `""` partition and assert that each
    subscribed scope rings once.
  - **Today:** fails, because the notify sinks ring once per row on both
    paths.
- [ ] Red: `TestOverlappingSourceRelistsKeepSeparateBatches`, on
  `namespace-network` through `NewSubsystemWithServices` and the Phase 0
  ingest API.
  - **Setup:** Service rows in namespace `a` and EndpointSlice rows in
    namespace `b`. Subscribe to `namespace:a`, `namespace:b`, and
    `namespace:all`. Add a test bundle sink to the Service store after the
    production sinks. It blocks inside a relist, after the maintained store's
    sink has seen the rows and before `EndRelist`, holding Service's batch
    open.
  - **Relist against relist:** start a Service relist that changes `a`'s rows
    on one goroutine. While it is held, complete an EndpointSlice relist that
    changes `b`'s rows.
    - `namespace:b` and `namespace:all` each ring once, at EndpointSlice's
      `EndRelist`. `namespace:a` does not ring while Service's relist is held.
    - After release, `namespace:a` and `namespace:all` each ring once more.
      Reads show both sources' new rows.
  - **Relist against update:** while Service's relist is held, an
    EndpointSlice update in `b` rings `namespace:b` at once.
  - **Driving:** call each store's `StorePartitionView.Replace` and `Update`,
    the reflector's entry points, so the interleaving is deterministic.
  - **Today:** the first case fails, because Service rows ring per row while
    the relist is held. The second passes and is characterization. Together
    they guard the per-source batch.
- [ ] Red: `TestPodOwnerChangeRingsPreviousOwnerScopes`, through the Phase 0
  ingest API.
  - **Setup:** a pod owned by ReplicaSet `web-1`, which collapses to
    Deployment `web`. Subscribe to both owners' workload scopes, the
    namespace, and the replacement owner's scope.
  - **Owner removal:** update the pod with its ownerReference removed. The
    ReplicaSet and Deployment scopes each ring, and neither read includes the
    pod.
  - **Owner replacement:** point the ownerReference at ReplicaSet `api-1`. The
    old and new owners' scopes all ring, and each read is correct.
  - **Today:** fails [inferred]. The pod notify sink rings only the new
    summary's scopes.
- [ ] Green:
  - `ProjectingStore` calls `BeginRelist` and `EndRelist` around `Replace` and
    `ReplacePartition`. `EndRelist` runs after the partition's commit.
  - Each source registration gets its own `maintainedStoreSink` instance. It
    publishes after each incremental mutation, outside a relist. Inside one,
    it collects scopes in its own batch and rings them once at `EndRelist`.
    After `ReplaceBundles` it rings every subscribed scope.
  - Every publication uses the union of the before and after rows' scopes.
  - Per-domain publishers: descriptor kinds, workloads, nodes, network, and
    pods. Pods use `scopesForPod`, moved from `resourcestream`, plus derived
    rows. Identities are derived for the domain's composition sources, the rule
    in `ingest_notify.go:62-70`.
  - [verify] Whether `PodSummary` carries UID and `resourceVersion` for the
    diagnostic `Ref`. If not, feed pods through a bundle sink like the other
    ingest stores.
- [ ] Delete producer 2 and its registrations. Delete the `Ref` lookups if
  decision 5 is yes. Replace the notify-sink unit tests with publisher tests at
  the store.
- [ ] Refactor: delete the `Broadcast*Refresh` wrappers once every caller uses
  `Ring`.

### Phase 4: docs and plan removal

- [ ] Update `data-freshness.md`, "Signals and source clocks". Replace the
  convention text with G1–G6: the store's mutation path is the only place that
  rings; echoes; relists; reconcile.
- [ ] Update `refresh-system.md` Ownership (`resourcestream` is the doorbell
  hub; stores publish) and `data-layer.md` Delivery.
- [ ] Update `fragility.md` Teardown and `domain-wiring.md` "Streamed tables"
  (give the store a publisher; never register a ringing handler).
- [ ] Add release notes to `docs/release/pending.md`, under the tables area:
  Gateway API, HPA, CRD, and Helm tables update reliably after changes.
- [ ] Delete this plan after moving its durable rules.

## Decisions

1. **Where translation lives.**
   - **A:** keep the row→scope translators in `resourcestream`. Stores call
     them through a domain-keyed interface after they apply. Smaller move, but
     each domain still has two places that must agree.
   - **B (recommended):** move translation into `snapshot` next to each store.
     `resourcestream` keeps the hub and the metric domain list. This gives one
     pattern for every producer: the store, then its publisher, then the
     `Bell`. The event and details notifiers already use it.
2. **Order of work.**
   - **Recommended:** Phase 1 before Phase 2. Fixing the race first would add
     five more late-wired notifiers for Phase 1 to delete. Phase 1 changes
     nothing consumers see. Its one behavior change, the stronger shutdown
     barrier, has its own red test.
   - **Alternative:** if John wants the race fixed first, Phase 2 can ship
     alone using the event-table notifier pattern.
3. **Echo rings.** Stop ringing on informer resync echoes for the five
   affected tables, in the same phase as the order fix and never before it.
   Recommended: yes. It is the documented contract, and removing it first
   would make stale rows permanent.
4. **Relists.** Ring each affected scope once per relist, at the partition
   boundary, instead of once per row:
   - scoped clusters: the scopes of that namespace's rows;
   - unscoped: every subscribed scope of the domain.

   Recommended: yes. Consumers refetch per scope anyway, and a namespace relist
   never rings a sibling namespace.
5. **`Ref` on derived signals.** Drop the diagnostic `Ref` on derived
   workload and node signals, removing cross-store lookups under the pod store
   lock. Recommended: yes; no production reader exists. Object signals keep
   their full `Ref`.
6. **Native evidence.** Automated tests cover the backend seam. A native check
   needs a dev cluster with Gateway API and an HPA, and someone to
   create, edit, and delete objects there.
   - **Recommended:** John runs the [native checks](#native).
   - **Alternative:** John names a dev kubeconfig and namespace where test
     objects may be created.

## Validation

### Automated

- Focused (with `GOCACHE` set per AGENTS.md in the Codex sandbox):

  ```sh
  mise exec -- go test ./backend/refresh/snapshot ./backend/refresh/system ./backend/refresh/resourcestream/... ./backend/refresh/ingest
  mise exec -- go test ./backend -run 'Doorbell|Catalog|ResponseCache|Subsystem'
  mise exec -- go test -race ./backend/refresh/...
  ```

- `mise exec -- npm run test --prefix frontend -- refresh streaming`, as a
  regression check that the wire did not change.
- Coverage: `mise exec -- wails3 task test:backend-coverage`. Target 80% for
  the changed files; report any gap.
- Cognitive complexity of 12 or less for every changed or new function
  (`gocognit -over 12`, per `docs/frontend/sonar.md`).
- `mise exec -- wails3 task qc:prerelease` on the final tree.

### Native

Run on a dev cluster with the app's persisted kubeconfig selection checked
first. These checks are not covered by automated tests.

- With the Network view open on a namespace, create, edit, and delete an
  HTTPRoute. Then delete the last HTTPRoute in that namespace. Each change
  shows without manual refresh, before the 15 s resync.
- The same for an HPA (Autoscaling view, and the target workload's row) and a
  Helm upgrade (Helm view).
- Diagnostics connections table (`Delivered` column,
  `frontend/src/core/refresh/components/diagnostics/TableConnections.tsx:189`):
  on a namespace with Gateway-API objects and no network changes, the
  `namespace-network` count no longer rises on a 15 s cadence.
