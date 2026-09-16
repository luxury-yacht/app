# Large Data Contract

Large-cluster support is a product constraint, not a table decoration. The app
must avoid loading, rendering, filtering, or exporting unbounded cluster data
without an explicit cap or pagination model.

## Read by change

Read the shared contract and the sections matching the changed data path.

| Change | Read |
| --- | --- |
| Completeness, local/query behavior, partial data or action limits | [Table modes](#table-modes) and [app-wide state](#app-wide-table-state) |
| Resource table adapters or lifecycle presentation | [Source model](#resource-inventory-source-model), then [frontend resource tables](../frontend/gridtable-resource-tables.md) |
| Browse query, keyset/anchor paging, typed envelopes or liveness | [Query contract](large-data-query.md) |
| Specific typed resource family or producer/consumer tracing | [Producer reference](large-data-producers.md) |
| Performance budgets, benchmarking or reconsidering a rejected optimization | [Measurements](large-data-measurements.md) |

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
  and avoid random page-jump UI. Do not render the footer for an exact result at
  or below the smallest supported page size unless previous or next navigation
  is available.
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
