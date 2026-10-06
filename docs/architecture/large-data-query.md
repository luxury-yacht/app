# Large Data Query Contract

Backend query semantics, typed envelopes, page addressing, and query liveness.
Shared rules and table modes live in [large data](large-data.md).

## Browse Query Chain

- `backend/objectcatalog.Service.Query` owns Browse filtering, search, sort,
  page limits, cursor validation, totals, and facets. Cursors bind `clusterId`,
  query signature, backend sort contract, direction, page limit, cursor version,
  and the last row's sort/tie-breaker values.
- Namespace and kind filters use the catalog query index. Default, search-only,
  and sort-only queries may stream every chunk (O(N) CPU) into a bounded page
  buffer and exact-metadata budget, never a full in-memory result.
- Store seam: the `Querier` interface (`backend/objectcatalog/query_store.go`,
  default in-memory index) preserves `QueryOptions` → `QueryResult`. Replace it
  only on a measured latency, residency, or cursor-churn regression, under the
  pure-Go rule in [data-layer.md](data-layer.md); frontend scopes and snapshot
  payloads never change with the store.
- `backend/refresh/snapshot/catalog.go` parses the scope and emits
  `CatalogSnapshot` with full object identity, `continue`, `previous`,
  `cursorInvalid`, `totalIsExact`, `facetsExact`, and reason-bearing `issues`.
- `frontend/src/modules/browse/hooks/useBrowseCatalog.ts` builds the scoped
  query, debounces search, requests cursor pages, replaces the row window, and
  restarts from page one only on `cursorInvalid`. `BrowseView` renders it as
  `Query Backed Static`.

## Typed Resource Query Contract

- `ResourceQueryRequest` / `ResourceQueryResult`
  (`backend/refresh/snapshot/resource_query_contract.go`, mirrored in frontend
  refresh types): each row carries one complete `ref` (identity plus plural
  resource) and no flat identity copies, plus stable projected fields; the
  envelope carries backend predicates, facets, exactness flags,
  partial/degraded issues, and an object revision reference.
- CPU/memory usage is joined at serve, with no metric-domain query contracts
  ([resource metrics](resource-metrics.md)); metric sorts (`usageSortValue`)
  use the same keyset cursor as every sort.
- Metadata search runs in the backend: adapters whose rows carry labels and
  annotations supply `MetadataText`, matched only when the request sets
  `includeMetadata`, a flag included in cursor and store keys. New typed tables
  with metadata must supply it; catalog-backed tables (Browse, custom resources)
  do not support it yet. Metadata values have no app byte cap below the upstream
  object limit; ingest strips managed fields and
  `kubectl.kubernetes.io/last-applied-configuration` before projection.
- Keyset ordering is self-consistent: page sort and cursor boundary derive from
  one comparable value per row, or pages skip or duplicate rows. Numeric sort
  fields stay numeric: a missing value (no timestamp, no metric sample,
  unparseable cell) sorts as a `-Inf` sentinel with `ok=true`, never a string
  fallback. See `typedTableComparableSortValue`
  (`backend/refresh/snapshot/typed_table_query.go`) and the wire cursor codec
  (`backend/refresh/querypage/cursor.go`).
- Typed builders serve a query page when the scope carries a query
  (`query.Enabled`), otherwise a bounded window. The window is the canonical
  snapshot for object panels, counts, and other snapshot consumers. Rejected:
  deleting it as a "path consolidation" — it is not redundant. A query-backed
  table holds `query` demand (base live scope plus current page); a consumer
  needing the window holds separate `snapshot` demand. Both share one live
  source and its readiness/permission/source clocks.
- Single-namespace tables are query-backed too (`baseScope =
  namespace:<name>`), so paging semantics match every scope.
- Both paths surface degraded and unavailable-source reasons. A window missing a
  permission-blocked source is inexact and issue-bearing. When an ingest sync
  deadline releases the liveness gate before the initial list succeeds, the
  envelope stays partial and inexact until raw source readiness is
  authoritative.
- Object-panel related-resource tables stay local while their owner-scoped
  domain keeps them bounded; they become typed query-backed only at namespace or
  cluster scale.

## Page Addressing Contract

A request addresses its page exactly one way (validated server-side):

| Field | Contract |
| --- | --- |
| `continue` | Opaque backend-minted keyset cursor. Every engine-served response carries `previous` and `continue`; the client keeps no token stack. |
| `anchor.*` | Full object reference (`clusterId` equals the request cluster; version, kind, name required). Serves the page-aligned window containing it plus `anchor: {found, rank, reason}`; a missing anchor serves the first page with `reason: "filtered" \| "not-found"` in one round trip. |
| `startRank` | 0-based offset for numbered jumps, offered only while `totalIsExact`; past-the-end starts clamp to the last aligned page. |

