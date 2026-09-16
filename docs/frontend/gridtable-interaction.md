# GridTable Interaction

Read for row activation/selection, focus, dropdown placement, dock offsets,
virtualization, or native table accessibility. Apply the [shared contract](gridtable.md).
Column measurement and resizing are in [column sizing](gridtable-columns.md#column-sizing).

## Interaction boundaries

- Interactive cell actions must declare whether they also participate in the
  row action. Shared interactive column factories expose `allowRowClick` for
  that distinction. Set it to `false` whenever the cell and row open different
  targets; a Kind badge or related-object link that opens independently must
  suppress row activation.
- Do not build CSS selectors from raw row or column keys; keys may contain
  characters that are not selector-safe.
- In the main content area, the filter container, header, body viewport, and
  footer consume the right-dock offset. No GridTable chrome may remain beneath
  a right-docked panel; closing the panel must resize and repaint each region.
- The current keyed row's embedded links/buttons join Tab order. Shared
  `useGridTableRowControls` updates committed rows and restores table focus
  when a focused control disappears or becomes unavailable. Other rows stay
  outside the sequential order. Escape returns from a child to row navigation;
  its Enter/Space activation remains independent of row activation.
- Row focus and row selection are separate contracts. `Enter` runs
  `onRowClick`; when `onRowSelectionToggle` is supplied, `Space` runs that
  selection action instead. Pointer-only selection uses `onRowPointerClick`,
  which excludes interactive descendants. A view that enables selection must
  supply `isRowSelected` so the shared row renderer owns the selected class,
  `data-row-selected`, and `aria-selected`. A primary click on unused space in the
  scrollable table body clears the focused-row highlight; controlled-selection
  views supply `onRowSelectionClear` to clear their selected state at the same
  boundary. Descendant rows, cells, and controls are excluded.
- Shared filter and Columns dropdown menus measure both viewport axes when they
  open. Right-edge menus end-align when start alignment would overflow, and menu
  width remains capped to the visible viewport. Because these menus are
  portaled, positioning under CSS app zoom must convert the visually scaled
  trigger `getBoundingClientRect()` into unscaled CSS coordinates before
  combining it with fixed `left`/`top`, `offsetWidth`/`offsetHeight`, or the
  zoom-adjusted viewport dimensions.

## DOM And Identity Rules

Rows render with `data-row-key`; cells render with `data-column`. Treat these as
data. For lookup, use shared helpers or compare `dataset` values in code instead
of interpolating keys into selectors.

DOM ids must use stable helper functions that cannot collapse distinct
cluster-scoped row keys.

### Accessibility model

`GridTable` renders native `table`, `thead`, `tbody`, `tr`, `th`, and `td`
elements. The table is the single keyboard entry point; Arrow, Home, End, Page
Up, and Page Down update the focused-row state while DOM focus stays on the
table, so recycling a virtual row never moves focus to an element that can
unmount. Virtual rows remain direct `tbody` children and are positioned from the
virtualizer's per-row top offsets.

The body table lives inside a distinct `.gridtable-wrapper` scroll viewport.
Keep scrolling, viewport measurement, virtualization, and header synchronization
bound to the wrapper while focus remains on the native table. Collapsing those
elements into one prevents the scroll viewport from constraining content wider
than itself and removes horizontal scrolling.

Plain Left/Right arrows retain native horizontal scrolling. Paginated tables use
Ctrl+Left/Right off macOS and Command+Left/Right on macOS for previous/next page;
the modified shortcut remains unhandled when its page direction is unavailable.

Sortable column labels are native buttons. Column and docked-layout resize
separators are keyboard focusable and support arrow keys plus Home and End. Keep
the native elements centralized in `AriaGridPrimitives.tsx`. Production grids,
app-log grids, tests, and stories must reuse those primitives or `GridTable` so
virtualization cannot regress to synthetic table roles.
