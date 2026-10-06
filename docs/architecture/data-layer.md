# Backend data layer — store, ingest, governor, delivery

How cluster object state reaches a table. One per-cluster columnar store and
one `Query → Page` engine serve every typed table and Browse; detail,
object-map, overview, logs, metrics, and permissions are deliberately separate
paths (see [Boundaries](#boundaries-deliberately-not-this-path)).

## Ownership

- **Store + query engine:** `backend/refresh/querypage/` (owned columnar
  `Store[R]` and the `Query → Page` engine).
- **Ingestion:** `backend/refresh/ingest/` (owned-reflector LIST+WATCH with
  projection at intake); `backend/refresh/informer/` (shared typed-informer
  factory for uncut kinds, projection transform, startup transport policy).
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
  bundle. `informer.StripManagedFields` (`informer/projection.go`, a
  `WithTransform` on every factory) drops `managedFields` before any cache; it
  is the main memory lever.
- **Locking:** `IngestManager.mu` is a leaf lock that guards only the entries
  map and is never held across a store call; sink delivery runs under the
  store write lock.
- **LIST+WATCH is the startup transport.** `informer/watchlist_config.go`
  disables client-go's beta WatchList gate before reflectors are built. A
  capability probe is insufficient: a proxy can deliver the terminal bookmark
  while streaming a large initial collection too slowly for an interactive app.
- **Sync deadline is liveness only.** A per-GVR deadline
  (`informer/factory.go`) degrades a hung GVR instead of wedging the cluster;
  until the source completes a real initial list, dependent snapshots report
  partial/inexact data with a syncing issue, never an authoritative empty
  result.
- **Immediate parallel cold start.** The manager declares each kind's
  permission-approved partitions, then starts every permitted reflector with no
  application admission queue; client-go's per-cluster REST rate limiter is the
  pressure boundary. The shared 15-second liveness deadline can mark a source
  degraded but never delays another source's initial LIST.
- **Two cutover shapes.** Registry-driven single-object kinds set the
  descriptor `IngestOwned` flag (the generic path wires maintained store,
  catalog, object-map, and response cache). Cross-kind-join domains (pods,
  workloads, network, nodes) use `RegisterReflector` plus serve-time
  re-aggregation (metrics overlay, pod aggregates, HPA, Service↔EndpointSlice).
- **Cross-kind projection inputs need a late-arrival story.** A projection may
  read its own object freely. Reading another kind's cache at projection time
  races that kind's sync, and owned reflectors never resync, so a baked value
  from an unsynced cache stays wrong (this caused the empty Deployment Pods
  tab). Only two shapes are allowed:
  1. **Re-join at serve** (endpoint counts, pod aggregates, metrics): correct
     by construction; use for volatile joins.
  2. **Bake + heal on the input kind's events** (pod ReplicaSet→Deployment
     owner: `snapshot/pod_owner_heal.go` via
     `ingest.ProjectingStore.RewriteBundlesByIndex` from the RS handler): for
     immutable joins that serve filters and doorbell routing need pre-resolved.
     Pin the heal with an equivalence test (healed bundle byte-equal to a fresh
     synced-cache projection, `pod_owner_heal_test.go`).
  Review tell: a `New*IngestProjector` signature gaining another kind's
  lister/store without one of these shapes.
- **Runtime-discovered sources share ingest ownership.** The typed CRD informer
  supplies definitions; initial watch admission waits for discovery's preferred
  served version. Ingest compares source specification, definition UID, and
  permitted namespace partitions before allocating replacement stores/reflectors.
  Permission checks run outside definition-selection and lifecycle locks, and
  admission is rechecked before commit so a delayed check cannot restore an
  older definition. Replacement cancels and joins its predecessor first;
  incomplete definitions keep the predecessor; terminal shutdown rejects
  admissions. These sources hold catalog projections, not full objects: the
  detail-cache sink runs before catalog notification, retirement evicts the
  old source's responses, and YAML and visible-page/export hydration still read
  live API payloads.
- **Kept as typed informers** (each justified in `informer/factory.go`):
  ReplicaSet (pod-owner resolution), CRDs (CR discovery), events, gateway-API
  ×8, HPA, namespaces.

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
  row crosses the wire: `streammux.ServerMessage` has no row field. Signal
  rules: [data-freshness.md](data-freshness.md#signals-and-source-clocks).
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

## Provenance

`backend/refresh/storebench/` holds the throwaway prototypes that gated the
owned columnar engine (Prototype #1, 1M-object write path) and the WatchList
fallback (Prototype #3).
