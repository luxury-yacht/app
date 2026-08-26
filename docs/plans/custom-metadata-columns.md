# Custom metadata columns

Status: Implemented; validation pending

Selected direction: **A — Columns menu as the hub** (2026-08-25)

## Goal

Let a user add a table column whose value comes from one Kubernetes label or
annotation. Rows without that exact metadata key render the shared `-`
placeholder. The feature should work across table families without weakening
GridTable ordering, visibility, sizing, copy/export, favorites, or query-backed
sorting contracts.

## Current constraints

- A column `key` is durable identity for GridTable presentation state. Custom
  columns therefore need a stable semantic key that is independent of an
  editable display name (`frontend/src/shared/components/tables/GridTable.types.ts`).
- Column order is controlled state and reconciles persisted keys against the
  currently declared definitions. Custom definitions must be restored before
  GridTable persistence prunes unknown keys
  (`frontend/src/shared/components/tables/gridTableColumnOrder.ts`,
  `frontend/src/shared/components/tables/gridTablePersistence.ts`).
- Text columns already render `undefined` and `null` as `-`; the custom accessor
  should return `undefined` when a row lacks the configured key
  (`frontend/src/shared/components/tables/columnFactories.tsx`).
- Browse catalog rows currently expose a labels digest rather than the label and
  annotation maps required to resolve arbitrary keys
  (`frontend/src/modules/browse/hooks/useBrowseColumns.tsx`,
  `backend/objectcatalog/types.go`).
- Query-backed sort is global and provider-owned. A custom column must remain
  non-sortable until its provider can sort the complete matching dataset by the
  exact metadata key (`docs/frontend/gridtable.md`,
  `backend/refresh/snapshot/catalog.go`).

## Product contract

- A custom definition contains: source (`label` or `annotation`), exact metadata
  key, and editable column heading.
- Durable identity is `metadata:<source>:<key>`. Renaming a heading does not
  reset its width, order, visibility, or favorite reference.
- The same source/key pair may exist only once in one table view. A label and an
  annotation with the same key remain distinct columns.
- A newly created column is visible, appended after existing columns, hideable,
  resizable, and automatic-width. It is initially non-sortable in every table
  mode.
- A missing key returns `undefined` and therefore displays/copies/exports as the
  shared `-` placeholder. A present-but-empty metadata value remains blank.
- Reset restores presentation defaults but never deletes custom definitions.
  Removal is an explicit destructive action in custom-column management.
- Definitions use GridTable's existing cluster/view/namespace persistence key,
  including its configured shared-versus-namespaced persistence mode.
- Favorites reference custom columns by durable key but do not own or recreate
  their definitions. Loading a favorite after its definition was removed
  ignores and reconciles away that unavailable column key.

## Selected UI contract

The first implementation will extend the existing Columns dropdown rather than
add a second toolbar picker or a separate manager:

- “Add custom” is a labeled action in the Columns menu action bar.
- Every column remains in one ordered visibility list. Custom-column rows add an
  Edit action beside the existing reorder control.
- Add opens a focused modal for source, exact metadata key, and column heading.
- Edit preserves the stable definition identity. Source and metadata key are
  read-only; the heading can be renamed and the column can be explicitly
  removed.
- A new definition is visible and appended. Hiding is reversible presentation
  state; removing deletes the definition. These actions must never be conflated.
- The existing Columns reset continues to restore visibility, declaration order,
  and automatic widths without removing custom definitions.
- Variants B (quick add) and C (dedicated manager) are not part of the first
  implementation. Revisit a larger manager only if observed metadata inventories
  make the Columns menu demonstrably hard to use.

## Explored UI approaches

### A. Columns menu as the hub

Extend the existing Columns dropdown with an “Add custom column” action. Custom
rows receive an adjacent edit action while all rows retain the current checkbox,
drag-row, and keyboard reorder behavior. This keeps creation and management in
the place users already visit for column presentation.

**Verdict: selected.** It preserves the current GridTable mental model and makes
the distinction between hide, reorder, reset, edit, and remove visible in one
place.

### B. Quick add beside filters

Keep the existing Columns dropdown unchanged. Add a searchable “+ Column”
picker beside the table filters for one-step addition from observed metadata,
plus a compact custom-column management entry. This optimizes frequent addition
without increasing the complexity of the existing menu.

**Verdict: not selected for the first implementation.** It creates a second
column entry point and separates creation from presentation management.

### C. Dedicated manager

Replace the small Columns dropdown with a “Manage columns” action that opens a
larger two-pane surface: available metadata on the left, active columns on the
right. Visibility, order, add, edit, and remove live together. This supports
large metadata inventories at the cost of a heavier interaction.

**Verdict: not selected for the first implementation.** It is more surface area
than the initial workflow requires, but remains a fallback if the menu cannot
handle real metadata cardinality.

The Storybook comparison remains throwaway reference material only until the
selected behavior is rewritten test-first in production code. Delete the losing
variants and shared prototype switcher as the production UI is absorbed.

## Data and lifecycle contract to resolve

1. Define a shared custom-column model and persistence owner keyed by cluster and
   table-view identity.
2. Make label/annotation values available to every supported row source without
   per-table fetches. Trace Browse catalog, refresh-backed static, live, and
   metrics-backed tables independently.
3. Restore custom definitions before column visibility/order/width state is
   reconciled.
4. Project custom values through the same render and canonical copy/export path.
5. Keep local and query-backed sorting honest; only advertise metadata sorting
   where the upstream provider implements complete-dataset ordering.
6. Define favorite behavior for create, rename, delete, and missing-definition
   recovery.

## Test-first implementation slices

1. Model and persistence: failing tests for durable identity, duplicate
   rejection, scope isolation, hydration order, rename stability, and deletion.
2. Shared projection: failing tests for label value, annotation value, missing
   key (`-`), and present-empty behavior once decided.
3. GridTable integration: failing tests for append order, visibility, resize,
   reorder, reset-without-delete, copy/export, and favorites.
4. Source adapters: one failing contract test per table mode proving metadata is
   available with complete cluster/object identity and without per-row requests.
5. UI: interaction and keyboard tests for create, edit, hide, reorder, reset,
   duplicate validation, and delete.
6. Rendered validation: exercise populated, partially missing, empty, loading,
   query-backed, and favorite-restoration states in the Wails UI.

## Resolved first-release decisions

- The metadata key input is free-form and exact; observed-key suggestions are
  deferred.
- The initial heading humanizes the final path segment and remains editable.
- A present empty string renders blank; only absence renders `-`.
- Definition scope follows the existing GridTable persistence scope.
- Favorites do not recreate deleted definitions.
- Arbitrary metadata columns remain non-sortable.
