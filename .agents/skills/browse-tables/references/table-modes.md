# Broad Table Change Inventory

Use for tier 3 table work: global sort/filter/pagination, export, select-all,
caps, or metric-backed semantics. Mode definitions live in
[large data](../../../../docs/architecture/large-data.md#table-modes).

## Production inventory

Inventory `ResourceInventoryTable` render sites and their sources;
`boundedRowsSource` and `backendQuerySource` callers; query-backed and local
resource-grid hooks; object-panel resource tables; direct `GridTable` sites,
which must be classified non-resource exceptions; and direct table-sort hook
consumers.

For every production usage, record owner/view, row type and producer, cluster or
namespace scope, completeness/cap/stream/query behavior, sortable fields,
filter/search sources, worst-case cardinality, table mode, and
export/selection/action semantics. Treat Browse/catalog, typed namespace and
cluster tables, all-namespaces views, metric-bearing Pods/Workloads/Nodes,
recent Events, custom resources, object-panel related objects, parsed logs, and
diagnostics as separate data-shape problems.

## Producer trace

Before changing ownership, caps, query semantics, or dynamic ordering, identify
the domain and scope shape, snapshot payload and row projection, resource-stream
parity, cache/index/query owner, truncation source and exposed totals/warnings,
permission/degraded behavior, object and dynamic-state revisions, and every
consumer assuming row shape or completeness. Per-family facts are in
[producers](../../../../docs/architecture/large-data-producers.md); keyset
ordering and the serve-time metric join are in the
[typed query contract](../../../../docs/architecture/large-data-query.md#typed-resource-query-contract).

## Export, selection, and actions

For row-set, filter, search, sort, or pagination changes, specify: current
page/window versus all matching rows; exact versus approximate totals and
supported navigation; visible concrete selection versus query-wide descriptors;
visible select-all versus all matching rows; window export versus backend
export-all; and concrete full refs for context menus, navigation, and mutations.

## Completion checklist

- Refresh registration, generated payload, diagnostics, manual refresh, and
  stream descriptor stay synchronized; snapshot and stream rows keep parity.
- The mode matches counts, facets, sorting, paging, export, selection, and
  actions: `Local Complete` has a proven bound, `Local Partial` is visibly
  limited, and query modes keep global semantics in the backend.
- Shared GridTable, controller, columns, live-age, and metrics contracts are
  reused.
- Tests cover the changed producer, table mode, permissions, and large-data
  boundary; broad changes keep the `gridTableViewRegistry` classification test
  current.
