# Backend data layer — store, ingest, governor, delivery

How cluster object state reaches a table. One per-cluster columnar store and
one `Query → Page` engine serve every typed table and Browse; detail,
object-map, overview, logs, metrics, and permissions are deliberately separate
paths (see [Boundaries](#boundaries-deliberately-not-this-path)).

## Ownership

- **Store + query engine:** `backend/refresh/querypage/` (owned columnar
  `Store[R]` and the `Query → Page` engine).
- **Ingestion:** `backend/refresh/ingest/` (owned-reflector LIST+WATCH with
  projection at intake, the managed-fields transform, and the startup transport
  policy) for every built-in kind; `backend/refresh/permissions/` (list/watch
  grants).
- **Serve + maintained stores:** `backend/refresh/snapshot/querypage_typed.go`
  (`resolveTypedSnapshotPageViaStore`, `resolveMaintainedDirect`,
  `typedMaintainedStore`); `backend/objectcatalog/` for Browse.
- **Lifecycle/memory:** `backend.RefreshCoordinator` (`backend/refresh_*.go`),
  governor policy in `backend/refresh/system/governor.go`, spill in
  `backend/refresh/domain/maintained_stores.go`. Reset unpublishes routing and
  stops producers before clearing cache and spill state; offline reset removes
  the same cache root through `internal/appstate` `Manifest`.

## Invariants

1. **One store, one query language, one delivery model.** Typed tables and
   Browse are the same `querypage` call differing only by `WHERE kind`. Do not
   add a second query engine or cursor codec.
2. **The webview never holds, sorts, or filters N.** Ordering, filtering,
   facets, and totals are backend-owned; the client holds the visible page and a
   small LRU. Narrowing the already-loaded window with the identical predicate
   during a refetch is allowed; full-N client sort/filter is not.
3. **No cgo, no embedded SQL engine.** The store is a pure-Go owned columnar
   SoA. Any on-disk fallback stays pure-Go (`bbolt`/Badger), never SQLite/cgo.
4. **Object state and metrics are separate sources joined by UID.** Metrics are
   overlaid at serve from the poller (`LatestPodUsage()`) inside the base table
   domains (`pods`, `nodes`, `namespace-workloads`, which carry an extra
   `metric` clock), never written to the store. A metrics poll never
   re-projects or re-stores an object row. There are no per-kind `*-metrics`
   domains and no client-side metric join; `namespace-metrics` is the one
   metric-only payload ([resource-metrics.md](resource-metrics.md)).

## Store & query engine (`querypage`)

- **Columnar SoA, dictionary-interned** (`store.go`, `columnar.go`): string
  columns intern to `uint32` dict ids, numeric/bool columns are pointer-free
  slices, rows live in a recycled `rowId` arena, and columns that are ≥90%
  unique drop the dictionary. A by-`rowId` match cache answers
  filter/search/facet/total without row reconstruction.
- **Per-direction keyset indexes:** one asc and one desc `google/btree` per
  sortable key, tie-broken to reproduce the live total order. Cursor =
  `(sortValue, uid)` plus signature (`cursor.go`).
- **Cost:** O(log N + page) when walked entries match; sparse filters/search
  degrade toward O(N) (`store.go` `collect`; trigram narrowing still verifies
  each entry). Unfiltered totals are O(1) and facet counters are maintained,
  but a filtered exact `Total` and `Scope` (maintained-direct filtered facets
  and totals) are O(N) column scans: 4–18 ms per page at 100k–250k rows
  ([Current Browse Budget](large-data-measurements.md#current-browse-budget)).
- **On-disk format = the same SoA, mmap'd** (`columnstore_mmap.go`: zero-copy
  `unsafe.Slice`/`unsafe.String` over `syscall.Mmap`, portable heap fallback).
  Spill and Cold serving use it.
- **Serve paths:** typed domains use `resolveMaintainedDirect` (query the
  persistent store in place) or `resolveTypedSnapshotPageViaStore` (per-Build
  store for cross-kind-join domains); Browse uses `objectcatalog`
  `queryViaEngine`.

## Ingestion (owned-reflector LIST+WATCH + projection-at-intake)

- **Project at intake.** `ingest.IngestManager` (`ingest/manager.go`) runs
  client-go reflectors for List/Watch/relist/RV handling and feeds a
  `ProjectingStore` (`ingest/projecting_store.go`) that keeps only the projected
  bundle. `stripManagedFields` (`ingest/managed_fields.go`, applied by every
  projecting store before its projector) drops `managedFields` before
  projection; it is the main memory lever.
- **Locking:** `IngestManager.mu` is a leaf lock that guards only the entries
  map and is never held across a store call; sink delivery runs under the
  store write lock.
- **Secondary indexes are store config.** `AddIndex` registers a
  `BundleIndexFunc` that derives a stored bundle's index values from its
  retained halves; bundles carry no index data. `RowsByIndex` and
  `RewriteBundlesByIndex` read the index, and a rewrite moves a row by changing
  the half the func reads (the pod owner-key index reads
  `PodAggregate.OwnerKey`).
- **Sink contract** (`ingest/projecting_store.go`):
  - A sink never reads its own store, because `Rows`, `RowsByIndex`, and
    `GetByKey` take the same lock. A consumer that aggregates across objects
    keeps its own index, fed by its sink (the Job owner index, the Helm
    revision index).
  - Work that touches another store goes through `ingest.AsyncBundleSink`,
    which keeps delivery order off the source lock.
  - A bundle sink receives only the new bundle. A consumer that compares old
    and new keeps its own last-seen state (the catalog's CRD discovery hook).
  - On an unpartitioned relist, a `BundleReplacer` gets only `ReplaceBundles`
    with the full new set, never per-key deletes. A replacer whose removals
    have side effects diffs that set against its previous one (CRD
    definitions, the discovery hook, Helm releases). Partition relists deliver
    per-key deletes.
  - `RestoreBundles` installs spilled rows without fanning them to sinks. A
    sink that needs the full set and does not spill it itself (an owner index,
    or the source records behind Attention's spilled findings, for stores whose
    rows keep what those records read) implements
    `BundleSeeder`. Its seed arrives under the write lock, before any live
    delta.
- **Settled is not knowledge.** Two signals look complete without being so:
  - `HasSyncedFor` is true after a deadline degrade.
  - `RawHasSyncedFor` is true after a restore whose source the permission
    filter then skips.

  A decision that treats a missing row as an authoritative absence needs
  `Ready` readiness on every partition it covers (`ingestRowsComplete` in
  `snapshot/ingest_readiness.go`). The workloads HPA flag and the object-map
  HPA join use it.
- **LIST+WATCH is the startup transport.** `ingest/watchlist_config.go`
  disables client-go's beta WatchList gate before reflectors are built. A
  capability probe is insufficient: a proxy can deliver the terminal bookmark
  while streaming a large initial collection too slowly for an interactive app.
- **Built-in reflectors decode protobuf.** The clientset handed to ingest is
  built from `protobufRestConfig` (`backend/cluster_client_contract.go`), and
  `TestOwnedReflectorListsNegotiateProtobuf` pins it. A reflector built on a
  plain config decodes JSON, several times slower at intake, so benchmarks
  and spikes must build their clientset the same way. The 2026-10 events spike
  missed this and blamed reflectors for a 2× slower initial sync than an
  informer; with protobuf on both sides, the owned events reflector synced
  faster (73 ms against 102 ms at 30,000 events).
- **Sync deadline is liveness only.** A per-GVR deadline
  (`IngestManager.entrySettled`) degrades a hung GVR instead of wedging the cluster;
  until the source completes a real initial list, dependent snapshots report
  partial/inexact data with a syncing issue, never an authoritative empty
  result.
- **Immediate parallel cold start.** The manager declares each kind's
  permission-approved partitions, then starts every permitted reflector with no
  application admission queue; client-go's per-cluster REST rate limiter is the
  pressure boundary. The shared 15-second liveness deadline can mark a source
  degraded but never delays another source's initial LIST.
- **Two reflector shapes.** Every built-in kind has an owned reflector.
  Single-object kinds with a stream descriptor take the generic path (it wires
  maintained store, catalog, object-map, and response cache). Cross-kind-join
  and bespoke kinds (pods, workloads, network, nodes, namespaces, events) use
  `RegisterReflector` plus serve-time re-aggregation (metrics overlay, pod
  aggregates, HPA, Service↔EndpointSlice). `backend/feed_contract_test.go`
  keeps the shared typed-informer factory out of production code.
- **Readiness is per resource.** Domains declare the resources they read;
  the snapshot service waits on those owned stores (`ingestHub`,
  `backend/refresh/system/ingest_hub.go`). The hub's `HasSynced` reports every
  tracked store settled. Only a build for a domain that declares no resources
  waits on it, and every production domain declares its resources. Typed-table
  domains read kind availability as a predicate (permitted at registration and
  served) and always serve from their maintained store.
- **Cross-kind projection inputs need a late-arrival story.** A projection may
  read its own object freely. Reading another kind's cache at projection time
  races that kind's sync, and owned reflectors never resync, so a baked value
  from an unsynced cache stays wrong (this caused the empty Deployment Pods
  tab). Only two shapes are allowed:
  1. **Re-join at serve** (endpoint counts, pod aggregates, metrics): correct
     by construction; use for volatile joins.
  2. **Bake + heal on the input kind's events** (pod ReplicaSet→Deployment
     and Job→CronJob owners: the pod projector reads owner indexes that the
     ReplicaSet and Job reflectors' bundle sinks feed and restores seed, and
     `resourcestream/owner_heals.go` rewrites already-projected pods via
     `ingest.ProjectingStore.RewriteBundlesByIndex` from async bundle sinks):
     for immutable joins that serve filters and doorbell routing need
     pre-resolved.
     Pin the heal with an equivalence test (healed bundle byte-equal to a fresh
     synced-cache projection, `pod_owner_heal_test.go`).
  Review tell: a `New*IngestProjector` signature gaining another kind's
  lister/store without one of these shapes.
- **Runtime-discovered sources share ingest ownership.** The owned CRD
  reflector supplies definitions: its sink publishes each CRD's
  `apiextensions.Definition` into a copy-on-write table synchronously (under the
  CRD store lock), and queues lifecycle work on an ordered worker; a relist is
  diffed against the previous table so a vanished definition is retired by its
  old UID, and a restore seeds the table. Initial watch admission waits for
  discovery's preferred served version. Ingest compares source specification,
  definition UID, and permitted namespace partitions before allocating
  replacement stores/reflectors. Permission checks run on the worker or the
  discovery caller, outside definition-selection and lifecycle locks, and
  commit rechecks the reservation against the published table, so a delayed
  check cannot restore an older or deleted definition. Replacement cancels and joins its predecessor first;
  incomplete definitions keep the predecessor; terminal shutdown rejects
  admissions. These sources hold catalog projections, not full objects: the
  detail-cache sink runs before catalog notification, retirement evicts the
  old source's responses, and YAML and visible-page/export hydration still read
  live API payloads.
- **Events are an owned reflector.** The Events table row goes to the two
  table sinks at intake and is not stored. The store keeps each Event's
  catalog Summary and a slim fact (involved object, type, reason, message,
  source, count, first and last observation), which object events, Attention,
  the namespace warning rollup, and Recent Events read at serve. Object events
  scans the store per build; there is no per-object index. A per-bundle index
  measured about 725 B more per event, and a 30,000-event scan costs about
  0.9 ms (microbenchmark). At 30,000 events the store retains about 31 MiB, 9% less than the
  former informer cache (measured 2026-10-21). Event is `CatalogNone`, so the
  catalog does not subscribe to its rows.
- Ingest builds a Gateway kind's reflector only when discovery reports it
  served.
- **Namespaces are an owned reflector.** The bundle keeps the namespace itself
  (Aggregate) because the namespaces row joins it at serve with workload
  presence, warning events, and quota pressure; `namespaces` and
  `cluster-overview` read that store, and a bundle sink on it drives the
  namespaces doorbell and its `afterRing` hook.
- **Helm releases ride the Secrets bundles.** A release Secret's Aggregate half
  is its revision, decoded once at intake only when the table can show it; a
  ConfigMap's names its release for cache eviction. The `namespace-helm` sink
  keeps its own revision index (it cannot read the Secrets store under that
  store's lock), recomputes only affected releases, diffs releases on an
  unpartitioned relist, and rebuilds from the restore seed.

## Lifecycle & governor

- **Tiers:** Foreground, Background, and Cold per cluster
  (`system/governor.go`, `backend/refresh_governor.go`). Foreground and
  Background keep the subsystem live; metrics polling follows cluster-scoped
  lease demand, not governor tier. A memory-pressure poll
  (`runtime.ReadMemStats` HeapInuse vs budget, not `GOMEMLIMIT`) collapses the
  warm set and calls `FreeOSMemory`.
- **Spill + Cold serving** (`domain/maintained_stores.go`,
  `querypage/columnstore_mmap.go`, `backend/refresh_spill.go`): maintained
  stores spill to a per-cluster cache dir in the columnar format, warm-paint on
  re-warm (across restarts, format-version-guarded), and reconcile after sync.
  A Cold cluster serves from read-only mmap-aliased stores (column data
  off-heap, indexes resident) instead of tearing down. Cold clusters run no
  object-catalog discovery, capability checks, or sync loops.
- **Cold entry gate.** A desired Cold tier stays unapplied until the live
  subsystem has built ready `namespaces` and `cluster-overview` snapshots for
  that exact cluster scope. The namespace build runs through the aggregate
  lifecycle callback, so Ready and the retained sidebar/Global payloads exist
  before any producer stops, without a frontend request. Preparation also
  requires the current generation's namespace workload tracker to report
  actual initial sync or explicit permission skip for every tracked
  Pod/workload source, so a Ready state retained across re-warm cannot cool an
  unsynced replacement. It never polls namespace snapshots (scoped builds can
  probe the API), retries the overview itself, ignores tab activation, and is
  never a manual refresh. Only successful preparation makes the subsystem
  eligible, and its completion re-drives governor reconciliation; the governor
  records Cold after the executor reaches it.
  Replacement or teardown cancels the generation's in-flight build and ends its
  retry loop.
- **Pressure fallback.** Under sustained HeapInuse pressure only, a
  preparation unsettled after one bounded snapshot-attempt grace degrades to
  full teardown of the inactive cluster: feeds stop, available stores spill, and
  the backend serves nothing for that cluster until a foreground re-warm
  rebuilds subsystem and catalog. Every over-budget sample re-drives the
  transition so the fallback stays reachable after the pressure edge. Never
  serve an unsettled store as a Cold baseline.
- **Cooled-store lifetime.** Cooled mmap stores belong to one subsystem
  generation. Replacement publishes new aggregate routes before retiring old
  snapshot serving; retirement rejects late reads and drains active builders
  before releasing mappings. A failed re-warm keeps the old routed generation
  and its mappings. Partial cooling returns already-swapped mappings to the
  coordinator, which retires and spills those stores before closing them during
  fallback teardown.
- **Re-warm** rebuilds through the same per-cluster chokepoint as first builds
  without demoting Ready ([refresh-system.md](refresh-system.md#permission-and-readiness)).
  Normal mmap-cooled serving is continuous: cooled stores serve until the
  aggregate re-routes, and fresh stores warm-paint from spill. Stream routing
  then replaces only that cluster's old-manager subscriptions
  ([subscription lifetime](refresh-system.md#backend-subscription-lifetime)).
- **Tier application is serialized.** Cooling and re-warming are multi-step
  replacements. A newer visible-cluster intent may be recorded meanwhile, but
  reconciles only after the in-flight transition reaches a consistent Cold or
  live state; foreground activation never observes the gap between feeds
  stopping and the subsystem being marked Cold. The governor publishes the
  planned tier before executor work and records the applied tier only after it
  completes; the two maps carry different ordering contracts. Catalog gating
  (`startObjectCatalogForTarget`, `backend/refresh_object_catalog.go`) reads
  the plan: it closes before cooling stops feeds and opens before re-warm
  starts the catalog. A live tier is reached only when both the subsystem and
  its cluster object catalog exist.

## Delivery — page + refetch-on-signal

- **Pull:** `GET /api/v2/snapshots/{domain}` (`refresh/api/server.go`) runs
  `Build`.
- **Push:** the `refresh-resources` stream carries only a change signal. A
  delta/resync advances the scoped doorbell clocks (`signalVersions`, plus the
  folded `sourceVersion`) and the query-backed view refetches its page. No live
  row crosses the wire: `streammux.ServerMessage` has no row field. The
  maintained store rings after it applies a change, from its own handler or
  ingest sink; nothing else rings its domain. Signal rules:
  [data-freshness.md](data-freshness.md#signals-and-source-clocks).
- **Metrics** reach a view only by serve-time overlay.

## Boundaries (deliberately NOT this path)

These may share transport but must not be forced onto `querypage`: object
detail/YAML (lazy direct GET via the `object-details` domain,
`object_yaml_by_gvk.go`); object map and overview (aggregations over
listers/ingest/metrics, `object_map_assembler.go`, `cluster_overview.go`); and
logs, shell/exec, port-forward, permissions, and metrics polling (live streams
and access reviews, not object-state queries).

## Validation

- Per-domain `…MatchesListPath` tests gate byte identity between store serve
  and the brute list+project path.
- `querypage` fuzz/property test (`apply(deltas) == recompute`) and the catalog
  brute-force oracle.
- Sink-fed consumers run against a real `cache.Reflector` and the
  `ingest/ingesttest` API server (`system/real_reflector_harness_test.go`).
  Each such consumer has two re-warm tests:
  - a spilled store, a valid-version resume, and no object changes, after which
    the consumer still sees the full set;
  - an expired version (`WatchGap`, 410), whose relist reaches the same
    consumer.

  A replacer with removal side effects also has a watch-gap test: an object
  deleted during the gap loses its side effect, and the survivors are
  untouched.

## Deliberately not built (do not re-attempt as TODOs)

Reasons beyond these lines are in git history.

- Rejected: positional window-delta stream protocol (INSERT/MOVE/REMOVE,
  fractional posKeys, CBOR, object/metric sub-channels) and live row merging
  into client collections — refetch-on-signal is simpler and pages are small.
- Rejected: h2c — browser `fetch` cannot do HTTP/2 cleartext.
- Rejected: MessagePack or Web-Worker decode — pages are small.
- Rejected: gorilla→coder/websocket migration — gorilla is maintained again.
- Rejected: a from-scratch single per-cluster LSN clock — dropped during the
  rewrite; per-payload source clocks remain.
- Rejected: SSAR→SSRR for the remaining callers — not SSRR-expressible.
- Parked: order-statistics Rank/At index — anchor jumps and numbered pages use a
  counted `QueryAround`/`QueryAt` walk within the page-serve budget; revisit
  only on a measured regression.
- Rejected: `metricsRevision` metric index — it would only serve the unbuilt
  delta layer or profiled metric-sorted views.
- Rejected: an adapter that presents the ingest contract over client-go
  informers. It would add a third feed shape and give informer kinds no
  namespace-scope partitions, spill, or delta resume. Every kind is an owned
  reflector instead, and `backend/feed_contract_test.go` keeps informers out.

## Provenance

`backend/refresh/storebench/` holds the throwaway prototypes that gated the
owned columnar engine (Prototype #1, 1M-object write path) and the WatchList
fallback (Prototype #3).
