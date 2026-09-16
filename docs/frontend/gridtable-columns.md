# GridTable Columns

Use with the [shared GridTable contract](gridtable.md). Read only the sections
selected by the column change. Custom label/annotation columns have a separate
[metadata contract](gridtable-metadata.md). Width measurement and resizing follow
[column sizing](gridtable-sizing.md).

## Column definitions

- Column keys are durable persistence identifiers. Renaming one is a migration,
  not cosmetic cleanup.
- A persisted column order reconciles against the declared columns: stale keys
  drop, and a column the stored order has never seen enters at its declared
  position (after its nearest declared predecessor), never appended after the
  user's trailing column — so a view can add columns without breaking saved
  layouts (`reconcileColumnOrder`).
- Column capabilities are declarative. Set `hideable: false` or
  `resizable: false` on the definition; the shared table must not infer either
  capability from `name`, `kind`, `type`, `age`, or another key.
- Use `createResourceNameColumn` for Kubernetes resource identity. It keeps the
  Name column visible while still allowing the user to move and resize it.
- Use `createKindColumn` when Kind badge presentation is wanted. A plain column
  whose key happens to be `kind` or `type` remains plain.
- Column header and data alignment are independent: use `alignHeader` and
  `alignData` with `left`, `center`, or `right`. Each defaults to `left` when
  omitted; use `className` only for styling outside this alignment contract.
- Prefer shared column factories for common Kubernetes/resource fields.
- Use `createDetailSegmentsColumn` for backend `DetailSegment[]` details fields
  (multi-kind tables). The backend tags each segment with a semantic slot
  (reference/address/counts); the namespace Network view maps them to stable
  **Context**, **Network**, and **Summary** columns so mixed-kind rows remain
  vertically aligned. Kind-specific meaning belongs in each segment label
  (`Class`, `Parent`, `Type`, `Hosts`, `Ports`), not in slash-separated column
  headings. The namespace Network view renders labeled values separated by dots
  and applies presentation tokens to exceptional values without boxing ordinary
  counts. In a narrow text column, keep the label visible and truncate only the
  value within the remaining width. Resolvable `ResourceLink` segments become
  cross-object link buttons and suppress the parent row action. Collapsed list
  values ("first +N") carry their full text
  in the tooltip via the segment's `search` field. Auto-width relies on the
  measurer's render-replica fallback,
  so do not add `measurementText`. Do not re-render segment lists with ad-hoc
  cells.
- An absent table value renders as the ASCII hyphen-minus (`-`) in
  `--color-text-tertiary`. `GridTable` normalizes both `-` and the legacy em
  dash through `tableNoValue`; native tables must render potentially absent
  scalar values through `TableCellValue`. Copy and CSV export use the same
  canonical hyphen.

## Columns menu

- The Columns trigger reports table state the way the other filter dropdowns do:
  plain `Columns` while every column is shown, and `Columns (N hidden)` once the
  user hides one — the count names what is missing rather than making the reader
  subtract shown-from-total. Column visibility persists per cluster and view, so the
  closed control must stay the place that discloses it.
- The Columns menu lists every column in current display order. Visibility
  toggles remain disabled for required columns, while every row—including
  Name—can be dragged to reorder. The whole row is the drag target; the grip is
  the affordance that says so and the keyboard entry point. Tab from the open
  Columns trigger focuses the first grip; a focused grip supports Up and Down
  Arrow keys. The menu's top-to-bottom order maps to the table's left-to-right
  column order. Reordering and visibility are independent, and the shared
  All/None actions affect hideable columns only.
- When the Columns menu exposes mutable order controls, visible column headers
  are also whole-cell drag targets. Tables without that menu, and controlled
  tables without an order-change callback, do not advertise reordering. A
  visual grip appears on hover immediately before the column label; keyboard
  reordering remains on the focusable grip in the Columns menu. Header dragging
  uses the tab strip's midpoint insertion model and the Columns menu's
  grab/grabbing, dimming, and accent-marker styling. Dropping updates the same
  order model as the Columns menu. A drop that leaves the visible sequence
  unchanged does not rewrite hidden-column placement. Resize handles remain
  resize-only and suppress native drag initiation when resizing starts.
- Option presentation is owned by the shared `DropdownFilterOption`, not by each
  menu. A required column renders as a locked control state with the label at
  full contrast and an `Always shown` title; it must never be explained with an
  extra word in the row. The menu carries `dropdown-columns-menu` so it can opt
  out of the shared disabled styling, because dimming a label while its
  still-usable drag handle stays at full strength is the state this prevents.
- The Columns menu is the only place that dims an unselected label
  (`dimWhenOff`), because there "off" means the column is absent from the table.
  Filter menus must not adopt it: most of their options are off by default, so
  dimming would flag the normal case as an anomaly.
- `Reset` is one recovery action for column preferences: it restores the column
  definitions' declaration order, shows every hideable column, and returns every
  `autoWidth` column to automatic measurement. Manually sized non-auto columns
  remain user-owned. Reset is enabled whenever order, visibility, or automatic
  width ownership differs from its default, and it is separated from All/None in
  the menu's action bar because it is a different kind of verb. Do not
  reintroduce partial reset actions — recovering a table must not take multiple
  actions in multiple models.

## Sorting

- Sort keys emitted by `GridTable` must be visible column keys. Hidden data
  fields such as timestamps may be used by a column `sortValue`, but must not be
  published as active table sort keys.
- Age columns should render relative text from `ageTimestamp` through the
  live-age contract in [live-age.md](live-age.md). `createAgeColumn` owns the
  timestamp sort value and parses compact fallback text only when a timestamp is
  unavailable; the generic sorting hook never infers Age semantics from a key.
- Query-backed table columns may be `sortable: true` only when the backend
  adapter supports that exact column key, or a documented alias for it, as a
  global query sort.
- Do not expose hydrated post-page fields as sortable query columns. If the
  backend cannot sort the complete matching dataset by a field, the column must
  be non-sortable or the backend contract must be expanded first.
- Production query-backed resource views should be covered by a rendered-column
  contract test that compares their sortable keys against the supported query
  sort contract.

## Age And Metrics Columns

- Age is display-time relative text. Use `createAgeColumn` or `LiveAgeText` with
  an absolute timestamp; do not refetch rows only to advance age text.
- Age headers and data are right-aligned in every table. Use `createAgeColumn`,
  which owns that alignment default, when adding an Age column.
- Resource utilization columns should use the shared value adapters in
  `frontend/src/core/resource-metrics`. Table rows can use adapters directly
  because many table row shapes do not carry full object GVK identity.
- Global metric-backed sorts belong to backend query contracts and metric source
  clocks. Do not locally sort a query-backed table by CPU or memory over the
  current page.
- Metric-bearing resource tables issue ONE base-domain query per page: live
  CPU/memory usage is joined onto the rows at serve, and CPU/memory sorts run
  server-side on the joined values through the same keyset cursor as every
  other sort. There are no separate metric domains, no metric-row overlay, and
  no client-side metric merge
  (see [`resource-metrics.md`](../architecture/resource-metrics.md)).
