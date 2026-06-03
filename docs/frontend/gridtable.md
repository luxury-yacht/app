# GridTable Contract

`GridTable` is the shared table system for resource and app data. Do not create
feature-specific table systems unless the shared contract cannot fit the
workflow and that exception is documented.

## Agent Contract

- Use `GridTable` for sortable/filterable resource tables.
- Every row needs a stable `keyExtractor`; cluster data row keys must include
  cluster identity.
- Column keys are durable persistence identifiers. Renaming one is a migration,
  not cosmetic cleanup.
- Prefer shared column factories for common Kubernetes/resource fields.
- Keep rendering, filtering, sorting, focus, keyboard, context menus,
  persistence, and virtualization in the shared table system.
- Do not disable virtualization to work around focus, hover, width, or context
  menu bugs.
- Do not build CSS selectors from raw row or column keys; keys may contain
  characters that are not selector-safe.
- Do not split pagination controls across unrelated parts of the view. For
  query-backed tables, the control group belongs with the table footer and must
  show page size, visible range, and honest total/page-count state.
- Rows-per-page is persisted table state. Store it with the same
  cluster/view/namespace persistence key as sort, filters, widths, and column
  visibility, and validate it against the table's supported page-size options.
- Filter inputs and pagination dropdowns are interaction contracts, not just
  rendering details. Changes to them need tests proving controlled search keeps
  focus across updates and rows-per-page menus open and dispatch supported
  values.

## Ownership

- Shared table component and types:
  `frontend/src/shared/components/tables/GridTable.tsx`,
  `frontend/src/shared/components/tables/GridTable.types.ts`
- Shared resource columns:
  `frontend/src/shared/components/tables/columnFactories.tsx`
- Filtering, persistence, virtualization, focus, and sizing:
  `frontend/src/shared/components/tables`
- Global table CSS: `frontend/styles/components/gridtables.css`
- Keyboard/focus rules: [keyboard.md](keyboard.md)

## DOM And Identity Rules

Rows render with `data-row-key`; cells render with `data-column`. Treat these as
data. For lookup, use shared helpers or compare `dataset` values in code instead
of interpolating keys into selectors.

DOM ids must use stable helper functions that cannot collapse distinct
cluster-scoped row keys.

## Filtering And Search

- Use local search only when the table owns the complete searchable row set.
- Use query-backed search when upstream query parameters shape the dataset.
- Namespace filters must preserve cluster-scoped resources where the table
  includes them.
- Metadata filters that describe the object universe should come from catalog or
  query metadata, not a capped row slice.

## Sorting

- Sort keys emitted by `GridTable` must be visible column keys. Hidden data
  fields such as timestamps may be used by a column `sortValue`, but must not be
  published as active table sort keys.
- Query-backed table columns may be `sortable: true` only when the backend
  adapter supports that exact column key, or a documented alias for it, as a
  global query sort.
- Do not expose hydrated post-page fields as sortable query columns. If the
  backend cannot sort the complete matching dataset by a field, the column must
  be non-sortable or the backend contract must be expanded first.
- Production query-backed resource views should be covered by a rendered-column
  contract test that compares their sortable keys against the supported query
  sort contract.

## Table Modes And User Claims

- `Local Complete` means the loaded rows are the complete bounded dataset for
  this table scope.
- `Local Partial` means the loaded rows are only a recent, capped, buffered, or
  degraded window. UI text, counts, filters, export, selection, and bulk actions
  must be scoped to that window.
- `Query Backed Static` and `Query Backed Dynamic` mean the backend owns global
  search, filters, sort, counts, facets, and pagination. `GridTable` renders the
  current page/window and emits query changes.
- A classified table is not automatically production-ready. The UI and actions
  must match the mode.

## Change Checklist

When changing table behavior:

1. Check row key, column key, and persisted-state compatibility.
2. Verify virtualization, keyboard focus, hover, context menu, and empty states.
3. Verify pagination placement, page-size behavior, visible range, and total
   exactness for query-backed tables.
4. Verify partial/degraded copy and action limits for Local Partial tables.
5. Keep shared behavior in focused table hooks rather than feature components.
6. Add tests with enough rows and columns to exercise the shared path.
7. For filter or footer changes, add interaction tests for focus retention,
   dropdown opening, and button disabled/loading behavior.

## Validation

Run targeted GridTable/consumer Vitest tests and `npm run typecheck --prefix
frontend`. For visual or interaction changes, verify in the app or Storybook.
