# Backend data layer — store, ingest, governor, delivery

The contract for how cluster object-state reaches a table. One per-cluster columnar
store + one `Query → Page` engine serve **every typed table and Browse**; everything
else (detail, object-map, overview, logs, metrics, permissions) is a deliberately
separate path (see "Boundaries"). This doc is the durable architecture extracted from
the completed `v2` rewrite plan.

## Ownership

- **Store + query engine:** `backend/refresh/querypage/` — the owned columnar
  `Store[R]` and the `Query → Page` engine.
- **Ingestion:** `backend/refresh/ingest/` — owned-reflector WatchList ingestion with
  projection-at-intake; `backend/refresh/informer/` — the shared typed-informer factory
  (uncut kinds), projection transform, and WatchList probe.
- **Per-domain serve + maintained stores:** `backend/refresh/snapshot/` —
  `querypage_typed.go` (`resolveTypedSnapshotPageViaStore`, `resolveMaintainedDirect`,
  `typedMaintainedStore`); `backend/objectcatalog/` for Browse.
- **Lifecycle / memory:** `backend/refresh/system/governor.go` +
  `backend/app_refresh_governor.go`; spill in `backend/refresh/domain/maintained_stores.go`.

## Invariants

1. **One store, one query language, one delivery model.** Typed tables and Browse are
   the same `querypage` call differing only by `WHERE kind`. Do not add a second query
   engine or cursor codec.
2. **The webview never holds, sorts, or filters N.** All ordering/filtering/facet/total
   authority is backend-side; the client holds the visible page + a small LRU. A
   client-side narrow of the already-loaded window with the identical predicate during a
   refetch is allowed; full-N client sort/filter is not.
3. **No cgo, no embedded SQL engine.** The store is a pure-Go owned columnar SoA. Any
   on-disk fallback must stay pure-Go (`bbolt`/Badger), never SQLite/cgo.
4. **Object state and metrics are two sources joined by UID.** Object columns are
   stored; metrics (CPU/mem) are **overlaid at serve** from the poller
   (`LatestPodUsage()`), never written to the store. A metrics poll must never re-project
   or re-store an object row. The join happens inside the BASE table domains
   (`pods`/`nodes`/`namespace-workloads`, which carry an extra `metric` source clock) —
   there are no separate `*-metrics` domains and no client-side metric join
   (see [`resource-metrics.md`](./resource-metrics.md)).
5. **All object references carry `clusterId` + group/version/kind** (+ namespace/name
   when specific) — see [`multi-cluster.md`](./multi-cluster.md).

## Store & query engine (`querypage`)

- **Columnar SoA, dictionary-interned.** String columns intern to `uint32` dict ids;
  numeric/bool columns are pointer-free slices; a recycled `rowId` arena. Adaptive
  promotion drops the dict for ≥90%-unique columns. A by-`rowId` match cache answers
  filter/search/facet/total with no row reconstruction. Starting points:
  `querypage/store.go`, `columnar.go`.
- **Keyset indexes, per direction.** One asc + one desc `google/btree` per sortable key,
  tie-broken to reproduce the live total order exactly. Pagination is a bounded keyset
  range scan — **O(log N + page) when the walked entries match** (unfiltered, or dense
  filters); a sparse filter/search walks past non-matching entries to fill the page and
  degrades toward O(N) worst case (`store.go` `collect`; the trigram index narrows
  search candidates but membership is still verified per entry). Cost honesty on
  counts: the **unfiltered** total is O(1) (`rows.len()`) and the facet counters
  returned with every page are maintained-counter reads — but a **filtered/searched**
  query pays a full O(N) match-value scan for its exact `Total`
  (`store.go:524-532`), and `Scope` (filtered facet counts + totals for the
  maintained-direct path) is the same O(N) column scan. These are cheap
  no-reconstruction column reads — measured 4–18 ms per page at 100k–250k rows
  (see `large-data.md` "Current Browse Budget") — linear, not O(1). Cursor =
  `(sortValue, uid)` + signature (`querypage/cursor.go`). There is **no**
  order-statistics (Rank/At) augmentation — it was only needed by the unbuilt delta
  layer.
- **On-disk format = the same SoA, mmap'd.** `querypage/columnfile.go` +
  `columnstore_mmap.go` (zero-copy `unsafe.Slice`/`unsafe.String` over `syscall.Mmap`,
  portable heap fallback). This is what spill and Cold-serving use.
- **Serve paths:** typed domains → `resolveMaintainedDirect` (query the persistent store
  in place) or `resolveTypedSnapshotPageViaStore` (rebuild a per-Build store for
  cross-kind-join domains); Browse → `objectcatalog` `queryViaEngine`. Each domain is
  gated byte-identical to a brute list+project path (`…MaintainedMatchesListPath`).

## Ingestion (owned-reflector WatchList + projection-at-intake)

- **Project at intake, discard the typed object.** `ingest.ProjectingReflector` borrows
  client-go's List/Watch/relist/RV machinery and feeds a `ProjectingStore` that keeps
  only the projected bundle. `informer.StripManagedFields` (a `WithTransform` on every
  factory) drops `managedFields` before any cache — the core memory lever. Starting
  points: `ingest/manager.go`, `ingest/projecting_store.go`, `informer/projection.go`.
