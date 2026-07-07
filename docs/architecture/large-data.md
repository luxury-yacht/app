# Large Data Contract

Large-cluster support is a product constraint, not a table decoration. The app
must avoid loading, rendering, filtering, or exporting unbounded cluster data
without an explicit cap or pagination model.

## Agent Contract

- Preserve `clusterId` in row identity and persisted table state.
- Every resource-grid table declares a required `tableMode`: `Local Complete`,
  `Local Partial`, `Query Backed Static`, or `Query Backed Dynamic`.
- A table is not large-data safe just because it has been classified.
  Classification is only the starting point. The table must either provide
  backend-owned global semantics, prove a real complete bound, or visibly
  present itself as a bounded/recent/partial view with matching action limits.
- Prefer server/query-side bounds for catalog-scale data.
- Use GridTable virtualization for large row sets; do not disable it to mask
  focus, hover, or width bugs.
- Metadata that claims to describe the object universe must come from catalog or
  query metadata, not a capped row slice.
- Query-backed tables must not run local full-row search, filtering, sorting,
  or facet generation over the current page as if it were the full result set.
- Cursor pagination for catalog-scale data is first/previous/next keyset
  navigation. Numbered page jumps require a separate bounded offset contract.
- Query-backed pagination controls belong together in the table footer. Show
  page size and visible range. Show exact totals and page counts only when the
  backend result says the total is exact; otherwise make the count approximate
  and avoid random page-jump UI.
- Browse page size is user-selectable only from bounded options. Changing page
  size starts a new backend query scope and invalidates prior page cursors.
- Make truncation, load-more, degraded data, stale data, unavailable metrics,
  permission-blocked reads, and capped windows visible in UI state.
- Exact totals are preferred for Browse while they remain within measured
  backend budgets. The catalog query path stops exact total/facet metadata above
  its backend exact-metadata budget and emits `totalIsExact: false` /
  `facetsExact: false`; the UI renders that count as approximate.
- CSV/copy actions operate on the current page by default; the "all matching
  rows" scope is a client-driven walk over the query cursor (the same bounded
  query path the table uses), and it fails loudly on a failed page rather than
  saving a partial result. Destructive object actions must operate on concrete
  visible-row refs with full `clusterId`, GVK, namespace, and name — never on a
  query-wide selector.
- Keep large text surfaces such as logs bounded, searchable, and copyable
  without forcing the full buffer into expensive React rendering.

## Ownership

- Catalog query and metadata bounds: `backend/objectcatalog`,
  `backend/refresh/snapshot/catalog.go`
- Table virtualization and persistence:
  `frontend/src/shared/components/tables`
- Refresh payload caps and diagnostics: `backend/refresh/snapshot`,
  `frontend/src/core/refresh`
- Log viewer bounds: object-panel log viewer modules and log stream managers

## Browse Query Chain

Producer: `backend/objectcatalog.Service.Query` owns Browse filtering, search,
sort, page limits, cursor validation, totals, and facets. Cursor tokens are
bound to `clusterId`, query signature, backend sort contract, page direction,
page limit, cursor version, and the last row's stable sort/tie-breaker values.
Namespace and kind filters use the catalog query index. Default, search-only,
and sort-only catalog queries may still stream over all catalog chunks as an
O(N) CPU scan, but they feed a bounded page buffer and exact-metadata budget
instead of collecting the full result set in memory.

Query store seam: `backend/objectcatalog.CatalogQueryStore` sits behind
`Service.Query`. The default implementation is the current in-memory catalog
index and preserves the public `QueryOptions` to `QueryResult` contract. A
future SQLite or other persistent backing store may replace this seam when
benchmarks show that O(N) chunk scans, memory residency, or startup rebuild
costs exceed the large-cluster budget. The decision point is a measured
regression in catalog query latency, catalog memory residency, or cursor-page
churn benchmarks; frontend scopes and snapshot payloads must not change when
the store changes.