- Counted serves (anchor, `startRank`) also return `pageStartRank` (exact
  serve-time rank of the first row; a pointer so rank 0 survives omission) and
  `self` (a landing-page cursor the client adopts so live refetches stay
  page-stable instead of re-anchoring). Plain cursor pages carry neither; their
  footer positions stay client-derived. Rejected: rank on every cursor page —
  the O(rank) walk failed the position-honesty gate at ~2× the worst page-serve
  budget at 250k ([Current Browse Budget](large-data-measurements.md#current-browse-budget)).
- Anchors resolve to engine row keys in the serve layer, never the engine
  (engine keys are adapter-owned and name-shaped, not UIDs). Typed tables map
  `(kind, namespace, name)` through the adapter's `AnchorKey`, built from the
  same helpers as its row `Key`; a typed kind without `AnchorKey` cannot be
  anchor-jumped to. Typed rows carry no UID. The catalog looks up the `Summary`
  by `(gvr, namespace, name)` and cross-checks `anchor.uid`; a mismatch (a
  recreated object) is `not-found`.
- Anchor intent is navigation state, never persisted table state, so favorites
  never replay jumps. A held jump re-fires on sort, filter, or page-size change
  (no bounce to page 1), clears on manual pagination, and retries with the
  anchor when a cursor is rejected mid-jump.
- Export walks compare the raw `sourceVersions["object"]` clock per page, never
  the folded `sourceVersion` token (it embeds the scope and differs per page).
  The first drift restarts the walk once; a second delivers the export with a
  visible "data changed during export" notification. Failed, blocked, or empty
  pages reject outright.

## Liveness Contract for Query-Backed Tables

Query pages are one-shot; liveness comes from refetching, never from mutating
displayed rows in place.

### Shared frontend mechanics

- `useCursorPageSession` owns applied next/previous cursors and footer position
  for typed and Browse queries, publishes them together, and keeps state when a
  repeated snapshot has the same page address. Colocated `useQuerySearch` owns
  the shared 250ms search debounce; Browse may reseed it when a structural scope
  change must clear rows before commit.
- `executeQueryPageRequest` delivers results only to the current request owner;
  data access still owns acquisition, fetch, read, and release. Adapter policies
  stay out of this helper: typed queries own declarative scopes, warm-up retry,
  anchors, and failed-navigation rollback; Browse owns imperative cursor
  requests, separate metadata scopes, quiet-request coalescing, and its
  blocked-result/error policies.
- `useQueryStreamSignal` (core refresh hooks) owns query signal identity; typed
  tables invalidate their declarative query with it, and Browse supplies a
  current-page reconciliation callback. Snapshot readers use
  `useStreamSignalRefetch`, which requests each doorbell once per scope however
  many consumers mount (the shared record lives only while one is mounted).
  Both read declared doorbell clocks from one helper; query consumers add
  subscription acknowledgements and fallback reconciliation ticks.

### Guarantees

- Typed queries refetch when a declared `signalVersions` source clock or stream
  acknowledgement identity changes (`useQueryBackedResourceGridTable.ts`), never
  on payload applies or refresh timestamps, so responses cannot echo into
  queries. Query demand subscribes before its initial read; `ACK`/initial
  `RESET` triggers an acknowledged reconciliation; the lifecycle identity
  rejects older in-flight responses.
- For a query-only lease, fallback scheduling advances a query-reconciliation
  identity instead of fetching the base snapshot; the consumer reissues its
  current cursor page, keeping position and the one-page retention bound. A
  healthy stream does not advance it because source clocks already invalidate
  the page.
- Update latency is one stream coalescing window (200ms) plus one query
  round-trip (tens of milliseconds at 100k rows), or the poll cadence plus the
  round-trip for poll-backed domains. A healthy stream suppresses snapshot
  polls; the stream manager falls back to polling on drift or failure.
- Value-based keyset cursors (sort value + row key) survive concurrent inserts
  and deletes without skips or duplicates, and metric sorts tolerate
  metrics-revision advances. A cursor whose anchor context disappears reports
  `cursorInvalid` and the table resets to page 1.
- Every refetch is visually silent
  ([quiet refresh](../frontend/gridtable-resource-tables.md#quiet-refresh)).
- Ingestion shares structure page-locally: it reuses a complete `ref` when
  identity is unchanged and a whole row only when every own enumerable scalar,
  map, array, and nested value is equal. The previous-page index is scoped to
  the full query/cursor identity and discarded after apply. Metric-bearing and
  event-churn families share refs only, because their projected values normally
  change ([measurements](large-data-measurements.md#resource-row-efficiency-measurements)).
