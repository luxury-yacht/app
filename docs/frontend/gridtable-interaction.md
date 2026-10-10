# GridTable Interaction

Row activation and selection, focus, dropdown placement, dock offsets,
virtualization, and native table accessibility. Apply the
[shared contract](gridtable.md); column measurement and resizing are in
[column sizing](gridtable-columns.md#column-sizing).

## Interaction boundaries

- Interactive cell actions declare whether they also trigger the row action
  through the shared factories' `allowRowClick`. Set it to `false` whenever the
  cell and row open different targets; a Kind badge or related-object link that
  opens independently suppresses row activation.
- In the main content area, the filter container, header, body viewport, and
  footer consume the right-dock offset; no GridTable chrome stays beneath a
  right-docked panel, and closing the panel resizes and repaints each region.
- Row-control Tab order and focus recovery follow [keyboard.md](keyboard.md);
  shared `useGridTableRowControls` implements them on committed rows and
  restores table focus when the focused control is removed, disabled, or
  hidden.
- Row focus and row selection are separate contracts. `Enter` runs
  `onRowClick`; when `onRowSelectionToggle` is supplied, `Space` runs it
  instead. Pointer-only selection uses `onRowPointerClick`, which excludes
  interactive descendants. A view that enables selection supplies
  `isRowSelected` so the shared row renderer owns the selected class,
  `data-row-selected`, and `aria-selected`. A primary click on unused space in
  the scrollable body clears the focused-row highlight; controlled-selection
  views supply `onRowSelectionClear` to clear selection at the same boundary.
  Descendant rows, cells, and controls are excluded.
- Workloads and Nodes open a row's Pods under it ([row detail](#row-detail))
  from the row's Pods count or `Space`, which also highlight the row; a pointer
  click only highlights; `Enter` and the Kind/Name links still open the object.
  Highlight and open row live only while the view is mounted and clear when
  their row leaves the settled rows (`useClearHiddenRowSelection`) or the scope
  changes. Pod jumps land in the Pods view, never an attached table.
- Shared filter and Columns dropdown menus measure both viewport axes on open:
  right-edge menus end-align when start alignment would overflow, and width stays
  capped to the visible viewport. The menus are portaled, so under CSS app zoom
  convert the visually scaled trigger `getBoundingClientRect()` into unscaled CSS
  coordinates before combining it with fixed `left`/`top`,
  `offsetWidth`/`offsetHeight`, or the zoom-adjusted viewport dimensions.

## Row detail

- `rowDetail` (`openRowKey`, `render`, `getLabel`) shows one open row's content
  in a native detail row directly under it: a full-width cell holding a
  labelled region whose id is `getGridTableRowDetailId(rowKey)`.
  `withRowDetailToggle` turns a count column into the opener ("2/3 ›") with
  `aria-expanded` and `aria-controls`; the view owns which row is open.
- The detail and the open row share the accent rail. Its content stays pinned to
  the visible width and is capped at a share of the table viewport; a nested
  table renders `embedded`, sizes to its rows up to the cap, then scrolls inside.
  Opening scrolls the detail into view once.
- The virtualizer adds the detail's measured height to the open row's span, and
  the open row stays mounted outside the virtual window so a nested table keeps
  its state. The detail is keyed by row identity, so it follows its row through
  sorting and refreshes.
- A nested table owns its focus and keys. The parent treats focus and pointer
  input inside its detail as not its own, so only the nested table's shortcuts
  run; `Escape` from the detail (outside text inputs) returns to the open row.
  Shared DOM queries that search a wrapper or table use
  `queryOwnGridTableElements`/`isInNestedRowDetail` so they never reach a nested
  table's rows, cells, or controls. The parent already takes the dock offsets,
  so a nested table inside the detail does not.

## DOM And Identity Rules

- Rows render `data-row-key` and cells `data-column`; treat them as data. Look
  rows up with shared helpers or `dataset` comparisons; never build CSS
  selectors from raw row or column keys, which may not be selector-safe.
- DOM ids use stable helper functions that cannot collapse distinct
  cluster-scoped row keys.

### Accessibility model

- `GridTable` renders native `table`, `thead`, `tbody`, `tr`, `th`, and `td`.
  The table is the single keyboard entry point (Arrow, Home, End, Page Up/Down
  move the focused row; DOM focus stays on the table). Virtual rows stay direct
  `tbody` children positioned from the virtualizer's per-row top offsets.
- The body table lives inside a distinct `.gridtable-wrapper` scroll viewport.
  Bind scrolling, viewport measurement, virtualization, and header
  synchronization to the wrapper while focus stays on the native table; merging
  the two stops the viewport from constraining wider content and removes
  horizontal scrolling.
- Plain Left/Right keep native horizontal scrolling. Paginated tables use
  Ctrl+Left/Right (Command+Left/Right on macOS) for previous/next page; the
  shortcut stays unhandled when that direction is unavailable.
- Sortable column labels are native buttons; column and docked-layout resize
  handles are keyboard-adjustable separators. Native elements stay centralized in
  `AriaGridPrimitives.tsx`; production grids, app-log grids, tests, and stories
  reuse those primitives or `GridTable` so virtualization cannot regress to
  synthetic table roles.
