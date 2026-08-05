---
name: browse-tables
description: Change cluster or namespace views, Browse/catalog surfaces, shared GridTable behavior, filters, pagination, large datasets, metrics columns, or refresh-backed resource tables
---

# Browse and Tables

Classify the table task before loading broad table architecture.

## Task tiers

1. **Narrow view edit:** one column, interaction, empty state, or local filter.
   Inspect its row producer, identity, persistence, and adjacent tests; do not
   inventory unrelated tables.
2. **Shared table behavior:** GridTable, resource-table controller, adapters,
   persistence, shared filtering/sorting/pagination, identity, or columns.
   Inventory affected usages and read `docs/frontend/gridtable.md` plus
   [table modes](references/table-modes.md).
3. **Architecture or large-data behavior:** query ownership, global semantics,
   pagination/windowing, caps, dynamic metrics, export, or select-all. Inventory
   every production resource-table usage, read
   `docs/architecture/large-data.md`, and use [table modes](references/table-modes.md).

Use `docs/architecture/catalog.md` for discovery/Browse changes,
`docs/architecture/refresh-system.md` for snapshot/stream contracts,
`docs/frontend/live-age.md` for age behavior, and
`docs/architecture/resource-metrics.md` for CPU/memory/utilization. Read only
the contracts selected by the change.

## Ownership

- The object catalog owns discovery, existence, canonical identity, Browse
  namespace metadata, and cluster listings. The `namespaces` refresh domain owns
  namespace LIST rows.
- Typed list/table data comes from refresh snapshots and, when applicable,
  matching resource-stream projections.
- Frontend reads use data access or refresh orchestration. Resource tables render
  through `ResourceInventoryTable` with `boundedRowsSource` or
  `backendQuerySource`; do not add a third source shape.
- Shared `GridTable` and column factories own common rendering behavior.
- Row actions and navigation use concrete full object references.

## Workflow

1. Trace backend producer, scope, cap/truncation, permission behavior, cache or
   query owner, stream parity, and every consumer assumption.
2. Classify the table mode. For tier 2/3 work, use the definitions and inventory
   in [table modes](references/table-modes.md).
3. For broad work, create or update `docs/plans/<topic>.md`; move durable results
   into the owning architecture/frontend doc when finished.
4. Write the failing contract test before changing global table semantics.
5. Keep counts, facets, sorting, export, selection, and actions consistent with
   the table's actual completeness.

## Focused checks

```sh
mise exec -- go test ./backend/objectcatalog ./backend/refresh/snapshot ./backend/refresh/system
mise exec -- npm run test --prefix frontend -- browse tables cluster namespace
mise exec -- npm run typecheck --prefix frontend
```

For broad shared-table changes, also run `mise exec -- mage qc:knip` and add a
static/contract test preventing unclassified production resource-table usage.
Then follow the root final validation gate.
