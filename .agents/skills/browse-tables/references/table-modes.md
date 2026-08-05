# Resource Table Modes and Broad-Change Inventory

Read this reference for shared table behavior, large-data work, global
sort/filter/pagination, export/select-all, or metric-backed table semantics.

## Contents

- Production inventory
- Table modes
- Metric-bearing tables
- Producer trace
- Export, selection, and actions
- Completion checklist

## Production inventory

Inventory:

- `ResourceInventoryTable` render sites and each source;
- `boundedRowsSource` and `backendQuerySource` callers;
- query-backed cluster/namespace hooks and local resource-grid hooks;
- object-panel resource tables;
- direct `GridTable` sites, which must be classified non-resource exceptions;
  and
- direct table-sort hook consumers.

For every production usage, record owner/view, row type and producer, cluster or
namespace scope, completeness/cap/stream/query behavior, sortable fields,
filter/search sources, expected worst-case cardinality, table mode, and
export/selection/action semantics.

Treat Browse/catalog, typed namespace/cluster tables, all-namespaces views,
metric-bearing Pods/Workloads/Nodes, recent Events, custom resources, object
panel related objects, parsed logs, and diagnostics as separate data-shape
problems.

## Table modes

### Local Complete

The frontend holds the entire bounded row set. Local sort, search, filters, and
facets are allowed. Prove the bound from domain shape or backend contract; a
user-tunable cap is not proof.

### Local Partial

The frontend holds a capped, recent, degraded, or sampled window. The UI,
counts, facets, sorting, export, selection, and select-all must visibly describe
window-local behavior rather than global behavior.

### Query Backed Static

The backend owns global search, filters, sort, facets, totals,
pagination/windowing, export-all, and non-mutating query-wide selection for
stable projected fields. React renders the current page/window.

### Query Backed Dynamic

The backend owns the same semantics, but sort/filter uses changing computed
state such as metrics. Cursor and result identity include the base resource
revision and the dynamic input revision.

New production resource tables start with one of these modes and one of the two
resource-table source shapes. Broad architecture work adds an enforcement test
so future usages cannot bypass classification.

## Metric-bearing tables

Pods, Workloads, Nodes, and embedded object-panel pod tables separate object
state from metric state:

- base queries own membership, object fields, filters, facets, totals, and
  object-sorted pagination;
- metric queries own metric-sorted membership/order, totals, cursor metadata,
  values, freshness, and metric revision;
- frontend joins by complete object identity and never locally sorts the current
  page as though it were a global metric sort;
- missing metrics are unavailable values, not absent base rows; use the backend
  numeric sentinel contract; and
- shared metric selectors/adapters live in
  `frontend/src/core/resource-metrics`.

Age stays outside metric refresh. Render absolute timestamps through shared live
age components and prove time advances without base or metric refetches.

## Producer trace

Before changing ownership, caps, query semantics, or dynamic ordering, identify:

- domain and scope shape;
- snapshot payload and row projection;
- resource-stream parity;
- cache/index/query owner;
- truncation source and exposed totals/warnings;
- permission/degraded behavior;
- object and dynamic-state revisions; and
- every consumer assuming row shape or completeness.

Typed sort values and keyset cursor boundaries use one comparable representation.
Numeric fields remain numeric, including missing-value sentinels, so paging does
not skip or duplicate rows.

## Export, selection, and actions

For row-set, filter, search, sort, or pagination changes, specify:

- current page/window versus all matching rows;
- exact versus approximate totals and supported navigation;
- visible concrete selection versus query-wide descriptors;
- visible select-all versus all matching rows;
- export of the current window versus backend export-all; and
- concrete full refs for context menus, navigation, and mutations.

Query-wide mutation requires an explicit product/security design. Non-mutating
query-wide work executes in the backend rather than materializing the result set
in React.

## Completion checklist

- Producer and consumer agree on cluster/GVK/object identity.
- Refresh registration, generated payload, diagnostics, manual refresh, and
  stream descriptor remain synchronized.
- Snapshot and stream rows retain parity.
- Catalog-backed identity/existence semantics remain authoritative.
- Mode matches counts, facets, sorting, paging, export, selection, and actions.
- Local Complete has a proved bound; Local Partial is visibly limited; query
  modes keep global semantics in the backend.
- Dynamic global sorts include dynamic revision in query/cursor identity.
- Age and metrics use their shared contracts.
- Shared GridTable/controller/columns are reused.
- Tests cover the changed producer, table mode, permissions, and large-data
  boundary; broad changes include a classification enforcement test.