Snapshot boundary: `backend/refresh/snapshot/catalog.go` parses the refresh
scope into catalog query options and emits `CatalogSnapshot` payloads with full
catalog object identity, `continue`, `previous`, `cursorInvalid`,
`totalIsExact`, `facetsExact`, and reason-bearing `issues`.

Frontend boundary: `frontend/src/core/data-access` owns refresh-domain reads.
`frontend/src/modules/browse/hooks/useBrowseCatalog.ts` builds the scoped
catalog query, debounces search, requests cursor pages, replaces the current
row window, and restarts from page one only when the backend reports an invalid
cursor.

Consumers: `BrowseView` renders a `Query Backed Static` resource-grid table.
Favorites persist query-backed filter and sort state. Object actions receive
concrete visible-row refs with `clusterId`, group, version, kind, namespace,
and name. CSV export/copy in the "all matching rows" scope walks the query
cursor client-side; destructive object actions continue to use concrete
visible-row refs.

## Page Addressing Contract (anchor / startRank / continue)

A query-backed request addresses its page exactly one way — the three are
mutually exclusive (validated server-side):

- **`continue`** — an opaque backend-minted keyset cursor. Every engine-served
  response carries `previous` (backend prev cursor; the client keeps no token
  stack) and `continue`.
- **`anchor.*`** — a full object reference (`clusterId` must equal the request
  cluster; version/kind/name required); the response is the PAGE-ALIGNED
  window containing the object, with `anchor: {found, rank, reason}` (a
  missing anchor serves the first page plus `reason: "filtered" |
  "not-found"` — one round trip, visible truth). The catalog cross-checks
  `anchor.uid` against its rows (mismatch = recreated object = not-found);
  typed rows carry no UID.
- **`startRank`** — a 0-based offset (numbered page jumps); the engine clamps
  past-the-end starts to the last aligned page. The UI offers numbered jumps
  only while `totalIsExact`.

Counted serves (anchor/startRank landings) also return `pageStartRank` (the
exact serve-time rank of the page's first row — a POINTER/optional field so
rank 0 survives omission semantics) and `self` (a cursor addressing the landing
page itself, adopted by the client so live refetches stay page-stable instead
of re-anchoring). Plain cursor pages carry neither: computing rank there costs
an O(rank) walk per serve, which failed the position-honesty benchmark gate
(the QueryAround deep measurement above, ~2× the worst page-serve budget at
250k) — footer positions on cursor pages remain client-derived between jumps.

Export walks guard cross-page consistency by comparing the RAW
`sourceVersions["object"]` clock per page (never the folded `sourceVersion`
token, which embeds the scope string and differs per page by construction):
first drift restarts the walk once; a second drift DELIVERS the export with a
user-visible "data changed during export" notification. Failed/blocked/empty
pages still reject outright.

Anchor identity resolves to an engine row key in the **serve layer**, never the
engine (engine row keys are adapter-owned and name-shaped, not Kubernetes UIDs):
typed tables map `(kind, namespace, name)` through the adapter's `AnchorKey`,
built from the same helpers as the adapter's row `Key` — **a new typed kind must
supply an `AnchorKey` or its rows cannot be anchor-jumped to**; the catalog looks
the `Summary` up by `(gvr, namespace, name)` and cross-checks the object UID
(mismatch = recreated object = `not-found`). Frontend anchor intent is
navigation state, never persisted table state (favorites must not replay jumps):
a held jump re-fires (it does **not** bounce to page 1) on a sort/filter/page-size
change, is cleared by manual pagination, and is retried with the anchor — not
reset to page 1 — when a cursor is rejected mid-jump.

## Table Modes

`Local Complete` tables may run local search, filtering, sorting, facets, CSV,
and selection because the loaded rows are the full bounded dataset for that
table scope.

`Local Partial` tables may run local transforms only over the visible bounded
window. They must not imply global totals, global facets, global sorting, or
export beyond the window.

Local Partial is a user-facing contract, not an internal excuse. The table must
label the window source, such as recent, capped, degraded, or buffered; totals
and facets must be scoped to that window; destructive and export actions must
enforce visible/windowed-row scope.

