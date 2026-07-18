# GridTable Contract

`GridTable` is the shared table system for resource and app data. Do not create
feature-specific table systems unless the shared contract cannot fit the
workflow and that exception is documented.

## Agent Contract

- Use `GridTable` for sortable/filterable resource tables.
- Every row needs a stable `keyExtractor`; cluster data row keys must include
  cluster identity.
- Column keys are durable persistence identifiers. Renaming one is a migration,
  not cosmetic cleanup.
- Column header and data alignment are independent: use `alignHeader` and
  `alignData` with `left`, `center`, or `right`. Each defaults to `left` when
  omitted; use `className` only for styling outside this alignment contract.
- Prefer shared column factories for common Kubernetes/resource fields.
- An absent table value renders as the ASCII hyphen-minus (`-`) in
  `--color-text-tertiary`. `GridTable` normalizes both `-` and the legacy em
  dash through `tableNoValue`; native tables must render potentially absent
  scalar values through `TableCellValue`. Copy and CSV export use the same
  canonical hyphen.
- Interactive cell actions must declare whether they also participate in the
  row action. Shared interactive column factories expose `allowRowClick` for
  that distinction. Set it to `false` whenever the cell and row open different
  targets; a Kind badge or related-object link that opens independently must
  suppress row activation.
- Keep rendering, filtering, sorting, focus, keyboard, context menus,
  persistence, and virtualization in the shared table system.
- Do not disable virtualization to work around focus, hover, width, or context
  menu bugs.
- Do not build CSS selectors from raw row or column keys; keys may contain
  characters that are not selector-safe.
- Do not split pagination controls across unrelated parts of the view. For
  query-backed tables, the control group belongs with the table footer and must
  show page size, visible range, and honest total/page-count state. Omit the
  entire footer when an exact result contains no more rows than the smallest
  supported page size and neither page direction is available. Keep it visible
  when navigation is available or an approximate count cannot prove that the
  result fits on one page.
- Complete or explicitly partial local row sets may use `localPagination` for
  presentation paging. `GridTable` applies it after local filter and sort, shows
  an exact filtered range and total, and keeps Copy scoped to every locally
  matching row rather than the displayed page. Do not combine `localPagination`
  with externally supplied `paginationControls`.
- Rows-per-page is persisted table state. Store it with the same
  cluster/view/namespace persistence key as sort, filters, widths, and column
  visibility, and validate it against the table's supported page-size options.
- Filter inputs and pagination dropdowns are interaction contracts, not just
  rendering details. Changes to them need tests proving controlled search keeps
  focus across updates and rows-per-page menus open and dispatch supported
  values.
- Filter-bar `Tab` and `Shift+Tab` navigation follows the rendered control
  order. Provider query facets participate in that order alongside structural
  filters, search, actions, and Columns; adding a facet must not create a
  keyboard focus trap.
- A feature-owned structural action that must precede Namespace uses
  `beforeNamespaceActions`; GridTable renders that IconBar after Kind and before
  Namespace rather than forcing the action into the post-search action cluster.
  A table without a Kind filter may use this as its leftmost filter-bar control;
  the Workloads/Pods composite uses it for the expanded Pods collapse control.
- Row focus and row selection are separate contracts. `Enter` runs
  `onRowClick`; when `onRowSelectionToggle` is supplied, `Space` runs that
  selection action instead. Pointer-only selection uses `onRowPointerClick`,
  which excludes interactive descendants. A view that enables selection must
  expose the selected state through `gridtable-row--selected` so the shared row
  renderer publishes `aria-selected`.
- The Columns menu uses `Dropdown`'s shared bulk-action controls. Its options are
  hideable columns only; do not add synthetic show-all or hide-all options.
- Every multi-select Kinds dropdown exposes search plus `Select all` and
  `Select none`. GridTable owns this as an invariant of a visible Kind filter;
  views may decide whether the filter is present but cannot disable its controls.
- Filter-style multiselects use three explicit states: `all` is unrestricted
  and includes options discovered later, `some` matches only its stored values,
  and `none` matches no rows. Controlled Dropdown values project `all` to every
  current option and `none` to an empty selection. Query adapters serialize
  `none` as `matchNone=true`; they may remove a full-dimension `all` selection
  only when building an equivalent backend query and must not write that query
  optimization back into dropdown state. The Columns dropdown is intentionally
  different: its selected values are enabled columns, so none hides every
  hideable column.
