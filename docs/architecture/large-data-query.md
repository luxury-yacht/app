# Large Data Query Contract

Use for backend query semantics, page addressing, typed envelopes, or query
liveness. Apply the [shared large-data contract](large-data.md).

## Read by change

- Catalog/Browse query ownership and bounds: [Browse query chain](#browse-query-chain).
- Cursor, anchor jump or page addressing: [page addressing](#page-addressing-contract-anchor--startrank--continue).
- Typed resource fields, facets, completeness or readiness: [typed queries](#typed-resource-query-contract).
- Refetch triggers, streams, fallback or row reuse: [liveness](#liveness-contract-for-query-backed-tables-track-a-acceptance-a1).

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

## Typed Resource Query Contract

Typed resource queries use `ResourceQueryRequest` and `ResourceQueryResult` in
`backend/refresh/snapshot/resource_query_contract.go`, mirrored by frontend
refresh types. Every canonical row carries one complete `ref`, including
`clusterId`, GVK, plural resource, namespace when namespaced, and name; it does
not retain flat copies of its own identity. The base resource contract carries
stable projected table fields, backend predicates,
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
window path remains the canonical refresh snapshot for object panels, counts,
and other snapshot consumers, so it is not redundant with the query path and
must not be deleted as a "path consolidation." Demand ownership prevents the
table itself from paying for both: a query-backed table holds `query` demand for
its base live scope and current page, while a separate consumer holds `snapshot`
demand only when it needs the window payload. Both demands share one live
source and its readiness/permission/source clocks. Single-namespace resource
tables are query-backed too — the frontend passes the selected namespace as the
query `baseScope` (`namespace:<name>`) so pagination and table semantics are
uniform across every scope, not just all-namespaces and cluster.
Degraded and unavailable-source reasons are computed and surfaced on both paths;
a window missing a permission-blocked source is reported inexact and
issue-bearing, never as a complete table. The same rule applies when an
informer/ingest sync deadline releases the liveness gate before its initial list
succeeds: the typed envelope stays partial and inexact until raw source readiness
becomes authoritative.

Object-panel related-resource tables stay local while their owner-scoped domain
keeps them naturally bounded. They move to typed query-backed mode only if an
object-panel table becomes namespace or cluster scale.

## Liveness Contract for Query-Backed Tables (Track A acceptance A1)

A query-backed table renders one-shot query pages, so its liveness comes from
refetching — never from mutating displayed rows in place. The contract:

- The typed query refetches when a declared `signalVersions` source clock or
  stream acknowledgement identity changes
  (`useQueryBackedResourceGridTable.ts`). Payload applies and refresh timestamps
  are deliberately excluded, so a query response cannot echo into another
  query. Query demand subscribes before its initial read; `ACK`/initial `RESET`
  triggers an acknowledged reconciliation, and the query lifecycle identity
  rejects an older in-flight response.
- Fallback scheduling for a query-only lease advances a query-reconciliation
  identity instead of fetching the domain's bounded base snapshot. The
  consumer uses that identity to reissue its current cursor page, preserving
  both page position and the one-page retention bound. A healthy stream does
  not advance the fallback identity because source clocks already invalidate
  the page.
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
- The typed-query ingestion boundary performs page-local structural sharing.
  It reuses a complete `ref` when identity is unchanged and reuses a whole row
  only when every own enumerable scalar, map, array, and nested value is equal.
  The previous-page index is scoped to the full query/cursor identity and is
  discarded after apply. Metric-bearing and event-churn families use ref-only
  sharing where exhaustive whole-row comparison would add work while their
  projected values normally change.
