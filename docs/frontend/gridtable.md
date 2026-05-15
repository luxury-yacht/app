# GridTable

`GridTable` is the shared table system for resource and app data. Use it
instead of creating feature-specific tables unless there is a documented reason
the shared table contract cannot fit the workflow.

## Source Layout

Primary files live under `frontend/src/shared/components/tables/`:

| File or folder                      | Responsibility                                               |
| ----------------------------------- | ------------------------------------------------------------ |
| `GridTable.tsx`                     | Thin render shell around `useGridTableController`            |
| `GridTable.types.ts`                | Public props, column definitions, filter and width types     |
| `GridTableBody.tsx`                 | Body viewport, empty state, virtualization spacer, paging UI |
| `GridTableHeader.tsx`               | Header rendering and trailing boundary                       |
| `GridTableFiltersBar.tsx`           | Shared filter/search/export controls                         |
| `columnFactories.tsx`               | Common Kubernetes/resource column builders                   |
| `gridTableFilterEngine.ts`          | Pure local filter/search matching                            |
| `gridTableFilterState.ts`           | Default filter state and narrowing checks                    |
| `hooks/gridTableColumnWidthMath.ts` | Pure width clamping, reconciliation, and initialization math |
| `hooks/`                            | Focus, keyboard, sizing, virtualization, filters, rendering  |
| `persistence/`                      | Persisted sort, filters, widths, visibility, and resets      |
| `performance/`                      | Diagnostics samples and mode-specific labels                 |
| `@styles/components/gridtables.css` | Shared GridTable styling                                     |

`GridTable.tsx` should stay a render shell. Put orchestration in
`useGridTableController` or a focused hook. Put pure transforms in standalone
helpers that can be tested without React.

## Consumer Contract

Every table needs:

- `data`: the rows to render.
- `columns`: `GridColumnDefinition<T>[]`.
- `keyExtractor`: a stable key for the row inside the table.

For cluster data, row keys must include cluster identity. Use the shared key
helpers instead of composing ad-hoc keys, and do not drop `clusterId` when data
crosses module, cache, event, action, or navigation boundaries.

Column keys are part of persistence, keyboard behavior, CSV export, and DOM
metadata. Treat them as durable identifiers. Renaming a column key is a persisted
state migration, not a cosmetic change.

Prefer shared column factories from `columnFactories.tsx` for common resource
fields. Add a factory when multiple views need the same rendering, sort value,
or object-link behavior.

## Rendering And Controller Split

`useGridTableController` owns the cross-cutting wiring:

- filtering and filter bar actions
- sort header behavior
- focus, hover, keyboard navigation, and shortcuts
- context menus
- row and cell rendering
- column layout, resizing, visibility, and auto-width measurement
- row and column virtualization
- load-more pagination
- diagnostics/profiling

Keep new behavior in the smallest focused hook that owns the state transition.
Avoid adding unrelated state directly to `GridTable.tsx`; that makes the render
surface hard to reason about and harder to test.

## Hook Inventory

The hooks folder is intentionally split by subsystem. Use this inventory before
adding another hook or placing new state in the controller.

### Orchestration

| File                               | Responsibility                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `useGridTableController.tsx`       | Composes the table subsystems and returns the render shell contract.             |
| `useGridTableFiltersWiring.tsx`    | Connects filter state, filter bar props, CSV export, and filter reset actions.   |
| `useGridTableInteractionWiring.ts` | Connects focus, hover, row click, context menu, and row-level interaction props. |
| `useGridTableHeaderActions.tsx`    | Owns header sort clicks, header context menu state, and header menu actions.     |
| `useGridTableHeaderSyncEffects.ts` | Synchronizes header scroll/width measurements with the body viewport.            |

### Filtering And Export

| File                        | Responsibility                                                       |
| --------------------------- | -------------------------------------------------------------------- |
| `useKindFilterOptions.ts`   | Builds kind dropdown options from rows and configured filter values. |
| `useMetadataSearch.tsx`     | Builds metadata-aware search text for resource rows.                 |
| `useGridTableCsvExport.tsx` | Builds the CSV export action from visible columns and filtered rows. |

### Columns, Widths, And Layout

