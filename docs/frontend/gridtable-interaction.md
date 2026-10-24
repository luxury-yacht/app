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
  `onRowClick`. `Space` only ever expands or collapses rows: it runs
  `onRowExpandToggle` for the focused row, which only tables whose rows expand
  supply (Workloads and Nodes row details, log rows that expand in place). In
  any other table Space does nothing; the table claims it so the body does not
  scroll, while a focused row control keeps its native Space.
  Pointer-only selection uses `onRowPointerClick`, which excludes
  interactive descendants. A view that enables selection supplies
  `isRowSelected` so the shared row renderer owns the selected class,
  `data-row-selected`, and `aria-selected`. A primary click on unused space in
  the scrollable body clears the focused-row highlight; controlled-selection
  views supply `onRowSelectionClear` to clear selection at the same boundary.
  Keyboard row moves (arrows, Page Up/Down, Home/End) also clear it, so the
  highlight follows the keyboard instead of staying on the row it was made on,
  and so does focus entering an expanded row's nested table by click or key.
  Descendant rows, cells, and controls are excluded.
- Workloads and Nodes open a row's Pods under it ([row detail](#row-detail))
  from the row's Pods count or `Space`, which also highlight the row; a pointer
  click only highlights; `Enter` and the Kind/Name links still open the object.
  Any number of rows can be open; `useOpenRowDetails` owns them. The highlight
  lives only while the view is mounted and clears when the scope changes. Open
  rows are kept per cluster, view, and namespace until the cluster closes, so
  returning to the view, namespace, or cluster tab shows them open again. Each
  clears when its row leaves the settled rows (`useClearHiddenRowSelection`),
  including a row on another page, since a view starts on page 1.
  Pod jumps land in the Pods view, never an attached table.
- Shared filter and Columns dropdown menus measure both viewport axes on open:
  right-edge menus end-align when start alignment would overflow, and width stays
  capped to the visible viewport. The menus are portaled, so under CSS app zoom
  convert the visually scaled trigger `getBoundingClientRect()` into unscaled CSS
  coordinates before combining it with fixed `left`/`top`,
  `offsetWidth`/`offsetHeight`, or the zoom-adjusted viewport dimensions.
- The same holds inside the table: virtual row and detail heights, the hover
  overlay, page size, and row reveal divide `getBoundingClientRect()` values by
  `getAppZoomFactor()` before mixing them with `scrollTop`, `clientHeight`, or
  virtual positions. At 100% the conversion is a no-op, so check measurement
  changes at 50% and 200% zoom.

## Row detail

- `rowDetail` (`openRowKeys`, `render`, `getLabel`, optional
  `getGroupClassName`) shows each open row's
  content in a native detail row directly under it: a full-width cell holding a
  labelled region whose id is `getGridTableRowDetailId(rowKey)`.
  `withRowDetailToggle` turns a count column into the opener ("2/3 ›") with
  `aria-expanded` and `aria-controls`; the view owns which rows are open. A
  nested table can also close its own detail with a Close in
  `filters.options.trailingActions`, which sits at the end of its filter bar.
- The accent rail and highlight background mark only selected, focused, and
  hovered rows, so a selected row beside an open detail never reads as part of
  it. When an open row is selected or focused, its detail (always rendered
  right after it) takes the same highlight and rail, so the group changes as
  one block. An open row and its detail are tinted together: `getGroupClassName`
  adds a kind color slot (`getKindColorClass`, the kind badge's color via
  `--kind-color`) to both, and the detail's padding shows the tint as a band
  around the nested table; without it the tint is neutral. Its content stays
  pinned to the visible width and is capped at a share of the table viewport;
  a nested table renders `embedded`, sizes to its rows up to the cap, then
  scrolls inside. Opening scrolls that detail into view once, vertically only
  (see the row-reveal rule in `keyboard.md`).
- The virtualizer adds each detail's measured height to its open row's span, and
  open rows stay mounted outside the virtual window so nested tables keep their
  state. Each detail is keyed by row identity, so it follows its row through
  sorting and refreshes, and opening or closing another row leaves it intact.
- A nested table owns its focus and keys. The parent treats focus and pointer
  input inside its detail as not its own, so only the nested table's shortcuts
  run; `Escape` from a detail (outside text inputs) returns to that detail's
  row, and so does closing the detail while focus is inside it.
- Keyboard navigation follows the screen (`RowDetailNavigationContext`,
  `useGridTableRowDetailNavigation`, `useGridTableScreenOrderNavigation`).
  One table holds the keyboard at a time, either the parent's rows or one
  detail's nested table, and only that table shows a row highlight.
  - Up/Down walk the rows in screen order: from an expanded row into its nested
    table's first row, from its last row on to the next parent row, and back.
  - Alt+Up/Alt+Down move between parent rows, skipping expanded tables (from a
    nested table, to its own row or the next one).
  - Home/End reach the first or last row on screen. Page Up/Down stay within
    the table holding the keyboard.
  - Tab order is the filter bars above the keyboard, its table's rows, the
    highlighted row's controls, then out. The parent's rows leave Tab order
    while a nested table holds the keyboard. Other details are marked
    `data-focus-trap-ignore`, so Shift+Tab retraces Tab exactly.
  - Cmd/Ctrl+F focuses the filter of the table holding the keyboard. Escape in
    any table's filter bar returns to its rows and keeps the filter.
  Shared DOM queries that search a wrapper or table use
  `queryOwnGridTableElements`/`isInNestedRowDetail` so they never reach a nested
  table's rows, cells, or controls. The parent already takes the dock offsets,
  so a nested table inside the detail does not.

## DOM And Identity Rules

- Rows render `data-row-key` and cells `data-column`; treat them as data. Look
  rows up with shared helpers or `dataset` comparisons; never build CSS
  selectors from raw row or column keys, which may not be selector-safe.
- Rows carry no DOM id, so tables showing the same rows (open details listing
  one pod) never repeat an id. A detail region's id comes from
  `getGridTableRowDetailId`, which cannot collapse distinct cluster-scoped row
  keys.

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
