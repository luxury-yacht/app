# GridTable Contract

`GridTable` is the shared table system for resource and app data. Do not create
feature-specific table systems unless the shared contract cannot fit the
workflow and that exception is documented.

## Task routes

Read the shared rules below, then only the matching reference sections.

| Change | Reference |
| --- | --- |
| Column definitions, persistence, Columns menu, sorting, age or metrics | [Columns](gridtable-columns.md) |
| Width measurement, auto-width or resizing | [Column sizing](gridtable-columns.md#column-sizing) |
| User-defined label or annotation columns | [Custom metadata columns](gridtable-columns.md#custom-metadata-columns) |
| Row actions, selection, focus, virtualization, native table semantics or dropdown placement | [Interaction](gridtable-interaction.md) |
| Search, filters, facets, filter chips, Download, navigation or favorites | [Filtering](gridtable-filtering.md) |
| Pagination, loading/empty/partial states, source adapters or adding a resource table | [Resource tables](gridtable-resource-tables.md) |
| Table modes, backend queries, completeness or scale | [Large data](../architecture/large-data.md) |
| New resource tables, source migrations, watch coverage or stale rows | [Required freshness evidence](../architecture/data-freshness.md#required-evidence-for-resource-source-changes) |

## Shared rules

- Use `GridTable` for sortable/filterable tables.
- Every row needs a stable `keyExtractor`; cluster data row keys include cluster
  identity.
- Keep rendering, filtering, sorting, focus, keyboard, context menus,
  persistence, and virtualization in the shared table system, as focused table
  hooks rather than feature-component logic.
- Do not disable virtualization to work around focus, hover, width, or context
  menu bugs.

## Ownership

- Component and types: `frontend/src/shared/components/tables/GridTable.tsx`,
  `GridTable.types.ts`
- Shared resource columns: `frontend/src/shared/components/tables/columnFactories.tsx`
- Filtering, persistence, virtualization, focus, and sizing:
  `frontend/src/shared/components/tables`
- Global table CSS: `frontend/styles/components/gridtables.css`
- Keyboard/focus rules: [keyboard.md](keyboard.md)

## Change checklist

- Keep row keys, column keys, and persisted state compatible.
- Verify virtualization, keyboard focus, hover, context menu, and empty states
  with enough rows and columns to exercise the shared path. Accessibility changes
  also verify the wrapper's active descendant, row/cell roles, native sort
  buttons, and separator value attributes.
- Verify pagination placement, page size, visible range, total exactness, and
  reset/clamp behavior for the table's mode, plus partial copy and action limits
  for `Local Partial` tables.
- Filter and footer changes need interaction tests proving controlled search
  keeps focus across updates, rows-per-page and filter dropdowns open and
  dispatch supported values, and buttons show disabled/loading state.
