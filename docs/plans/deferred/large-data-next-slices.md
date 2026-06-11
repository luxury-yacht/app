# Large-Data Hardening: Next Slices

Status: **Deferred, evidence-triggered.** Track A (single-namespace query
migration) shipped 2026-06-08 and its plan content has been removed — the
durable guidance (liveness contract, table modes, query-chain ownership) lives
in [`docs/architecture/large-data.md`](../../architecture/large-data.md).
Track B (persistent catalog store) remains deferred: the largest cluster tested
to date is under 10k objects, far below its trigger. Keep the existing catalog
store/seam and do nothing on Track B until its trigger is observed.

This plan also tracks the follow-ups that deliberately survived the 2026-06-09
large-table review (the 56-item followup sweep); see
[Review Follow-Ups](#review-follow-ups-2026-06-09).

All work here must preserve the non-negotiable rules from the completed
app-wide table hardening (see
[`docs/architecture/large-data.md`](../../architecture/large-data.md) and
[`docs/frontend/gridtable.md`](../../frontend/gridtable.md)): `clusterId` in
every query/cache/persistence/row/action; concrete object refs carry
clusterId+GVK+namespace+name; query-backed tables never locally
search/filter/sort/count/facet over a page as if it were the full set; partial
tables stay visibly partial; pagination stays honest about exact vs approximate
totals.

## When To Implement — Trigger Thresholds

Track B is not justified by abstract "scale"; it has a concrete object count
below which it adds nothing a user can perceive. Build only when real usage
crosses the trigger. These thresholds are grounded in constants already in the
code; the memory/performance figures are estimates to be confirmed by the B5
benchmarks before any enablement decision.

Reference points in code:

- Catalog total/facet exactness flips to approximate above
  `catalogQueryExactMetadataThreshold = 100000`
  (`backend/objectcatalog/query.go`).
- A catalog `Summary` is ~12 string fields plus optional `ActionFacts`, i.e.
  roughly **0.5–1 KB resident per object**.

### Track B (persistent SQLite store) trigger

| Catalog objects (per cluster, unless noted)                       | Disposition                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **< ~100k**                                                       | Do not build. In-memory is exact and instant; SQLite only adds disk I/O.                                                                                                                                                       |
| **~100k+ in a single query result**                               | First real gain: **correctness**. Above this the app deliberately goes approximate on totals/facets; SQLite restores exact counts and facets on catalog-backed tables (Browse, Custom resources). Hard cliff, not an estimate. |
| **~250k–500k per cluster, or ~100k × several clusters connected** | **Memory + responsiveness.** Resident index ~190–375 MB/cluster; this is where a laptop feels pressure and per-query jank. SQLite serves a page without holding the dataset resident.                                          |
| **~1M+**                                                          | Effectively **required**; resident footprint risks swap/OOM, especially multi-cluster.                                                                                                                                         |

Multi-cluster shifts Track B left: five clusters at 100k each ≈ the resident
footprint of one 500k cluster, so heavy multi-cluster users hit the wall before
single-cluster users do.

### Decision rule

- Default to in-memory. Open Track B only when a user is observed on a
  **100k+**-object cluster (or a multi-cluster session whose combined catalog
  is comparable) _and_ reports Browse/Custom-resource degradation.
- Until then, the `CatalogQueryStore` seam is the paid-for insurance; leave it
  in place and ship nothing new.

## Current State (what already exists)

- The `CatalogQueryStore` interface exists
  (`backend/objectcatalog/query_store.go`) with a single method
  `QueryCatalog(opts QueryOptions) (QueryResult, bool)`. The default in-memory
  store builds its query index lazily on first query (memoized until the next
  publish) and is benchmarked (`backend/objectcatalog/service_benchmark_test.go`).
  `Service.Query` already falls back to the uncached path when a store declines
  (and that path reports `UnfilteredTotal` like the cached one).
- The catalog comparator (`compareSummariesForCatalogQueryWithOptions`,
  `backend/objectcatalog/helpers.go`) is the single ordering authority for page
  sorts and keyset cursors; age sort ascending means newest-first, matching the
  typed tables.

Track B is a net-new store implementation behind a contract that is already
isolated.

---

## Track B: Persistent Catalog Query Store (SQLite)

Goal: catalog queries (Browse, cluster/namespace Custom resources) survive
catalogs larger than the in-memory index can hold, swappable without changing
the `QueryOptions`/`QueryResult` contract or any frontend code.

**Trigger to start:** a user observed on a **100k+**-object cluster (or a
multi-cluster session with comparable combined catalog) reporting Browse/Custom
degradation. Below ~100k objects this delivers nothing perceptible — see
[When To Implement](#when-to-implement--trigger-thresholds).

### B0 — Decision record: backing store and where it lives

- [ ] Confirm SQLite (with WAL) as the backing store, or record the alternative.
- [ ] Decide DB location and lifecycle: one file per `clusterId` under the app
      data directory, created on cluster-add and removed on cluster-remove,
      mirroring the per-cluster catalog service lifecycle in
      `backend/app_object_catalog.go`.
- [ ] Decide the enablement model: config flag / capability that selects the
      store at construction, defaulting to in-memory until B is proven.

Acceptance: a written decision record (in `docs/architecture/large-data.md` on
completion) covering store choice, file lifecycle, and rollout gating.

### B1 — Schema and index design that reproduces the in-memory order EXACTLY

The cursor is portable only if the SQL order is byte-for-byte identical to the
in-memory comparator. The catalog's default order is `compareCatalogIdentity`
(`backend/objectcatalog/helpers.go`): kind, namespace, name, group, version,
resource, uid — all ascending, Go string `<` (UTF-8 byte order). Explicit sort
fields are kind/namespace/name/age with the identity chain as the ascending
keyset tiebreak; note the age field's direction flip (ascending = newest first).

- [ ] Define the table schema for `Summary` (identity columns + sort columns +
      search-text + facet columns), storing the creation timestamp as an
      integer for `age` sort.
- [ ] Use `COLLATE BINARY` (SQLite default) so SQL ordering matches Go's
      byte-wise string comparison; add covering indexes for each supported sort
      tuple so keyset `WHERE (tuple) > (cursor)` is index-driven.
- [ ] Add a cross-store conformance test: the same `QueryOptions` against the
      in-memory store and the SQLite store must return identical row order,
      cursors, totals, exactness, and facets across multiple pages.

Acceptance: a portable cursor minted by one store is honored by the other; the
conformance test passes for default sort and every explicit sort field, asc and
desc, including the desc-on-default case fixed in the review.

### B2 — Query execution: filter, search, sort, keyset page, facets, exactness

- [ ] Translate kind/namespace matchers, search, and predicate filters to SQL
      that matches the in-memory matchers (`newKindMatcher`,
      `newNamespaceMatcher`, `newSearchMatcher`).
- [ ] Implement keyset pagination via row-value comparison on the sort tuple
      (no OFFSET); preserve `Continue`/`CursorInvalid` semantics — including
      the empty-previous-page → `cursorInvalid` reset.
- [ ] Implement kind/namespace facet counts (`GROUP BY`) and total count with
      the same 100k exactness threshold that flips both `TotalIsExact` and
      `FacetsExact` together (`backend/objectcatalog/query.go`); include
      `UnfilteredTotal` (the "of M" in the filter banner).
- [ ] Return `(QueryResult, false)` to defer to the fallback only when the store
      genuinely has no data, matching the in-memory store's contract.

Acceptance: the store passes the existing `query_test.go` contract suite (run
against the SQLite store) with no contract changes.

### B3 — Write path and concurrency

- [ ] Implement upsert/delete from catalog index updates (add/remove/replace
      summaries) as batched transactions; single-writer with WAL for concurrent
      reads.
- [ ] Ensure query reads see a consistent snapshot (no torn reads mid-rebuild),
      matching the in-memory store's immutable-chunk read semantics.
- [ ] Bound memory: the store must not hold the full catalog in RAM to serve a
      page.

Acceptance: concurrent read/write stress test shows no torn pages, no race
(`go test -race`), and stable memory under a catalog larger than the in-memory
working set.

### B4 — Custom-resource hydration unchanged

- [ ] Confirm `HydrateCatalogCustomRows` (`backend/app_object_catalog.go`) is
      unaffected: the store returns catalog identity pages; current-page row
      hydration via the dynamic client stays as-is and keeps its
      clusterId+GVK+namespace+name ref enforcement (and its
      canceled-context-is-an-error contract).

Acceptance: Custom resource tables behave identically regardless of store.

### B5 — Benchmarks, rollout, validation

- [ ] Extend `service_benchmark_test.go` to benchmark the SQLite store at and
      beyond the in-memory working-set limit (e.g. 250k, 1M objects/cluster) and
      compare page latency to in-memory.
- [ ] Gate rollout behind the B0 enablement flag; document the swap and the
      measured crossover point where SQLite wins.
- [ ] `mage qc:prerelease` passes on the final worktree.

Acceptance: storage swaps without changing request/result contracts or frontend
code; the in-memory store stays the default and benchmarked until SQLite is
proven at scale.

---

## Review Follow-Ups (2026-06-09)

Items that deliberately survived the 56-item large-table review sweep. Each is
bounded, has a trigger, and is independent of Track B.

### F1 — Streaming export (review item #23 remainder)

Exports/copies in the "all matching rows" scope page at the backend max and
fail loudly on a failed page, but the full CSV is still assembled as **one
in-memory string** and handed across the Wails bridge in one piece
(`SaveCsvFile`). Rough cost: 500k rows × ~200 B ≈ 100 MB+ transient on both
sides of the bridge.

- Fix shape: stream pages to a backend temp file during the cursor walk and
  atomically rename on completion. The pieces are already centralized: the walk
  is `frontend/src/modules/resource-grid/cursorPageWalk.ts` (one walk for typed
  + catalog) and the atomic file write is `writeCSVFileAtomically`
  (`backend/app_csv_export.go`).
- Trigger: exports observed at ~100k+ rows, or a reported export OOM/stall.

### F2 — Bounded collector for the remaining static families (review item #55)

Pods, workloads, and both events families build query pages through the bounded
top-K collector (`typedTableQueryCollector`). The remaining static families
(config, network, RBAC, storage, autoscaling, quotas, CRDs, helm — cluster and
namespace variants) decorate once and full-sort per query page
(`applyTypedTableQuery`) — cheap since the decorated-sort rework, but still
O(N log N) per page request.

- Fix shape: mechanical per-family conversion to the collector (the engine and
  the conversion pattern are proven by the events conversion). Pin parity with
  a characterization test per family, as the events conversion did.
- Trigger: any static family observed at large cardinality (≳50k rows in
  scope), or opportunistically when touching a builder.

### F3 — Descriptor-driven view config (review items #41/#55 remainder)

The per-view copy-paste class (column defs, filter accessors, labels) and the
`namespaceResourceDescriptors` select mappings retire together only with a
descriptor-driven view config. The mappings are NOT dead today —
`NsResourcesContext` consumes `descriptor.select` for the live snapshot side —
so this is a refactor, not a cleanup.

- Related: [`view-owned-window-fetch.md`](view-owned-window-fetch.md) (the
  manager/window collapse) overlaps the same manager machinery and should land
  first or together.
- Trigger: none (debt-driven); do it when the per-view duplication next causes
  a double-edit bug, and not before the window-fetch plan is resolved.

## Cross-Cutting Risks

- **Cursor portability (Track B).** Any divergence between Go's comparator and
  SQL `ORDER BY`/collation silently breaks pagination. B1's conformance test is
  the gate; do not ship B without it.
- **clusterId discipline.** Per-cluster SQLite files must carry `clusterId` in
  path, cache, and persistence keys.

## Definition of Done

- The SQLite catalog store passes the in-memory store's contract suite and a
  cross-store cursor-conformance test, swaps in without contract or frontend
  changes, and is benchmarked beyond the in-memory working set.
- Durable guidance (store decision record, cursor-portability rule) is moved
  into `docs/architecture/large-data.md` before this plan is deleted.
- Review follow-ups F1–F3 are either implemented (with their own tests) or
  re-recorded with an updated trigger.
- `mage qc:prerelease` passes on the final implementation of each slice.
