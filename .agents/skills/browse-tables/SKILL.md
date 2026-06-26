---
name: browse-tables
description: Work on cluster/namespace views, browse/catalog surfaces, shared GridTable behavior, large datasets, filters, and refresh-backed table tests
---

# Browse And Tables

Use this when touching cluster or namespace resource views, Browse/catalog UI,
shared `GridTable`, table columns, filters, pagination/load-more, row identity,
large-data behavior, or refresh-backed list/table tests.

## Core Contracts

Read:

1. `AGENTS.md`
2. `backend/AGENTS.md` for snapshot/catalog changes
3. `frontend/AGENTS.md` for table/view changes
4. `docs/architecture/catalog.md`
5. `docs/architecture/refresh-system.md`
6. `docs/architecture/data-access.md`
7. `docs/frontend/gridtable.md`
8. `docs/architecture/large-data.md`
9. `docs/frontend/live-age.md` when age columns or catalog-backed age display changes
10. `docs/architecture/resource-metrics.md` when CPU/memory/pod utilization columns change

## Backend Entry Points

- `backend/objectcatalog`
- `backend/refresh/snapshot/catalog.go`
- `backend/refresh/snapshot/*.go`
- `backend/refresh/system/registrations.go`
- `backend/refresh/resourcestream`

The object catalog owns discovery, existence, namespace listings, cluster
listings, and canonical identity. Typed refresh snapshots may add richer row
data, but they must preserve catalog-shaped identity.

## Frontend Entry Points

- `frontend/src/modules/browse`
- `frontend/src/modules/cluster`
- `frontend/src/modules/namespace`
- `frontend/src/core/data-access`
- `frontend/src/core/refresh`
- `frontend/src/core/refresh/streaming/resourceStreamDomains.ts`
- `frontend/src/shared/components/tables`

Use `GridTable` and shared column factories. Frontend reads should flow through
`dataAccess` or the refresh orchestrator, not direct `fetch` calls.

## Table Surface Workflow

Classify the task before proposing or editing:

1. **Narrow table edit**: one view/column/style/empty-state interaction.
   Inspect the affected consumer, row identity, persistence keys, and backend
   producer. A full inventory is not required.
2. **Shared table behavior**: `GridTable`, resource-grid adapters, shared
   filtering/sorting/pagination, persistence, row identity, or column factories.
   Inventory all affected adapters/usages before editing.
3. **Table architecture/performance**: large-cluster behavior, query-backed
   tables, pagination/windowing, table data ownership, global sort/filter,
   export/select-all semantics, or any "definitive" table fix. Inventory every
   production table usage before making architecture claims.

For tier 2 and 3 work, create or update an explicit artifact before
implementation. Use `docs/plans/<topic>.md` for active work; move durable rules
to `docs/frontend/gridtable.md` or `docs/architecture/large-data.md` when the
plan is complete. If an artifact is not needed for a narrow edit, say why in
the final response.

For app-wide large-table work, classification is not completion. A table is
complete only when it is query-backed, proven Local Complete by a real bound, or
visibly Local Partial with matching counts, filters, export, selection, and
object-action limits.

Resource inventory tables render through one controller — `ResourceInventoryTable`
fed by `boundedRowsSource` (bounded local) or `backendQuerySource` (backend
query). New resource tables start there; do not render `GridTable` directly and do
not add a third source shape. See the Resource Inventory Tables section of
`docs/frontend/gridtable.md`.

Inventory these entry points:

- `<ResourceInventoryTable` render sites and the `source` each is given
- `boundedRowsSource` / `backendQuerySource` callers
- `useQueryBackedClusterResourceGridTable` / `useQueryBackedNamespaceResourceGridTable`
- `useClusterResourceGridTable`
- `useNamespaceResourceGridTable`
- `useObjectPanelResourceGridTable`
- `useQueryResourceGridTable`
- `<GridTable` render sites (must be a classified non-resource exception)
- direct `useTableSort`

For each production usage, record:

- owning file and view
- row type and backend producer
- scope: cluster, namespace, all-namespaces, object panel, logs, diagnostics,
  or app-shell
- whether the backend payload is complete, capped, recent-window, streaming,
  query-backed, or assembled locally
- sortable columns and whether each sort field is static, computed, or dynamic
  metric state
- filter/search sources, including metadata search and table-specific toggles
- expected cardinality and worst-case large-cluster cardinality
- correct table mode:
  - `Local Complete`
  - `Local Partial`
  - `Query Backed Static`
  - `Query Backed Dynamic`
- export, selection, select-all, context-menu, and object-action semantics

Treat these cases as separate design problems:

- Browse/catalog identity tables
- typed namespace and cluster resource tables
- all-namespaces typed tables
- metric-backed Pods, Workloads, and Nodes columns
- capped/recent Events tables
- custom-resource and CRD fanout tables
- object-panel related-resource tables
- parsed/log-derived tables
- diagnostics/app-shell tables

### Table Modes

`Local Complete`: the frontend has the complete bounded row set. Local
sort/search/filter/facets are allowed. The bound must come from the domain shape
or backend contract, not from a user-tunable row cap.