- Non-default GridTable filters render as removable chips beneath the filter
  controls, with one `Clear all` action that uses the table's existing reset
  contract. The filter-bar icon group does not duplicate that action with a
  reset button. Search and boolean filters use descriptive labels. A multiselect
  containing exactly one value uses the singular filter type and selected
  option label, such as `Namespace: kube-system`; if that option is no longer
  available, the stored value is the label fallback. Zero or multiple selected
  values use the plural filter type and count, such as `Namespaces: 0` or
  `Statuses: 2`. Chip visibility and counts come from the stored selection mode:
  `all` renders no chip, `some` renders its stored value count, and `none`
  renders zero. Removing a multiselect chip restores that dimension to `all`;
  it must not synthesize a selection from the currently available options. When
  a narrowing filter is active, the same row begins with plain
  `Showing N of M items` summary text before `Clear all`.
- Query facets may declare `placement: 'before-kinds'` when they constrain the
  Kind vocabulary. They must also declare `invalidates: ['kinds']` so changing
  the upstream facet clears the previous Kind selection in the same state
  transition; the provider then supplies the dependent Kind options.
- Shared filter and Columns dropdown menus measure both viewport axes when they
  open. Right-edge menus end-align when start alignment would overflow, and menu
  width remains capped to the visible viewport. Because these menus are
  portaled, positioning under CSS app zoom must convert the visually scaled
  trigger `getBoundingClientRect()` into unscaled CSS coordinates before
  combining it with fixed `left`/`top`, `offsetWidth`/`offsetHeight`, or the
  zoom-adjusted viewport dimensions.
- Query-backed filter feedback displays the backend's filtered total against the
  unfiltered total for the same view scope. Producers must not widen the
  denominator beyond cluster-scoped, all-namespaces, or pinned-namespace
  boundaries when clearing user filters.
- Cross-view filter navigation uses the shared one-shot GridTable filter request.
  Every request must name the exact destination `viewId` and `clusterId`; the
  destination applies it only after its persisted table state hydrates, then
  consumes it. Stage the request before activating the destination route so
  another table or cluster cannot receive it and hydration cannot overwrite it.

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

Auto-width dirty checking hashes the currently rendered cells before running column measurement.
When row virtualization changes `virtualRange.start/end`, the controller must enqueue visible
auto-width columns after the new row window commits; the range bounds are intentional effect
invalidators even though the callback does not read them.

## Filtering And Search

- Use local search only when the table owns the complete searchable row set.
- Use query-backed search when upstream query parameters shape the dataset.
- Namespace filters must preserve cluster-scoped resources where the table
  includes them.
- Multi-cluster local tables use the first-class Cluster filter. Dropdown option
  values and row accessors carry `clusterId`; context names are display labels
  only. Build the option vocabulary from the table's full open-cluster scope so
  partial row availability does not rename, collapse, or remove cluster
  selections. Cluster selections persist with GridTable state and favorites.
- Metadata filters that describe the object universe should come from catalog or
  query metadata, not a capped row slice.
- Query providers may add `queryFacets` to the shared filter state and options.
  Each facet uses a stable provider-owned key, persists through GridTable state
  and favorites, and only shapes backend queries; GridTable must not locally
  apply those selections to the current page.
- Provider-specific facets are declared by backend capability descriptors and
  paired by key with envelope `facetValues`. The shared resource-query adapter
  maps descriptor labels/placeholders/searchability/bulk actions and option
  value/labels into GridTable controls, and serializes selections as repeated
  `facet.<key>` query values. Each value is opaque and must never be comma-split
  because providers may use structured identities containing commas. Views must
  not add key-specific projection or serializer branches.
- A query-backed view may exclude provider facets from its filter bar through
  the shared query wrapper. Exclusion removes both the control and that facet's
  active query state; filtering only the rendered controls would leave an
  invisible persisted filter affecting results.
