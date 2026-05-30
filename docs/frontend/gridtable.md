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

## Change Checklist

When changing table behavior:

1. Check row key, column key, and persisted-state compatibility.
2. Verify virtualization, keyboard focus, hover, context menu, and empty states.
3. Keep shared behavior in focused table hooks rather than feature components.
4. Add tests with enough rows and columns to exercise the shared path.

## Validation

Run targeted GridTable/consumer Vitest tests and `npm run typecheck --prefix
frontend`. For visual or interaction changes, verify in the app or Storybook.
