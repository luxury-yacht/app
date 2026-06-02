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
- CSV/export actions should operate on visible/current-page rows unless a
  backend query-wide operation exists for the same `clusterId` and query
  signature.
- Query-wide selection and bulk-action flows must use a
  `QuerySelectionDescriptor`, require confirmation before execution, and return
  compact partial-failure refs instead of loading every matching row into the
  frontend.
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
and name. Query-wide CSV export and guarded query-wide bulk delete execute in
the backend against a query descriptor; visible-row actions continue to use
concrete refs.

## Table Modes

`Local Complete` tables may run local search, filtering, sorting, facets, CSV,
and selection because the loaded rows are the full bounded dataset for that
table scope.

`Local Partial` tables may run local transforms only over the visible bounded
window. They must not imply global totals, global facets, global sorting, or
query-wide export/selection.

Local Partial is a user-facing contract, not an internal excuse. The table must
label the window source, such as recent, capped, degraded, or buffered; totals
and facets must be scoped to that window; destructive and export actions must
say or enforce that they apply only to visible/windowed rows.

`Query Backed Static` tables receive rows that are already searched, filtered,
sorted, and paged by the backend. Shared table logic must not locally narrow or
resort those rows. Browse is the reference implementation.

`Query Backed Dynamic` tables are query-backed and include volatile projected
fields such as CPU or memory metrics. All-namespaces Pods and Workloads use
their refresh-domain query scopes for backend search, filters, keyset paging,
and CPU/memory sort. Cursor continuity is keyset-based: the cursor carries the
dynamic metrics revision for diagnostics and signature stability, but ordinary
metrics refreshes do not reject the cursor or bounce the user back to page 1.

## Typed Resource Query Contract

Typed resource queries use `ResourceQueryRequest` and `ResourceQueryResult` in
`backend/refresh/snapshot/resource_query_contract.go`, mirrored by frontend
refresh types. The contract carries full `clusterId` and GVK identity for every
row, stable projected table fields, dynamic CPU/memory fields, backend
predicates, facets, exactness flags, partial/degraded issues, and a dynamic
revision reference.

Metadata label/annotation search is not implicitly global for query-backed
typed tables. A typed table may expose metadata search globally only after that
metadata is indexed by the backend query implementation. Until then, metadata
search remains Local Complete-only, or the large-scope table must show an
explicit degraded/disabled state.

Metric sorts use a bounded dynamic paging model. The backend response must name
the metrics source and revision used for the result. Deep metric paging is
allowed only within the chosen bounded snapshot/top-k policy; cursors must not
restart merely because the live metrics stream refreshes.

Object-panel related-resource tables stay local while their owner-scoped domain
keeps them naturally bounded. They move to typed query-backed mode only if an
object-panel table becomes namespace or cluster scale.

## High-Risk Typed Producer Trace

Pods: `backend/refresh/snapshot/pods.go` feeds namespace and all-namespaces pod
tables. It carries pod identity, status, restart, readiness, node, owner, and
metrics projection state. All-namespaces Pods are `Query Backed Dynamic`:
search, namespace filters, health predicates, pagination, and CPU/memory sort
are backend-owned for the current metrics snapshot. The current implementation
still scans the informer-backed object set for each query page, but it no
longer retains the full projected pod row universe before sorting and slicing;
matching rows feed a bounded keyset candidate buffer plus exact facet/total
accounting.

Workloads: `backend/refresh/snapshot/namespace_workloads.go` feeds namespace
workload tables. Single-namespace workloads remain `Local Complete`.
All-namespaces Workloads are `Query Backed Dynamic`: kind and namespace filters,
search, pagination, and CPU/memory aggregate sorts are backend-owned for the
current metrics snapshot. Like Pods, this is a bounded projected-row query path,
not a persistent secondary index for workload summaries.

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

Events: cluster, namespace, and object-panel events are recent/capped snapshot
windows. They remain `Local Partial` until a real event query API exists.

Nodes: `backend/refresh/snapshot/nodes.go` is usually bounded by cluster node
count, but CPU/memory are metric fields. Nodes remain local below threshold and
move to `Query Backed Dynamic` only if measured node count crosses the table
scale threshold.

Config, RBAC, storage, network, quotas, autoscaling, and Helm: current snapshot
producers are typed refresh domains. Single-namespace bounded views may remain
local; all-namespaces or capped snapshot views either remain visibly `Local
Partial` or migrate to `Query Backed Static` after measured fixtures justify it.

## App-Wide Remaining Work

The completed large-table slice covers Browse, Custom resource tables,
all-namespaces Pods, all-namespaces Workloads, and shared table-mode
enforcement. It does not make every production table globally query-backed.

The active remaining plan is
[`docs/plans/app-wide-table-hardening.md`](../plans/app-wide-table-hardening.md).
Do not claim app-wide large-table completion until that plan's Definition of
Done is satisfied.

## Current Browse Budget

Measured on 2026-05-31 with Apple M2 Max using the synthetic catalog benchmark:

- 100k first page: 4.32 ms, 160 KB allocated.
- 100k cursor page: 7.07 ms, 151 KB allocated.
- 100k per-cluster catalog index residency: 26.75 MB.
- 250k first page: 11.45 ms, 161 KB allocated.
- 250k cursor page: 17.67 ms, 151 KB allocated.
- 250k per-cluster catalog index residency: 66.80 MB.
- 3 x 100k multi-cluster catalog index residency: 80.19 MB aggregate.

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