`Query Backed Static` tables receive rows that are already searched, filtered,
sorted, and paged by the backend. Shared table logic must not locally narrow or
resort those rows. Browse is the reference implementation.

`Query Backed Dynamic` tables are query-backed and include volatile projected
fields such as CPU or memory metrics. All-namespaces Pods and Workloads use
their refresh-domain query scopes for backend search, filters, keyset paging,
and CPU/memory sort. Cursor continuity is keyset-based: the cursor carries the
dynamic metrics revision for diagnostics and signature stability, but ordinary
metrics refreshes do not reject the cursor or bounce the user back to page 1.

## Resource Inventory Source Model

Every resource inventory table renders through one controller
(`ResourceInventoryTable`, see [`docs/frontend/gridtable.md`](../frontend/gridtable.md))
fed by a normalized source state, not a per-view display path. The source comes
from one of two adapters:

- `boundedRowsSource` for bounded local data (`Local Complete` / `Local Partial`).
  It never exposes pagination, so a bounded table cannot silently fan out to query
  scale.
- `backendQuerySource` for backend-owned query results (catalog Browse/Custom and
  the typed-resource query wrappers).

The controller derives the display state from the source lifecycle, not from the
current row count: a refresh that momentarily holds zero rows renders as loading,
and only a settled, loaded, empty result renders as empty. Truncation/partial is
carried on the source (`completeness` plus a label) and owned by the controller,
so a partial, recent, or degraded window can never be presented as a complete
table. New resource tables must use one of the two adapters through the
controller; if a table cannot prove bounded-complete, bounded-partial, or
backend-owned semantics, stop and update the backend query contract rather than
adding a new frontend source shape.

## Typed Resource Query Contract

Typed resource queries use `ResourceQueryRequest` and `ResourceQueryResult` in
`backend/refresh/snapshot/resource_query_contract.go`, mirrored by frontend
refresh types. The base resource contract carries full `clusterId` and GVK
identity for every row, stable projected table fields, backend predicates,
facets, exactness flags, partial/degraded issues, and an object revision
reference. Live CPU/memory usage is joined onto the base rows at serve — there
are no separate metric-domain query contracts; the payload's `metrics` block
carries the poller freshness/error metadata
(see [`resource-metrics.md`](resource-metrics.md)).

Metadata label/annotation search is not implicitly global for query-backed
typed tables. A typed table may expose metadata search globally only after that
metadata is indexed by the backend query implementation. Until then, metadata
search remains Local Complete-only, or the large-scope table must show an
explicit degraded/disabled state.

Metric sorts run server-side on the joined usage values through the same
keyset cursor as every other sort (`parseFormattedCPUToMilli` /
`parseFormattedMemoryToBytes` sort keys). Cursors must not restart merely
because a metric tick refreshed the joined values.

Keyset ordering must be self-consistent. The page sort and the cursor boundary
must be derived from one comparable value per row, so the order rows are laid out
in is exactly the order the cursor walks. Computing them from two different
functions can skip or duplicate rows across pages. A numeric sort field must stay
uniformly numeric: a row that is missing a value (no age timestamp, no metric
sample, an unparseable cell) sorts as a `-Inf` sentinel with `ok=true`, never via
a string fallback, so numeric and string comparable spaces never mix within one
field. See `typedTableSortedItemLess` and `typedTableComparableSortValue` in
`backend/refresh/snapshot/typed_table_query.go`; this invariant is what prevents
silent dup/skip when a new sort field or adapter is added.

