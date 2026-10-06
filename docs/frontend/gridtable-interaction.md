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
- Shared filter and Columns dropdown menus measure both viewport axes on open:
  right-edge menus end-align when start alignment would overflow, and width stays
  capped to the visible viewport. The menus are portaled, so under CSS app zoom
  convert the visually scaled trigger `getBoundingClientRect()` into unscaled CSS
  coordinates before combining it with fixed `left`/`top`,
  `offsetWidth`/`offsetHeight`, or the zoom-adjusted viewport dimensions.

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