`Local Partial`: the frontend has a capped, recent, degraded, or sampled window.
Local sort/search/filter are allowed only over that window. UI, export, counts,
facets, and select-all must not imply global behavior.

`Query Backed Static`: backend owns global search, filter, sort, facets, totals,
  pagination/windowing, export-all, and non-mutating query-wide selection for
  stable projected fields. Frontend renders only the current page/window.

`Query Backed Dynamic`: backend owns the same behavior as Query Backed Static,
but sort/filter depends on changing computed state such as metrics. Cursor and
result metadata must include both the base resource revision and the dynamic
input revision.

If a table is `Local Partial`, the UI must make partial, capped, recent, or
degraded state visible and must not imply global counts, facets, sorting, or
export semantics.

If a table is `Local Complete`, verify the bound at the producer or with
measured fixtures. Do not use a user-facing row cap as proof that the dataset is
complete.

If a table is `Query Backed Dynamic`, backend cursor/snapshot identity must
include both the base resource snapshot/revision and the dynamic input revision
such as metrics. Do not sort dynamic fields locally for a global table.

Before finishing broad table architecture work, add or update an enforcement
mechanism so new production `GridTable` usages cannot bypass mode
classification.

## Backend Producer Trace

Before changing table data ownership, sort/filter semantics, caps, refresh
domains, or query contracts, trace the producer:

- refresh domain name and scope shape
- snapshot payload type and row type
- resource-stream parity if streamed
- cache/index/query owner
- cap/truncation source and whether stats expose `truncated`, `total`, or
  warnings
- permission/degraded behavior
- metrics or computed-state revision source for dynamic fields
- identity source for `clusterId`, `group`, `version`, `kind`, `namespace`, and
  `name`
- every consumer that assumes the current row shape or completeness

If producer completeness, truncation, identity, or dynamic-state ordering is
unclear, stop and inspect the producer instead of implementing a local table
workaround.

## Export Selection And Actions

For any table change that affects row sets, filters, search, sort, or
pagination, explicitly check:

- pagination control placement, visible range, page size, exact/approximate
  total display, and whether page count/random access is actually supported
- CSV/export: current page/window vs all matching query
- selection: visible concrete refs vs query-wide selection descriptor
- select-all: visible rows only vs all matching rows
- context menus and actions: full object refs with `clusterId`, GVK, namespace,
  and name
- destructive actions: concrete visible refs only unless an explicit product
  and security plan approves a query-wide mutation
- non-mutating query-wide operations: backend execution; do not materialize all
  rows in React

## Checklist

- [ ] Rows carry complete cluster/GVK/object identity.
- [ ] Refresh domain, payload type, refresher config, orchestrator, diagnostics,
      and backend registration stay synchronized.
- [ ] Snapshot and resource-stream row shapes match for streamed domains.
- [ ] Streamed table domains update resource stream descriptors, backend
      supported domains, registration files, and single-cluster stream tests.
- [ ] Catalog-backed browse behavior remains the identity/existence source of
      truth.
- [ ] Large datasets retain pagination/load-more, truncation diagnostics, and
      table performance behavior.
- [ ] Broad table architecture work includes a complete production `GridTable`
      inventory and mode classification.
- [ ] Mode classification is backed by implementation: query-backed tables own
      global semantics in the backend, Local Complete tables have a real bound,
      and Local Partial tables visibly limit user claims/actions.
- [ ] Query-backed tables do not run local full-dataset search, filter, sort, or
      facet generation.
- [ ] Age columns render from absolute timestamps through the live-age contract
      and use displayed `age` strings only as fallback text.
- [ ] Metric columns use shared resource-metrics value adapters where applicable
      and keep global metric-backed sorts backend-owned.
- [ ] Metric-backed global sorts are backend-owned and tied to a metrics or
      computed-state snapshot/revision.
- [ ] New/changed typed sort fields keep the page sort and the keyset cursor
      boundary on one comparable value, and numeric fields stay uniformly numeric
      (missing values sort as `-Inf`, never a string fallback), so cursor paging
      cannot skip or duplicate rows. See `docs/architecture/large-data.md`.
- [ ] Capped/recent/partial tables visibly communicate that local sort/filter
      only applies to the loaded window.
- [ ] Export, selection, select-all, context-menu, and object-action semantics
      match the table mode.
- [ ] Table changes reuse `GridTable` and shared column factories.
- [ ] Tests cover the changed refresh, catalog, table, or large-data behavior.
- [ ] Broad table-mode changes include a contract/static test or other
      enforcement for new production table usages.
- [ ] Non-doc changes pass `mage qc:prerelease`.

## Validation

Use focused checks while iterating:

```sh
go test ./backend/objectcatalog ./backend/refresh/snapshot ./backend/refresh/system
npm run typecheck --prefix frontend
npm run test --prefix frontend -- browse tables cluster namespace
```

For broad shared-table changes, also run `mage qc:knip`, then
`mage qc:prerelease` for non-documentation changes.

For tier 2 or 3 table-mode work, validation must include a contract/static test
or equivalent check that detects new production `GridTable` usage without mode
classification.
