# Luxury Yacht v2 — Ground-Up Architecture (Design + Migration)

Status: **In progress — see the Build Status ledger below.** This is a clean-sheet
architecture for handling very large clusters (100k–1M+ objects, many GVRs,
multiple clusters open), loading data as fast as possible, and keeping updates
near real-time. It is written as a phased *evolution* of the current app, not a
big-bang rewrite — every phase ships value behind existing seams. Nothing here is
committed until **Prototype #1 (the write-path benchmark gate, §Risks)** picks the
store engine.

It reacts to, and would consolidate, the contracts in:

- [`docs/architecture/refresh-system.md`](../architecture/refresh-system.md)
- [`docs/architecture/large-data.md`](../architecture/large-data.md)
- [`docs/architecture/notify-only-streams.md`](../architecture/notify-only-streams.md)
- [`docs/architecture/catalog.md`](../architecture/catalog.md)
- [`docs/architecture/multi-cluster.md`](../architecture/multi-cluster.md)
- [`docs/architecture/data-access.md`](../architecture/data-access.md)

## Build status (live ledger)

_Updated 2026-06-23. The running record of what is actually built vs. designed —
keep this current as work lands. Per-step detail (file:line, benchmarks) is in the
sections it references._

> **2026-06-23 re-baseline (audited against code; the pre-2026-06-23 ledger below
> understated Phase 4).** The owned-reflector **ingest path is LIVE** for ~26 cut kinds
> (`backend/refresh/ingest/`: `ProjectingReflector` + `ProjectingStore`, `IngestOwned`
> descriptor facet). It **projects at intake and discards the typed object** (deeper than
> the plan's "project-to-column-tuple" goal — `projecting_store.go`), uses
> `ToListWatcherWithWatchListSemantics` so it **falls back to LIST+WATCH** when WatchList is
> stripped, and the **gateway factory has `StripManagedFields`**. nodes/pods/workloads/network
> are cut to ingest via bespoke projectors. Ingest readiness now has the factory's two
> defenses: a **per-kind sync-deadline degrade** (a never-syncing kind degrades out of the
> all-or-nothing gate instead of wedging `Manager.Start` + the metrics poller —
> `ingest/manager.go entrySettled`) and **permission-skip** (a kind the identity cannot
> list/watch is skipped at Start, conservatively — only on a confirmed denial —
> `ingest/manager.go SetPermissionFilter` + `system/manager.go ingestPermissionFilter`).
>
> **Phase 4 status by item (audited):** DONE — project-to-column-tuple, LIST fallback,
> gateway transform, governor + `SetMetricsActive`, metrics §3.6 for pods, ingest
> deadline-degrade + permission-gating, 10 typed domains on the owned store (the 9 + now
> `cluster-crds`, fed by the apiext CRD informer via `registerMaintainedInformerHandler`,
> byte-identity gated). **CORRECTION: `pods` already serves ALL scopes (namespace/node/
> workload) from its maintained store** (`pods.go:373-376 collectSummariesFromStore`) — the
> earlier audit's "node/workload scopes list" was wrong (that path is test-only).
> 13 typed domains now on the owned store: the 9 + `cluster-crds` + `cluster-events` +
> `namespace-events` + `namespace-helm` (helm = a bespoke handler on the helm-storage Secret
> informer re-aggregates each release's latest non-superseded revision; events via
> `registerMaintainedInformerHandler`; all byte-identity gated). **AUDIT CORRECTION (grounded):
> `namespace-workloads` is NOT a list+project gap** — it reads the projected workload-OWN
> rows + pod aggregates straight from the ingest stores (`namespace_workloads.go:276-281`) and
> its per-Build work is `reaggregateWorkloadSummary` — a SERVE-TIME relationship join
> (workload ↔ pods ↔ fresh metrics ↔ HPA), the SAME §3.6 pattern the architecture overlays at
> serve on purpose (and metrics MUST stay at serve, so a maintained store can't subsume it).
> Likewise `namespace-network`'s cut kinds read projected ingest rows + a serve-time
> Service↔EndpointSlice join; its only raw list+project is the Gateway-API kinds via
> `collectDescriptorTableRows` (small-N read from the gateway informer INDEXERS — RAM, not the
> apiserver). **TIER 1.2 COMPLETE (2026-06-23):** every domain that list+projected RAW objects
> per Build now serves from a maintained store — the 9 + `cluster-crds` + `cluster-events` +
> `namespace-events` + `namespace-helm` + `namespace-network` Gateway-API kinds — each behind a
> `…MaintainedMatchesListPath` byte-identity gate, full backend `-race` clean. **`namespace-
> workloads` IS NOW on a maintained store too (2026-06-24):** the per-namespace view serves
> assembled object-state rows (workload↔pod join + standalone determination) from the store,
> re-assembled LAZILY + version-gated on Build (a cross-kind assembly can't be fed one row per
> event — that would be O(N²) over a sync — so `ensureWorkloadsStoreFresh` re-runs the shared
> `assembleWorkloadRows` only when the combined workload+pod+HPA ingest version advances), with
> CPUUsage/MemUsage overlaid at serve per §3.6 (the only usage-dependent fields). The all-
> namespaces overview stays on the list path (it reads no pods by design — `parsedScope.
> Namespace==""`), so the store serves the heavy per-namespace case where it's byte-identical.
> Gate: `TestNamespaceWorkloadsBuilderMaintainedMatchesListPath` (with metrics) +
> `…StandaloneTransitions` (workload delete → owned pod becomes standalone). Network's
> Service↔EndpointSlice join stays the §3.6-mandated serve-time join. Reusable machinery:
> `registerMaintainedInformerHandler`, `deleteRow`, `rowsInNamespace`, `collectDescriptorSources`.
> **TIER 1.3 COMPLETE (2026-06-24):** the catalog's on-demand dynamic-CRD informers are
> consolidated onto the one ingest path. The catalog no longer owns a `dynamicinformer`:
> `maybePromote` now registers an on-demand dynamic reflector with the ingest manager
> (`RegisterDynamicCatalogReflector` — an unstructured LIST+WATCH via the dynamic client,
> projecting each CR to the SAME `buildSummary` Summary), plus a Catalog-half sink for
> incremental updates, and records the gvr so `collectViaIngest` serves it from `CatalogRows`
> once `HasSyncedFor`. ON-DEMAND PRESERVED (only promotes at `itemCount ≥ threshold`; below
> threshold the kind keeps being listed). READINESS ISOLATED: on-demand entries are EXCLUDED
> from the whole-manager `HasSynced` gate (added after the cluster serves — they must not
> perturb readiness/metrics, the issue-#225 class), while `HasSyncedFor` reports their real
> per-gvr sync so the catalog serves-when-synced-else-LIST (no empty flash). DELETED:
> `collectFromInformer`, `getPromotedDescriptor`, `promotedDescriptor`, `errInformerNotSynced`,
> `s.promoted` (→ `dynamicIngested` gvr set). The CRD-DEFINITION watch (`watch.go`) already
> rode the shared apiext factory — unchanged. Gates: `TestCatalogDynamicCRDViaIngestMatchesListPath`
> (ingest-served Summaries == pure-LIST Summaries) + `…PromotesOnlyAboveThreshold` (on-demand)
> + ingest pkg `TestRegisterDynamicCatalogReflectorServesCatalogRows` / `…GlobalHasSyncedIgnoresOnDemandEntries`
> / `…StopReflectorForEvicts`; full backend `-race` + `mage qc:prerelease` green.
> **TIER 2.4 COMPLETE (2026-06-24):** the spill is wired into the governor's Cold/re-warm —
> with a reconciling restore so it is correct for ALL domains (the user-chosen
> difficult-but-correct path). A per-cluster `domain.Registry` now collects every domain's
> maintained store (`RegisterMaintainedStore`, one line per domain, no signature changes);
> `teardownClusterSubsystem` spills them to a session-scoped per-cluster cache dir once the
> subsystem is quiescent (`spillClusterStores`), and `rebuildClusterSubsystem` re-paints the
> fresh stores from disk BEFORE the informers feed (`restoreClusterStores`) then, in the
> `Manager.Start` goroutine which blocks until the hub syncs, calls
> `ReconcileMaintainedStores()`. CORRECTNESS: ingest/reflector-fed stores self-reconcile via
> the reflector's initial `Replace`; shared-informer-fed stores (HPA, GatewayClass,
> Gateway-API, CRDs, events, limitrange) drop ghosts via `typedMaintainedStore.Reconcile`
> (per-kind diff-sync vs the live informer list — populated by `registerMaintainedHandlers`
> and `registerMaintainedInformerHandler`); workloads self-reconciles via its Build recompute
> `Replace`. helm is intentionally NOT spilled (bespoke synthesized rows; re-syncs from empty
> = correct, no warm-paint). Session-scoped: `resetSpillRoot` clears last session's spill at
> startup (cross-restart resume is 2.5). Gates: querypage `RestoreFrom` round-trip;
> `typedMaintainedStore` spill/restore + reconcile-drops-ghosts + per-kind scoping; registry
> SpillAll/RestoreAll(skip-missing)/ReconcileAll; app per-cluster spill-dir round-trip + reset;
> full `mage qc:prerelease` EXIT 0. NOTE: a sub-second post-sync window can show a ghost before
> `Reconcile`'s version-bump triggers the corrective refetch — acceptable for 2.4; 2.5 tightens it.
> (2.5) the four-stage cold-start — ✅ ALL STAGES DONE (2026-06-24): **stage 1 (discovery disk-cache+ETag) DONE
> (2026-06-24):** the object catalog re-discovers through a per-cluster `disk.CachedDiscoveryClient`
> (aggregated discovery + ETag/304 + on-disk group/HTTP cache under the user cache dir), built
> once via `ensureDiscovery`→`buildDiscoveryClient` with a plain-client fallback when the
> RestConfig/cache dir is unavailable; precise invalidation — a CRD add/delete on the apiext
> informer marks `discoveryStale` (`crdWatchHandler` wrapping `makeHandler`) so the next
> `discoverResources` `Invalidate()`s the cache, so periodic discovers stay cached while a new/
> removed CRD forces a fresh fetch (gated: invalidate-after-CRD-change + handler-marks-stale +
> `mage qc:prerelease`). **stage 2 (warm-paint-from-disk across restarts) DONE (2026-06-24):** the
> 2.4 spill is now cross-restart — `resetSpillRootForFormat` (initGovernor) keeps the previous
> session's spill iff its `format-version` marker matches this build (else discards on first-run/
> upgrade; any residual decode mismatch is skipped per-store), and restore is centralized in
> `buildRefreshSubsystemForSelection` so EVERY build path (initial setup, selection update, auth/
> governor re-warm) re-paints the maintained stores from disk before the manager starts;
> reconcile-after-sync runs in both start goroutines (`startRefreshSubsystems` + cluster_auth
> rebuild). Same mechanism as 2.4 reconciles stale rows on the cold-start full LIST; UI
> "reconciling" marker deferred (rows paint then reconcile silently). Gated: `TestResetSpillRootForFormat`
> (keep-compatible / clear-on-upgrade) + `mage qc:prerelease`. stage 3 (WatchList resume
> from persisted RV → delta reconcile — turns the cold-start full LIST into a delta) + stage 4
> (410-Gone reconcile-delete) — DONE, built incrementally (3a/3b/4 below). **ARCHITECTURE NOTE (2026-06-24):** stage 3 cannot reuse client-go's
> `cache.Reflector` (the ingest path borrows it, manager.go:7) — that reflector ALWAYS transfers full
> state on initial sync (`list()` reflector.go:676; WatchList streams from RV=""), with no resume-delta
> option in `ReflectorOptions`. So the delta-resume is a custom watch path, built incrementally.
> **stage 3a (resume-watch component) DONE:** `ingest/resume.go resumeFromResourceVersion` issues a delta
> WATCH from the persisted RV (`AllowWatchBookmarks=true`), applies Added/Modified/Deleted to the
> ProjectingStore on top of its restored baseline, advances RV on bookmarks, marks the store synced once
> the watch establishes (per-GVR readiness), and returns `resumeNeedsFullSync` on 410-Gone/expired/Error
> (caller full-syncs → stage 4 reconcile) or `resumeContextDone` on ctx end. + `ProjectingStore.MarkSynced`.
> Standalone + unit-gated (deltas+synced / 410→needs-full-sync / error-event→needs-full-sync), NOT yet wired
> (zero blast radius). **stage 3b-i (resume wiring) DONE:** IngestManager.Start now launches each reflector
> via `runWithResume(ctx, e.lw, e.store, e.resumeRV, fullSync)` — attempts the delta resume when `e.resumeRV` is
> set, else (the default) runs the reflector's full sync UNCHANGED. `SetResumeResourceVersion(gvr, rv)` sets it;
> entry retains its ListerWatcher. NOT activated in production (resumeRV unset until the ingest-store restore
> lands), so zero behavior change — proven by the unchanged manager/readiness tests + `runWithResume` unit tests
> (healthy→no full-sync / 410→full-sync / no-RV→full-sync). **stage 3b-ii-a (serialization primitive) DONE:**
> `ProjectingStore.SpillBundles(path)` / `RestoreBundles(path) (rv, err)` gob-encode `{Rows map[string]Bundle, RV}`
> and restore the Bundles DIRECT (no re-projection — source object gone) + rv + synced, returning rv for the
> resume. SAFE-DEGRADE design: missing file / unregistered type / decode error → error → caller skips → full sync
> (no regression). Round-trip + missing-file gated. **stage 3b-ii-b-1 (manager spill/restore + gob registration) DONE:**
> `IngestManager.SpillStores(dir)` / `RestoreStores(dir)` round-trip each entry's store (per-GVR `.bundles` file);
> RestoreStores sets `e.resumeRV` from the persisted RV (lighting up runWithResume). `registerGobTypes` projects
> each entry's retained example object and gob.Registers the Bundle halves (recover-guarded — unregisterable kind →
> full sync). Safe-degrade gated. **stage 3b-ii-b-2 (activation) DONE:** teardownClusterSubsystem spills the ingest
> stores (subsystem.IngestManager.SpillStores) after Shutdown (alongside the maintained ones);
> buildRefreshSubsystemForSelection restores them (RestoreStores) before Start — per-cluster `ingest` subdir of the
> format-version-guarded spill root. **stage 4 (410-Gone reconcile-delete) DONE:** the full-sync fallback's
> `ProjectingStore.Replace` drops every UID absent from the fresh snapshot AND notifies sinks — the zombie-row
> mitigation (risk #7), gated by `TestFullSyncFallbackDeletesAbsentUIDs`. **➤ TIER 2.5 COMPLETE (2026-06-24)** — all
> four stages (discovery disk-cache+ETag; cross-restart warm-paint; WatchList resume-from-persisted-RV via a custom
> resume path since client-go's reflector can't; 410-Gone reconcile-delete), safe-degrade end-to-end (any failure →
> full sync). Real-cluster delta-resume is a deployment property; the unit gates + safe-degrade are the contract.
> **(2.6) mmap on-disk column format — DONE (2026-06-24), replacing the gob baseline.** The maintained-store spill
> now writes/reads the columnar mmap format instead of gob: `querypage/columnfile.go` + build-tagged `mmap_unix.go`
> (syscall.Mmap PROT_READ/MAP_SHARED → off-heap, OS-reclaimable page cache) + `mmap_other.go` (os.ReadFile fallback)
> give the mmap mechanism with BOTH a portable per-value `binary.LittleEndian` path AND `Int64Column`/`Uint32Column`
> **zero-copy** `unsafe.Slice` accessors (8-aligned, native-order — the plan's literal "zero-copy page-cache reads").
> `querypage/columnstore_spill.go` serializes a whole `Store[R]` column-wise (all 7 codec field kinds: scalars flat,
> strings len+bytes, ptr-to-scalar present+scalar, dynamic map/slice "fallback" fields via one gob stream) and
> restores via `RestoreColumnsFromFileInto` (reconstruct + Upsert → rebuilds columns/dicts/indexes/match cache,
> query-equivalent to gob). WIRED: `typedMaintainedStore.SpillTo`→`SpillColumns`, `RestoreFrom`→columnar with a gob
> FALLBACK (handles a prior gob spill on a same-version transition + degrades safely). Gated: round-trip ==
> gob-equivalence harness + all-scalar-kinds + zero-copy + cross-platform (windows build) + full `mage qc:prerelease`.
> **DUAL-MODE SERVING — CORE BUILT + GATED; GOVERNOR-TIER WIRING DONE (2026-06-25).** A Cold cluster now serves
> queries from its mmap-backed columnar stores instead of being fully torn down. WIRED: `typedMaintainedStore.SwapToMmap`
> (calls `Store.ReopenInternedColumnsInPlace`, bumps the sink version) + the `domain.SpillableStore` interface +
> `domain.Registry.CoolMaintainedStoresToMmap(dir)` (one `<domain>.qcm` per domain; on any error closes what it opened
> and returns the error so the caller falls back to full teardown). The governor's Cold action
> (`appGovernorExecutor.teardown` → `App.coolClusterToMmapServing`) stops the cluster's FEEDS (a factored
> `stopClusterFeeds`: permission-reval + ResourceStream + Manager.Shutdown + InformerFactory.Shutdown — NO
> `takeRefreshSubsystem`, NO spill), swaps the maintained stores to mmap, installs a `system.cooledInformerHub`
> (always-settled, since `factory.Shutdown` cleared the real hub's synced flag) on the still-registered
> `snapshot.Service`, marks `Subsystem.Cooled`, stores the closers per-cluster, and `FreeOSMemory`s; any cooling error
> safe-degrades to the existing full `teardownClusterSubsystem`. Re-warm (`ensureRunning` detecting `Subsystem.Cooled`)
> UNROUTES the cooled subsystem (`takeRefreshSubsystem`), rebuilds a fresh live one (re-pointing the aggregate router),
> THEN closes the mmap mappings — so a closer (each lock-safe: it takes the store's write lock to serialize after any
> in-flight Query, and is idempotent) only unmaps after no Build can still read the mapping. Gated: store-level
> `TestReopenInternedColumnsInPlaceCloserWaitsForInFlightQuery`/`...ConcurrentQueryAndClose`/`...CloserIdempotent`
> (`-race`); maintained-store `TestTypedMaintainedStoreSwapToMmapServesIdentically`; registry
> `TestRegistryCoolMaintainedStoresToMmap`/`...ErrorClosesOpened`; service `TestServiceSetInformerHubSwapsSyncGate`;
> system `TestCooledInformerHubAlwaysSettled`; end-to-end `TestCoolServeRewarmRoundTrip` (cool→serve-identical→re-warm,
> `-race`) + `TestCoolReadOnlyRejectsUpsert`; app `TestAppCloseCooledClosersRunsEachExactlyOnce`. A cooled cluster is
> LOW-RAM (columns off-heap, indexes resident), not ~0-RAM — see the contradiction note below.
>
> _(historical, pre-wiring:)_ A Cold cluster can serve
> queries directly from the mapping (column data off-heap). Built + tested: (a) Prototype #4
> (`mmap_query_prototype_test.go`) proving a filter+sort+page query over mmap'd columns == in-memory baseline; (b)
> zero-copy `StringColumnAliased` (`unsafe.String`) completing the int/uint/string off-heap read set; (c) `Store.readOnly`
> mode (Upsert/Delete ignored — a mmap-aliased store is never mutated); (d) `querypage/columnstore_mmap.go` —
> `Store.SpillInternedColumns` + `OpenInternedColumnStore` (aligned interned writer/reader; scalar columns aliased via
> `unsafe.Slice`, dict strings via `unsafe.String`, fallback gob→heap; rebuilds uid→rowID + sort indexes + match cache
> from the aliased columns; returns a closer that must outlive use). Gated: `TestInternedColumnStoreMmapRoundTrip`
> (read-only mmap store == heap store across sorts/filters, incl. read-only enforcement) + `-race` + staticcheck +
> windows build + full `mage qc:prerelease`. Plus `Store.ReopenInternedColumnsInPlace` (spill + swap a live store's
> internals to the mmap view in place — same pointer keeps serving — returning the closer; `TestReopenInternedColumnsInPlace`
> gated). So the entire STORE-LEVEL dual-mode machinery is complete + tested + gated.
> **GOVERNOR COLD-SERVING TIER WIRED — DONE (2026-06-25).** The governor's Cold action now COOLS a cluster to
> mmap-serving instead of full teardown: `appGovernorExecutor.teardown`→`coolClusterToMmapServing` stops the cluster's
> feeds (informers/ingest/metrics/permission-reval, via the factored-out `stopClusterFeeds`), swaps every maintained
> store to a read-only mmap-aliased view (`Registry.CoolMaintainedStoresToMmap`→`typedMaintainedStore.SwapToMmap`→
> `Store.ReopenInternedColumnsInPlace`, column DATA off-heap/OS-reclaimable, indexes rebuilt resident), installs an
> always-settled `cooledInformerHub` so a cooled Build isn't blocked by the shut sync gate, marks `Subsystem.Cooled`,
> and `FreeOSMemory()`. The subsystem STAYS registered and serves `Build` from the mmap stores. On re-warm,
> `ensureRunning` detects `Cooled` and `rewarmCooledClusterSubsystem` unroutes the cooled subsystem, rebuilds a fresh
> live one, THEN runs the mmap closers. SAFE-DEGRADE: any cool error falls back to the original full teardown.
> mmap-closer-vs-Build-reader safety: the closer is lock-safe (takes the store write lock, serializing after in-flight
> Queries) + idempotent, and runs only after the cooled subsystem is unrouted — proven by a RED test that SIGSEGV'd on
> read-after-unmap, now GREEN under `-race` (`TestReopenInternedColumnsInPlaceCloserWaitsForInFlightQuery`,
> `TestCoolServeRewarmRoundTrip`, `TestTypedMaintainedStoreSwapToMmapServesIdentically`). Full `mage qc:prerelease`
> EXIT 0. NOTE: a cooled cluster is LOW-RAM (bulk column data off-heap + OS-reclaimable; only the smaller indexes
> resident) and still queryable — the plan's "Cold: columns spilled to mmap'd disk".
> **(2.7) nodes metrics in the query sort schema DONE (2026-06-24)** — the nodes adapter already sorts
> cpu/memory by numeric LIVE usage (`NumericSort` → `parseFormattedCPUToMilli`/`parseFormattedMemoryToBytes`, schema
> lists cpu/memory, `finishNodeSnapshot` serves the metrics-overlaid rows through the engine); the gap was a missing
> regression test, now added (`TestNodesSortByMetricUsage`, values chosen so lexical≠numeric order).
> **➤ PLAN COMPLETE (2026-06-25) — all tiers + all refinements landed, gate-green.** The re-baseline tier list —
> 1.1, 1.2, 1.3, 2.4, 2.5 (all four cold-start stages), 2.6 (mmap on-disk column format + dual-mode Cold-serving
> tier), 2.7 — is done + gated (`mage qc:prerelease` EXIT 0). The previously-"STILL OPEN" items are now ALL done:
> (a) 2.6 dual-mode mmap SERVING — the governor Cold action cools a cluster to a read-only mmap-aliased store (bulk
> column data off-heap/OS-reclaimable, indexes resident) and keeps serving Build, re-warming on switch-back; closer-
> vs-reader lifetime made safe (RED SIGSEGV → GREEN under `-race`). (b) the "Smaller, optional" maintained-store
> conversions — `nodes`, `namespace-workloads` (5 GVRs), `namespace-network` (EndpointSlice relationship kept at
> serve) all converted to Sink-fed maintained stores; `cluster-crds`/`namespace-helm` were already maintained stores;
> pods' metric SORT done+gated; a stronger catalog oracle test (`TestCatalogQueryMatchesBruteForceOracle`, 10,800
> query shapes); trigram search (`querypage/trigram.go`, verify-after-intersect, skipped on read-only Cold stores).
> (c) ingestion refinement — project-to-column-tuple DONE (one generic `keyFromCatalog` matched all 27 ingest-fed
> kinds; stored Table-half dropped, delete keys off the retained Catalog half; pods retain theirs). Phase 4 ✅.
> DROPPED-with-reason items (h2c, SSAR→SSRR, LSN clock, metrics-signal, MessagePack) are intentionally not pending.

**Shipped & green** (verified `go test ./backend/...` + `mage qc:prerelease`/vitest where noted):

- ✅ **Phase 1 — delivery-model collapse, COMPLETE.** All 16 streamed domains are signal-only:
  a delta/resync bumps streamRevision → the query-backed view refetches; no domain renders live
  stream rows. The **entire live-row path is deleted** (applySnapshot, mergeSnapshotRows, the 16
  collections, sort fns, drift detection, the whole `resourceStreamRows.ts`), backend row-omission
  is **universal** (`newObjectRowUpdate` never ships a row), and the `notifyOnly` flag + parity test
  + contract field are gone. helm's *backend* stays `complete-resync-stream` (a stream-semantics
  detail — synthesized HelmReleases — not a delivery difference). Verified green: full backend
  `go test`, tsc, vitest 391 files / 3234 passed, `mage qc:prerelease`.
