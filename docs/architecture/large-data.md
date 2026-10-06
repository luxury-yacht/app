# Large Data Contract

Large-cluster support is a product constraint: never load, render, filter, or
export unbounded cluster data without an explicit cap or pagination model.

## Task routes

| Change | Read |
| --- | --- |
| Completeness, local vs query behavior, partial data, action limits | [Table modes](#table-modes) |
| Resource table adapters, lifecycle states, footer and pagination UI | [GridTable resource tables](../frontend/gridtable-resource-tables.md) |
| Browse or typed query semantics, envelopes, keyset ordering, liveness | [Query contract](large-data-query.md) |
| Cursor, anchor, or `startRank` paging, page ranks, export continuity | [Page Addressing Contract](large-data-query.md#page-addressing-contract) |
| A specific typed resource family or producer/consumer trace | [Producer reference](large-data-producers.md) |
| Budgets ("Current Browse Budget"), benchmarks, rejected optimizations | [Measurements](large-data-measurements.md) |

## Contract

- Classification is not proof of safety. A table provides backend-owned global
  semantics, proves a real complete bound, or visibly presents a
  bounded/recent/partial view with matching action limits.
- Prefer server/query-side bounds for catalog-scale data. Metadata that claims
  to describe the object universe (totals, facets, filter options) comes from
  catalog or query metadata, never a capped row slice.
- Query-backed tables never run local search, filtering, sorting, or facet
  generation over the current page as if it were the full result.
- Catalog-scale cursor pagination is first/previous/next keyset navigation.
  Numbered page jumps use the bounded `startRank` contract.
- Show exact totals and page counts only when the backend reports
  `totalIsExact`; otherwise render the count as approximate with no page-jump
  UI. Browse prefers exact totals within measured budgets; above its
  exact-metadata budget the catalog emits `totalIsExact: false` /
  `facetsExact: false`.
- Page size comes only from bounded options. Changing it starts a new backend
  query scope and invalidates prior cursors.
- Make truncation, load-more, degraded, stale, permission-blocked, capped, and
  metrics-unavailable states visible in the UI.
- Download of all matching rows is a client-driven walk over the same bounded
  query cursor that fails loudly on a failed page instead of writing a partial
  result.
- Destructive object actions operate on concrete visible-row refs, never a
  query-wide selector; query-wide mutation needs an explicit product/security
  design. Other non-mutating query-wide work runs in the backend, never by
  materializing the result in React.
- Keep large text surfaces such as logs bounded, searchable, and copyable
  without rendering the full buffer in React.

## Ownership

- Catalog query and metadata bounds: `backend/objectcatalog`,
  `backend/refresh/snapshot/catalog.go`
- Table virtualization and persistence: `frontend/src/shared/components/tables`
- Refresh payload caps and diagnostics: `backend/refresh/snapshot`,
  `frontend/src/core/refresh`
- Log viewer bounds: object-panel log viewer modules and log stream managers

## Table Modes

Every resource-grid table declares a required `tableMode`
([enforcement](../frontend/gridtable-resource-tables.md#enforcement)).

- **`Local Complete`**: the loaded rows are the full bounded dataset for the
  table scope. Local search, filters, sort, facets, CSV, and selection are
  allowed. Prove the bound from domain shape or backend contract; a
  user-tunable cap is not proof.
- **`Local Partial`**: the loaded rows are a recent, capped, buffered, degraded,
  or sampled window. Label the window source; counts, facets, sort, export,
  selection, select-all, and destructive actions are window-scoped and never
  imply global results.
- **`Query Backed Static`**: the backend owns global search, filters, sort,
  counts, facets, pagination, export-all, and non-mutating query-wide selection
  over stable projected fields. Shared table logic never narrows or resorts the
  page locally. Browse is the reference implementation.
- **`Query Backed Dynamic`**: as Static, with volatile projected fields such as
  CPU/memory; Pods, Workloads, and Nodes run backend search, filters, keyset
  paging, and metric sort. The result envelope's `dynamic` ref carries the
  metrics revision, not the value-keyed cursor; ordinary metric refreshes never
  reject the cursor or return the user to page 1
  (`TestTypedTableQueryContinuesCursorWhenDynamicRevisionChanges`).

Every production resource table is query-backed, proven owner/scope bounded, or
visibly `Local Partial` with matching action limits; none presents a capped,
recent, buffered, degraded, or page-limited row set as complete. If measured
fixtures show a `Local Complete` table can exceed its scope budget, migrate it
to a query-backed mode or make it visibly `Local Partial`.

Local modes use `boundedRowsSource`; query modes use `backendQuerySource` or a
typed query wrapper ([source adapters](../frontend/gridtable-resource-tables.md#source-adapters)).

## Change checklist

- Identify the maximum backend payload size and frontend rendered row count.
- Confirm empty, truncated, loading, blocked, and degraded states, and test
  capped/paginated behavior with enough rows to trigger virtualization, not only
  small fixtures.