- **WatchList, capability-probed, LIST fallback.** `informer/watchlist_probe.go` probes
  WatchList at first connect and disables the client-go gate if the
  `initial-events-end` bookmark is stripped (Teleport-style proxies) → robust LIST+WATCH.
  A per-GVR sync-deadline degrades a hung GVR instead of wedging the cluster
  (`informer/factory.go`). WatchList is **beta** — the LIST fallback is load-bearing.
- **Two cutover shapes.** Registry-driven single-object kinds flip a descriptor
  `IngestOwned` flag (the generic path wires maintained store, catalog, object-map,
  response-cache). Cross-kind-join domains (pods, workloads, network, nodes) use a
  bespoke `RegisterReflector` + **serve-time re-aggregation** (metrics overlay, pod
  aggregates, HPA, Service↔EndpointSlice) — these joins stay at serve by design.
- **Cross-kind projection inputs must declare a late-arrival story.** A projection may
  read its OWN object freely; any input read from another kind's cache at projection
  time is a race against that kind's sync, and owned reflectors never resync — a value
  baked from an unsynced cache is wrong forever (the empty-Deployment-Pods-tab bug,
  2026-07-05). Exactly two sanctioned shapes:
  1. **Don't bake — re-join at serve** (Service↔EndpointSlice endpoint counts, pod
     aggregates, metrics overlay): correct by construction; right for volatile joins.
  2. **Bake + heal on the input kind's events** (the pod ReplicaSet→Deployment owner:
     `snapshot/pod_owner_heal.go` applied via `ingest.ProjectingStore.RewriteBundlesByIndex`
     from the RS informer handler): right for immutable joins that serve filters and
     doorbell scope routing need pre-resolved. A heal MUST be pinned by an equivalence
     test — healed bundle byte-equal to a fresh synced-cache projection
     (`pod_owner_heal_test.go`) — so the heal and the projector cannot drift.
  The tell in review: a `New*IngestProjector` signature growing another kind's
  lister/store without one of these shapes.
- **Kept-as-typed-informer (documented):** ReplicaSet (pod-owner resolution), CRDs (CR
  discovery), events, gateway-API ×8, HPA, namespaces — each justified in `factory.go`.

## Lifecycle & governor

- **Foreground / Background / Cold** per cluster (`system/governor.go`,
  `app_refresh_governor.go`). Foreground and Background both keep the subsystem
  live; metrics polling follows cluster-scoped frontend lease demand rather than
  governor visibility. A memory-pressure poll (`runtime.ReadMemStats` HeapInuse vs budget — **not**
  `GOMEMLIMIT`) collapses the warm set under pressure and `FreeOSMemory`s.
- **Spill + Cold-serving.** Maintained stores spill to a per-cluster cache dir in the
  columnar format, warm-paint on re-warm (cross-restart, format-version-guarded), and
  reconcile after sync. A Cold cluster can serve from read-only **mmap-aliased** stores
  (column data off-heap/OS-reclaimable, indexes resident) rather than full teardown;
  re-warm unroutes then closes the mappings safely. Cold clusters do not run object-catalog
  discovery, capability checks, or sync loops against their stopped feeds; the catalog
  restarts as part of re-warm. Starting points:
  `domain/maintained_stores.go`, `querypage/columnstore_mmap.go`, `app_refresh_spill.go`.
- **Cold has a server-owned entry gate.** A desired Cold tier stays unapplied while
  the live subsystem builds settled `namespaces` and `cluster-overview` snapshots
  for its cluster scope. The namespace build uses the aggregate lifecycle callback,
  so Ready and the retained sidebar/Global payloads exist before any producer stops.
  Preparation waits on that lifecycle state and the current subsystem generation's
  namespace workload tracker without polling namespace snapshots, retries the overview
  from the backend, and does not wait for tab activation. This generation-local gate
  prevents a retained Ready state from cooling a replacement subsystem before its own
  stores settle. Only a successful preparation marks the subsystem eligible for
  cooling; the governor records Cold after the executor reaches it. Preparation is
  owned by that subsystem generation: replacement or teardown cancels an in-flight
  build, and the retry loop exits as soon as the generation is no longer current.
  Under sustained HeapInuse pressure only, an unsettled preparation that exceeds one
  bounded snapshot-attempt grace degrades to the normal full teardown path. Available
  stores still spill, but the backend is unavailable for that cluster until re-warm;
  it never serves an unsettled store as a Cold mmap baseline. Every over-budget sample
  re-drives reconciliation so this fallback remains reachable after the pressure edge.
