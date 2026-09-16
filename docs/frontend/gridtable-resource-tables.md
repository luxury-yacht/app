# GridTable Resource Tables

Read for pagination, source adapters, loading/empty/partial state, or a new
resource table. Apply the [shared contract](gridtable.md); backend query and
completeness changes also use [large data](../architecture/large-data.md).

## Read by change

- Footer, page size and reset/clamp behavior: [pagination](#pagination) and [table modes](#table-modes-and-user-claims).
- Loading, empty, partial or retained rows: [controller](#resource-inventory-tables).
- Source lifecycle, vocabulary or quiet refresh: [adapters](#source-adapters).
- New table: [construction](#building-a-new-resource-table) and [enforcement](#enforcement).

## Pagination

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
  `ready`, `degraded`, `empty`, `blocked`, `error`). **Empty is decided from
  lifecycle, never from raw `rows.length`.** A refresh that transiently reports
  zero rows resolves to `loading`, not empty. A settled zero-row result whose
  envelope is partial resolves to `degraded` and renders its partial reason, not
  the view's authoritative "No X found" copy. These are structural false-empty
  protections and must not be reintroduced in a view.

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