- A provider may publish a facet only after request serialization, backend
  extraction/filtering, full-structural-scope options, UI projection, and shared
  persistence exist. Do not advertise status, owner, node, application, or other
  row-field filters from response facets alone.
- Pods, Workloads, and Nodes are the reference typed-query facet implementations:
  their provider-owned options describe the full structural scope, remain stable
  when a selection narrows the result set, and feed backend query parameters
  through the shared typed-resource scope builder. Their providers publish
  Status, but the user-facing tables exclude it. Pods expose Owner followed by
  Node; in all-namespaces views those controls follow Namespace. Workloads row
  selection writes Namespace and Owner through the same controlled filter state
  used by direct dropdown interaction.

### Favorite snapshots

- A favorite snapshots the complete `GridTableFilterState` and table display
  state as one named pane. Favorites code must compare, edit, save, and restore
  the state object as a whole; it must not maintain a separate allowlist of
  Kinds, Namespaces, or provider facet keys.
- The save modal derives editable controls from the pane's
  `GridTableFilterOptions`. Built-in structural filters and every declared
  `queryFacets` entry therefore use the same option vocabulary and selection
  semantics as the live table. Every favorite multi-select must expose the
  semantic `all` selection and persist it as `mode: all`, never as a snapshot
  of the option values that happened to exist when the favorite was saved. Its
  closed control displays `All` for `mode: all` and `None` for `mode: none`;
  `mode: some` displays the stored value count as `n selected` instead of
  listing the selected option labels.
- A route with multiple tables stores one favorite containing a named snapshot
  for every pane. The Workloads route owns `workloads` and `pods`; it exposes one
  favorite action, waits for both persistence stores to hydrate, then restores
  both panes before consuming the pending favorite.
- Favorites schema v3 stores named panes exclusively. Loading an older schema
  starts a new empty Favorites collection; no legacy top-level filter/table
  compatibility path is maintained.

## Sorting

- Sort keys emitted by `GridTable` must be visible column keys. Hidden data
  fields such as timestamps may be used by a column `sortValue`, but must not be
  published as active table sort keys.
- Age columns should render relative text from `ageTimestamp` through the
  live-age contract in [live-age.md](live-age.md). Displayed `age` strings are
  fallback text only; they are not stable sort values.
- Query-backed table columns may be `sortable: true` only when the backend
  adapter supports that exact column key, or a documented alias for it, as a
  global query sort.
- Do not expose hydrated post-page fields as sortable query columns. If the
  backend cannot sort the complete matching dataset by a field, the column must
  be non-sortable or the backend contract must be expanded first.
- Production query-backed resource views should be covered by a rendered-column
  contract test that compares their sortable keys against the supported query
  sort contract.

## Table Modes And User Claims

- `Local Complete` means the loaded rows are the complete bounded dataset for
  this table scope.
- `Local Partial` means the loaded rows are only a recent, capped, buffered, or
  degraded window. UI text, counts, filters, export, selection, and object
  actions must be scoped to that window.
- Local presentation pagination does not change either local table mode. Its
  page index is transient, resets when filter, sort, scope, or page size changes,
  and clamps when the filtered result shrinks. A reset commits page one as the
  new transient state, so returning to an earlier filter or sort identity cannot
  restore that identity's previous page. Page size uses the table's persisted
  state and shared supported options.
- `Query Backed Static` and `Query Backed Dynamic` mean the backend owns global
  search, filters, sort, counts, facets, and pagination. `GridTable` renders the
  current page/window and emits query changes.
- A classified table is not automatically production-ready. The UI and actions
  must match the mode.

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

## Resource Inventory Tables

Every production resource inventory table — cluster, namespace, Browse/catalog,
and object-panel related-resource lists — renders through one controller, never a
bespoke display path:

- `ResourceInventoryTable`
  (`frontend/src/modules/resource-grid/ResourceInventoryTable.tsx`) is the single
  wrapper. It takes a normalized `source` plus `gridTableProps` and owns the
  loading boundary, refresh overlay, settled-empty state, and partial banner. It
  is the only sanctioned direct `GridTable` consumer for resource data.
  While the controller renders live source rows, the wrapper must pass the
  binding-owned row order to `GridTable` so local sorting is not discarded. If
  the controller substitutes cached rows during a transient empty refresh, the
  replay rows take precedence because the live binding has no rows to order.
