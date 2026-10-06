# GridTable Columns

Column definitions, the Columns menu, sorting, sizing, and custom metadata
columns. Apply the [shared GridTable contract](gridtable.md).

## Column definitions

- Column keys are durable persistence identifiers; renaming one is a migration.
- Persisted order reconciles against declared columns (`reconcileColumnOrder`):
  stale keys drop; a never-seen column enters after its nearest declared
  predecessor, never after the user's trailing column.
- Default resource-table order: Kind, Name, Namespace, Status, view-specific
  columns, Age. A table showing Namespace only in All Namespaces adds it with
  `withNamespaceColumn` after Name (Events, which has no Name column: after
  Object Name). Status, or the view's state column, follows the identity
  columns; the only exception is Type (Normal/Warning), second in the Events
  tables.
- Capabilities are declarative: set `hideable: false` or `resizable: false` on
  the definition. The shared table never infers either from `name`, `kind`,
  `type`, `age`, or another key.
- `createResourceNameColumn` owns Kubernetes resource identity: always visible,
  still movable and resizable. `createKindColumn` adds the Kind badge; a plain
  column keyed `kind` or `type` stays plain.
- Header and data alignment are independent: `alignHeader` / `alignData` take
  `left` (default), `center`, or `right`; use `className` only for styling
  outside alignment.
- Prefer shared column factories for common Kubernetes/resource fields.
- `createDetailSegmentsColumn` renders backend `DetailSegment[]` fields
  (multi-kind tables); never re-render segments with ad-hoc cells. Backend
  semantic slots (reference/address/counts) map to the namespace Network view's
  stable **Context**, **Network**, and **Summary** columns so mixed-kind rows
  align. Kind-specific meaning goes in segment labels (`Class`, `Parent`,
  `Type`, `Hosts`, `Ports`), not slash-separated headings. Values render
  dot-separated, tokens only on exceptional values (no boxed ordinary counts); in
  narrow columns only the value truncates. Resolvable `ResourceLink` segments
  become link buttons that suppress the row action. Collapsed lists
  ("first +N") put full text in the tooltip via the segment's `search` field.
  Auto-width uses the measurer's render-replica fallback; no `measurementText`.
- An absent value renders as ASCII `-` in `--color-text-tertiary`. `GridTable`
  normalizes `-` and the legacy em dash through `tableNoValue`; native tables
  render potentially absent scalars through `TableCellValue`. Copy and CSV use
  the same hyphen.
- CPU and memory columns (`createResourceBarColumn`) export plain integers
  (millicores, KiB) under `CPU (m)` / `Memory (KiB)` (`exportHeader`) so
  spreadsheets can sort and total them; cells keep display units.

## Columns menu

- The trigger reads `Columns`, or `Columns (N hidden)` once any is hidden;
  visibility persists per cluster and view, so the closed control discloses it.
- The menu lists every column in display order (top-to-bottom =
  left-to-right). Required columns' visibility toggles are disabled, but every
  row, Name included, drags to reorder; the whole row is the drag target and the
  grip is the affordance and keyboard entry (Tab from the open trigger focuses
  the first grip; Up/Down move it). Order and visibility are independent;
  All/None affect hideable columns only.
- With mutable order in the menu, visible headers are also whole-cell drag
  targets (hover grip before the label) using the tab strip's midpoint insertion
  and the menu's drag styling and order model; tables without the menu, or
  controlled tables without an order-change callback, do not advertise it. A
  drop leaving the visible sequence unchanged does not rewrite hidden-column
  placement. Resize handles stay resize-only and suppress native drag.
- `DropdownFilterOption` owns option presentation. A required column is a locked
  control at full label contrast with an `Always shown` title, never an extra
  word; `dropdown-columns-menu` opts out of shared disabled styling so a dimmed
  label never sits beside a usable drag handle.
- Only the Columns menu dims unselected labels (`dimWhenOff`), since "off" means
  absent; filter menus must not, because most of their options are off by
  default.
- `Reset` is the single recovery action: declaration order, every hideable
  column shown, every `autoWidth` column back to automatic (manually sized
  non-auto columns stay user-owned). It is enabled whenever any differs from
  default and sits apart from All/None. Rejected: partial resets — recovery must
  not take several actions across models.

## Sorting