- **Re-warm keeps Ready.** Governor re-warms rebuild the subsystem through the same
  per-cluster chokepoint as first builds. Normal mmap-cooled serving is continuous
  (cooled stores serve until the aggregate re-routes; fresh stores warm-paint from spill);
  after a pressure-forced full teardown, frontend-retained rows remain visible while the
  backend rebuilds from spill —
  `transitionClusterToLoading` guards the chokepoint so an already-READY cluster is
  never demoted to loading on a tab switch. Aggregate stream routing then ends
  only that cluster's old-manager subscriptions so they re-establish against the
  replacement without reconnecting other clusters; continuity follows
  [the freshness contract](data-freshness.md#signals-and-source-clocks).
- **Tier application is serialized.** Cooling and re-warming are multi-step subsystem
  replacements. A newer visible-cluster intent may be recorded while one is running,
  but its reconciliation waits until the in-flight transition has reached a consistent
  Cold or live state. Foreground activation must never inspect or accept the interval
  after feeds stop but before the subsystem is marked Cold. After reconciliation,
  activation replays the cluster's current lifecycle state so a frontend that missed
  an earlier transition converges even when the backend state did not change. The
  governor publishes a separate planned tier before executor work begins, then records
  the applied tier only after that work completes. Catalog gating reads the plan: it
  closes before cooling stops feeds and opens before re-warm starts the catalog. A live
  tier is reached only when both the subsystem and its cluster object catalog exist.
- **Cluster-Ready is server-driven.** The loading→ready transition rides a namespaces
  snapshot build after the workload stores settle; the backend self-builds it on each
  pre-Ready namespaces doorbell (`runNamespacesReadinessSelfBuild` via the
  `Subsystem.NamespacesDoorbell` observer, wired per cluster in
  `buildRefreshSubsystemForSelection`). Readiness never depends on the frontend
  asking first.
- **Client publication and lifecycle are ordered per cluster.** Startup settings and
  saved-selection restore run through the runtime selection coordinator. A completed
  client is installed inside its per-cluster operation before that operation publishes
  `connected`, without waiting for sibling builds. Building the refresh subsystem then
  advances the cluster to `loading`; stale client-build completions cannot demote
  `loading`, `loading_slow`, or `ready` back to `connecting`/`connected`.

## Delivery — page + refetch-on-signal

- **Pull:** `GET /api/v2/snapshots/{domain}` (`refresh/api/server.go:59`) → `Build`.
- **Push:** the resources **WebSocket** `/api/v2/stream/resources` carries only a change
  **signal**; a delta/resync advances the scoped doorbell clocks
  (`signalVersions`, plus the folded `sourceVersion`) and the query-backed view
  refetches its page. **No live row ever crosses the wire** — the
  envelope (`streammux.ServerMessage`) has no row field, and the live-row-merge path
  (`applyResourceRowUpdates`, `mergeSnapshotRows`, `sortRows`, per-domain collections) is deleted. See
  [`data-freshness.md`](./data-freshness.md) for the frontend contract.
- **Metrics** reach a view by serve-time overlay (above), not the store or the wire.
  Metric source clocks and frontend utilization reads are covered by
  [`data-freshness.md`](./data-freshness.md) and
  [`resource-metrics.md`](./resource-metrics.md).

## Boundaries (deliberately NOT this path)

These share the store's transport where sensible but must **not** be forced onto
`querypage`: object **detail/YAML** (lazy direct client GET via the `object-details`
domain / `object_yaml_by_gvk.go`), **object-map/overview** (aggregations over
listers/ingest/metrics — `object_map_assembler.go`, `cluster_overview.go`), and
**logs/shell/exec/port-forward/permissions/metrics-poll** (live streams + access
reviews, not object-state queries).

## Validation

- Per-domain `…MaintainedMatchesListPath` byte-identity gates (store serve == list+project).
- `querypage` fuzz/property test (`apply(deltas) == recompute`) + the catalog brute-force
  oracle.
- `mage qc:prerelease` (backend `-race`, vitest, knip, trivy) is the release gate.

## Deliberately not built (do not re-attempt as TODOs)

Validated/decided during the rewrite; reasons in git history + the memory record:

- **Positional window-delta WS protocol** (INSERT/MOVE/REMOVE/DOORBELL, fractional
  posKeys, CBOR, object/metric sub-channels) — refetch-on-signal is simpler and the
  bounded pages it refetches are small.
- **h2c** (browser `fetch` can't do HTTP/2 cleartext), **MessagePack/Web-Worker decode**
  (pages are small), **gorilla→coder/websocket** (gorilla is maintained again).
- **A single per-cluster LSN clock** as a from-scratch rewrite (Phase 2 dropped) and
  **SSAR→SSRR** for the remaining callers (legitimately not SSRR-expressible).
- **Order-statistics Rank/At index** and a **`metricsRevision` metric index**. The
  anchor-jump / numbered-page feature that needs a per-row rank uses a counted
  `QueryAround`/`QueryAt` walk instead — measured within the page-serve budget class for a
  one-shot jump (`large-data.md` "Current Browse Budget"), so order statistics stay parked
  behind a measured regression. The metric index would still only serve the unbuilt delta
  layer / profiled metric-sorted views.

## Provenance

The owned-engine bet (columnar + interning + keyset indexes, no SQLite/cgo) was gated by
**Prototype #1** (1M-object write-path benchmark) and the WatchList fallback by
**Prototype #3**, both in the throwaway `backend/refresh/storebench/` package. Full
design history and the migration ledger are in git.
