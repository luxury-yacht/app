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
- Keep rendering, filtering, sorting, focus, keyboard, context menus,
  persistence, and virtualization in the shared table system.
- Do not disable virtualization to work around focus, hover, width, or context
  menu bugs.
- Do not build CSS selectors from raw row or column keys; keys may contain
  characters that are not selector-safe.
- Do not split pagination controls across unrelated parts of the view. For
  query-backed tables, the control group belongs with the table footer and must
  show page size, visible range, and honest total/page-count state.
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
- The Columns menu uses `Dropdown`'s shared bulk-action controls. Its options are
  hideable columns only; do not add synthetic show-all or hide-all options.
- Multi-select filter state preserves an explicit Select All selection so the
  controlled dropdown remains distinct from Select None. Query adapters may
  remove a full-dimension selection only when building an equivalent backend
  query; they must not write that query optimization back into dropdown state.
- Shared filter and Columns dropdown menus measure both viewport axes when they
  open. Right-edge menus end-align when start alignment would overflow, and menu
  width remains capped to the visible viewport.
- Query-backed filter feedback displays the backend's filtered total against the
  unfiltered total for the same view scope. Producers must not widen the
  denominator beyond cluster-scoped, all-namespaces, or pinned-namespace
  boundaries when clearing user filters.

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
  value/labels into GridTable controls, and serializes selections as
  `facet.<key>`. Views must not add key-specific projection or serializer branches.
- A provider may publish a facet only after request serialization, backend
  extraction/filtering, full-structural-scope options, UI projection, and shared
  persistence exist. Do not advertise status, owner, node, application, or other
  row-field filters from response facets alone.
- Pods, Workloads, and Nodes are the reference typed-query facet implementations:
  their provider-owned options describe the full structural scope, remain stable
  when a selection narrows the result set, and feed backend query parameters
  through the shared typed-resource scope builder. Pods add Node; all three expose
  Status.

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
  and clamps when the filtered result shrinks. Page size uses the table's
  persisted state and shared supported options.
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