The typed builders expose two paths: a backend-query page when the scope carries
a query string (`query.Enabled`) and a bounded local window otherwise. The
window path is the canonical refresh snapshot — it backs object panels, counts
elsewhere, and the live-data version that drives query refetch — so it is not
redundant with the query path and must not be deleted as a "path consolidation."
Single-namespace, all-namespaces, and cluster scopes all run both: the query page
feeds the table (with backend keyset pagination) while the window snapshot feeds
liveness and the other consumers above. Single-namespace resource tables are
query-backed too — the frontend passes the selected namespace as the query
`baseScope` (`namespace:<name>`) so the page is scoped to that namespace — so
pagination and table semantics are uniform across every scope, not just
all-namespaces and cluster.
Degraded and unavailable-source reasons are computed and surfaced on both paths;
a window missing a permission-blocked source is reported inexact and
issue-bearing, never as a complete table.

Object-panel related-resource tables stay local while their owner-scoped domain
keeps them naturally bounded. They move to typed query-backed mode only if an
object-panel table becomes namespace or cluster scale.

## Liveness Contract for Query-Backed Tables (Track A acceptance A1)

A query-backed table renders one-shot query pages, so its liveness comes from
refetching — never from mutating displayed rows in place. The contract:

- The typed query refetches exactly when the scoped live domain's **source
  identity** changes: `liveDomainVersion = sourceVersion`
  (`useQueryBackedResourceGridTable.ts`). `sourceVersion` comes from snapshot
  responses and resource WebSocket doorbells; the HTTP snapshot endpoint uses the
  same token for `ETag` / `304`. Refresh timestamps are deliberately excluded —
  identical source identity must never trigger a refetch (the anti-churn
  invariant).
- **Update latency**: for streamed domains, a cluster change is visible within
  one stream coalescing window (200ms flush in the stream managers) plus one
  query round-trip (an in-memory backend page build — tens of milliseconds at
  100k rows). For poll-backed domains, latency is the poll cadence plus the same
  round-trip. A healthy stream suppresses snapshot polls; the stream manager
  falls back to polling on drift or stream failure, restoring poll-cadence
  liveness automatically.
- **Cursor stability across live updates**: pagination cursors are value-based
  keysets (sort value + row key), so a page-2+ cursor survives concurrent
  inserts/deletes without skipping or duplicating rows; metric-backed sorts
  tolerate metrics-revision advances (`typedTableQueryCursor.matches`). A cursor
  whose anchor context disappears reports `cursorInvalid` and the table resets
  to page 1.
- Every query refetch is visually silent — user-initiated (sort/filter/page
  size) and background liveness alike. The table keeps the last applied rows
  (or the settled "no matches" state) until the new page lands; `loading` is
  reported only before the first applied result for a scope, so filtering never
  dims the view, swaps in a spinner, or unmounts the filter input (which would
  steal focus while typing).

## High-Risk Typed Producer Trace

Pods: `backend/refresh/snapshot/pods.go` feeds namespace and all-namespaces pod
tables. It carries pod identity, status, restart, readiness, node, owner, and
metrics projection state. All-namespaces Pods are `Query Backed Dynamic`:
search, namespace filters, health predicates, pagination, and CPU/memory sort
are backend-owned for the current metrics snapshot. Pod rows are served from a
maintained `querypage` store fed by the owned-reflector ingest path (a keyset
range scan with exact facet/total counters; metrics are overlaid at serve, never
stored) — see [data-layer.md](./data-layer.md).

Workloads: `backend/refresh/snapshot/namespace_workloads.go` feeds namespace
workload tables. Both single-namespace and all-namespaces workload tables are
`Query Backed Dynamic` (single-namespace runs a namespace-scoped query page):
kind and namespace filters, search, pagination, and CPU/memory aggregate sorts
are backend-owned for the current metrics snapshot. Like Pods, workload rows
serve from a maintained `querypage` store fed by the workload GVRs' ingest
reflectors, with the pod-aggregate / HPA / metrics join applied at serve — see
[data-layer.md](./data-layer.md).