- `useResourceInventoryTable` / `deriveResourceInventoryRenderState`
  (`useResourceInventoryTable.ts`) is the pure controller: it projects a source's
  lifecycle into a display status (`initializing`, `loading`, `refreshing`,
  `ready`, `empty`, `blocked`, `error`). **Empty is decided from lifecycle, never
  from raw `rows.length`.** A refresh that transiently reports zero rows resolves
  to `loading`, not empty — this is the structural fix for the "No X found"
  false-empty flash, and it must not be reintroduced by checking `rows.length` in
  a view.

### Source adapters

A table's `source` (`ResourceInventorySourceState`) comes from exactly one of two
adapters; there is no third shape:

- `boundedRowsSource` — bounded local data (a fully-resident `Local Complete`
  set, or an explicitly `Local Partial` window). The source never fetches pages,
  so a bounded table cannot silently fan out to query scale; it carries
  `completeness` and an optional `partialLabel`. `GridTable` may divide those
  already-loaded rows into local presentation pages.
- `backendQuerySource` — catalog/explicit backend query results (Browse, Custom).
  The typed-resource query wrappers build their source inline from the same
  `ResourceInventorySourceState` shape.

The wrapper hooks (`useQueryBackedClusterResourceGridTable` /
`useQueryBackedNamespaceResourceGridTable`) return `{ source, gridTableProps,
favModal }`. Read rows/loading/error from `source` — there are no separate
wrapper-level lifecycle fields.

**Kind vocabulary is backend-owned:** the Kinds dropdown's option list is the
family's `capabilities.kindVocabulary`, published on every query payload
(`ResourceQueryCapabilities` in `backend/refresh/snapshot/resource_query_contract.go`,
pinned per family by `TestTypedResourceProvidersPublishKindVocabulary`). Builders
narrow it to the kinds whose backing resource can currently produce rows
(`capabilitiesWithAvailableKinds` over the same source lists the issues channel
uses), so e.g. Gateway API kinds are only offered on clusters that serve them.
The kind FACETS on a result collapse to the active selection by design — they
describe the matched rows and must never feed the dropdown. Do not reintroduce
frontend kind lists or thread `availableKinds` from snapshot meta; the query
wrapper supplies the vocabulary to the binding itself.

**Quiet-refresh contract:** a server-backed source reports `loading: true` only
before its first applied result for the current scope (cluster/namespace/base
scope — the points where its rows reset). Filter, sort, page-size, manual, and
background refetches must NOT raise `loading`: the table keeps the last applied
rows (or the settled "no matches" state) until the new result lands. Raising
`loading` mid-session dims the table (`refreshing`) or, with zero rows, swaps
the whole surface — filter bar included — for the loading boundary, which
unmounts the filter input and steals focus while the user is typing.

### Building a new resource table

1. Pick the source adapter: bounded local → `boundedRowsSource`; backend-owned
   query → `backendQuerySource` or a typed-query wrapper. If neither fits, stop
   and extend the backend contract rather than adding a new source shape.
2. Render `<ResourceInventoryTable source={source} gridTableProps={gridTableProps} />`.
   Do not hand-roll loading/empty/partial booleans, and do not call `GridTable`
   directly.
3. A producer-reported truncation must surface as `Local Partial` (completeness +
   label) so it can never render as a complete table.

### Enforcement

`shared/components/tables/persistence/gridTableViewRegistry.contract.test.ts`
rejects: any un-allowlisted direct `<GridTable>`, any resource-grid call missing a
table mode, any `source` produced outside the sanctioned adapters, and any stale
allowlist entry. The only classified non-resource exceptions are object-scoped
events (`EventsTab`, whose display lifecycle is still controller-driven through
`boundedRowsSource`) and parsed logs (`ParsedLogTable`).

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
6. Add tests with enough rows and columns to exercise the shared path.
7. For filter or footer changes, add interaction tests for focus retention,
   dropdown opening, and button disabled/loading behavior.

## Validation

Run targeted GridTable/consumer Vitest tests and `npm run typecheck --prefix
frontend`. For visual or interaction changes, verify in the app or Storybook.
