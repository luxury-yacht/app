# Large-Data Hardening: Next Slices

Status: **Track A done (2026-06-08); Track B still deferred.** Track A was
implemented ahead of its object-count trigger because the local/query split was a
visible, illogical UX inconsistency — some single-namespace tables had pagination
controls and others didn't, on a distinction (single vs. all namespaces) the user
can't see. Uniform pagination across every scope was the deciding factor, not the
cardinality threshold; the "net-neutral-at-small-scale" trade the table below
flags was accepted for consistency. Track B remains evidence-triggered (the
largest cluster tested to date is under 10k objects, far below its trigger), so
keep the existing catalog store/seam and do nothing on Track B.
See [When To Implement](#when-to-implement--trigger-thresholds).

- **Track A** ✅ DONE — single-namespace typed resource tables (Pods, Workloads,
  Config, Network, RBAC, Storage, Events, Autoscaling, Quotas, Helm) are now
  query-backed (`enabled: true`, `baseScope = namespace:<name>`), matching
  all-namespaces/cluster/Browse/Custom. The backend window path is retained (it
  still feeds liveness + counts); only the table display moved to the query page.
- **Track B** — add a _persistent (SQLite) catalog query store_ behind the
  existing `CatalogQueryStore` seam, so catalog queries survive beyond the
  in-memory index's working-set limit.
- **Track B** — add a _persistent (SQLite) catalog query store_ behind the
  existing `CatalogQueryStore` seam, so catalog queries survive beyond the
  in-memory index's working-set limit.

The two tracks are independent and can ship in either order. Track A is the
higher-value, lower-risk slice; Track B is larger and mostly de-risked by the
seam that already exists.

Both tracks must preserve the non-negotiable rules from the completed app-wide
table hardening work (see [`docs/architecture/large-data.md`](../architecture/large-data.md)
and [`docs/frontend/gridtable.md`](../frontend/gridtable.md)): `clusterId` in
every query/cache/persistence/row/action; concrete object refs carry
clusterId+GVK+namespace+name; query-backed tables never locally
search/filter/sort/count/facet over a page as if it were the full set; partial
tables stay visibly partial; pagination stays honest about exact vs approximate
totals.

## When To Implement — Trigger Thresholds

Neither track is justified by abstract "scale"; each has a concrete object count
below which it adds nothing a user can perceive (and, for Track A, can make the
common case slightly worse). Build a track only when real usage crosses its
trigger. These thresholds are grounded in constants already in the code; the
memory/performance figures are estimates to be confirmed by the A0/B5
benchmarks before any enablement decision.

Reference points in code:

- Catalog total/facet exactness flips to approximate above
  `catalogQueryExactMetadataThreshold = 100000`
  (`backend/objectcatalog/query.go`).
- Single-namespace resource tables stay `Local Complete` (exact) until a single
  family in one namespace exceeds its snapshot cap of **1,000 rows**
  (`config.SnapshotNamespace*EntryLimit`), at which point they truncate and
  become `Local Partial`.
- A catalog `Summary` is ~12 string fields plus optional `ActionFacts`, i.e.
  roughly **0.5–1 KB resident per object**, transiently doubled by the
  per-query deep-clone in the in-memory store.

### Track A (single-namespace migration) trigger

| Per-namespace, per-family object count               | Disposition                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **< ~1,000**                                         | Do not build. The local path is already exact and complete, live-streamed, and cheaper than query refetch. Migration here is net-neutral-to-negative: it adds query wiring on top of the snapshot that must still exist, and trades live streaming for refetch-on-version. |
| **~1,000+ in a single namespace, hit by real users** | Becomes reasonable. This is where the local snapshot actually truncates and the single-namespace table starts capping/misleading. Migrate the _specific families_ that cross it (per A0 evidence), not all of them.                                                        |
| **Many namespaces each well over the cap**           | Clear win. Uniform backend semantics and honest pagination across every scope.                                                                                                                                                                                             |

Note: Track A's value is primarily **uniform table semantics**, not scale or
complexity reduction — the `!query.Enabled` window path is the canonical refresh
snapshot and was not removed by this migration. This note originally said not to
undertake Track A for consistency alone below the 1,000-row cap; that is exactly
the call that was revisited and reversed (2026-06-08): the local/query split was
shipping a visible, illogical pagination inconsistency, so uniform semantics won.
The trade this table describes (net-neutral at small scale) was accepted knowingly.

### Track B (persistent SQLite store) trigger

| Catalog objects (per cluster, unless noted)                       | Disposition                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **< ~100k**                                                       | Do not build. In-memory is exact and instant; SQLite only adds disk I/O.                                                                                                                                                       |
| **~100k+ in a single query result**                               | First real gain: **correctness**. Above this the app deliberately goes approximate on totals/facets; SQLite restores exact counts and facets on catalog-backed tables (Browse, Custom resources). Hard cliff, not an estimate. |
| **~250k–500k per cluster, or ~100k × several clusters connected** | **Memory + responsiveness.** Resident index ~190–375 MB/cluster and the per-query clone peaks near 2×; this is where a laptop feels pressure and per-query jank. SQLite serves a page without cloning the dataset.             |
| **~1M+**                                                          | Effectively **required**; clone peaks >1 GB risk swap/OOM, especially multi-cluster.                                                                                                                                           |

Multi-cluster shifts Track B left: five clusters at 100k each ≈ the resident
footprint of one 500k cluster, so heavy multi-cluster users hit the wall before
single-cluster users do.

### Decision rule

- Default to in-memory and local single-namespace tables.
- Open Track A only when a user/family is observed crossing the **1,000-row**
  per-namespace cap.
- Open Track B only when a user is observed on a **100k+**-object cluster (or a
  multi-cluster session whose combined catalog is comparable) _and_ reports
  Browse/Custom-resource degradation.
- Until then, the `CatalogQueryStore` seam and the dual query/window paths are
  the paid-for insurance; leave them in place and ship nothing new.

## Current State (what already exists)

- The typed-query engine (`backend/refresh/snapshot/typed_table_query.go`,
  `static_table_query.go`) already applies search/filter/sort/keyset-page to a
  resource slice **independent of scope**. Each per-resource builder lists the
  resources for its scope (single namespace, all namespaces, or cluster) and
  then runs `applyTypedTableQuery` when `query.Enabled`, or the local truncated
  window when not.
- `query.Enabled` is driven purely by whether the frontend appends a `?…` query
  string to the scope. Today the namespace views gate this on
  `enabled: namespace === ALL_NAMESPACES_SCOPE`
  (e.g. `frontend/src/modules/namespace/components/NsViewConfig.tsx:162`), so
  single-namespace scopes take the local-window path and are classified
  `Local Complete` / `Local Partial`, bounded only by the snapshot caps
  (`config.SnapshotNamespace*EntryLimit`).
- The frontend query stack (`useTypedResourceQuery`,
  `useQueryBackedResourceGridTable`, pagination footer, partial-state label,
  persistence keys) is already scope-agnostic and cluster-aware.
- The `CatalogQueryStore` interface exists
  (`backend/objectcatalog/query_store.go`) with a single method
  `QueryCatalog(opts QueryOptions) (QueryResult, bool)`. The default in-memory
  store is benchmarked (`backend/objectcatalog/service_benchmark_test.go`).
  `Service.Query` already falls back to the uncached path when a store declines.

The implication: **most of Track A is flipping the frontend gate and wiring
liveness; the backend largely already supports it.** Track B is a net-new store
implementation behind a contract that is already isolated.

---

## Track A: Single-Namespace Backend Query Migration

Goal: a single namespace with very large resource counts (e.g. a tenant
namespace with tens of thousands of ConfigMaps/Secrets/Pods/PVCs) renders the
current page only, with backend-owned counts/facets/sort/page, instead of
loading the whole namespace into React under a cap.

**Trigger to start:** a single family in one namespace observed at **~1,000+
rows** for real users (the snapshot cap where the local table truncates). Below
that, do not start — see
[When To Implement](#when-to-implement--trigger-thresholds).

### A0 — Evidence: which single-namespace tables actually need this

- [ ] Add large single-namespace fixtures and benchmark each single-namespace
      family against the table budget: Config (ConfigMap/Secret), Pods,
      Network (Service/EndpointSlice/Ingress/policies), Storage (PVC),
      Workloads, RBAC, Quotas, Autoscaling, Helm.
- [ ] Record measured worst-case cardinality per family. Migrate only families
      that can exceed the budget; keep naturally-bounded families
      `Local Complete` with a documented bound.

Acceptance: every single-namespace family is either selected for migration with
a measured over-budget case, or kept local with a written bound. No
"Local Complete by assumption" remains for a selected family.

### A1 — Liveness contract for single-namespace query pages

This is the central risk. All-namespaces query pages use one-shot reads
(`cleanup:true, preserveState:false`) and refetch on `liveDataVersion` changes
from the scoped live domain. Single-namespace today streams live snapshot/stream
updates directly into local rows. Moving to query pages must not lose
near-real-time updates.

- [ ] Confirm the scoped live domain (`useRefreshScopedDomain`) publishes a
      `liveDataVersion` for single-namespace scopes and that the query refetches
      on it, matching the all-namespaces behavior.
- [x] ✅ Define and test the update latency contract for a migrated
      single-namespace table (refetch-on-version vs prior stream cadence) and
      record it in `docs/architecture/large-data.md` (see "Liveness Contract for
      Query-Backed Tables").
- [ ] Prove a cursor on page 2+ survives a live update without skipping or
      duplicating rows (reuse the keyset-consistency contract; metric-backed
      single-namespace Pods inherit the dynamic-revision tolerance).

Acceptance: a migrated single-namespace table updates within the documented
window and never serves a dup/skip across a live refresh.

### A2 — Flip the frontend gate and scope the query

- [ ] For each selected family, change `enabled` from
      `namespace === ALL_NAMESPACES_SCOPE` to enabled for single-namespace too,
      and pass the namespace into the query `baseScope` so the backend pages over
      exactly that namespace.
- [ ] Keep `showNamespaceFilters` / namespace facets off for single-namespace
      (the namespace is fixed); keep kind facets and counts backend-owned.
- [ ] Ensure persistence keys still include `clusterId` + namespace so a
      single-namespace table's sort/filter/page state is scoped correctly.

Acceptance: a selected single-namespace table issues a backend query, renders
the current page only, and never derives counts/facets/sort from the page.

### A3 — Retire or bound the now-redundant local window

- [ ] For migrated families, remove the local truncated-window path for the
      single-namespace scope (or keep it strictly as the typed-window fallback
      used only when `!query.Enabled`), and remove the dead snapshot cap if it
      no longer governs any rendered path.
- [ ] For families kept local, keep the cap and the visible `Local Partial`
      label exactly as today.

Acceptance: no migrated single-namespace family depends on a snapshot row cap
for correctness; no dead window path remains in touched builders.

### A4 — Regression coverage

- [ ] First-load + pagination tests for single-namespace versions of every
      migrated family (mirror the all-namespaces `queryBackedLeafFirstLoad`
      coverage).
- [ ] Backend tests: single-namespace query predicates, facets (kind only),
      keyset signatures, exactness flags, and degraded reasons
      (permission-blocked source in a single namespace must still surface).
- [ ] `gridTableViewRegistry.contract` updated so migrated single-namespace
      surfaces are classified `Query Backed …`, not `Local …`.

Acceptance: the all-namespaces first-load bug class is covered for
single-namespace too; `mage qc:prerelease` passes on the final worktree.

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
keyset tiebreak.

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
      (no OFFSET); preserve `Continue`/`CursorInvalid` semantics.
- [ ] Implement kind/namespace facet counts (`GROUP BY`) and total count with
      the same 100k exactness threshold that flips both `TotalIsExact` and
      `FacetsExact` together (`backend/objectcatalog/query.go`).
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
      clusterId+GVK+namespace+name ref enforcement.

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

## Cross-Cutting Risks

- **Cursor portability (Track B).** Any divergence between Go's comparator and
  SQL `ORDER BY`/collation silently breaks pagination. B1's conformance test is
  the gate; do not ship B without it.
- **Liveness regression (Track A).** Replacing single-namespace streaming with
  query-page refetch must not visibly slow updates. A1 must define and test the
  latency contract before A2 flips any gate.
- **Scope creep into single-namespace pods/workloads dynamics.** Metric-backed
  single-namespace sort inherits the dynamic-revision keyset tolerance already
  in `typed_table_query.go`; do not re-invent it.
- **clusterId discipline.** Per-cluster SQLite files and single-namespace query
  scopes must both carry `clusterId` in path, cache, and persistence keys.

## Definition of Done

- Every selected single-namespace family is query-backed and renders only the
  current page; families kept local have a documented measured bound and a
  visible `Local Partial` state when capped.
- No migrated table depends on a snapshot row cap for correctness.
- The SQLite catalog store passes the in-memory store's contract suite and a
  cross-store cursor-conformance test, swaps in without contract or frontend
  changes, and is benchmarked beyond the in-memory working set.
- Durable guidance (single-namespace liveness contract, store decision record,
  cursor-portability rule) is moved into `docs/architecture/large-data.md`
  before this plan is deleted.
- `mage qc:prerelease` passes on the final implementation of each track.