- Emitted sort keys are visible column keys. Hidden fields such as timestamps
  may feed a column `sortValue` but are never published as active sort keys.
- Query-backed columns are `sortable: true` only when the backend adapter
  supports that exact key, or a documented alias, as a global sort. Hydrated
  post-page fields are never sortable query columns; expand the backend
  contract first. Production query-backed views keep a rendered-column contract
  test comparing their sortable keys with the supported query sort contract.

## Age And Metrics Columns

- Age follows [live age](live-age.md): render it with `createAgeColumn` or
  `LiveAgeText` from an absolute timestamp. Age headers and data are
  right-aligned in every table; `createAgeColumn` owns that default and the
  timestamp sort value, parsing compact fallback text only without a timestamp;
  the generic sort hook never infers Age from a key.
- Metric columns follow [resource metrics](../architecture/resource-metrics.md):
  one base-domain query per page, usage joined at serve, CPU/memory sorts in the
  backend through the same keyset cursor. Rejected: metric domains, metric-row
  overlays, client-side metric merges, and local CPU/memory sorts over a
  query-backed page.

## Column sizing

- Widths come from persisted user state, the column definition, auto-width
  measurement, or the shared fallback. Columns never stretch to fill the
  viewport; narrower tables leave trailing space and wider tables scroll.
  Resizing affects only the declared column and respects `minWidth`,
  `maxWidth`, and `resizable`.
- Auto-width dirty checking hashes the rendered cells before measuring. When
  virtualization changes `virtualRange.start/end`, the controller enqueues
  visible auto-width columns after the new row window commits; the range bounds
  are intentional effect invalidators though the callback does not read them.
- Measurement considers every row of the current data page; never cap or stride
  it, because a skipped row can hold the widest value. `measurementSampleKey`
  may deduplicate only rows with guaranteed equivalent rendered width.
- Replacing the page forces every non-user-sized `autoWidth` column to
  recompute in both directions; a wider prior page never becomes the minimum.
  This pass reads the data page directly after render, not a visible-cell
  signature, because virtualization or loading can leave no rendered cells.
- `getBoundingClientRect()` returns visual pixels; convert to unzoomed CSS
  pixels before storing a width. Intrinsic measurements add one CSS pixel so
  subpixel rounding cannot clip the content edge.
- Header measurement reproduces the header cell inside a `gridtable-header` row,
  because header styles such as the uppercase transform live on the row; a lone
  cell probe measures narrow and truncates the label.
- Measurement never mounts cell components or runs their effects. Plain
  composite values declare `measurementText`; composites whose wrapper changes
  box width declare an inert `measurementElement` with the rendered wrapper's
  host tag and classes, derived from the same presentation helpers.
- When a column changes from declared fixed to automatic sizing, its fresh
  measurement replaces persisted column-owned widths; only widths whose
  persisted source is `user` stay fixed.

## Custom metadata columns

- Every resource table declares `supportsCustomMetadataColumns`: `true` only when
  rows carry Kubernetes labels or annotations through `metadata` or the
  supported top-level compatibility fields, `false` for projected rows without
  them so the Columns menu omits a dead-end Add. Shared and query-backed wrappers
  forward the caller's value and never infer it from table mode.
- `Add` closes the Columns menu and opens the shared editor: one searchable
  picker, grouped into Labels and Annotations, of distinct keys from the loaded
  rows (exact keys, no free typing); a selected key shows up to three sampled
  values. With no keys, the full-width picker stays disabled with
  `No metadata keys available`, an explanation beneath, and creation disabled.
  Custom rows expose Edit and a direct Delete beside the grip; hiding and
  removing are separate operations.
- The durable key is `metadata:<label|annotation>:<exact-metadata-key>`; the
  heading is presentation only, so renaming preserves width, order, visibility,
  and favorite references. A source/key pair appears once per table scope; a
  label and an annotation with the same key are distinct.
- Custom columns are hideable, resizable, auto-width, appended on creation, and
  non-sortable until a query provider implements metadata-key ordering. A
  missing key returns `undefined` and renders `-`; a present empty string stays
  a present, blank value.
- Definitions persist under the table's cluster/view/namespace key and restore
  before order, visibility, or width pruning. Columns Reset keeps definitions.
  Favorites may reference a custom key but never own or recreate its
  definition; a deleted definition is ignored when the favorite applies.