| File                                       | Responsibility                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `useGridTableColumnLayout.ts`              | Resolves visible columns, locked columns, width state, and layout totals.     |
| `useGridTableColumnWidths.ts`              | Owns column width state, default widths, resize events, auto-size, and reset. |
| `useGridTableColumnWidths.helpers.ts`      | Helper hooks for width state sync, measurement, and notifications.            |
| `gridTableColumnWidthMath.ts`              | Pure width clamping, flex distribution, reconciliation, and initial planning. |
| `useColumnResizeController.ts`             | Handles resize drag lifecycle and emits width changes.                        |
| `useColumnVisibilityController.ts`         | Applies column visibility changes while respecting non-hideable columns.      |
| `useGridTableExternalWidths.ts`            | Normalizes externally controlled width state into table width inputs.         |
| `useGridTableAutoWidthMeasurementQueue.ts` | Debounces auto-width remeasurement and protects user-resized columns.         |
| `useGridTableColumnMeasurer.ts`            | Measures rendered/static column content to produce natural widths.            |
| `useGridTableColumnsDropdown.ts`           | Builds the header column visibility dropdown.                                 |
| `useContainerWidthObserver.ts`             | Observes table container width changes.                                       |
| `useGridTableAutoGrow.ts`                  | Tracks auto-grow sizing behavior for the table viewport.                      |

### Virtualization And Rendering

| File                                  | Responsibility                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `useGridTableVirtualization.ts`       | Computes virtual row windows from scroll position and row estimates.            |
| `useGridTableColumnVirtualization.ts` | Computes rendered column windows while preserving sticky start/end columns.     |
| `useGridTableRowRenderer.tsx`         | Builds row and cell render output, row ids, classes, styles, and cell metadata. |
| `useGridTableHeaderRow.tsx`           | Builds header cells, resize handles, sort UI, and header actions.               |
| `useGridTableCellCache.tsx`           | Caches rendered cell content to reduce repeated render work.                    |
| `useGridTablePagination.ts`           | Owns load-more state, status text, sentinel behavior, and manual load-more.     |

### Focus, Keyboard, Hover, And Shortcuts

| File                                | Responsibility                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `useGridTableFocusNavigation.ts`    | Owns focused row key/index state and wrapper focus/blur behavior.            |
| `useGridTableKeyboardNavigation.ts` | Handles Arrow/Home/End/Page navigation and scrolls focused rows into view.   |
| `useGridTableExternalFocus.ts`      | Applies focus requests from external table/object navigation events.         |
| `gridTableFocusRequest.ts`          | Builds and matches cluster-aware external focus request identities.          |
| `useGridTableHoverSync.ts`          | Synchronizes hover state from pointer and focused row elements.              |
| `useGridTableHoverFallback.ts`      | Recovers hover state when pointer leave/DOM transitions miss a normal event. |
| `useGridTableShortcuts.ts`          | Registers table-specific shortcuts inside the active keyboard scope.         |

### Context Menus And Diagnostics

| File                                | Responsibility                                                       |
| ----------------------------------- | -------------------------------------------------------------------- |
| `useGridTableContextMenu.ts`        | Owns body context menu position, selected row, and selected column.  |
| `useGridTableContextMenuItems.tsx`  | Builds row context menu actions from built-ins and consumer actions. |
| `useGridTableContextMenuWiring.tsx` | Connects context menu state to rendered menu nodes and row handlers. |
| `useGridTableProfiler.tsx`          | Wraps table renders and records diagnostics samples.                 |
| `useFrameSampler.ts`                | Samples animation frames for scroll/render diagnostics.              |

## Identity And DOM Lookup Rules

Rows render with `data-row-key`; cells render with `data-column`. Those values
are data, not CSS selector fragments. Keys can contain characters such as `|`,
`"`, `]`, `/`, and `:` because cluster-scoped Kubernetes object identities are
not CSS-safe.

When looking up a row by key, use `findGridTableRowByKey` from
`GridTable.utils.ts`. Do not build a selector like:

```ts
wrapper.querySelector(`.gridtable-row[data-row-key="${key}"]`);
```

When matching a column by key, query a broad safe selector and compare
`element.dataset.column` in code. Do not depend on `CSS.escape` availability for
table correctness.

DOM ids should be derived with `getStableRowId`; do not use lossy replacement
logic that can collapse distinct row keys into the same id.

## Filtering

Filtering is split between:

- `useGridTableFilters` for state and derived filtered rows.
- `gridTableFilterEngine.ts` for pure local matching.
- `useGridTableFiltersWiring` for filter bar props and CSV export actions.

Use `searchBehavior: "local"` when the table owns all searchable rows. Use
`searchBehavior: "query"` when upstream query parameters shape the dataset
before rows reach the table.

Provide filter accessors when default row fields are not enough:

- `getSearchText`
- `getKind`
- `getNamespace`

Namespace filters must preserve cluster-scoped resources. If a namespace filter
should include synthetic cluster-scoped entries, use the filter options instead
of special-casing the consumer.

## Column Widths And Virtualization

GridTable supports explicit widths, min/max widths, user resizing, auto-width
columns, and column virtualization. These paths are coupled: a change to one can
affect measured widths, rendered cells, header sync, and persisted state.

Width-related behavior is owned by:

- `useGridTableColumnLayout`
- `useGridTableColumnWidths`
- `useColumnResizeController`
- `useGridTableAutoWidthMeasurementQueue`
- `useGridTableColumnMeasurer`
- `useGridTableColumnVirtualization`
- `useGridTableExternalWidths`

Auto-width measurement must ignore stale or non-rendered cells and must not
overwrite user-resized widths. If a column key is used for DOM matching, compare
against `dataset.column`; do not interpolate the key into a selector.

Virtualization defaults live in `GRIDTABLE_VIRTUALIZATION_DEFAULT`. Override
them per table only when the table has a measured behavior difference. Do not
disable virtualization to work around focus, hover, or width bugs; fix the
shared table behavior.

## Focus, Keyboard, And Hover

GridTable focus state is row-key based. The relevant hooks are:

- `useGridTableFocusNavigation`
- `useGridTableKeyboardNavigation`
- `useGridTableExternalFocus`
- `useGridTableHoverSync`
- `useGridTableHoverFallback`
- `useGridTableInteractionWiring`
- `GridTableKeys.ts`

Keyboard navigation should update row focus without depending on the current
virtual viewport. If the row is not rendered yet, scroll first and retry after
the virtual viewport updates.

External focus requests must include enough identity to avoid cross-cluster
matches. For Kubernetes objects, references crossing boundaries need
`clusterId`, `group`, `version`, `kind`, and, for concrete objects,
`namespace` and `name`.

See `docs/frontend/keyboard.md` for global shortcut and focus-surface rules.

## Persistence

GridTable persistence stores:

- sort state
- column visibility
- column widths
- filter state

The storage key is built from view identity, cluster identity, namespace scope,
and persistence mode. Use `useGridTablePersistence` or a feature wrapper around
it; do not write parallel local-storage code for table preferences.

Persistence must be pruned against the current columns and rows so removed
columns, invalid filters, and stale row-dependent state do not survive forever.
When adding persisted state, update the persistence tests and the reset path.

## Diagnostics

Tables should set `diagnosticsLabel` when the default label would be ambiguous.
Use `diagnosticsMode` to describe how counts and churn should be interpreted:

- `local`: all rows are loaded locally, then GridTable filters/sorts them.
- `query`: upstream query/filtering has already shaped the dataset.
- `live`: frequent row updates are expected.

Diagnostics mode labels and churn rules live in
`performance/gridTableDiagnosticsMode.ts`.

## Testing Expectations

Prefer focused hook/helper tests for state-heavy behavior and a small number of
component tests for integration behavior. Update the adjacent test when changing
one of these areas:

| Change area            | Tests to start with                                                |
| ---------------------- | ------------------------------------------------------------------ |
| Row rendering          | `GridTable.test.tsx`, `GridTableBody.test.tsx`, row renderer tests |
| Filters/search/export  | `useGridTableFilters.test.tsx`, `gridTableFilterEngine.test.ts`    |
| Keyboard/focus/hover   | `useGridTableKeyboardNavigation.test.tsx`, focus and hover tests   |
| Widths/resizing/layout | column width, resize, layout, measurer, and auto-width tests       |
| Virtualization         | `useGridTableColumnVirtualization.test.tsx`, GridTable tests       |
| Persistence            | tests under `persistence/`                                         |
| Context menus          | context menu and wiring tests                                      |

Regression tests for keys must include selector-sensitive characters. Simple
alphanumeric keys do not prove the multi-cluster/resource identity path is safe.

## Change Checklist

Before changing GridTable behavior:

1. Identify whether the change belongs in the public props, controller wiring,
   a focused hook, a pure helper, or a consumer.
2. Preserve cluster-aware row identity and object references.
3. Keep column keys stable unless intentionally migrating persisted state.
4. Check virtualization, keyboard focus, column widths, and persistence for
   side effects.
5. Add or update the focused tests for the affected subsystem.
6. Run the relevant frontend tests, then the project-required final checks for
   non-documentation changes.
