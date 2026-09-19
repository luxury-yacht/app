# GridTable Contract

`GridTable` is the shared table system for resource and app data. Do not create
feature-specific table systems unless the shared contract cannot fit the
workflow and that exception is documented.

## Task routes

Read the shared rules below, then only the matching reference and its selected
sections. Trace related consumers before expanding to another table contract.

| Change | Reference |
| --- | --- |
| Column definitions, persistence, visibility, ordering, sorting, age or metrics | [Columns](gridtable-columns.md) |
| Width measurement, auto-width or resizing | [Column sizing](gridtable-sizing.md) |
| User-defined label or annotation columns | [Custom metadata columns](gridtable-metadata.md) |
| Row actions, selection, focus, virtualization, native table semantics or dropdown placement | [Interaction](gridtable-interaction.md) |
| Search, filters, facets, filter chips, navigation or favorites | [Filtering](gridtable-filtering.md) |
| Pagination, loading/empty/partial states, source adapters or adding a resource table | [Resource tables](gridtable-resource-tables.md) |
| Backend queries, completeness or scale | [Large data](../architecture/large-data.md) |
| New resource tables, source migrations, watch coverage or stale rows | [Required freshness evidence](../architecture/data-freshness.md#required-evidence-for-resource-source-changes) |

## Agent Contract

- Use `GridTable` for sortable/filterable resource tables.
- Every row needs a stable `keyExtractor`; cluster data row keys must include
  cluster identity.
- Keep rendering, filtering, sorting, focus, keyboard, context menus,
  persistence, and virtualization in the shared table system.
- Do not disable virtualization to work around focus, hover, width, or context
  menu bugs.

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

## Change Checklist

When changing table behavior:

1. Check row key, column key, and persisted-state compatibility.
2. Verify virtualization, keyboard focus, hover, context menu, and empty states.
   For accessibility changes, also verify the wrapper's active descendant,
   row/cell roles, native sort buttons, and separator value attributes.
3. Verify pagination placement, page-size behavior, visible range, total
   exactness, and reset/clamp behavior for the table's local or query-backed
   mode.
4. Verify partial/degraded copy and action limits for Local Partial tables.
5. Keep shared behavior in focused table hooks rather than feature components.
6. Add tests with enough rows and columns to exercise the shared path. New
   resource tables and changes to sources, watches, caches, or signals must also
   satisfy the [freshness acceptance checks](../architecture/data-freshness.md#required-evidence-for-resource-source-changes).
7. For filter or footer changes, add interaction tests for focus retention,
   dropdown opening, and button disabled/loading behavior.

## Validation

Run targeted GridTable/consumer Vitest tests and `npm run typecheck --prefix
frontend`. For visual or interaction changes, verify in the app or Storybook.