- ✅ **Prototype #1 — store gate: GO.** `backend/refresh/storebench/` at 1M objects:
  write 0.7µs (1 idx)/1.7µs (2 idx) 0-alloc; keyset page 3.5µs (vs naive full-sort 270ms);
  reads-under-concurrent-churn 6.4µs (`-race` clean); trigram search 38–555µs; memory
  74 B/object (~54 clusters/4GB). Owned-columnar + interning + multi-index (no SQLite/cgo)
  validated across write/read/concurrency/search/memory. (Detail under §Risks #1.)

**Engine build** — production `backend/refresh/querypage/`:

- ✅ **Step 1 — unified value-keyed cursor** (`cursor.go`): one codec replacing the
  typed-table + catalog cursors; tested.
- ✅ **Step 2 — generic `Store[R]` Query→Page engine** (`store.go`): schema-driven (zero
  per-kind code), per-direction keyset indexes, facets/filters/search/pagination.
  Benchmarked @1M: write 2.7→5.2µs, query 17.6µs and **depth-independent**.
- ✅ **Step 3 — exact-order parity + config schema**: per-direction indexes reproduce the live
  `typedTableSortedItemLess` tie-break exactly; `configQuerypageSchema()` derives from the live
  adapter (reusing its sort encoder + key). Ordering equivalence proven.
- ✅ **Step 4 — FIRST LIVE CUTOVER**: `snapshot/namespace_config.go::Build` now serves its query
  branch through the engine (`resolveConfigSnapshotPageViaStore`). Proven byte-equivalent over
  **84 query combos** (rows across full pagination + Total + UnfilteredTotal + facet lists); full
  backend suite green. NOTE: this is **unification** (per-Build store rebuild; config N is small) —
  the perf win needs the maintained store (Next #1).

**Dropped or deferred (with reason — these are NOT pending work, do not re-attempt as patches):**

- ❌ helm *backend* → notify-only/resource-stream-table behaviorClass (genuinely complete-resync;
  behaviorClass stays). NOTE: helm's *frontend* IS signal-only like the 15 (Phase 1 is complete) —
  only its backend stream semantics differ; this is not pending work.
- ❌ SSAR→SSRR (remaining callers are legitimately cluster-scoped / resourceName-specific).
- ❌ h2c transport (the webview's browser `fetch` can't use HTTP/2 cleartext); 🔻 MessagePack/Worker
  decode (marginal at ≤1000-row pages — the big payloads it would help were already eliminated).
- ❌ metrics-signal decouple (no pre-store value) and ❌ LSN clock as incremental tweaks — these are
  from-scratch-architecture, only land with the real engine.

**Where we are:** **Phase 3 DONE** — all 16 typed-table domains AND Browse/object-catalog serve through the
single `querypage` engine, whose store is now the **columnar SoA backend** (interned columns + reflect codec,
property-test gated; ~12% row-memory win — modest because projection already captured the big win, but it's
the on-disk SoA format for Phase 4 spill). The 8 maintained domains query the persistent store DIRECTLY
(O(log N+page)). The bespoke **`typedTableQueryCollector`, the old `resolveTypedSnapshotPage`, AND the catalog
chunk-scan + cursor codec are all DELETED**; the engine grew **predicates** + **backward/prev-page pagination**;
`applyTypedTableQuery` remains only as the typed-table equivalence oracle. **`pods` is on a maintained store
with metrics as a separate column** (zeroed in the store, overlaid fresh at serve — a metrics poll never
touches the store). (Earlier ledger entries said "10 typed domains" — that undercounted; the set is 16.)
**Next** (complete remaining
roadmap with per-item status in [§Migration phases](#migration-phases--value-early-no-big-bang)):

**Phases 0–3 are DONE.** Phase 4 (ingestion to WatchList + projection + spill) is the remaining build. Next:
1. **Phase 4 — WatchList-projection ingestion**: replace the eager ~30-informer factory + the catalog's
   `factory.ForResource`/on-demand promotion + the CRD watch with one registry-driven WatchList-projection
   path (capability-probe + watchdog). Prototype #3 (WatchList watchdog + LIST fallback) first.
2. **Phase 4 — lifecycle + governor + mmap spill + four-stage cold-start.** The columnar SoA is already the
   on-disk format, so spill is `mmap`ing the column files per `(cluster,gvr)`.
3. **Smaller, optional (status 2026-06-25):** maintained stores for the cutover-only domains — `nodes` ✅ DONE
   (typedMaintainedStore fed by the NodeGVR Sink); `workloads synthesized pods` ✅ DONE (one
   typedMaintainedStore[WorkloadSummary] fed by all five workload GVRs' Table-half Sinks; the standalone-pod
   synthesis + pod/metrics/HPA overlay stay serve-time cross-kind joins; `namespaceWorkloadOwnRows` removed);
   `network relationship` ✅ DONE 2026-06-25 (one typedMaintainedStore[NetworkSummary] fed by the four cut
   network GVRs' Table-half Sinks — Service/EndpointSlice/Ingress/NetworkPolicy — UNIFIED with the uncut
   Gateway-API kinds' informer-fed rows in the SAME store; the EndpointSlice service-join stays a serve-time
   cross-kind join read from the ingest source's Aggregate half and re-applied by reaggregateServiceSummary;
   `namespaceNetworkOwnRows` + the cut-kind PULL fallback removed, no dual path); `helm/crds` still per Build.
   pods' direct query ✅ (metric SORT done + gated; the persistent metric index stays profile-driven, part of the
   deferred metrics-column-family). A stronger catalog correctness test ✅ DONE (`TestCatalogQueryMatchesBruteForceOracle`
   — 10,800 query shapes vs a brute-force oracle). Trigram-accelerated search ✅ DONE (querypage `trigramIndex`,
   verify-after-intersect so results stay identical, skipped on read-only Cold stores).

## Provenance & confidence

**Verified 2026-06-21 against `main`** (commit with PR #235 merged). Every
current-system `file:line` in this doc was checked against the checked-out code
this session — 56 load-bearing claims: **38 confirmed exact, 14 line/scope
corrected, 3 were wrong (fixed below), 1 is an estimate.** Read the labels:

- **[fact]** — verified against current code/docs this session (the citation is exact).
- **[ext]** — external fact (Kubernetes KEP / Go library), verified via source and
  version-qualified.
- **[design]** — a forward proposal, not yet built; falsifiable only by building it.
- **[target]/[estimate]** — an engineering target or order-of-magnitude estimate,
  **not a measurement**. Treat every latency/throughput/byte number in §§3–4 as a
  **[target]** to be settled by Prototype #1, *except* the two explicitly cited as
  measured: the ~26 ms@50k merge+sort (`notify-only-streams.md:84`) and the Browse
  budget (`large-data.md`).

Everything under "Layers in detail" and "End-to-end walkthrough" is **[design]**
with **[target]** numbers unless a sentence cites current code as **[fact]**.

> **Material corrections after verification — do not trust the pre-2026-06-21 draft:**
> - "~18 streamed domains" → **wrong**. There are **16** streamed domains (15
>   `resource-stream-table` + 1 complete-resync `namespace-helm`); 30 refresh
>   domains total; **3** notify-only today (`notify_only.go:23`).
> - "per-row `PodSummary.Metrics` (`pods.go:152`)" → **wrong**. Per-pod usage is
>   baked as **formatted strings** `PodSummary.CPUUsage`/`MemUsage`
>   (`streamrows.go:318,321`); `pods.go:152` is *snapshot-level* poller-health
>   metadata (`PodSnapshot.Metrics`), not a per-row field.
> - "Events use a special full-cached informer" → **wrong**. `factory.go:188`
>   registers a **standard** shared `Events` informer like the other ~29 core ones.
> - "per-object SSAR loop is today's permission path" → **overstated**. The live
>   `QueryPermissions` gate **already** does SSRR-first with SSAR fallback
>   (`app_permissions.go:107`); the per-check SSAR loop (`service.go:125`) is the
>   *fallback* plus remaining callers (`objectcatalog/sync.go`, `resource_permission.go`).
> - "catalog fully rebuilt per watch flush" → **overstated**. The debounced
>   (≤200 ms) per-flush rebuild updates chunk/kind/namespace caches but **defers**
>   the O(N) sort + query-index to first query (`catalog_index.go:335-337`).
> - "the typed full-sort" → it is **one of two** paths. A **bounded**
>   `typedTableQueryCollector` capped-candidate buffer already exists alongside the
>   full sort (`typed_table_query.go:421-520`); the full sort itself is at `:377-379`.
> - "gorilla/websocket (archived)" → **outdated**. It was archived Dec 2022 but
>   **un-archived and maintained again since mid-2023**; it is pinned to an untagged
>   commit (`go.mod:9`). The migration rationale is the API (context-aware,
>   concurrency-safe writes), not abandonment.
> - WatchList is **[ext] beta**, not GA (client-go `WatchListClient` default-on
>   since v0.35; server-side beta since k8s 1.32).

---

## Problem — multiplicity is the scaling tax

The current app's deepest scaling cost is not one slow function; it is that it
maintains parallel mechanisms that each must be kept in sync and each is a place
state can diverge:

- **Multiple delivery models.** [fact] The refresh contract defines **six**
  behavior classes (`refresh-system.md:74-82`); the three that deliver *table
  rows* are full-snapshot replace, live-row-merge (`resource-stream-table`), and
  notify-only. Notify-only (the cheapest, query-backed one) reached only **3 of 16
  streamed domains** (pods, namespace-workloads, nodes;
  `backend/refresh/resourcestream/notify_only.go:23`; 16 = 15 `resource-stream-table`
  + 1 complete-resync, out of 30 refresh domains total).
- **Two query engines.** [fact] A typed path
  (`backend/refresh/snapshot/typed_table_query.go`) and a catalog chunk-scan path
  (`backend/objectcatalog/query.go`), each with its own cursor codec. The typed
  path *already* has a bounded keyset collector (`typedTableQueryCollector`,
  `typed_table_query.go:421-520`) alongside a full-sort fallback (`:377-379`); the
  catalog path still streams all chunks as an O(N) scan (`query.go:342`). So the
  problem is two **separate** engines/codecs, not that both are unbounded.
- **Three ordering authorities** — per-(domain,scope) sequence numbers, per-object
  Kubernetes `resourceVersion`, and `liveDomainVersion`
  (`version:checksum:streamRevision`).
- **Live-row waste** — the live subscription retains the full row set and runs an
  O(N log N) merge+sort on every 150 ms coalesced flush, measured **~4.7 ms @ 10k
  rows / ~26 ms @ 50k rows** for rows nothing renders
  (`notify-only-streams.md:84`). `notify-only` exists *only* to dodge this; it is a
  symptom of the model split, not a clean primitive.
- **Metrics packaged into the object row.** [fact] CPU/memory come from a
  *separate poll* (`metrics.k8s.io` via the `Poller` ticker,
  `backend/refresh/metrics/poller.go:153`; exposed as `LatestPodUsage()`,
  `pods.go:235`) but are **baked into the row at projection time** as formatted
  strings `PodSummary.CPUUsage`/`MemUsage` (`pods.go:280` and `:294` → `:69`
  `project(...)`; the row strings live at `streamrows.go:318,321`), **folded into
  the same snapshot version object changes bump** (`pods.go:238-242` →
  `snapshotVersionWithDynamicRevision`, `table_window.go:19`), and **keyed into the
  projection memo as `(uid, resourceVersion, metricsRev)`** (`pods.go:108-111`). So
  every ~15 s metrics poll flips the unified `liveDomainVersion` and re-projects the
  whole fleet's stable rows, even though no object changed. (`pods.go:152` is
  *snapshot-level* poller-health metadata, `PodSnapshot.Metrics`, not a per-row
  field.) (Resolution: §3.6.)
- **Cold start dominated by informer LIST**, all-or-nothing across ~30 informers
  (`backend/refresh/informer/factory.go:266`), ~100 ms at 50k pods bounded by the
  LIST, not the projection (`notify-only-streams.md:93`).
- **In-memory-only catalog**, lost on cluster eviction/relaunch. [fact] The
  debounced (≤200 ms) per-watch-flush rebuild updates the chunk/kind/namespace
  caches but **defers** the O(N) sort + query-index to first query
  (`catalog_index.go:335-337`) — so it is not a *full* rebuild per flush, but it is
  still volatile and non-persistent. The persistent (on-disk) store seam is
  deliberately documented but **not taken** until measured (`large-data.md`
  "Query store seam"; `notify-only-streams.md:104-110`).
- **A 100k exact-facet cliff** [fact] where totals/facets stop being exact above a
  budget (`query.go:33,167,203`).

## Goal — one of each

| Axis | v2 |
|---|---|
| Stores | **One** per-cluster canonical store + index |
| Query engines | **One** `Query → Page` contract (typed tables and Browse differ only by `WHERE kind`) |
| Delivery models | **One**: *page (pull) + window-delta (push)* |
| Ordering authorities | **One per data source** — object LSN (watch); metricsRevision (poll) |
| Webview row residency | **The visible window + a small LRU**, independent of cluster size |

`notify-only` disappears as a named mode because there is no other mode to
distinguish it from. The one place v2 deliberately keeps **two** of something is
data *sources*: object state and metrics are two column families on two clocks
(§3.6), because they are genuinely two different data sources — collapsing them is
the current app's mistake, not its virtue.

---

## Principles & the load-bearing invariant

1. **One store, one query language, one delivery model.**
2. **The webview never holds, sorts, or filters N.** All ordering/filtering/facet
   authority is backend-side; the JS heap holds the visible window + a tiny
   back-nav LRU (single-digit MB/view at any cluster size).
3. **Borrow the hard correctness machinery; own only the narrow thing that wins
   scale.** Borrow client-go's reflector (410/relist/bookmark/RV bookkeeping),
   `google/btree`, and CBOR/MessagePack framing. Own exactly two things: the
   **dictionary-interned columnar projection** and the **incremental
   order-statistics index maintenance**. **No cgo / no embedded SQL engine** — any
   on-disk fallback is a pure-Go embedded store (e.g. `bbolt`/Badger), so the binary
   stays cgo-free and there is one canonical store, not two query languages.
4. **One clock per data source.** Object state runs on a single per-cluster
   monotonic **LSN** (watch-fed); metrics run on their own **metricsRevision**
   (poll-fed). *Within* a source, nothing orders, resumes, dedups, or invalidates
   by `resourceVersion`, wall-clock, or a per-domain counter. The two sources are
   joined by UID in the store, never merged into one revision (§3.6).
5. **Memory bounded by a process-wide governor, not hope.** `GOMEMLIMIT` *triggers*
   eviction; LRU eviction of a background cluster's write source *does the
   freeing*; the durable store stays on disk.

**The system-wide invariant** (one regression gate enforces it — see Prototype
#2):

> A page query result is byte-identical to a fresh sort+filter+window of the
> canonical store at the same snapshot clock — and a window delta, applied to the
> client's window, yields byte-identical rows to that same page query at the
> delta's clock. For any view, ordering and resume authority derive from exactly
> one clock — the LSN for object-sorted views, the metricsRevision for
> metric-sorted views (§3.6) — and from nothing else (never `resourceVersion`,
> never wall-clock).

If this holds end-to-end, cursor stability, resume, backpressure recovery, and
multi-cluster isolation all fall out of it.

---

## System overview

Per cluster, keyed by `clusterId`, top to bottom:

```
 Kubernetes apiserver                          metrics.k8s.io (or Prometheus)
   │  WatchList (KEP-3157): SendInitialEvents     │  poll (LIST every ~15s; not watchable)
   │  + protobuf(builtins)/JSON(CRDs);            │
   │  PartialObjectMetadata tier.                 │
   │  client-go reflector owns 410/relist/        │
   │  bookmark; capability-probe + LIST-fallback. │
   ▼                                              ▼
 INGESTION (watch)                             METRICS POLLER ── name→UID join,
   │  registry-driven cache.TransformFunc          │   own metricsRevision clock,
   │  projects each object → flat column tuple,     │   per-row sample ts + freshness
   │  discards source object. Per-GVR projection-   │
   │  failure isolation (skip + log-once).          │
   ▼                                                ▼
 UNIFIED DELTA LOG (per cluster, LSN)          METRIC COLUMN FAMILY (per-(cluster,gvr))
   │   single Append: LSN, per-UID coalesce,        │   separate column slices in the SAME
   │   ring-retain. The ONE object writer.          │   row arena, keyed by the SAME rowId/UID.
   ▼                                                ▼
 STORE / INDEX ──────────────────────── columnar SoA, dict-interned (~150–400 B/row,
   │   zero-pointer GC win). Order-statistics b-trees per (kind,sort): O(log N) insert/
   │   delete + O(log N) Rank/At. O(1) exact facet counters. COW snapshots = MVCC. Trigram
   │   search. mmap spill for cold clusters. Object indexes advance on LSN; METRIC indexes
   │   advance on metricsRevision.   [pure-Go embedded store (bbolt) = benchmark-gated fallback.]
   ▼
 QUERY ── one Query→Page engine. Keyset page = bounded range scan over a COW index
   │   snapshot: O(log N + page). Facets/totals = counter reads, exact at any N.
   │   Lazy full-object hydration on detail-open (bounded LRU). Cursor = (sortValue, uid)
   │   + snapshot clock + signature (+ metricsRev for metric-sorted pages).
   ▼
 DELIVERY / TRANSPORT ── ONE model: "page + window delta".
   │   • Pages → loopback h2c HTTP, MessagePack, ETag=clock, decoded in a Web Worker.
   │   • Deltas → ONE WebSocket (coder/websocket), CBOR binary frames, arraybuffer→Worker.
   │     OBJECT sub-channel: INSERT/UPDATE/MOVE/REMOVE/DOORBELL on LSN.
   │     METRIC sub-channel: per-cell UPDATE (object-sorted views) or window DOORBELL
   │     (metric-sorted views) on metricsRevision. Joined at the client by UID.
   │   • Commands/actions → Wails bound methods (small RPC only).
   ▼
 FRONTEND DATA MODEL ── one window (+ small LRU) per view as source of truth.
   │   Signal store (TanStack Store): object cells and metric cells are DISTINCT signal
   │   families fed by distinct channels. Never holds/sorts/filters N. Quiet in-JS
   │   pre-filter of the loaded window with the identical predicate during refetch.
   ▼
 RENDER ── existing prefix-sum + binary-search virtualizer, UID stable keys, scroll-anchor
           by top-visible UID. ~30 rows in DOM at any N.
```

**The one delivery model** is **"page + window delta."** The client pulls a keyset
page over HTTP and subscribes to that exact window over the WS. The WS pushes
positional deltas scoped to the visible window (the churn-independent steady
state) plus a DOORBELL when totals/facets move beyond the window. There is no
live-row-merge path, no per-domain `notifyOnly` flag, no `applyResourceRowUpdates`.

---

## Layers in detail

### 3.1 Ingestion (K8s API → backend)

One path for every GVR. [fact] Today there are three overlapping ingestion paths:
the typed shared `SharedInformerFactory` (`informer/factory.go`); a generic
lister/handler layer over that *same* factory via `factory.ForResource(gvr)`
(`objectcatalog/informer_registry.go:54,63`, `watch.go:300`) plus **on-demand
per-GVR dynamic informers** created by catalog "promotion" when a kind exceeds an
item-count threshold (`objectcatalog/collect.go:308`,
`dynamicinformer.NewFilteredDynamicInformer`); and a single CRD-definitions watch
handler that learns when CRDs appear/disappear (`watch.go:306-309`). v2 replaces
all of that with one registry-driven WatchList-projection path. **This section is
object state only — metrics are ingested by a separate poll path, see §3.6.**

- **Transport — WatchList, capability-probed, with a tested LIST fallback.**
  [ext, **beta**] WatchList (KEP-3157) is beta — server-side default-on since
  k8s 1.32, client-go `WatchListClient` gate default-on since v0.35 (we run
  v0.36.2, `go.mod:21`) — **not GA**; the LIST fallback below is therefore
  load-bearing, not belt-and-braces. Per `(clusterId, gvr)`, client-go reflector
  with the `WatchListClient` feature gate:
  `Watch(ListOptions{SendInitialEvents:true, ResourceVersionMatch:NotOlderThan,
  ResourceVersion:<persisted RV or "">, AllowWatchBookmarks:true})`. Objects stream
  as `ADDED`; the `k8s.io/initial-events-end: "true"` bookmark marks
  "snapshot complete"; the same connection continues into live deltas. We inherit
  client-go's 410-Gone relist, "never go back in time" RV bookkeeping, and LIST
  fallback. A **per-cluster capability probe + a watchdog** downgrades a GVR to
  chunked streaming LIST (`limit=500`, `continue`) if no `initial-events-end`
  bookmark arrives within a timeout (default 10 s). The fallback is tested as a
  first-class path (bookmark-stripped fault injection asserts the GVR still reaches
  readiness). Mitigates the bookmark-stripping-proxy hang (Teleport #64188).
- **Encoding & tiering.** `application/vnd.kubernetes.protobuf` for built-ins
  (~2× smaller wire, ~10× less deser CPU); JSON for CRDs. The kind registry
  declares each kind's **ingest tier**: full-projection (table shows status/spec)
  vs metadata (`PartialObjectMetadata`; table is name/ns/age/labels/owner).
- **Projection at intake (owned).** A registry-driven `cache.TransformFunc`
  projects each object into a flat column tuple — identity
  `{clusterId, group, version, kind, resource, namespace, name, uid, rv, created}`
  plus the kind's registry-declared columns — strips `managedFields` (30–50% of a
  Pod's bytes), and **discards the source object before it lands in any indexer.**
  One generic function parameterized by the kind descriptor, not 30 bespoke
  builders.
- **Per-GVR projection-failure isolation.** Transform runs under recover; a failing
  GVR is skipped and logged **once per session** (per the log-once rule) and its
  readiness flips to `degraded` rather than wedging the cluster's clock.
- **Registry-enforced projection conformance.** A conformance test asserts a kind's
  declared table columns ⊇ the columns its registered query reads — projection gaps
  fail the build loudly, not as silent blank cells at runtime.
- **Budget.** [estimate — not measured] Full Pod typed object ≈ 5–15 KB (varies
  widely with `managedFields`/annotations); projected interned tuple ≈
  **150–400 B/row**; 1M projected rows ≈ 0.3–0.5 GB resident vs 5–15 GB of full
  typed objects. These are order-of-magnitude engineering estimates to confirm with
  `pprof`/`unsafe.Sizeof` on representative objects, not measurements.

### 3.2 Unified delta log + canonical store + index

- **The log.** Per cluster, one append-only, ring-retained, LSN-stamped log. The
  reflector's delta handler does one thing: project, then `Append`. `Append` is the
  **single object writer**: assigns `lsn = atomic++`, coalesces per-UID into the
  pending materialization batch (a hot object flipping 1000×/s costs one row write),
  and records the delta in the resume ring. The store materializer and the wire
  fan-out are both downstream consumers reading by LSN — "materialized index" and
  "delta stream" are the same thing observed at two points. Maps onto the existing
  resume-by-sequence + ring + RESET-on-overflow plumbing
  (`streammux/handler.go`), so it is an evolution, not a rewrite.
- **Columnar store (owned #1).** Per `(cluster, gvr)`, structure-of-arrays indexed
  by a dense recycled `rowId uint32` arena. High-cardinality repeated columns
  (namespace, node, image, owner, phase) are dictionary-interned to `uint32` ids;
  only per-object-unique `name` stays in an arena. Dense `uint32`/`int64` slices
  have **zero pointers** for the GC to chase — the real GC win at 1M vs the current
  pointer-rich `map[string]Summary`. Numeric sort columns use the existing
  order-preserving float-bits encoding so one byte representation serves both the
  index key and the cursor. **Metric columns (cpu, mem, …) are a separate column
  family in this same arena, on their own clock — see §3.6.**
- **Order-statistics index (owned #2).** For each registry-declared sortable
  `(kind, sortColumn)`, an order-statistics b-tree over `(sortValue, uid)`
  row-ids — `google/btree` **forked to carry a `size int` per node maintained
  through insert/delete/rebalance**. Gives both `AscendGreaterOrEqual(cursor)` →
  O(log N + page) keyset paging *and* `Rank(key)`/`At(ordinal)` → O(log N)
  absolute-rank answers (so delivery can decide "did this row cross the window
  edge?" in O(log N) without a full IVM engine). **Exact facet counters**
  (per-kind, per-namespace, per-(kind,namespace), ±1 per delta) read O(1) at any
  N — kills the 100k exactness cliff. (Metric-sort indexes use the same b-tree
  machinery but are maintained by the metrics materializer on metricsRevision —
  §3.6.)
- **MVCC via COW snapshots.** [ext] `google/btree`'s `Clone` is a *lazy
  copy-on-write* clone — it marks the shared root read-only (near-O(1) in the common
  case) and copies nodes on first write; reads see no degradation (the library docs
  describe this mechanism but do not literally say "O(1)", and a freelist path can
  iterate nodes). A page query takes a cheap immutable snapshot at the current
  clock; the writer keeps mutating; the page never shifts mid-read. No held
  read-lock, no re-sort.
- **Incremental maintenance (property-test gated).** Per `delta@lsn`:
  `ADD` allocates a row, writes columns, `ix.Insert(newKey)` per index (O(log N)),
  bumps facet counters (O(1)); `UPDATE` does `ix.Delete(old); ix.Insert(new)` only
  on indexes whose key column changed; `DELETE` removes from each index, decrements
  facets, frees the rowId. Per-delta cost is **O(changedIndexes · log N)**, never
  O(N). [fact] This replaces the catalog's per-flush chunk-cache rebuild +
  deferred-sort model (`catalog_index.go:315-339`) and the typed path's full sort
  fallback (`typed_table_query.go:377-379`) with one always-incremental index — the
  typed path's existing bounded collector (`:421-520`) becomes unnecessary because
  the index *is* the keyset.
- **Search.** A trigram inverted index over name/namespace/kind, maintained
  incrementally (true infix). Built lazily on first search per cluster; dropped on
  demote.
- **Disk spill.** Columns are flat SoA → spill is an mmap'd column file per
  `(cluster, gvr)` + dict tables + last LSN/RV per GVR. On demote-to-Cold: flush
  columns, drop in-RAM b-trees (rebuildable from columns), keep a thin handle.
  `mmap` makes warm rows instant via the OS page cache. The SoA *is* the on-disk
  format, so no separate embedded database is needed — and getting cold clusters off
  the Go heap onto OS-reclaimable, file-backed pages is the lever that bounds RAM
  when many large clusters are open (the savings come from projection + interning
  shrinking each row, plus this spill — not from any SQL engine).

Budget **[estimate/target — not measured; to be settled by Prototype #1]**, except
the complexity rows, which are structural:

| Quantity | Budget |
|---|---|
| Resident row (columnar, interned) | ~150–400 B [estimate] |
| Index entry per sort order | ~40–80 B/row; ~2–4 indexes/kind [estimate] |
| 200k pods, foreground, ~3 indexes + facets + trigram | ~150–300 MB [estimate] |
| 1M objects, one cluster, foreground | ~0.6–1.2 GB; Cold ≈ 0 (spilled) [estimate] |
| Per-delta index maintenance | O(log N) per changed index; facets O(1) [structural] |
| Facet / exact total | O(1) counter read [structural] |

### 3.3 Query model

One `Query → Page` engine. Typed tables and Browse are the *same* call differing
only by `WHERE kind=?` vs `WHERE kind IN (…)`.

```go
type Query struct {
    ClusterID  string
    GVRs       []GVR        // [] = catalog/all; one = typed table
    Scope      Scope        // namespaces, node, owner, label selector
    Search     string       // trigram
    Predicates []Predicate  // health=unhealthy, cpu>80%, etc. (metric predicates are metricsRev-owned, §3.6)
    Sort       SortSpec
    Limit      int          // default 250, cap 1000
    Cursor     *Cursor
}
type Cursor struct {
    Snapshot   uint64 // object LSN — the clock (shared by HTTP page AND WS delta)
    Signature  uint64 // hash(clusterId, GVRs, Scope, Sort, Predicates, Search)
    SortValue  []byte // order-preserving comparable (NOT an offset)
    UID        string // unique tiebreak
    MetricsRev uint64 // metric-sorted pages only; advances do NOT invalidate the cursor (§3.6)
}
```

Serving a page: take a COW index snapshot at the current clock,
`Seek((SortValue, UID))` → O(log N), forward-scan applying cheap `matches()` skips
until `limit+1` rows (the +1 is the `hasMore` probe). **No full scan, no full
sort, ever.** Totals/facets from counters. Deleted-anchor resolves natively (the
`>` seek lands on the next-greater key). **Metric sorts are owned by the metrics
clock (§3.6):** the page reads the metric index at the current metricsRevision, and
the cursor's `MetricsRev` advancing does not invalidate it (signature unchanged) —
so an ordinary metrics refresh never bounces the user to page 1. **Lazy
full-object hydration:** detail-open / View-YAML issues one live `GET` by full
object reference, cached in a bounded LRU (≤200 MB); 99% of rows never open detail.

**Budget [target — not measured]:** keyset page (250 rows) 0.2–2 ms at 100k–1M;
faceted page <10 ms at 1M. (Plausible against the measured catalog Browse budget —
`large-data.md`: 100k first page 4.32 ms, 250k 11.45 ms — but that path is a scan,
not a b-tree seek, so these remain targets until Prototype #1.)

### 3.4 Delivery + transport — the one model

Two loopback channels, never the Wails string bridge (string IPC is the documented
OOM/stall path for bulk data). Commands/actions ride Wails bound methods.

- **Pages → loopback h2c HTTP.** Wrap the existing loopback `http.Server` with
  `golang.org/x/net/http2/h2c` so all clusters/views multiplex one connection
  (dodging HTTP/1.1's 6-per-origin cap). Body is **MessagePack**, parsed in a **Web
  Worker**. `ETag = (signature, snapshot clock)` → cheap 304.
- **Deltas → ONE WebSocket, resumable from the log high-water mark.** Optionally
  migrate `gorilla/websocket` → **`coder/websocket`** behind the existing `wsConn`
  interface seam (`handler.go:24`), with `handler_test.go` green *before* touching
  protocol. [fact/ext] The current dep is pinned to an **untagged commit**
  (`go.mod:9`, `v1.5.4-0.2025…`); gorilla was archived in 2022 but **un-archived and
  is maintained again** since 2023, so this migration is a *preference* (coder's
  context-aware API + concurrency-safe writes + binary framing), not a forced move
  off an abandoned library. Frames are length-prefixed **CBOR** (`fxamacker/cbor/v2`,
  `go.mod:56`), `binaryType='arraybuffer'`, transferred into a Worker.

The protocol — the log projected to the subscription's window. **Object columns
ride the object sub-channel (LSN); metric columns ride the metric sub-channel
(metricsRevision) — see §3.6.** Object frames:

```
RESET   {sub, lsn, window:[{posKey, uid, row}...], total, facets}   // baseline
INSERT  {sub, lsn, posKey, uid, row}     // entered the window
UPDATE  {sub, lsn, uid, changedCols}     // in-place, same slot
MOVE    {sub, lsn, uid, posKey}          // sort key moved → ONE fractional key
REMOVE  {sub, lsn, uid}                  // left the window
DOORBELL{sub, lsn}                        // totals/facets moved beyond window; refetch if exact wanted
```

- `posKey` is a base-62 fractional index; a MOVE ships one key. Fractional keys
  rebalance **only on RESET**, never mid-stream.
- Every patch carries `lsn` (same clock as the HTTP cursor). Resume =
  `{resumeFrom: lastLsn}`; the server replays ring entries `> lastLsn` and
  re-derives window patches, with the existing out-of-order guard. If `lastLsn`
  predates the ring's oldest entry, the server sends RESET — today's
  resume-or-RESET semantics over the unified log.
- **Backpressure never thrashes.** Per ~16–33 ms tick, coalesce a subscription's
  deltas to the minimal patch set (`INSERT(k)` then `REMOVE(k)` cancel; multiple
  `UPDATE(k)` collapse). A slow client gets the *latest complete window* resent
  (idempotent because keyed by UID) — never a partial patch after a drop, never the
  current "drop oldest + RESET the whole scope" thrash. Bounded ≤ ~60 patches/s/window.
- **Optional positional fast-path.** For in-window value updates of rows already on
  screen, a per-UID signal patch (`UPDATE`) renders one cell with no refetch. **Hard
  rule, property-test-enforced: it NEVER re-sorts and NEVER changes window
  membership.** Any rank-changing event falls through to the debounced window
  re-query. Strictly subordinate: if it and a refetch disagree, the refetch wins.
  (Metric cell updates on an object-sorted view are exactly this case — §3.6.)

**Budget [estimate/target]:** DOORBELL ~60 B; MOVE ~40–60 B; UPDATE 150–300 B;
RESET/page 250 rows MessagePack gzipped ~50–150 KB. Steady-state wire per window:
**≤ ~30 KB/s regardless of churn** — a target the coalescing bound (≤ ~60
patches/s/window) is designed to hit, not a measurement.

### 3.5 Frontend data model + render

One window (+ small back-nav LRU) per view, keyed
`(clusterId, domain, sortKey, filterHash)`, as the source of truth. **Signal store
(TanStack Store)** — one signal per visible UID; an UPDATE patches one cell, no
list re-render. **Object cells and metric cells are distinct signal families fed by
distinct channels (§3.6), joined by UID into one rendered row.** Deletes
`applyResourceRowUpdates`, `mergeSnapshotRows`, `sortRows`, the per-domain
`collection` descriptors, the shadow-key drift detection, and the global `notify()`
fan-out (replaced by per-`(clusterId,domain,signature)` listener buckets).

- **Quiet filtering (plain JS, no second engine).** On a filter keystroke, the
  window narrows instantly by applying the **identical predicate** in plain JS over
  the already-loaded window while the authoritative refetch is in flight — no flash,
  no spinner, focus never lost. The in-JS predicate is generated from the same
  `Predicate` spec the backend uses, so semantics cannot diverge (only completeness:
  local narrows an ordered window, never reorders).
- **Render.** Keep the existing prefix-sum + binary-search virtualizer (O(visible)).
  UID stable keys (never index); on refetch, anchor scroll by the top-visible UID's
  new slot. Browse and typed tables collapse onto one paginated-query hook.
  Out-of-order guard: tag each fetch with the clock it was issued for; drop a landed
  page if a newer clock was already requested.
- **Budget [estimate/target].** Window 500 rows × ~2 KB + small LRU ≈ single-digit
  MB/view, independent of N; per-flush main-thread cost <1 ms.

### 3.6 Metrics — a separate column family, joined by UID

Metrics (CPU/memory, and any future custom metric) are a different data source on
every axis, so v2 keeps them physically and temporally apart from object state and
joins them only at the row, by UID.

| | Object state | Metrics |
|---|---|---|
| Source | apiserver **watch** (event-driven) | metrics-server/Prometheus **poll** (`metrics.k8s.io` isn't meaningfully watchable) |
| Clock | object `LSN` (from `resourceVersion`, exact) | `metricsRevision` (scrape timestamp + window, best-effort) |
| Cadence/cardinality | **sparse** — only changed objects | **whole-fleet tick** every ~15s |
| Availability | authoritative; the object exists or doesn't | optional/partial — absent, stale, lagging, or never sampled |

**Why split (the current cost). [fact]** Today metrics are baked into the row as
formatted strings — `pods.go:280`/`:294` → `:69` `project(...)`, surfacing as
`PodSummary.CPUUsage`/`MemUsage` (`streamrows.go:318,321`) — the metrics timestamp
is folded into the same snapshot version object changes bump (`pods.go:238-242` →
`snapshotVersionWithDynamicRevision`, `table_window.go:19`), and the projection memo
is keyed `(uid, resourceVersion, metricsRev)` (`pods.go:108-111`). So each ~15 s
poll flips the unified `liveDomainVersion` and re-projects the whole fleet's
*stable* rows just to refresh CPU. v2 removes that coupling.

- **Two writers, two column families, one row.** The object materializer owns the
  object columns (object LSN). A separate **metrics materializer**, fed by the
  existing poller (`metrics/poller.go:153`, `LatestPodUsage()/LatestNodeUsage()`),
  owns a **metrics column family** in the same row arena — same `rowId`/UID,
  separate column slices — stamped with its own **metricsRevision** and a per-row
  sample timestamp + `fresh | stale | unavailable` state. Metric columns are
  nullable: a freshly-scheduled pod has object columns and no metrics yet.
- **The object checksum no longer includes metrics.** `snapshotVersionWithDynamicRevision`
  (`table_window.go:19`) and the `metricsRev` term in the projection-cache key
  (`pods.go:108-111`) are removed. This *strengthens* the anti-churn invariant:
  object refetch only on object change; metric refetch only on metric change. A
  ~15s metrics poll no longer re-projects a single object row.
- **Joined by UID, never by name.** metrics-server keys samples by `namespace/name`
  (`pods.go:64`); the metrics materializer resolves name→UID against the object
  store and writes by `rowId`, dropping samples whose object is gone, so a
  deleted-and-recreated pod (same name, new UID) never inherits stale numbers.
- **Two indexes, two clocks.** Object-sorted views (name/age/status) use object
  indexes advanced by the watch LSN. Metric-sorted views (CPU/mem) use **metric
  indexes maintained by the metrics materializer**, advanced by metricsRevision.
  Same order-statistics b-tree machinery; only the writer and clock differ.
- **Delivery: a metric sub-channel, joined at the client by UID.** The rule that
  keeps it unambiguous:

  > **A column's data source owns its clock, its index, and its delta channel.
  > Sorting or filtering by a column hands the view's refetch trigger to that
  > column's clock.**

  - View sorted by an **object** column: metric updates arrive as per-cell
    `UPDATE{uid, cpu, mem}` patches to the metric signal — no reorder, no
    membership change (the fast-path's "never re-sort" case, exactly).
  - View sorted by a **metric** column (or filtered `cpu>80%`): a metricsRevision
    bump issues a **window-scoped DOORBELL** → a silent refetch of the visible
    ~250 rows from the metric index. The cursor's `MetricsRev` tolerates the
    advance without bouncing to page 1 (§3.3).

  Object deltas and metric deltas never invalidate each other; the client joins
  them by UID into one rendered row.
- **Frontend: two signal families, one table.** A metric cell is a `(uid, 'cpu')`
  signal fed by the metric channel; an object cell is a `(uid, 'status')` signal
  fed by the object channel. One table renders both; two updaters drive them
  independently. A missing/stale sample renders `—` / a staleness affordance,
  **never `0`**, and surfaces the sample age — a metric-sorted table's freshness is
  inherently capped at the scrape interval, so it is shown, not hidden.
- **Governable independently.** Metrics polling can pause on background clusters
  without touching object liveness; a different source (Prometheus, custom metrics)
  slots in behind the metric column family without touching the object path.

---

## End-to-end walkthrough — 200k-pod cluster

This is a **[design]** trace; every millisecond figure is a **[target]** to be
validated by Prototype #1, not a measurement. The *complexity* bounds (O(log N),
bounded ≤251-row scans) are structural.

**Open all-namespaces Pods, sort by CPU desc, filter to namespace `prod`, while
pods churn.** Cluster Foreground; Pod GVR WatchList-ingested; a separate metrics
poller feeds `ix_cpu` (an order-statistics b-tree over `(cpuKey, uid)` maintained
by the metrics materializer on `metricsRevision`, §3.6) + exact per-namespace facet
counters; object log clock at LSN L0, metrics at metricsRevision M0.

- **T0 — first paint.** `GET /api/v2/query?cluster=C&kind=Pod&sort=cpu&dir=desc&limit=250`
  over h2c; subscribe scope `pods` on the WS. Backend COW-snapshots `ix_cpu` at the
  current metricsRevision M0, seeks the high-CPU end, range-scans 251 row-ids, joins
  object + metric columns by rowId, projects 250: **O(log 200k + 250) ≈ sub-2 ms.**
  Facets/total from counters — exact, no cliff. MessagePack body parsed in a Worker,
  rendered through the virtualizer (~30 rows in DOM). **First useful paint < 80 ms
  p50**, dominated by loopback RTT + Worker decode, not any scan of 200k rows. WS
  replies RESET with fractional posKeys for the window.
- **T1 — filter to `prod`.** Re-issue with `Scope.Namespaces=[prod]`; signature
  changes → cursor invalidated, page resets. Same `ix_cpu` seek + inline
  `namespace='prod'` skip; exact `count(*)` for "of M" from the `(kind,prod)`
  counter. The loaded window is narrowed instantly in JS by the identical predicate
  while the refetch flies — no flash, no spinner.
- **T2 — paginate.** Cursor `(cpuKey_231, uid)`. Backend snapshots `ix_cpu` at the
  *current* metricsRevision, `AscendLessThan((cpuKey_231, uid))`, take 251. O(log N
  + 250) ≈ 2 ms, independent of page depth. Deleted anchors are skipped. No offset,
  no drift, no duplicate.
- **T3 — live churn, two clocks.** Object deltas (a pod scheduled, killed, status
  change) flow on the **object channel** at LSN; metric ticks flow on the **metric
  channel** at metricsRevision — independently. Because this view is **CPU-sorted**,
  order is owned by the metrics clock: on each ~15s metricsRevision bump, the
  metrics materializer updates `ix_cpu` (O(log N)/changed row) and the `pods:prod`
  subscription gets a window-scoped **DOORBELL** → a silent refetch of the visible
  250 rows. A pod whose CPU rises into the visible top-250 appears; one that drops
  out leaves — all via the bounded window refetch, never a 200k re-sort. Meanwhile
  an *object* change to a visible pod (e.g. it goes `CrashLoopBackOff`) is a per-cell
  object `UPDATE{uid,status}` with no reorder. (Had the view been **name-sorted**
  instead, the same CPU tick would be a per-cell metric `UPDATE{uid,cpu}` with no
  refetch at all — §3.6.) A filtered-out `team-y` pod churning → no patch. A
  5k-pod storm coalesces to one window patch; a lagging client gets the latest
  complete window resent. Wire ≤ ~30 KB/s.
- **T4 — cursor stability.** Every page reads a COW snapshot at its clock,
  internally consistent under concurrent writes. The cursor is a *value*
  `(cpuKey, uid)`, not an offset, so churn elsewhere never shifts the page; the
  window never blanks — because one clock (here metricsRevision) and one
  value-keyed total order govern the HTTP page, the WS deltas, and the cursor alike
  for this view.

Net: first paint, every pagination, and every live refresh are index-served
bounded scans over ≤251 rows. Nothing — backend or frontend — ever sorts, scans,
or holds 200k rows, and a metrics tick never re-projects or re-ships object state.

---

## Multi-cluster, cold start & persistence

**Lifecycle state machine + single process-wide governor.**

```
Connecting → Warm(Foreground) ⇄ Warm(Background) → Cold(Spilled) → Disconnected
```

- **Foreground (≤1):** full-projection WatchList for visible GVRs; metrics poller
  active; b-trees + trigram resident; active WS subscription.
- **Background (≤3 MRU):** metadata-tier WatchList only for the keep-warm set the
  user touched; **metrics polling paused** (object liveness untouched — §3.6);
  b-trees resident, trigram dropped. Refocus instant; counts live at ~1–2 KB/object.
- **Cold:** reflectors + metrics poller torn down (heap reclaimed), columns spilled
  to mmap'd disk with last LSN/RV per GVR. Re-warm resumes WatchList from the stored
  RV — a delta reconcile, not a full re-LIST.
- **Disconnected:** full teardown; DB optionally retained.

The governor: **weighted priority lanes** via `golang.org/x/sync/semaphore`
(interactive ≫ background-keepwarm ≫ discovery) so background discovery can never
starve a foreground click; **`GOMEMLIMIT` triggers the decision; eviction does the
freeing** (`debug.SetMemoryLimit` sized from host RAM with webview headroom; at
>80%, evict the LRU background cluster Warm→Cold). The columnar store is off the GC
pointer-chase path, so cold clusters cost ~0 RAM (mmap, OS-reclaimable). Per-cluster
log/columns/LSN/metricsRevision/spill/discovery-cache/SSRR-cache/cursor/
frontend-store-key make cross-cluster bleed structurally hard.

**Cold start — four-stage contract:**

1. **Discovery:** aggregated discovery (`apidiscovery.k8s.io/v2`, one round-trip),
   disk-cached + ETag → 304 on reconnect. Replaces the `ServerPreferredResources`
   fan-out.
2. **Warm-paint from disk BEFORE any network call:** if spilled columns exist,
   `mmap` and paint immediately, rows marked **"reconciling"**, in **< 250 ms**.
   (Metric columns repaint as `stale` until the first poll lands.)
3. **WatchList from persisted RV → delta reconcile:** warm path streams only deltas
   since the stored RV → `initial-events-end` → clear "reconciling." Cold path
   (RV="") streams every object as `ADDED`, rendered incrementally (first rows < 1 s
   on 1M); readiness fires **per-GVR** at the bookmark — first paint depends only on
   the active view's GVRs, not all ~30 kinds.
4. **410-Gone reconcile-delete (kills zombie rows):** if the stored RV is too old,
   re-WatchList from RV="" and emit deletes for UIDs absent from the fresh consistent
   snapshot.

**RBAC cold-start. [fact]** This is *already largely how it works* — the live
`QueryPermissions` gate (`app_permissions.go:107`) resolves checks against cached
`SelfSubjectRulesReview` rules with a batched SSAR fallback. v2 keeps SSRR-first as
the primary (one SSRR per `(cluster, namespace)`, evaluated client-side per row,
cached), SSAR only for the residue (cluster-scoped, `resourceName`-specific, or
`SSRR.Incomplete==true`). The remaining v2 work is narrower than a rewrite:
**converting the still-per-object SSAR callers** — `objectcatalog/sync.go:40,86`
and `resource_permission.go:70` (each calls `service.go:125` `Evaluate` one check
at a time) — onto the same SSRR-cached path, so no surface does O(rows×actions)
SSAR. SSRR/SSAR gate *buttons*, never enforce — the apiserver re-authorizes the
real call.

---

## Cross-cutting — riding the same spine

- **Permissions:** SSRR-first; action availability computed against the cached rule
  set as the window is delivered — no per-row round-trip.
- **Metrics:** a separate column family on its own clock/channel, joined by UID
  (§3.6) — the one deliberate two-source split.
- **Object detail / YAML:** lazy full-object GET on open, bounded LRU; the
  conformance test guarantees no silent blank cells from projection gaps.
- **Actions (scale/restart/delete/drain):** Wails bound-method RPC, authorized at
  click-time against cached SSRR rules. On success the resulting watch delta flows
  through the log → DOORBELL/UPDATE → the table reflects it via the same delivery
  path. No special action-result plumbing.
- **Object-graph:** owner/node/ref columns are projected and indexed; a graph is a
  set of indexed neighbor lookups (`owner_uid=?`, `node=?`) composed above the
  store. Cross-kind relationships that can't be a single column (RBAC role↔binding —
  the resourcemodel relationship cycle) are resolved by the graph layer querying
  both sides; the store provides indexed lookups, never a scan.
- **Logs / shell / exec / port-forward:** live byte streams, not object state — out
  of the store. They get short-lived subscriptions on the *same* unified WebSocket
  (new frame types), so backpressure/resume/telemetry are one shared stack
  (collapsing the separate SSE event-stream fan-out). Logs resume by byte offset.
- **Events:** [fact] Kubernetes Events become just another GVR in the store. Today
  Events run on a **standard** shared informer (`factory.go:188`, registered like
  the other core informers) feeding a separate SSE event stream
  (`eventstream/manager.go`); v2 folds both into the one store + one delivery model.
  An object's events panel is a query subscription scoped to `involvedObject`.

---

## How this beats the current design

| Current tension | Resolution |
|---|---|
| 3 delivery models for table rows + notify-only on only **3 of 16** streamed domains (`notify_only.go:23`) | One model: page (HTTP) + window delta (WS). `notifyOnly` flag, `applyResourceRowUpdates`, and the 3-place parity tests deleted; "notify-only" is universal and unnamed. |
| Two separate query engines/codecs — typed (full sort `:377-379` + bounded collector `:421-520`) and catalog chunk scan (`query.go:342`, O(N)) | One engine: bounded keyset range scan over a COW order-statistics snapshot: O(log N + page). Totals/facets O(1) counters. |
| metrics packaged into the object row as strings (`pods.go:280`/`294`,`108-111`,`238-242`; `streamrows.go:318,321`; `table_window.go:19`); each ~15 s poll churns the whole-fleet projection + unified version | Metrics are a separate column family on their own `metricsRevision`, joined by UID, delivered on their own channel; an object change never touches metric cells and a metrics tick never re-projects object rows (§3.6). |
| Full ServerMessage (incl. `Row`, `types.go:59`) JSON-serialized per event over the WS (`handler.go:483`) | Rows never cross the Wails string bridge; pages over h2c MessagePack, deltas over CBOR, both Worker-decoded; steady push is window-scoped patches (KB/s). |
| informer-LIST-dominated, all-or-nothing readiness (`factory.go:266`) | WatchList streams incrementally; per-GVR readiness at the bookmark; warm-paint from mmap spill before any network call. **([ext] WatchList is beta — LIST fallback is load-bearing.)** |
| in-memory catalog: per-flush chunk rebuild + deferred sort (`catalog_index.go:315-339`), lost on eviction | Incremental O(log N)/delta; durable mmap spill survives eviction/relaunch; eviction drops the write source, not the data. |
| 100k exact-facet cliff (`query.go:33,167,203`) | Exact at any N via maintained counters. |
| split ordering authority (per-(domain,scope) seq + per-object RV + `liveDomainVersion` checksum) | One clock per data source — object LSN and metricsRevision — each governing its own cursor/resume/dedup/invalidate. |
| per-object SSAR still in `objectcatalog/sync.go`, `resource_permission.go` (`service.go:125`) — though `QueryPermissions` is already SSRR-first (`app_permissions.go:107`) | Convert the remaining SSAR callers onto the existing SSRR-cached path: O(namespaces) + small residue everywhere. |
| gorilla/websocket pinned to an untagged commit (`go.mod:9`) | *Optionally* migrate to `coder/websocket` behind the `wsConn` seam (`handler.go:24`), `handler_test.go` as the gate. (Not abandonment — gorilla is maintained again since 2023.) |

---

## Risks & what to prototype first

1. **The columnar write path at 1M churn is the load-bearing unknown — and there is
   no drop-in SQL fallback, by design (no cgo / no SQLite).** The single-writer
   `Append` + incremental multi-index maintenance is unproven at 1M (the repo's own
   evidence measures only the catalog path; the typed path is unmeasured; the
   persistent store is deferred "until measured"). **Mitigation = a hard go/no-go
   benchmark FIRST:** sustained 1M-object cold reconcile + a 50k-events/s churn
   storm, asserting `Append`+materialize keeps p99 LSN-to-wire latency under one
   frame and the writer never becomes the bound. If it misses, the fallback is *not*
   a different query engine — it is to **degrade the owned engine gracefully**
   (fewer maintained indexes, a bounded re-sort on cold paths, coarser facets) and/or
   back persistence/spill with a **pure-Go embedded store** (`bbolt`/Badger — no cgo,
   no SQL) behind the *identical* `Query → Page` + delta seam, so the wire contract
   and frontend never change. Removing SQLite means this benchmark bar matters more,
   not less — there is no proven engine to hide behind.
2. **Incremental maintenance won't self-heal.** A delete-old/insert-new key-swap bug
   silently corrupts a sort order permanently, unlike a rebuild. **Mitigation:** the
   fuzzed replay-equivalence property test is the *primary* test contract:
   `apply(deltas) == recompute(store)` at every clock.
3. **The forked order-statistics b-tree is owned, correctness-critical code.** A
   Rank/At bug emits ghost rows. **Mitigation:** narrow augmentation (subtree-size
   through rebalance) over an already-vendored library; same property test; the
   fast-path's "never re-sort, never change membership" bounds the blast radius.
4. **Single log = one blast radius.** A poison delta wedging the materializer stalls
   the cluster's clock. **Mitigation:** per-GVR projection-failure isolation (skip +
   log-once); the cheap `Append` never blocks on b-tree maintenance.
5. **WatchList maturity / bookmark-stripping proxies.** **Mitigation:**
   capability-probe + LIST-fallback watchdog as a tested first-class path.
6. **Fractional-index precision exhaustion in a hot window.** **MOOT (2026-06-25):** the
   delivery model was built with KEYSET cursors (opaque continueToken over a (sort-value, UID)
   b-tree keyset — `querypage/store.go`), not fractional posKeys, so there is no fractional
   index to exhaust. The original mitigation (rebalance posKeys only on RESET) is N/A.
7. **mmap spill + 410-reconcile is a net-new stale-data surface.** **Mitigation:**
   stage-4 reconcile-delete contract + a test asserting absent UIDs are deleted.
8. **Trigram search memory** (~3× indexed text): built lazily, dropped on demote.
9. **Metrics↔object join by UID (§3.6).** metrics-server keys by `namespace/name`
   (`pods.go:64`); a deleted-and-recreated pod (same name, new UID) could inherit
   stale numbers, and a metric-sorted view's freshness is capped at the scrape
   interval. **Mitigation:** the metrics materializer resolves name→UID against the
   object store and drops samples whose object is gone; a missing sample renders
   `—`/stale (never `0`) with a visible sample age; a property test asserts a metric
   cell's UID matches its object row's UID.
   - ✅ **Mitigation implemented on the current overlay path (2026-06-25).** The
     poller now stamps each `PodUsage`/`NodeUsage` with metrics-server's per-sample
     `Timestamp` (poller.go). The pod/node serve-time overlay (`overlayPodMetrics`/
     `projectPod`/`reaggregateNodeSummary`) drops a sample that is absent OR predates
     the object row's creation (`AgeTimestamp`) — metrics-server exposes no UID, so the
     sample-timestamp-vs-creationTimestamp comparison is the sound name→UID proxy.
     A dropped/missing sample renders `streamrows.MetricsNoData` (`"-"`, the frontend's
     existing resource no-data sentinel — NOT the literal `—`, which the frontend's
     resource-bar parsers don't recognise), never `"0m"`/`"0Mi"`. The visible sample
     age/stale signal is the existing `PodMetricsInfo`/`NodeMetricsInfo`
     `CollectedAt`+`Stale` (unchanged). Property test:
     `TestOverlayPodMetricsDropsStaleSampleFromPriorIncarnation` (pods_test.go) asserts a
     recreated same-name pod does not inherit the deleted pod's numbers until a fresh
     sample arrives. Limit (accepted by this risk): freshness capped at the scrape
     interval; per-pod `NodePodMetric` entries (no per-pod creation on `PodAggregate`)
     drop only on a MISSING sample. The full UID-keyed metric column family (§3.6,
     lines 805-827) remains the future columnar-store design.

**Prototype-first order (de-risk):**

1. [x] **Write-path benchmark gate (risk #1) — FIRST RESULT GREEN (2026-06-21).**
   `backend/refresh/storebench/` (isolated package; not wired into prod) implements a
   minimal-but-faithful columnar write path (interned SoA columns + `google/btree`
   sorted index + facet counters) and a naive full-sort baseline. Measured (Apple M-series):
   - **Upsert under churn (one sort key changing): 539–645 ns/op @ 100k, 692–716 ns/op @ 1M,
     0 allocs** — O(log N), ~1.5–1.85M events/s single-threaded (~30× the 50k/s target).
   - **Multi-index fan-out (2 indexes updated per event): 1.17 µs @ 100k, 1.73 µs @ 1M, ~0 allocs**
     — ~linear per index (~+0.5–1 µs/index), so a realistic ~5-index/facet kind is ~4 µs/event
     ≈ ~230k events/s at 1M (~4.6× the target). Multi-index Append is NOT the bottleneck.
   - **Keyset page read (TopByCPU 250): 3.9 µs @ 100k, 3.5 µs @ 1M** vs naive full-sort
     **20 ms / 270 ms** — microseconds, near-flat to 1M.
   - Property test (`apply(deltas) == recompute`) passes.
   - **Concurrency (RWMutex, µs criticals): bounded-page reads stay correct (`-race`
     clean, no torn reads — 3 writers churning + deletes/recycling, 4 readers) and fast
     under a full-speed concurrent writer: 6.0 µs @ 100k / 6.4 µs @ 1M (vs 3.5 µs
     uncontended — ~1.8×, still microseconds).** So pagination needs NO complex MVCC —
     brief RLock/Lock criticals suffice.
   - **Trigram substring search (filter-as-you-type): correct (== linear scan) and
     sub-millisecond at 1M — 38 µs (common, page-capped) / 91 µs (multi-trigram word) /
     555 µs (worst case: a selective query whose individual trigrams are each common).**
     All well under a 16 ms frame. The 555 µs is the naive map-of-sets paying
     `|smallest posting| × |trigrams|`; a roaring-bitmap AND cuts it to µs. Rename
     maintenance: 3–5 µs/event. CAVEAT: uncompressed map-of-sets postings are
     memory-heavy — the production index MUST use compressed bitmaps (roaring) for memory.
     Latency is proven; the memory representation is the remaining engineering choice.
   - **Memory footprint: 74 bytes/object at 1M → ~74 MB per 1M-object cluster (~54 such
     clusters in a 4 GB budget).** Projection + interning + SoA deliver the compact in-RAM
     store the plan bet on (NOT SQLite). A full kind (more columns + ~5 indexes) is higher,
     but even ~300 bytes/object → ~13 clusters in 4 GB.
   NOT YET MEASURED (both now shown LOW-priority): persistence/mmap spill — the 74 B/object
   footprint makes it a backstop for extreme many-cluster cases, not the common path; and
   lock-free LONG reads (export / cursor-walk-all) — niche (export-only), needing column
   MVCC (the one genuinely hard remaining problem). The owned-engine bet is comprehensively
   GREEN across write, read, concurrency, search, AND memory — a clear GO on building the
   real engine. (Fallback if a later stage misses: degrade the engine and/or a pure-Go
   `bbolt`/Badger spill — never cgo/SQL.)
2. [ ] **Property test harness (risks #2, #3, #9)** — fuzzed replay-equivalence gate
   against whichever engine wins #1, including the metric/object UID-join invariant.
3. [ ] **WatchList watchdog + LIST fallback (risk #5)** with bookmark-strip fault
   injection.

---

## Migration phases — value early, no big-bang

**This is the authoritative "what's left" roadmap.** The ledger at the top is the
short summary; this section is the full list with per-item status.

Status legend: ✅ done · 🔶 in progress · ⏳ not started · ❌ dropped (with reason).
Phases are **not strictly sequential** in practice: we shipped Phase 1, then
Prototype #1, then went straight into Phase 3 (the engine); Phase 2 was dropped as
incremental work. **We are currently mid-Phase-3.** Each item is gated by
`mage qc:prerelease` and leaves the app correct and faster than before.

### Phase 0 — Seam-preserving plumbing — ✅ no required work outstanding

Phase 0 items are **independent optional plumbing, not prerequisites** for Phases 1/3 — which
is why they sit untouched while later phases progressed (the "Phase 0" number overstated their
priority). On re-evaluation (2026-06-21) all three remaining items are dropped or deferred with
reasons; **nothing required is incomplete here.**

- ❌ **h2c on the loopback server — DROPPED.** The refresh server is consumed by the webview's
  **browser `fetch`** (`client.ts:190`); browsers only negotiate HTTP/2 over TLS+ALPN and do not
  do HTTP/2 cleartext, so the multiplexing benefit can't reach this client.
- 🔻 **MessagePack + Web Worker decode — DEFERRED (low value now).** Pages are bounded at ≤1000
  rows (`typed_table_query.go:18`), so a page is small and `JSON.parse` is sub-millisecond; Worker
  offload is marginal. It would have mattered for the old full-row snapshots, which the
  notify-only/query-backed migration already eliminated. Revisit only if a page payload grows large.
- 🔻 **`gorilla/websocket` → `coder/websocket` — DEFERRED (optional).** Gated on wanting binary
  framing for a delta protocol that doesn't exist yet; gorilla is maintained again.
- ❌ **SSAR→SSRR cleanup — DROPPED (2026-06-21).** The remaining callers are legitimately NOT
  SSRR-expressible — `objectcatalog/sync.go:40,86` does cluster-wide `list` checks (no namespace)
  and `resource_permission.go:70` does resourceName+subresource checks; SSRR is namespace-rule scoped.

### Phase 1 — Universalize notify-only (delete the live-row path) — ✅ DONE

- ✅ "page + signal" is the only **delivery** model for ALL 16 streamed domains. helm's frontend is
  now signal-only too (a complete-resync signal bumps streamRevision → refetch, exactly like the 15);
  only helm's *backend stream semantics* stay `complete-resync-stream` (it ships a resync signal, not
  row deltas — its rows are scope-level *synthesized* HelmReleases). That's a backend detail, not a
  delivery-model difference: no domain renders live stream rows anymore.
- ✅ Live-row path **fully deleted**: `applyRowUpdates`/`applyShadowUpdates`/`applyResourceRowUpdates`,
  `applySnapshot`, `mergeSnapshotRows`, `sortRows`, all 16 per-domain `collection`s, the shadow-key
  drift detection, and the resync-fetch error path — gone, plus the whole `resourceStreamRows.ts`
  module. (helm joined the bump-only resync path, which made the rest unreachable; tsc-guided cascade.)
- ✅ Backend row-omission is now **universal** — `newObjectRowUpdate` never ships a row; the
  `notifyOnlyStreamDomains` flag, `isNotifyOnlyStreamDomain`, the parity test, and the contract
  `notifyOnly` field are deleted. (`behaviorClass`/`coverageContract` untouched.)
- ✅ Outcome: the measured ~26 ms@50k-per-flush merge+sort is gone for every streamed table; verified
  green — full backend `go test`, frontend tsc clean, vitest 391 files / 3234 passed.

### Phase 2 — The LSN clock + the metrics split — ❌ DROPPED as incremental work

- ❌ **LSN clock** — the four ordering signals (per-(domain,scope) seq, per-object RV,
  `liveDomainVersion`, snapshot `Sequence`) live in four layers; unifying them is a from-scratch
  restructure, not a tweak. Lands (if at all) WITH the engine, not before.
- ❌ **Metrics-signal decouple** — no pre-store value: `liveDomainVersion`'s only consumer is the
  query-backed refetch, which must refetch on a metrics change anyway. Folds into Phase 3's metrics
  column family. (The pods projection-cache split — keying on `(uid, RV)` so a metrics poll doesn't
  re-project the fleet — WAS done earlier as a safe standalone slice.)

### Phase 3 — The store, behind the `Query → Page` seam — ✅ DONE (2026-06-22)

- ✅ **Prototype #1** (write-path benchmark) — GREEN, GO. (Detail in the prototype list above / §Risks #1.)
- ✅ **The engine** — `backend/refresh/querypage/`: unified cursor ✅; generic schema-driven `Store[R]`
  Query→Page (per-direction keyset indexes, facets, filters, search, pagination) ✅; **backward/prev-page
  pagination** ✅; benchmarked @1M ✅; **Prototype #2 fuzz ✅**. **Columnar SoA backend LIVE** (`columnar.go`):
  a reflect-built `rowCodec[R]` interns string columns → uint32 dict ids, packs numeric/bool columns
  (zero-pointer), and stores exotic fields (maps/slices/pointers) via an exact deep-copy fallback so
  `Decode(Encode(R))==R`; recycled-rowId arena; adaptive promotion drops the dict for ≥90%-unique columns; a
  by-rowId match cache answers filter/search/facet/total with NO row reconstruction (only the returned page is
  rebuilt). **Property-test gated airtight** — the fuzz, backward test, ALL 16 typed-domain equivalence tests,
  and the catalog all pass UNCHANGED through it. **MEASURED MEMORY WIN: modest — 241 vs 275 B/row (~12%)**, NOT
  the dramatic figure the budget implied, because the big win (storing the projected Summary, not the raw
  object) was already achieved by projection; the columnar adds interning + is the on-disk SoA format that
  enables Phase 4 mmap spill.
- ✅ **Typed tables cut over to the one engine — COMPLETE (16/16 domains).** Every typed-table domain serves
  via `resolveTypedSnapshotPageViaStore`, each equivalence-gated byte-identical to the live executor: config,
  namespace-{storage, quotas, rbac, autoscaling, network, workloads, events, helm}, cluster-{config, storage,
  rbac, events, crds}, nodes, pods. The engine handles query **predicates** (`applyTypedTableQueryViaStore`
  builds the store from the matched set). The bespoke **`typedTableQueryCollector` + the old non-engine
  `resolveTypedSnapshotPage` are DELETED**; `applyTypedTableQuery` remains only as the equivalence-test oracle.
- ✅ **Browse/object-catalog cut over to the engine — COMPLETE.** `objectcatalog.Service.Query` serves from a
  maintained `querypage.Store[Summary]` (fed incrementally via `setItem`/`deleteItem`), using the new backward
  (prev-page) keyset pagination (`querypage.Store` returns `PrevCursor` + walks `DescendLessOrEqual`;
  TDD-gated; forward path byte-unchanged — Browse has explicit Prev/Next buttons). The bespoke **catalog
  chunk-scan executor + the catalog cursor codec (`catalogQueryCursor`/`encode|decodeCatalogQueryCursor`) +
  the lazy query index are DELETED** (~770 lines). Kind filter → `kindidentity` facet, CustomOnly → `custom`
  facet, age-flip + composite default sort in the schema, two-scan UnfilteredTotal + 100k approximate
  threshold preserved. **This was partly pre-existing in the working tree (a half-finished `queryViaEngine`
  path, 2 tests broken) — now finished**: fixed a real namespace-facet divergence, completed + deleted the
  dead path. CAVEAT: the old chunk path was already bypassed before completion, so correctness rests on the
  existing catalog behavior tests (which caught the facet bug) + a pagination-completeness test, NOT a full
  new-vs-old matrix. Gate green (`mage qc:prerelease` exit 0). **The "one query engine" goal is now met:
  every typed table AND Browse serve through `querypage`; both old cursor codecs + the collector are gone.**
- ✅ **Metrics as a separate column (§3.6).** Realized for `pods`: the maintained pod store holds row data
  with CPU/Mem ZEROED (informer-fed); fresh metrics are overlaid at serve from `LatestPodUsage()`, so a metrics
  poll never touches the store. (nodes carries its metrics in the per-Build rows — fine at node scale.)
- ✅ **Direct persistent-store querying** — the 8 maintained typed domains (config, namespace-{storage,
  quotas,rbac,autoscaling}, cluster-{config,storage,rbac}) now query their persistent store DIRECTLY
  (`store.Query` page = O(log N+page); `store.Scope` counts facets/totals over the by-rowId match cache with
  NO reconstruction) instead of `Snapshot()`+rebuild — byte-identical (all 8 `…MatchesListPath` gates pass
  unchanged). **DEFERRED (explicitly conditional, not blocking Phase 3):** pods' own direct query (its
  metric-sorts need fresh-metric ordering + the serve overlay — a targeted future opt), and metric indexes on
  `metricsRevision` ("if/when metric-sorted pods need sub-O(N)" — profile-driven).

### Phase 4 — Ingestion to WatchList + projection + spill — ✅ DONE (2026-06-25; the deferred refinements — project-to-column-tuple + the Cold-serving mmap tier — all landed, gate-green)

- ✅ **Per-cluster maintained store — LIVE for config.** `namespace-config` now serves Build from an
  informer-fed `configMaintainedStore` (generic `ingest`/`evict` via the descriptor's `StreamRow`/`Kind`,
  tombstone unwrap, max-resourceVersion tracking, per-request availability filter) instead of
  list+re-project. Handlers registered in `RegisterNamespaceConfigDomain` before factory start (sync gate
  guarantees populated-before-serve); `clusterMeta` threaded from `registrations.go`. PROVEN: rows
  `ElementsMatch` the list path, AND the full Build payload is **byte-identical** to the list-path Build
  across window/query/filter/search scopes (`TestNamespaceConfigBuilderMaintainedMatchesListPath`); rests
  on the fuzz-proven engine. Gate green (backend + tsc + vitest 3234 + knip + trivy).
- ✅ **Machinery genericized** (`querypage_typed.go`): `typedMaintainedStore[T]`,
  `applyTypedTableQueryViaStore[T]`, `resolveTypedSnapshotPageViaStore[T]`, `querypageSchemaFromAdapter[T]`
  — config slimmed to a 14-line schema wrapper; each domain is a thin adapter.
- ✅ **Applied to 8 typed domains** (2026-06-22) — **live on the maintained store + engine cutover:**
  config, namespace-{storage, quotas, rbac, autoscaling}, cluster-{config, storage, rbac}. Each behind
  its own equivalence gate (maintained `rows` == list path; Build payload byte-identical). The
  handler-registration loop is now ONE generic helper `registerMaintainedHandlers[T]` that handles both
  `Informer` and Gateway-API `GatewayInformer` — which de-duped the 8 loops AND let cluster-config
  (GatewayClass) join. Fixed a generic `evict` bug (delete key via `adapter.Key`, so namespaced+cluster
  -scoped both delete right). Gate green (`mage qc:prerelease` EXIT 0: race tests, vitest 3234, knip, trivy).
  **ALL maintained-store conversions DONE (2026-06-25).** `namespace-network` ✅ DONE — Service/Ingress/EndpointSlice/
  NetworkPolicy Sinks → one `typedMaintainedStore[NetworkSummary]`; the EndpointSlice relationship (a Service row's
  endpoint counts) stays a SERVE-time cross-kind join (`namespaceEndpointSliceReadyCounts` + `reaggregateServiceSummary`),
  proven by `TestNamespaceNetworkMaintainedEndpointJoinFromStore`; the cut-kind PULL fallback was removed. `namespace-workloads` ✅ DONE (2026-06-25) — converted
  to one `typedMaintainedStore[WorkloadSummary]` fed by all five workload GVRs' Table-half Sinks (Deployment/
  StatefulSet/DaemonSet/Job/CronJob; the Sink type-guards on WorkloadSummary so one store holds all five). The
  synthesized standalone-pod rows + the pod-aggregate/metrics/HPA overlay stay SERVE-time cross-kind joins
  (reaggregateWorkloadSummary + the standalone synthesis in assembleWorkloadRows, read from the pod ingest source
  + HPA lister + metrics provider); the lazy recompute (`recomputeWorkloadsStore`/`ensureWorkloadsStoreFresh`) and
  `namespaceWorkloadOwnRows` were removed, and the now-orphaned `typedMaintainedStore.Replace` with them. ONE serve
  path for all scopes; all-namespaces reads no pods (namespacePodRowsFromIngest("") empty), preserving the overview
  behavior. `nodes` ✅ DONE (2026-06-25) — converted to a `typedMaintainedStore[NodeSummary]` fed by the NodeGVR
  Table-half Sink (mirrors pods; `nodeOwnRowsFromIngest` removed). `cluster-crds` ✅ and `namespace-helm` ✅ are ALSO
  already maintained stores (`cluster_crds.go:87` apiext-CRD-informer-fed; `namespace_helm.go:129` helm-storage-Secret-
  handler-fed — helm intentionally not spilled). So EVERY built-in domain now serves from a maintained store; none
  list+project per Build. (Browse/catalog is DONE — its own maintained `querypage.Store` + direct `store.Query`.)
  ✅ **project-to-column-tuple DONE (2026-06-25).** The earlier "BLOCKED, needs a large per-adapter rewrite" verdict
  was WRONG. The maintained-store delete does NOT need the Table row — it needs `adapter.Key`, which is reconstructable
  from the RETAINED Catalog half. A single generic `keyFromCatalog(summary)` (`static_table_query.go`:
  cluster-scoped → `clusterTableKey(Kind, Name)`, else `namespacedTableKey(Kind, Namespace, Name)`) equals
  `adapter.Key(tableRow)` for ALL 27 ingest-fed maintained-store kinds — PROVEN by
  `TestKeyFromCatalogMatchesAdapterKeyForEveryMaintainedKind` (no mismatch; helm/events are not ingest-owned, so not in
  scope). So: (1) the maintained-store feed is now a whole-`ingest.BundleSink` (`maintainedStoreSink` UpsertBundle by
  Table half, DeleteBundle by `keyFromCatalog(Catalog half)`), wired via `AddBundleSink` in the 9 descriptor domains +
  nodes/workloads/network; (2) `ProjectingStore` gained `retainTable bool` (default FALSE) — on Add/Update/Replace it
  fans the FULL projected value to sinks FIRST, then stores a Table-nilled copy (Catalog/ObjectMap/Aggregate retained);
  (3) pods set `retainTable=TRUE` (the only `RegisterReflector(..., true)` call) because `pod_aggregate_source.go:61`
  and `ingest_notify_pods.go:51,83` read the STORED Table half. `trackerWorkloadSink` (a second Table-half-Sink
  delete consumer) was converted to a BundleSink keyed off the Catalog half too. Verified: incremental Delete AND
  relist Replace-delete evict with no ghost (`TestMaintainedStoreNoGhostOnDeleteWithTableHalfDropped`); spill/re-warm
  with nil Table halves round-trips (the Catalog half survives; gob type registration reads the fresh example, not
  stored rows); `IngestManager.TableRows` has no non-test consumer so no serve path breaks. Full
  `go test ./backend/refresh/ingest ./backend/refresh/snapshot -race` green; staticcheck + gofmt clean.
- ✅ **Ingestion cutover (DONE 2026-06-25 — project-to-column-tuple landed; see the Tier-2.6 ledger note).** ✅ **Projection-at-intake on EVERY ingestion path** (`informer/projection.go`
  `StripManagedFields`): `WithTransform` on the core + apiext + gateway factories AND `SetTransform` on the
  catalog's dynamic-CRD informers — discards `managedFields` (30-50% of a Pod's bytes) before any object
  enters any cache. The core memory lever; gate green (no table/catalog/maintained-store consumer reads it).
  ✅ **WatchList capability probe + per-GVR sync-deadline watchdog** (`informer/watchlist_probe.go` +
  `factory.go`): probes WatchList at first connect (explicit `SendInitialEvents` watch); if the
  `initial-events-end` bookmark is stripped/absent, disables the `WatchListClient` gate before any factory →
  robust LIST+WATCH (data still arrives behind a Teleport-style stripping proxy); a per-GVR deadline degrades a
  still-unsynced GVR instead of wedging the cluster. Risk #5 closed in production. ✅ **Dynamic-CRD informers
  consolidated onto the ingest path (Tier 1.3, 2026-06-24):** the catalog's on-demand promotion no longer owns a
  `dynamicinformer` — `maybePromote` registers an on-demand dynamic reflector with the ingest manager
  (`RegisterDynamicCatalogReflector`, unstructured LIST+WATCH via the dynamic client, projecting to the same
  `buildSummary` Summary) + a Catalog-half sink, serving from `CatalogRows` once synced. On-demand preserved;
  on-demand entries excluded from the global readiness gate (per-gvr `HasSyncedFor` only); `collectFromInformer`/
  `promotedDescriptor`/`s.promoted` deleted. The CRD-definition watch already rode the shared apiext factory
  (`watch.go`) — unchanged. Byte-equivalence + readiness-isolation gated, full backend `-race` + prerelease green.
  ✅ **gateway-factory transform DONE** — the production Gateway-API factory is built with
  `WithTransform(StripManagedFields)` (`cluster_clients.go:358`), so projection-at-intake covers EVERY ingestion path.
  ✅ **project-to-column-tuple DONE (2026-06-25)** — the ingest stores no longer retain the redundant typed Table half
  (the columnar maintained store holds it); the maintained-store delete keys off the retained Catalog half via the
  generic `keyFromCatalog`. Pods opt out (retain) because their synthesis/notify paths read the stored Table half.
  See the matching ✅ entry under "Build-on-snapshot serving" above.
- ✅ **Lifecycle + governor + spill (DONE 2026-06-25 — mmap column format + Cold-serving tier landed).** ✅ **Process-wide governor** (`system/governor.go` policy +
  `app_refresh_governor.go` wiring): `SetVisibleCluster` tiers open clusters Foreground/Background/Cold,
  reusing the existing per-cluster build/teardown + pausing the metrics poller for Background; a memory-pressure
  poll (`runtime.MemStats` vs budget) collapses the warm set under pressure; frontend wired; unit-tested.
  ✅ **Disk spill** (`querypage/spill.go`): `Spill`/`RestoreStore` (gob-rows, indexes rebuilt on restore),
  round-trip + query-equivalence gated — the capability the Cold action uses to reclaim+re-warm.
  ✅ **Spill wired into Cold/re-warm (Tier 2.4, 2026-06-24):** `domain.Registry` collects every domain's maintained
  store; `teardownClusterSubsystem` spills them (per-cluster session-scoped cache dir), `rebuildClusterSubsystem`
  restores (warm-paint, before informers feed) then reconciles after the hub syncs. Correct for ALL domains:
  ingest-fed self-reconcile via the reflector's `Replace`; shared-informer-fed drop ghosts via
  `typedMaintainedStore.Reconcile` (added `Store.RestoreFrom`, exported SpillTo/RestoreFrom/Reconcile, per-kind
  reconcile sources); helm intentionally not spilled. Gate-green (`mage qc:prerelease`). ✅ **mmap'd-column on-disk
  format DONE (2.6, 2026-06-25):** `typedMaintainedStore.SpillTo`→`SpillColumns` / `RestoreFrom`→columnar-with-gob-
  fallback, replacing the gob baseline; gate-green. The governor/lifecycle is COMPLETE per its Foreground/Background/
  Cold design. (The only unbuilt item is the optional dual-mode mmap-SERVING tier — see the Tier-2.6 ledger note above:
  store-machinery built, but "~0 RAM while queryable" is inherently contradictory, so it's a design addition beyond
  the Foreground/Background/Cold tiers, not a listed deliverable.)
  **NOTE:** the goals — memory bounded (projection + Cold teardown), resilient ingestion (probe+watchdog) — are
  met + unit-gated; the actual RAM-bounding across many large clusters is a deployment property, real-cluster
  validated, not unit-assertable.

### Prototype gates — status

- ✅ **#1 Write-path benchmark** — GREEN (see above).
- ✅ **#2 Property / replay-equivalence harness** (risk #2) — GREEN: `store_property_test.go` fuzzes
  40 seeds × 800 Upsert/Delete ops (sort-key swaps, key collisions, delete/recreate) × random
  paginated queries, all equal to a from-scratch recompute. (Risks #3/#9 — metrics-join — land with
  the metrics column family.)
- ✅ **#3 WatchList watchdog + LIST fallback** (risk #5) — GREEN: `storebench/watchlist.go` models
  WatchList initial sync (ADDED events + `initial-events-end` bookmark) + a per-GVR watchdog. Bookmark-strip
  fault injection (`watchlist_test.go`, race-tested) proves a GVR ALWAYS reaches readiness with its full
  object set — via WatchList when the bookmark arrives, via the authoritative LIST when it's stripped or the
  watch stalls. Mitigates the Teleport #64188 hang. (Risk #5 closed at the prototype level; the production
  watchdog wires `time.After` for the deadline this models as an injected channel.)

---

## Files this design replaces or rewrites (verify before acting)

- `backend/refresh/resourcestream/notify_only.go` — deleted.
- `backend/refresh/snapshot/typed_table_query.go` + `backend/objectcatalog/query.go`
  — unified into one engine behind the query-store seam.
- `backend/refresh/snapshot/table_window.go` (`snapshotVersionWithDynamicRevision`)
  + `backend/refresh/snapshot/pods.go` projection cache (`pods.go:108-111`) —
  `metricsRev` removed from the object version/checksum and from the projection-cache
  key; metrics move to their own column family / clock / channel (§3.6).
- `backend/refresh/informer/factory.go` (eager factory) + `objectcatalog/collect.go`
  promotion informers + `watch.go` CRD-def handler — one registry-driven WatchList
  projection.
- `backend/objectcatalog` catalog index (per-flush chunk rebuild + deferred sort,
  `catalog_index.go:315-339`) — incremental O(log N) maintenance.
- `backend/refresh/streammux/handler.go` — RESET-thrash → per-window coalescing;
  object + metric sub-channels; *(optionally)* gorilla→coder.
- `backend/capabilities` — keep SSRR-first (`app_permissions.go:107`); convert the
  remaining per-check SSAR callers (`service.go:125` via `objectcatalog/sync.go`,
  `resource_permission.go`).
- `frontend/src/core/refresh` row merge+sort path — deleted; global `notify()` →
  per-signature signals; object + metric signal families.