Custom resources: cluster and namespace custom table row universes come from
the object catalog query path with `customOnly=true`. Search, kind filters,
sort, paging, counts, and facets for the visible table are owned by the backend
catalog query contract. The frontend hydrates only the current catalog page
through `HydrateCatalogCustomRows` to recover status, readiness, conditions,
labels, and annotations. Production Custom tabs do not subscribe to, enable, or
load the legacy `cluster-custom` and `namespace-custom` CRD fanout domains, and
they do not pass those full-row payloads through the Wails boundary. Those
legacy domains remain registered only for explicit resource-stream and
diagnostic compatibility surfaces; any future surface that enables them pays the
old full-CR-row fanout cost and must not be described as large-table-safe.

Events: cluster and namespace event tables use typed backend query pages over
the current event set and are `Query Backed Static` for table search, filters,
sort, counts, and cursor pagination. Object-panel events remain object-scoped
recent/capped windows and are visibly `Local Partial`.

Nodes: `backend/refresh/snapshot/nodes.go` feeds a `Query Backed Dynamic`
cluster table. Search, pagination, status filters, age sort, and CPU/memory
metric sorts are backend-owned for the current resource and metric projection
state.

Config, RBAC, storage, network, quotas, autoscaling, and Helm: these snapshot
producers expose typed backend query pages for cluster, all-namespaces, and
single-namespace surfaces alike. Single-namespace tables run a namespace-scoped
query page (`baseScope = namespace:<name>`) rather than a local-complete window,
so pagination and table semantics match every other scope.

## App-Wide Table State

Every production resource table is query-backed, proven owner/scope bounded, or
visibly Local Partial with matching action limits. This does not mean every
table is globally query-backed; it means no production table may present a
capped, recent, buffered, degraded, or page-limited row set as complete global
data.

Future table work must preserve that contract. If measured fixtures show that a
currently Local Complete table can exceed its scope budget, either migrate it to
`Query Backed Static` / `Query Backed Dynamic` or make it visibly
`Local Partial` with honest counts, filters, export, selection, and destructive
action semantics.

## Current Browse Budget

Measured on 2026-05-31 with Apple M2 Max using the synthetic catalog benchmark:

- 100k first page: 4.32 ms, 160 KB allocated.
- 100k cursor page: 7.07 ms, 151 KB allocated.
- 100k per-cluster catalog index residency: 26.75 MB.
- 250k first page: 11.45 ms, 161 KB allocated.
- 250k cursor page: 17.67 ms, 151 KB allocated.
- 250k per-cluster catalog index residency: 66.80 MB.
- 3 x 100k multi-cluster catalog index residency: 80.19 MB aggregate.

Anchored jump (measured 2026-07-06 on Apple M2 Max, engine microbenchmark
`BenchmarkStoreQueryAround`, limit 50 — one counted O(rank + limit) walk per
user-initiated jump, a one-shot action, not a per-page cost):

- 100k anchor at rank N/2: 3.24 ms; at rank N-1 (worst case): 6.92 ms.
- 250k anchor at rank N/2: 14.35 ms; at rank N-1 (worst case): 33.16 ms.

The deep-anchor worst case exceeds the per-page serve budget above (b-tree
iteration costs more per entry than the flat match-value scan); that is
accepted for a one-shot jump. Order-statistics indexes stay not-built; revisit
only on a measured UX regression.

Per-Build page turns (measured 2026-07-06 on Apple M2 Max,
`BenchmarkPerBuildPageTurn`, 100k rows): uncached rebuild 618.9 ms per page
turn; single-slot store cache hit 0.024 ms; churn (version bump per request,
always a miss) 627.6 ms — identical to uncached, so the cache's win is
quiet-domain-only by design (the key is the domain's refetch identity: source
version watermark + metric revision + matched-set inputs).

## Change Checklist

When touching high-volume data:

1. Identify the maximum backend payload size and frontend rendered row count.
2. Check whether filters/search are local, query-backed, or both.
3. Preserve stable row keys and column keys for persistence.
4. Confirm empty, truncated, loading, blocked, and degraded states.
5. Add tests for capped/paginated behavior rather than only small fixtures.

## Validation

Use focused backend snapshot/catalog tests and frontend table tests for the
changed path. For visual table work, verify behavior with enough rows to trigger
virtualization.
