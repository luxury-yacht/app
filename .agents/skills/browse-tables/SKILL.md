---
name: browse-tables
description: Change cluster or namespace views, Browse/catalog surfaces, shared GridTable behavior, filters, pagination, large datasets, metrics columns, or refresh-backed resource tables
---

# Browse and Tables

Classify the table task before loading broad table architecture.

## Task tiers

1. **Narrow view edit** (one column, interaction, empty state, or local filter):
   inspect its row producer, identity, persistence, and adjacent tests; do not
   inventory unrelated tables.
2. **Shared table behavior** (GridTable, resource-table controller, adapters,
   persistence, shared filtering/sorting/pagination, identity, or columns):
   inventory affected usages and follow the task routes in
   `docs/frontend/gridtable.md`, reading only the matching sections.
3. **Architecture or large-data behavior** (query ownership, global semantics,
   pagination/windowing, caps, dynamic metrics, export, or select-all): read
   `docs/architecture/large-data.md` and its selected references, then run the
   [broad-change inventory](references/table-modes.md), recording it in
   `docs/plans/<topic>.md`.

Classify every touched production table against
[table modes](../../../docs/architecture/large-data.md#table-modes) and keep its
counts, facets, sorting, export, selection, and actions consistent with its
actual completeness.

Related contracts, read only when selected by the change:
`docs/architecture/catalog.md` (discovery/Browse),
`docs/architecture/refresh-system.md` (snapshot/stream contracts),
`docs/frontend/live-age.md` (age), and `docs/architecture/resource-metrics.md`
(CPU/memory/utilization).

## Focused checks

```sh
mise exec -- go test ./backend/objectcatalog ./backend/refresh/snapshot ./backend/refresh/system
mise exec -- npm run test --prefix frontend -- browse tables cluster namespace
mise exec -- npm run typecheck --prefix frontend
```

Broad shared-table changes also run `mise exec -- wails3 task qc:knip` and keep
the `gridTableViewRegistry` contract test rejecting unclassified production
resource-table usage.
