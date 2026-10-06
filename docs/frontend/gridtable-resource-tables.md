# GridTable Resource Tables

Pagination, source adapters, loading/empty/partial state, and new resource
tables. Apply the [shared contract](gridtable.md); table modes and completeness
live in [large data](../architecture/large-data.md#table-modes).

## Pagination

- Keep pagination controls together in the table footer. Query-backed footers
  show page size, visible range, and honest total/page-count state
  ([exactness](../architecture/large-data.md#contract)). Omit the footer when an
  exact result fits the smallest supported page size and neither direction is
  available; keep it when navigation is available or an approximate count
  cannot prove a single page.
- Complete or explicitly partial local row sets may use `localPagination` for
  presentation paging, never combined with external `paginationControls`.
  `GridTable` applies it after local filter and sort, shows an exact filtered
  range and total, and keeps Download scoped to every locally matching row. It
  does not change the table mode. The page index is transient: it resets when
  filter, sort, scope, or page size changes (committing page one, so returning
  to an earlier filter or sort cannot restore its old page) and clamps when the
  filtered result shrinks.
- Rows-per-page is persisted table state under the same cluster/view/namespace
  key as sort, filters, widths, and visibility, validated against the table's
  supported page-size options.

## Resource Inventory Tables

Every production resource inventory table (cluster, namespace, Browse/catalog,
object-panel related lists) renders through one controller:

- `ResourceInventoryTable`
  (`frontend/src/modules/resource-grid/ResourceInventoryTable.tsx`) takes a
  normalized `source` plus `gridTableProps` and owns the loading boundary,
  refresh overlay, settled-empty state, and partial banner. It is the only
  sanctioned direct `GridTable` consumer for resource data. While rendering live
  source rows it passes the binding-owned row order to `GridTable` so local
  sorting survives; cached replay rows substituted during a transient empty
  refresh take precedence because the live binding has no rows to order.
- `useResourceInventoryTable` / `deriveResourceInventoryRenderState`
  (`useResourceInventoryTable.ts`) projects source lifecycle into a display
  status (`initializing`, `loading`, `refreshing`, `ready`, `degraded`,
  `empty`, `blocked`, `error`). Empty comes from lifecycle, never
  `rows.length`: a refresh transiently reporting zero rows is `loading`, and a
  settled zero-row partial envelope is `degraded` with its partial reason, not
  the view's "No X found" copy. Do not reintroduce these checks in a view.

### Source adapters

`source` (`ResourceInventorySourceState`) comes from exactly one of two
adapters; there is no third shape:

- `boundedRowsSource`: bounded local data (`Local Complete`, or an explicitly
  `Local Partial` window). It never fetches pages, so a bounded table cannot
  silently fan out to query scale. It carries `completeness` and an optional
  `partialLabel`; a producer-reported truncation surfaces as `Local Partial`.
- `backendQuerySource`: catalog/backend query results (Browse, Custom). The
  typed wrappers (`useQueryBackedClusterResourceGridTable` /
  `useQueryBackedNamespaceResourceGridTable`) build the same shape inline and
  return `{ source, gridTableProps, favModal }`; read rows, loading, and error
  from `source`.

To add a resource table, pick the adapter (if neither fits, extend the backend
contract), render
`<ResourceInventoryTable source={source} gridTableProps={gridTableProps} />`,
and never hand-roll loading/empty/partial booleans or call `GridTable` directly.

### Kind vocabulary

The Kinds dropdown lists the family's `capabilities.kindVocabulary`, published
on every query payload (`ResourceQueryCapabilities` in
`backend/refresh/snapshot/resource_query_contract.go`, pinned by
`TestTypedResourceProvidersPublishKindVocabulary`). Builders narrow it to kinds
whose backing resource can currently produce rows
(`capabilitiesWithAvailableKinds`, over the issues channel's source lists), so
Gateway API kinds appear only on clusters that serve them. Result kind facets
collapse to the active selection and must never feed the dropdown. Rejected:
frontend kind lists and threading `availableKinds` from snapshot meta; the query
wrapper supplies the vocabulary to the binding.

### Quiet refresh

A server-backed source reports `loading: true` only before its first applied
result for the current scope (cluster, namespace, or base scope, where rows
reset). Filter, sort, page-size, manual, and background refetches never raise
`loading`; the table keeps the last applied rows, or the settled "no matches"
state, until the new result lands. Raising it mid-session dims the table or,
with zero rows, swaps the whole surface (filter bar included) for the loading
boundary, unmounting the filter input and stealing focus mid-typing.

### Enforcement

`shared/components/tables/persistence/gridTableViewRegistry.contract.test.ts`
rejects any un-allowlisted direct `<GridTable>`, any resource-grid call missing
a table mode, any `source` built outside the sanctioned adapters, and stale
allowlist entries. The only classified non-resource exceptions are
object-scoped events (`EventsTab`, still controller-driven through
`boundedRowsSource`) and parsed logs (`ParsedLogTable`).
