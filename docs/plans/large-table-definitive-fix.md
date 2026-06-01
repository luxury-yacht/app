# Definitive Large Table Fix

Status: Complete. Browse, custom-resource catalog paging, all-namespaces
Pods/Workloads dynamic query paging, backend-owned query export, guarded
query-wide bulk action support, and table-mode enforcement are implemented.

Owner: implementation agent for this fix. Assign a durable human owner before
expanding query-backed behavior beyond the completed Browse, Custom, Pods, and
Workloads surfaces.

Approved Phase 0 defaults:

- Target scale: 100k catalog objects per cluster for the first Browse slice.
- Day-one Browse sort: backend-owned kind/namespace/name ordering.
- Pager: first/previous/next cursor navigation only; no numbered page jumps or
  "Page X of Y" in the first implementation.
- Totals/facets: exact only while served from indexed or otherwise bounded work;
  otherwise show approximate/degraded state.
- Export/bulk actions: page-scoped or disabled until backend query-wide operations
  exist.
- Index memory: add benchmark scaffolding first, then set measured per-cluster
  and multi-cluster residency ceilings from data instead of guessing.

Implementation readiness: the plan is complete for the scoped fix captured in
this document. Follow-on work that expands typed query mode to more table
families should start from `docs/architecture/large-data.md` and a new scoped
plan.

## Problem

Luxury Yacht has repeatedly hit the same failure mode in very large clusters:
table views become slow or memory-heavy because too much catalog-scale data is
loaded, transformed, retained, or rendered in the frontend.

The current row cap is only a safety guard. Letting users raise it is not a
performance strategy; it asks the renderer to do more work and makes failures
larger.

The permanent fix is to stop treating a table's loaded rows as the unit of
scale. The unit of scale must be a backend-owned query result page/window.

There was also a concrete correctness bug in the pre-fix Browse path: Browse sent
search/kind/namespace query parameters to the backend, but the frontend appends
pages, re-sorts the loaded page set with `useTableSort`, and applies
`searchBehavior: 'query'` without preventing local `applyGridTableFilters`.
With offset pagination, changing sort or filters can present a partial ordering
of only loaded rows as if it were the global result order.

## Decision

This was tier 3 table architecture/performance work under the `browse-tables`
skill. The implementation started only after the production table inventory was
complete enough to identify table mode, backend producer, completeness, dynamic
fields, and export/selection/action semantics for every production `GridTable`
consumer.

Catalog-scale tables must be query-backed end to end.

The backend owns:

- filtering
- search
- sorting
- counting
- facets and filter options
- pagination/windowing
- degraded or partial result state
- export and bulk result sets

The frontend owns:

- visible page/window rendering
- virtualization of the currently loaded rows
- column layout and persistence
- keyboard/focus behavior
- visible-row selection
- loading, empty, blocked, and degraded presentation

`GridTable` remains the shared table component. It must not be the query engine
for catalog-scale data.

After the Browse readiness gate passes, the first implementation slice is
deliberately narrow:

1. Browse uses backend search, filtering, sorting, facets, totals, and cursor
   pagination for catalog rows.
2. The frontend never retains more than the current page/window of Browse rows.
3. `GridTable` query mode is locked so local full-dataset transforms cannot
   quietly come back.

Do not start by building a general database, a new table framework, or a broad
rewrite of every resource view. Start with one complete vertical path:
`backend/objectcatalog` -> frontend data access -> Browse -> `GridTable`.
Typed namespace/cluster query work is a follow-on epic, not a prerequisite for
shipping the Browse vertical slice.

## Non-Negotiable Invariants

- Every query and result row carries `clusterId`.
- Every concrete object row carries `clusterId`, `group`, `version`, `kind`,
  `namespace` when namespaced, and `name`.
- Query-backed tables do not perform local full-dataset search, filtering,
  sorting, or facet generation.
- Frontend memory does not grow with every page visited.
- Query caches, pagination state, table persistence keys, and query-selection
  descriptors are scoped by `clusterId`.
- Export and bulk operations over "all matching rows" execute against a backend
  query, not a frontend array of loaded rows.
- `maxRows` remains an internal safety guard, not the user-facing solution for
  large clusters.

## Target Contract

Harden the existing catalog query request/result contract owned by the backend
catalog/query layer and consumed through frontend data access.

Current state:

- `backend/objectcatalog.QueryOptions` already supports kind, namespace, search,
  limit, and `Continue`.
- `backend/objectcatalog.QueryResult` already returns items, `ContinueToken`,
  exact `TotalItems`, `ResourceCount`, `Kinds`, and `Namespaces`.
- `backend/refresh/snapshot.CatalogSnapshot` already exposes the result to
  Browse with `continue`, totals, facets/filter options, and batch metadata.
- The current continue token is a bare integer offset. It is not bound to
  `clusterId`, query signature, sort, page limit, catalog ordering contract, or
  a stable keyset anchor.
- Backend sort is fixed to kind/namespace/name today; Browse sort controls do
  not drive backend ordering.

The first catalog contract change is not greenfield type creation. It is to
replace the offset continue token with a keyset cursor, add backend-owned sort
parameters, and preserve the existing facet/total fields with explicit
exact/degraded metadata.

Example shape:

```ts
type CatalogQueryRequest = {
  clusterId: string
  scope: {
    kinds?: Array<{
      group: string
      version: string
      kind: string
    }>
    namespaces?: string[]
  }
  search?: string
  filters?: CatalogFilter[]
  sort?: CatalogSort
  limit: number
  cursor?: string
  consistencyToken?: string
}

type CatalogQueryResult = {
  items: CatalogRow[]
  pageInfo: {
    nextCursor?: string
    previousCursor?: string
    hasMore: boolean
    totalCount?: number
    totalIsExact: boolean
    totalDegradedReason?: string
  }
  facets: {
    namespaces: FacetValue[]
    kinds: FacetValue[]
    exact: boolean
    degradedReason?: string
  }
  consistencyToken?: string
  degradedReason?: string
}
```

The exact Go/TypeScript names can differ, but the ownership cannot.

Totals and facets are exact today because `Query()` scans the matching catalog
universe. The new query path may intentionally give up exact totals/facets above
a defined threshold to keep queries bounded. That is a visible behavior change:
the UI must show approximate/degraded copy instead of presenting an approximate
or missing count as an exact count.

Cursor tokens must be tied to:

- `clusterId`
- canonical query signature
- sort field and direction
- page direction
- page limit
- last row sort value
- stable tie-breaker object key
- cursor format/version and ordering schema
- optional consistency token when the query deliberately uses a frozen snapshot

The default Browse catalog model is live keyset continuity, not snapshot
rejection on every catalog mutation. Incremental catalog updates are expected
between page turns. A cursor should resume from the encoded sort key and stable
tie-breaker across minor additions or deletions. Reject a cursor when it is
malformed, belongs to a different `clusterId`, query signature, sort order, page
limit, or cursor/ordering version, or when an explicitly frozen snapshot is no
longer available. Do not reject solely because the live catalog revision
advanced.

Previous-page cursors must have explicit reverse-window semantics; do not infer
previous pages by reusing a forward cursor with offset-style behavior. Changing
page size invalidates existing cursors unless the cursor contract deliberately
encodes a safe page-size transition.

## Query Engine Strategy

Start with a storage-agnostic backend query interface over the object catalog.
The implementation must sit behind a small `CatalogQueryStore`-style boundary
so storage can be changed without rewriting Browse or `GridTable`.

Evaluate the first implementation as an in-process per-cluster index because it
fits the existing catalog lifecycle and avoids persistence/migration complexity.
Do not treat that as a permanent commitment. If benchmarks or correctness
pressure show the custom index is becoming an underpowered database, replace it
behind the same interface with SQLite or another embedded query store.

Initial index requirements:

- cluster id
- full GVK
- namespace
- name
- resource scope
- normalized searchable terms for name, namespace, kind, group, and version
- sortable creation timestamp when available
- stable catalog object key

Do not index arbitrary YAML fields or labels until the product explicitly
exposes those filters. Large-table correctness requires bounded query behavior,
not an unbounded general-purpose object database.

Storage decision checkpoint:

- If the in-memory index meets the latency, allocation, cursor, facet, and
  churn budgets, keep it.
- If it requires ad hoc secondary-index complexity for basic Browse behavior,
  switch to SQLite before expanding scope.
- If exact totals or facets require broad scans, either add indexed counters or
  return approximate/degraded metadata.

## Typed Resource Views And Dynamic Metrics

The catalog query engine solves identity-scale browsing. It does not, by
itself, solve typed resource tables whose sortable columns come from rapidly
changing data.

Pods sorted by CPU or memory are the important example. CPU and memory are not
catalog identity fields, and they should not be stored as long-lived catalog
sort keys. They come from the current metrics snapshot.

For metric-backed typed views:

- The backend still owns global sort/filter/page behavior.
- The query must join stable catalog/resource identity with the latest metrics
  snapshot for the same `clusterId`.
- Sorting by CPU or memory uses a bounded metrics snapshot, not full object
  YAML parsing and not frontend local sorting.
- The response must include the metrics snapshot timestamp or revision used for
  the sort.
- If metrics are stale, partial, unavailable, or permission-blocked, the
  response must mark the result degraded.
- Cursor tokens for metric sorts must include whatever metric continuity model
  the typed-query design chooses. Do not default to rejecting every cursor when
  the metrics snapshot refreshes; metric snapshots can update every few seconds,
  and constant page-1 restarts would make deep paging unusable.

Before implementing metric-backed global sorts, choose one product behavior:

- freeze a metrics snapshot for a bounded paging session,
- expose metric sorts as bounded top-k/page queries with an explicit depth cap,
  or
- make metric sorts a first-page or current-window affordance rather than a
  globally pageable order.

Metric sort keys are allowed only for fields the backend deliberately projects
and can sort from compact row/metric state. Do not support arbitrary column
sorts by hydrating every object.

For very large metric-sorted result sets, the implementation may use either:

- an ordered metric index updated with each metrics snapshot, or
- a bounded top-k/page query over compact pod metric records.

The required behavior is the same either way: React receives only the current
page/window, and the backend makes the global ordering decision for the metric
snapshot.

## GridTable Usage Audit

This plan must cover every production `GridTable` render site, not just Browse.

All resource-grid namespace and cluster views currently flow through
`frontend/src/modules/resource-grid/useGridTableBinding.ts`, which calls
`useTableSort` locally. `useResourceGridTableCommon` also derives kind and
namespace filter options from the loaded row slice unless callers provide
explicit options. That is acceptable only for tables whose loaded row set is a
complete, bounded dataset.

### Inventory Status

Status: complete for the scoped fix. The inventory below records the traced
producer, mode, and export/selection/action disposition used for the Browse,
Custom, all-namespaces Pods, and all-namespaces Workloads implementation.
Rows outside that slice are classified for follow-on work and must be
revalidated before expanding query-backed behavior.

Required inventory columns:

| View | Entry point | Backend producer | Scope | Completeness | Sort/filter sources | Mode | Export/selection/actions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Browse | `frontend/src/modules/browse/components/BrowseView.tsx` | `backend/objectcatalog`, `backend/refresh/snapshot/catalog.go` | cluster / namespace / all-namespaces | current page/window only | backend search/kind/namespace/sort/facets/totals | Query Backed Static | backend query-wide export and guarded bulk delete; visible-row actions |
| Namespace Pods | `frontend/src/modules/namespace/components/NsViewPods.tsx` | `backend/refresh/snapshot/pods.go` | namespace / all-namespaces | single namespace complete; all-namespaces current query page | backend search/namespace/health/sort/page for all-namespaces; CPU/memory from metrics | Query Backed Dynamic for all-namespaces, Local Complete for bounded single namespace | visible refs locally; query-wide export/selection only after backend support |
| Namespace Workloads | `frontend/src/modules/namespace/components/NsViewWorkloads.tsx` | `backend/refresh/snapshot/namespace_workloads.go` | namespace / all-namespaces | single namespace complete; all-namespaces current query page | backend kind/search/namespace/sort/page for all-namespaces; CPU/memory from metrics | Query Backed Dynamic for all-namespaces; Local Complete for bounded single namespace | visible refs locally; query-wide export/selection only after backend support |
| Namespace Custom | `frontend/src/modules/namespace/components/NsViewCustom.tsx` | `backend/objectcatalog`, `backend/refresh/snapshot/catalog.go`; `namespace_custom` retained only for explicit stream/diagnostic compatibility, not production table loading | namespace / all-namespaces | current catalog query page | backend customOnly kind/search/sort/namespace facets; CRD column derived from catalog GVR/resource | Query Backed Static | backend query-wide export and visible-row actions |
| Cluster Custom | `frontend/src/modules/cluster/components/ClusterViewCustom.tsx` | `backend/objectcatalog`, `backend/refresh/snapshot/catalog.go`; `cluster_custom` retained only for explicit stream/diagnostic compatibility, not production table loading | cluster | current catalog query page | backend customOnly kind/search/sort facets; CRD column derived from catalog GVR/resource | Query Backed Static | backend query-wide export and visible-row actions |
| Namespace Events | `frontend/src/modules/namespace/components/NsViewEvents.tsx` | `backend/refresh/snapshot/namespace_events.go` | namespace / all-namespaces | capped recent window | local search/sort over recent window | Local Partial | visible/recent-window only |
| Cluster Events | `frontend/src/modules/cluster/components/ClusterViewEvents.tsx` | `backend/refresh/snapshot/cluster_events.go` | cluster | capped recent window | local search/sort over recent window | Local Partial | visible/recent-window only |
| Object Events | `frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx` | `backend/refresh/snapshot/object_events.go` | object panel | capped object window | local sort over object events | Local Partial | visible/object-window only |
| Cluster Nodes | `frontend/src/modules/cluster/components/ClusterViewNodes.tsx` | `backend/refresh/snapshot/nodes.go` | cluster | usually complete; cardinality must be verified | local search/metadata search/sort; CPU/memory dynamic metrics | Local Complete below threshold; Query Backed Dynamic if threshold exceeded | visible refs locally; no global query behavior until backend supported |
| Object Panel Pods | `frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx` | `backend/refresh/snapshot/pods.go` | object panel related resources | object-scoped | local search/sort; metrics display | Local Complete if bounded by object relation | visible refs only |
| Object Panel Jobs | `frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.tsx` | object detail / job related payload | object panel related resources | object-scoped | local search/sort | Local Complete if bounded by object relation | visible refs only |
| Parsed Logs | `frontend/src/modules/object-panel/components/ObjectPanel/Logs/ParsedLogTable.tsx` | container logs stream / log parser | logs | bounded by log buffer | parsed log display/filtering outside GridTable | Local Partial | log-buffer export semantics |
| Namespace Config | `frontend/src/modules/namespace/components/NsViewConfig.tsx` | `backend/refresh/snapshot/namespace_config.go` | namespace / all-namespaces | capped by `SnapshotNamespaceConfigEntryLimit`; stats currently report returned count only | local kind/search/sort/namespace | Local Partial while capped; Query Backed Static required for global semantics | visible/capped-window only until query-backed |
| Namespace Network | `frontend/src/modules/namespace/components/NsViewNetwork.tsx` | `backend/refresh/snapshot/namespace_network.go` | namespace / all-namespaces | capped by `SnapshotNamespaceNetworkEntryLimit`; stats currently report returned count only | local kind/search/sort/namespace | Local Partial while capped; Query Backed Static required for global semantics | visible/capped-window only until query-backed |
| Namespace Storage | `frontend/src/modules/namespace/components/NsViewStorage.tsx` | `backend/refresh/snapshot/namespace_storage.go` | namespace / all-namespaces | capped by `SnapshotNamespaceStorageEntryLimit`; stats currently report returned count only | local kind/search/sort/namespace | Local Partial while capped; Query Backed Static required for global semantics | visible/capped-window only until query-backed |
| Namespace RBAC | `frontend/src/modules/namespace/components/NsViewRBAC.tsx` | `backend/refresh/snapshot/namespace_rbac.go` | namespace / all-namespaces | complete snapshot today; all-namespaces can become large | local kind/search/sort/namespace | Query Backed Static for all-namespaces/large scopes; Local Complete only after measured single-namespace bound | visible refs locally; query-wide export/selection only after backend support |
| Namespace Quotas | `frontend/src/modules/namespace/components/NsViewQuotas.tsx` | `backend/refresh/snapshot/namespace_quotas.go` | namespace / all-namespaces | capped by `SnapshotNamespaceQuotasEntryLimit`; stats currently report returned count only | local kind/search/sort/namespace | Local Partial while capped; Query Backed Static required for global semantics | visible/capped-window only until query-backed |
| Namespace Autoscaling | `frontend/src/modules/namespace/components/NsViewAutoscaling.tsx` | `backend/refresh/snapshot/namespace_autoscaling.go` | namespace / all-namespaces | capped by `SnapshotNamespaceAutoscalingEntryLimit`; stats currently report returned count only | local kind/search/sort/namespace; target/current/desired fields from autoscaler status snapshot | Local Partial while capped; Query Backed Static required for global semantics | visible/capped-window only until query-backed |
| Namespace Helm | `frontend/src/modules/namespace/components/NsViewHelm.tsx` | `backend/refresh/snapshot/namespace_helm.go` | namespace / all-namespaces | single namespace queries Helm directly; all-namespaces fans out across namespace list with worker limit and no row cap | local sort/search/namespace | Query Backed Static for all-namespaces/large scopes; Local Complete only after measured single-namespace bound | visible refs locally; query-wide export/selection only after backend support |
| Cluster Config | `frontend/src/modules/cluster/components/ClusterViewConfig.tsx` | `backend/refresh/snapshot/cluster_config.go` | cluster | complete snapshot today; cardinality must be benchmarked | local kind/search/sort | Local Complete only below measured threshold; Query Backed Static if threshold exceeded | visible refs locally; query-wide export/selection only after backend support |
| Cluster Storage | `frontend/src/modules/cluster/components/ClusterViewStorage.tsx` | `backend/refresh/snapshot/cluster_storage.go` | cluster | complete snapshot today; cardinality must be benchmarked | local search/sort | Local Complete only below measured threshold; Query Backed Static if threshold exceeded | visible refs locally; query-wide export/selection only after backend support |
| Cluster RBAC | `frontend/src/modules/cluster/components/ClusterViewRBAC.tsx` | `backend/refresh/snapshot/cluster_rbac.go` | cluster | complete snapshot today; cardinality must be benchmarked | local kind/search/sort | Local Complete only below measured threshold; Query Backed Static if threshold exceeded | visible refs locally; query-wide export/selection only after backend support |
| Cluster CRDs | `frontend/src/modules/cluster/components/ClusterViewCRDs.tsx` | `backend/refresh/snapshot/cluster_crds.go` | cluster | complete snapshot today; cardinality must be benchmarked | local search/sort/group/version/scope | Local Complete only below measured threshold; Query Backed Static if threshold exceeded | visible refs locally; query-wide export/selection only after backend support |

Inventory completion gate:

- Every row has a table mode, and every conditional mode has a measured
  threshold or implementation migration decision before code work starts.
- Every Local Complete row has a documented bound or measured maximum.
- Every Local Partial row names the cap/recent-window source and required UI
  copy.
- Every Query Backed Dynamic row names the dynamic revision source.
- Every query-backed row names export/select-all semantics.

### Query-Backed Catalog Table

Files:

- `frontend/src/modules/browse/components/BrowseView.tsx`
- `frontend/src/modules/browse/hooks/useBrowseCatalog.ts`
- `frontend/src/modules/browse/hooks/useBrowseColumns.tsx`

Current behavior:

- Backend catalog scope handles search/kind/namespace query parameters.
- `GridTable` still receives locally sortable rows through
  `useQueryResourceGridTable`.
- Pagination is "load more" append, so frontend memory grows with pages.

Plan disposition:

- Convert to backend-owned search/filter/sort/page.
- Replace append pagination with bounded first/previous/next cursor navigation.
- Disable local full-dataset sort/filter/facet behavior in query mode.

### Namespace Resource Tables

Files:

- `frontend/src/modules/namespace/components/NsViewPods.tsx`
- `frontend/src/modules/namespace/components/NsViewWorkloads.tsx`
- `frontend/src/modules/namespace/components/NsViewConfig.tsx`
- `frontend/src/modules/namespace/components/NsViewCustom.tsx`
- `frontend/src/modules/namespace/components/NsViewNetwork.tsx`
- `frontend/src/modules/namespace/components/NsViewStorage.tsx`
- `frontend/src/modules/namespace/components/NsViewRBAC.tsx`
- `frontend/src/modules/namespace/components/NsViewQuotas.tsx`
- `frontend/src/modules/namespace/components/NsViewAutoscaling.tsx`
- `frontend/src/modules/namespace/components/NsViewHelm.tsx`
- `frontend/src/modules/namespace/components/NsViewEvents.tsx`

Current behavior:

- All use local `GridTable` sort/filter through
  `useNamespaceResourceGridTable`.
- All-Namespaces mode can make a namespace table become cluster-scale.
- `NsViewPods` sorts CPU/memory locally from metric strings and has a local
  unhealthy/restarts/not-ready filter path.
- `NsViewWorkloads` sorts CPU/memory locally from aggregate workload metrics.
- `NsViewCustom` and `ClusterViewCustom` are especially risky because the
  backend currently fans out across CRDs and materializes all returned custom
  resources for the table.
- Namespace config/network/storage/RBAC/quotas/autoscaling snapshots are capped
  in backend config. Local sorting/filtering over a capped snapshot is only a
  sort/filter over the partial snapshot, not over the namespace universe.
- Namespace events are capped to recent events. Local sort/filter is only over
  the capped recent event window.

Plan disposition:

- Single-namespace typed tables may remain local only when the backend payload
  is complete and below the table-scale threshold.
- All-Namespaces typed tables are cluster-scale by default and must move to a
  backend query/window contract before claiming global search/filter/sort.
- Pod and workload CPU/memory sorts require backend metric-snapshot query
  support.
- Pod health filters such as unhealthy, restarted, and not-ready must become
  backend query predicates for large result sets.
- Custom resource tables must not keep using CRD fanout plus local table
  transforms as the large-cluster path.
- Capped snapshot tables must surface partial-data state and must not present
  local filters, counts, or sorts as global.

### Cluster Resource Tables

Files:

- `frontend/src/modules/cluster/components/ClusterViewNodes.tsx`
- `frontend/src/modules/cluster/components/ClusterViewEvents.tsx`
- `frontend/src/modules/cluster/components/ClusterViewConfig.tsx`
- `frontend/src/modules/cluster/components/ClusterViewCustom.tsx`
- `frontend/src/modules/cluster/components/ClusterViewStorage.tsx`
- `frontend/src/modules/cluster/components/ClusterViewRBAC.tsx`
- `frontend/src/modules/cluster/components/ClusterViewCRDs.tsx`

Current behavior:

- All use local `GridTable` sort/filter through
  `useClusterResourceGridTable`.
- Nodes are usually bounded, but CPU/memory are dynamic metric fields sorted
  locally from metric strings.
- Nodes also have local metadata search over labels and annotations.
- Cluster events are capped to recent events, so local sort/filter is partial.
- Cluster RBAC, storage, config, CRDs, and custom resources can grow large in
  operator-heavy clusters.
- Cluster custom resources have the same CRD fanout/materialization risk as
  namespace custom resources.

Plan disposition:

- Nodes can stay local while node count remains below threshold, but metric
  sort semantics must still be classified as metric-snapshot sort semantics.
- Cluster events remain a recent-events table unless and until an event query
  API is added.
- Cluster custom resources must move to query-backed custom-resource paging.
- Other cluster tables may stay local only when complete and below threshold;
  above threshold, they use the typed resource query contract or show explicit
  partial-data state.

### Object Panel Tables

Files:

- `frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/Logs/ParsedLogTable.tsx`

Current behavior:

- Object-panel tables are object-scoped, not catalog-scale.
- Events are capped by the object-events snapshot.
- Pods and Jobs are related-object tables scoped to the selected object.
- Parsed logs are bounded by the log buffer, but parsed/log filtering can still
  be memory-heavy and belongs to the logs large-data contract.

Plan disposition:

- Keep local sorting/filtering when the object-scoped payload is bounded and
  complete.
- Keep partial/capped event/log state visible.
- Do not expand object-panel related-resource tables into full namespace or
  cluster scans in the frontend.

## Table Mode Rules

Every `GridTable` consumer must declare or derive one of these modes.

### Local Complete

Use when the frontend has the complete row set and the maximum row count is
bounded by domain shape, not user preference.

Allowed:

- local sort
- local search/filter
- local facets from rows

Required:

- documented bound
- full cluster/object identity on rows

Examples:

- object-panel Jobs for a selected CronJob
- object-panel related Pods when scoped to one object
- Nodes while node count remains below threshold

### Local Partial

Use when the frontend has a capped or recent window, not the full result
universe.

Allowed:

- local sort/filter only over the visible partial dataset

Required:

- visible partial-data/degraded state
- no UI copy implying global totals, global facets, or global sort
- export/bulk limited to visible/current partial dataset

Examples:

- cluster and namespace events capped to recent events
- capped namespace config/network/storage/RBAC/quotas/autoscaling snapshots
  before they are migrated

### Query Backed Static

Use for large resource tables whose sortable/filterable fields are stable row
projection fields.

Backend owns:

- query predicates
- search
- sort
- facets
- totals
- pagination/windowing

Examples:

- Browse catalog
- high-cardinality custom resources
- high-cardinality config/RBAC/storage/network/resource quota tables

### Query Backed Dynamic

Use for large resource tables whose sortable/filterable fields depend on live
or frequently refreshed computed state.

Backend owns the same behavior as Query Backed Static, plus the snapshot
revision of the dynamic input.

Examples:

- Pods sorted by CPU or memory
- Workloads sorted by CPU or memory
- Nodes sorted by CPU or memory if node count crosses the table-scale threshold

Cursor tokens for this mode must include the base resource ordering contract and
the metric/computed continuity model chosen by the typed resource query epic.

## Migration Threshold

A table cannot stay local merely because it is convenient. It may stay local
only when one of these is true:

- the domain is naturally small and has a documented upper bound,
- the backend response is complete and the measured maximum remains below the
  table-scale budget,
- the UI clearly presents the table as a partial/recent window.

Initial table-scale threshold:

- Local Complete tables should stay below 1,000 rows under expected real-world
  usage.
- Any table that can reasonably exceed 1,000 rows in a large cluster must have a
  query-backed migration path.
- Any table above 5,000 possible rows is query-backed by default unless it is
  explicitly partial/recent.

These thresholds are not user-tunable performance settings. They decide which
data contract the table uses.

## Pagination Decision

Use keyset-compatible cursor pagination first.

The first Browse pager is first/previous/next only, with optional "last" only if
the backend can implement it without offset-style random access or scan-all
work. Do not ship numbered page jumps, "jump to page N", or a "Page X of Y"
contract in the first slice. Those require offset-into-index semantics and a
stable exact total, which keyset cursors deliberately avoid.

Do not implement unbounded infinite scroll. Infinite scroll only becomes
acceptable later if it uses a bounded page window and evicts old pages.

Cursor pagination is the first target because it has better failure properties:

- fixed frontend memory
- clear user model
- no random offset into a changing live result set
- simpler tests
- simpler selection semantics
- easier degraded-state messaging

If numbered pages become a product requirement later, design them as a separate
contract with an explicit bounded-cost story for offsets, exact or approximate
totals, and live-catalog mutation behavior. Do not bolt numbered pages onto the
Browse keyset cursor contract.

This is a correctness baseline, not a permanent UX ceiling. A later infinite
scroll presentation is acceptable only if it uses the same backend cursor/window
contract and evicts old pages so frontend memory remains bounded.

## Selection Model

Selection must be split into two explicit modes.

### Visible Row Selection

Stores concrete object refs for rows that are currently loaded.

This is suitable for actions over specific objects the user can see.

### Query Selection

Stores a query descriptor for "all objects matching this query".

This is required for export and bulk operations over a large result set. The
frontend must not load every matching row just to represent the selection.

## Phase 0: Browse Readiness And Enforcement Design

Goal: make omissions mechanically visible before the Browse slice starts,
without turning the later typed-query epic into a prerequisite for Browse.

- [x] Assign an owner for the Browse vertical slice.
- [x] Resolve product decisions that gate Browse design:
      committed target scale, day-one Browse sort fields, pager model,
      export/select-all behavior, and exact/approximate/degraded totals policy.
- [x] Verify the inventory by searching every production entry point named by
      the `browse-tables` skill:
      `<GridTable`, `<ResourceGridTableView>`,
      `useClusterResourceGridTable`, `useNamespaceResourceGridTable`,
      `useObjectPanelResourceGridTable`, `useQueryResourceGridTable`, and
      direct `useTableSort`.
- [x] Trace the backend producer for every table family, including refresh
      domain, payload type, stream parity, cap/truncation source,
      permission/degraded behavior, dynamic metric or computed revision source,
      identity source, cache/persistence keys, and consumers.
- [x] Classify every production table as Local Complete, Local Partial, Query
      Backed Static, or Query Backed Dynamic.
- [x] Mark naturally bounded object-panel/log rows as classified-and-done when
      their scope or buffer contract proves they cannot become catalog-scale.
- [x] Document the bound or measured maximum for every Local Complete table that
      can plausibly become namespace/cluster-scale.
- [x] Document the cap, recent-window, sampled, or degraded source and required
      UI copy for every Local Partial table.
- [x] Document backend query ownership, cursor identity, export semantics, and
      query-selection semantics for Browse.
- [x] Document how `clusterId` scopes query cache keys, pagination state, table
      persistence keys, and query-selection descriptors for every table mode.
- [x] Decide the type-level enforcement mechanism that prevents new
      resource-grid production table usage from bypassing table-mode
      classification.
- [x] Resolve typed-table query design questions for the completed Custom,
      Pods, and Workloads slices; keep any future table-family expansion in a
      new scoped plan.

Acceptance:

- The inventory has no unresolved conditional or unverified cells that affect
  Browse, shared table-mode enforcement, or query-backed Browse semantics.
- Every production `GridTable` consumer has a traced backend producer, table
  mode, completeness contract, and export/selection/action semantics. Dynamic
  query details may remain deferred only for typed tables outside the Browse
  slice.
- Every production table cache, persistence key, pagination state, and
  query-selection descriptor has explicit `clusterId` scoping.
- The first implementation PR has a required `tableMode` type contract ready
  before changing shared table behavior.
- No Browse code phase below starts until this gate is complete.

## Phase 1: Lock Table Mode Boundaries

Goal: make table mode explicit and stop shared table behavior from treating
query-backed rows as a complete dataset. This phase must not fake backend query
ownership before the backend query contract exists.

- [x] Add an explicit table mode contract to the shared resource-grid adapter:
      Local Complete, Local Partial, Query Backed Static, or Query Backed
      Dynamic.
- [x] Make `tableMode` a required, non-optional prop for production
      resource-grid adapters so TypeScript rejects unclassified table usage.
- [x] Update `GridTable` query-mode behavior so `searchBehavior: 'query'`
      means rows are treated as already filtered/searched/sorted by the source.
- [x] Remove the current placeholder behavior where Browse sets
      `searchBehavior: 'query'` but shared filtering still runs
      `applyGridTableFilters` locally.
- [x] Ensure query-backed mode disables local `useTableSort` ordering unless the
      sort callback is only emitting a backend query change.
- [x] Preserve local filtering/searching/sorting for tables that own a complete
      bounded dataset.
- [x] Make Local Partial tables surface partial/recent/capped state and avoid
      global count/facet/sort claims.
- [x] Ensure query-backed tables can consume backend-provided totals and facets
      without deriving equivalent metadata from the loaded row slice.
- [x] Add a static or contract test only for gaps TypeScript cannot cover, such
      as direct production `GridTable` or direct `useTableSort` usage outside
      the resource-grid adapter.
- [x] Add frontend tests proving query-backed tables do not locally narrow rows.
- [x] Add frontend tests proving local-mode tables still locally search/filter.
- [x] Update table docs to define local tables vs query-backed tables.

Acceptance:

- Query-backed table mode does not run local full-row transforms.
- Query-backed table mode does not derive global facets, filter options, or
  totals from the current loaded page.
- Existing local tables keep their current behavior.
- Every production resource-grid table has a compile-time required table mode.
- Direct production `GridTable` and direct `useTableSort` usages are covered by
  a static/contract check or an explicit exception.
- Every production `GridTable` consumer has traced export, selection,
  select-all, context-menu, and bulk-action semantics.
- This phase does not introduce a frontend-only query workaround or scan-all
  backend endpoint.

## Phase 2: Harden Existing Backend Catalog Query Interface

Goal: harden the existing catalog query boundary before optimizing internals.

- [x] Trace current catalog producer and consumers:
      `backend/objectcatalog`, `backend/refresh/snapshot/catalog.go`,
      catalog stream payloads, `useBrowseCatalog`, Browse persistence,
      favorites, object actions, and CSV/export hooks.
- [x] Extend the existing `QueryOptions`, `QueryResult`, and
      `CatalogSnapshot` contracts instead of creating a parallel greenfield
      query type.
- [x] Preserve cluster and full GVK identity through the existing refresh scope,
      data-access, and row contracts.
- [x] Add backend-owned sort parameters for the Browse day-one sort fields.
- [x] Add a catalog query service/store interface behind `backend/objectcatalog`
      so the storage implementation can be replaced without changing frontend
      contracts.
- [x] Include page limit validation and a hard backend maximum.
- [x] Replace the current integer-offset `Continue` token with a keyset cursor
      bound to `clusterId`, canonical query signature, backend sort, page
      direction, page limit, cursor/order version, last sort value, and stable
      tie-breaker object key.
- [x] Use live keyset continuity across ordinary catalog mutations. Do not
      reject solely because the live catalog revision advanced between page
      turns.
- [x] Include explicit exact, approximate, or degraded state when totals, facets,
      or query precision are not exact.
- [x] Make cursor validation reject malformed cursors and cursors with
      mismatched cluster, query signature, sort order, page direction, page
      limit, cursor/order version, or unavailable frozen snapshot.
- [x] Include page direction and page limit in cursor validation so previous
      pages and page-size changes cannot silently skip or duplicate rows.
- [x] Route frontend catalog reads through `dataAccess` rather than direct
      transport calls.
- [x] Add contract tests for identity preservation, limit validation, keyset
      cursor validation, live-mutation continuity, and degraded totals/facets.

Acceptance:

- The frontend can request one page of catalog rows with search, filters, sort,
  and limit.
- The response contains backend-owned totals/facets with exact, approximate, or
  degraded state.
- Valid keyset cursors continue across minor live catalog additions/deletions.
- Invalid cursors fail predictably and force a refetch from page 1.
- Cursor tokens cannot be reused across clusters, query signatures, or sort
  orders.
- Cursor tokens cannot be reused across incompatible page directions or page
  limits.
- Catalog query producer trace documents completeness, truncation, cursor,
  stats/degraded behavior, and all consumers that assume current row shape.

## Typed Resource Query Epic

Goal: cover namespace and cluster resource views that are not pure catalog
identity tables. The first completed typed slices are all-namespaces Pods and
Workloads, with Custom resources handled by the catalog query path.

- [x] Trace backend producers for each high-risk typed table before designing
      its query shape: Pods, Workloads, Custom resources, Events, Nodes,
      namespace capped resource snapshots, and Helm.
- [x] Define a typed resource query request/result contract parallel to catalog
      query, with full `clusterId` and GVK identity on every concrete row.
- [x] Support stable projected fields used by current table columns:
      kind, namespace, name, status, ready, restarts, owner, node, details,
      CRD name, CRD group, CRD scope, storage version, storage class, capacity,
      claim, chart/app version, Helm revision, Helm updated timestamp,
      autoscaling target/current/desired values, and age.
- [x] Support dynamic projected fields with snapshot revisions:
      pod CPU, pod memory, workload CPU, workload memory, node CPU, and node
      memory.
- [x] Support table-specific predicates that currently run locally, including
      pod unhealthy, pod restarted, pod not-ready, kind, namespace, and search.
- [x] Decide metadata search semantics for labels/annotations: either indexed
      backend metadata search for query-backed tables, or explicit Local
      Complete-only behavior with large-scope disable/degraded UI.
- [x] Include partial/degraded metadata for capped snapshots, missing
      permissions, stale metrics, unavailable metrics, and failed CRD fanout.
- [x] Choose the metric-sort paging model before defining dynamic cursor
      semantics: bounded frozen metrics snapshot, bounded top-k/page depth, or
      first-page/current-window-only metric sorting.
- [x] Keep object-panel related-resource tables out of the query path unless
      they become namespace/cluster-scale.

Acceptance:

- The query contract can represent every sortable/filterable field currently
  exposed by namespace and cluster `GridTable` resource views.
- Dynamic metric sorts have an explicit paging model and cursor continuity
  contract; they do not restart at page 1 merely because a new metrics snapshot
  arrived.
- Local-only tables have an explicit bound or partial-data label.
- Typed producer traces document cap/truncation sources, permission/degraded
  behavior, stream parity, dynamic revision source, and current consumers.

## Phase 3: Build The Per-Cluster Catalog Index

Goal: remove collect-all, sort-all, slice pagination, frontend-scale row
materialization, and unbounded per-query working sets from large catalog
queries. The current in-memory catalog query path still performs an O(N) CPU
stream over catalog chunks for default, search-only, and sort-only queries
where no namespace or kind index can narrow candidates. That scan feeds only a
bounded page buffer and exact-metadata budget, so query memory stays bounded;
benchmarks cover the accepted scale envelope.

- [x] Build a per-cluster index owned by the object catalog/query layer.
- [x] Update the index incrementally from catalog refresh/stream events.
- [x] Support filtering by GVK and namespace without scanning all rows.
- [x] Support normalized name/kind/namespace search.
- [x] Support deterministic sort order with stable tie-breakers.
- [x] Collapse cached and no-cache query ordering/filter/pagination logic behind
      the same helper so cursor stability cannot depend on whether streaming
      cache state is warm. The current paths duplicate the same
      kind/namespace/name order; keep them from drifting.
- [x] Generate namespace and kind facets from indexed state.
- [x] Return approximate or degraded totals/facets instead of scanning all rows
      when exact metadata is too expensive.
- [x] Keep all query results scoped to exactly one `clusterId`.
- [x] Add backend unit tests for incremental add/update/delete behavior.
- [x] Add backend tests for search, filter, sort, facets, totals, and cursors.

Acceptance:

- Query execution materializes only the requested page plus bounded working
  state.
- Sort order is stable across pages for the same query signature and ordering
  version, even when the live catalog receives minor additions or deletions.
- Deleted or changed objects do not remain reachable through stale index keys.
- Exact metadata is provided only when backed by indexed state or bounded work.

## Phase 4: Benchmark And Set Performance Budgets

Goal: prove the fix under realistic large-cluster conditions.

- [x] Add synthetic catalog fixtures for 10k, 50k, 100k, and 250k objects.
- [x] Defer synthetic typed fixtures to the typed resource query epic unless one
      of those tables is selected as the next vertical slice.
- [x] Include pathological fixtures:
      many namespaces, many CRDs, many kinds, one namespace holding most
      objects, long names, missing metadata, permission-degraded discovery, and
      high update/delete churn.
- [x] Benchmark common queries:
      empty search, name search, namespace filter, kind filter, combined
      namespace/kind/search, and sorted pages.
- [x] Benchmark cursor invalidation and refresh churn while users page through
      results.
- [x] Measure allocations and peak memory for the query path.
- [x] Measure steady-state per-cluster catalog index residency for 10k, 50k,
      100k, and 250k objects, including normalized search terms, facet/index
      structures, cursor/order metadata, and lookup maps.
- [x] Measure multi-cluster aggregate index residency with several
      simultaneously connected large clusters.
- [x] Measure frontend row memory across page navigation.
- [x] Record budgets in this plan or the durable large-data architecture doc
      after implementation.

Initial target budgets:

- First page query over 100k objects: under 250 ms on a developer machine.
- Subsequent page query over 100k objects: under 100 ms on a developer machine.
- Per-cluster catalog index residency for 100k and 250k objects has an explicit
  MB budget before implementation is accepted.
- Multi-cluster aggregate catalog index residency has an explicit ceiling for
  the maximum supported number of simultaneously connected large clusters.
- Frontend retained rows after visiting multiple pages: bounded to the current
  page/window, not cumulative.
- Search/filter keystroke path: no renderer full-dataset transform.
- Visiting 20 pages in Browse does not create cumulative retained row arrays.
- Exact facets/counts are either served from indexed state within budget or
  returned as approximate/degraded.
- Cursor continuity across ordinary live catalog mutations is deterministic and
  covered by tests.
- Typed table budgets are required before the typed resource query epic ships,
  including custom-resource fanout, metric-sorted Pods, metric-sorted Workloads,
  and any table allowed to remain Local Complete above the default threshold.

Measured Browse catalog query budget sample on 2026-05-31, Apple M2 Max,
`go test ./backend/objectcatalog -run '^$' -bench ... -benchtime=1x -benchmem`:

- 100k first page: 4.32 ms, 160 KB allocated, 135 allocs.
- 100k cursor page: 7.07 ms, 151 KB allocated, 61 allocs.
- 100k per-cluster index residency: 26.75 MB.
- 250k first page: 11.45 ms, 161 KB allocated, 138 allocs.
- 250k cursor page: 17.67 ms, 151 KB allocated, 61 allocs.
- 250k per-cluster index residency: 66.80 MB.
- 3 x 100k multi-cluster index residency: 80.19 MB aggregate.

These budgets are starting targets. If the hardware or fixture model makes
them unrealistic, update the budget with measured evidence rather than leaving
the behavior undefined.

## Phase 5: Move Browse Fully Onto Query Results

Goal: make Browse the reference implementation for catalog-scale tables.

- [x] Search sends query params to the backend with debounce.
- [x] Namespace and kind filters come from backend facets.
- [x] Sort changes issue backend queries.
- [x] First/previous/next cursor navigation replaces the current row page instead
      of appending forever.
- [x] Numbered page jumps and "Page X of Y" UI are out of scope unless a
      separate bounded offset/total contract is designed.
- [x] Refresh and stream updates preserve live keyset continuity unless the
      query signature, sort order, cursor/order version, or explicit frozen
      snapshot token becomes invalid.
- [x] Loading, empty, blocked, stale, degraded, and partial states are visible.
- [x] Current row keys include full cluster/object identity.
- [x] Query cache keys, pagination state, table persistence keys, and any
      selection descriptors are scoped by `clusterId`.
- [x] Remove Browse code paths that depend on user-raised row caps for scale.
- [x] Audit Browse for any remaining local full-dataset transforms.
- [x] Keep all-matching export/bulk disabled or explicitly page-scoped
      until a backend query operation exists for the active query descriptor.
- [x] Add integration tests for large-result pagination behavior.

Acceptance:

- Browse can inspect a 100k-object synthetic catalog without loading 100k rows
  into React.
- Page navigation does not increase retained frontend row count.
- Browse paging is sequential cursor navigation, not arbitrary numbered-page
  random access.
- Filter options describe the matching result universe, not the current page.
- If results change during paging, ordinary live mutations do not bounce the
  user to page 1; truly invalid cursors restart the query rather than showing
  duplicate or missing rows.
- Browse does not expose all-matching export or all-matching bulk actions unless
  the action executes against a backend query descriptor for the same
  `clusterId` and query signature.

## Phase 5B: Migrate High-Risk Typed Tables

Goal: apply the same bounded-window model to non-catalog tables that can become
large.

- [x] Move namespace and cluster custom-resource tables away from CRD fanout
      plus local transforms and onto query-backed custom-resource paging.
- [x] Stop production namespace/cluster Custom tabs from enabling,
      subscribing to, loading, or passing through `namespace-custom` /
      `cluster-custom` full-row fanout payloads. Kind filter options come from
      catalog facets, not fanout metadata.
- [x] Hydrate only the current Custom catalog page for rich status, readiness,
      conditions, labels, and annotations so catalog identity paging does not
      degrade the row details users had in the legacy fanout tables.
- [x] Move All-Namespaces Pods onto Query Backed Dynamic mode for search,
      namespace filter, health filters, CPU sort, and memory sort.
- [x] Move All-Namespaces Workloads onto Query Backed Dynamic mode for search,
      kind filter, namespace filter, CPU sort, and memory sort.
- [x] Keep the Pods/Workloads query path honest: it still performs an O(N)
      informer-backed scan for broad queries, but projected rows feed a bounded
      keyset candidate buffer instead of retaining and sorting the full
      projected row universe before slicing.
- [x] Add backend metric-snapshot sorting for Pods and Workloads before
      disabling local CPU/memory sort for large scopes.
- [x] Audit config/RBAC/storage/network/quotas/autoscaling tables against
      measured large-cluster fixtures and either:
      keep Local Complete with a documented bound, keep Local Partial with
      visible partial-state copy, or migrate to Query Backed Static.
- [x] Keep cluster and namespace events explicitly Local Partial/recent until a
      real event query API exists.

Acceptance:

- No All-Namespaces typed table presents local search/filter/sort as global
  unless it is query-backed.
- Custom-resource views do not materialize all CR instances into the frontend
  for large clusters.
- CPU/memory sorts are globally correct for the metric snapshot used by the
  backend response.

## Phase 6: Backend-Owned Export And Bulk Operations

Goal: prevent export and bulk workflows from reloading the table universe into
the frontend.

- [x] Audit current GridTable CSV/export hooks and selection behavior against
      each table mode.
- [x] Add "export current page" using loaded concrete rows.
- [x] Add "export all matching query" as a backend operation.
- [x] Keep visible-row bulk actions over concrete object refs.
- [x] Add query-selection bulk action support only where the backend can
      execute safely against a query descriptor.
- [x] Require confirmation for query-wide bulk actions.
- [x] Surface partial failure results without requiring all object rows in the
      frontend.

Acceptance:

- Exporting all matching objects does not require all matching rows in React.
- Query-wide bulk actions execute from a backend query descriptor, not
  thousands of concrete refs.
- Local Partial tables export/select only the visible or recent/capped window
  and say so in the UI.

## Phase 7: Remove The Old User-Facing Escape Hatch

Goal: eliminate the workflow that tells users to raise row limits to make large
clusters usable.

- [x] Hide or reword user-facing max table row settings that imply performance
      tuning.
- [x] Keep hard backend safety caps.
- [x] Add page-size controls with bounded options.
- [x] Audit cluster, namespace, and dashboard tables for catalog-scale data
      paths that still rely on capped snapshots.
- [x] Convert catalog-scale tables to query-backed mode.
- [x] Leave local mode only for genuinely bounded tables.

Acceptance:

- Users are not guided toward increasing row caps as the fix for large
  clusters.
- Any remaining capped table clearly communicates that it is showing a partial
  dataset.

## Test Plan

Backend:

- object catalog query contract tests
- index update tests
- query search/filter/sort/facet tests
- live-mutation keyset continuity tests
- query-signature cursor mismatch tests
- previous-page and page-limit cursor mismatch tests
- degraded state tests
- steady-state catalog index residency tests or benchmarks per cluster
- multi-cluster aggregate catalog index residency benchmark
- benchmarks for 10k, 50k, 100k, and 250k objects
- churn benchmarks with update/delete events during paging

Frontend:

- `GridTable` local-mode tests
- resource-grid table mode contract tests
- TypeScript coverage proving production resource-grid adapters require
  `tableMode`
- static inventory enforcement test for direct production `GridTable`,
  `ResourceGridTableView`, or direct `useTableSort` usage that TypeScript
  table-mode props cannot cover
- `GridTable` query-mode tests
- tests proving `searchBehavior: 'query'` does not run local
  `applyGridTableFilters`
- tests proving query-backed sort emits backend query changes instead of local
  `useTableSort` ordering
- Browse query parameter tests
- Browse pagination tests
- Browse facet/count/degraded-state tests
- Browse invalid-cursor recovery tests
- Browse cluster-scoped query cache, pagination, persistence, and selection
  descriptor tests
- Browse all-matching export/bulk disabled or backend-query-backed tests
- typed resource query mode tests for Pods, Workloads, and Custom resources
- selection mode tests for visible rows vs all matching query

End-to-end or integration:

- synthetic large catalog smoke test
- search/filter/sort/page through Browse
- first/previous/next cursor navigation without numbered-page random access
- search/filter/sort/page through All-Namespaces Pods, Workloads, and Custom
  resources
- memory check that rows do not accumulate across pages
- churn scenario where results update during pagination

Final validation for non-documentation implementation work:

```sh
mage qc:prerelease
```

## Risks

- Cursor stability can be wrong if the index mutates without a stable keyset
  ordering contract and cursor/order version semantics.
- Cursor behavior can become unusable if the implementation rejects every live
  catalog mutation instead of using keyset continuity.
- The backend index can move the memory problem from the renderer to the Go
  process if steady-state per-cluster and multi-cluster residency are not
  budgeted and measured.
- Facets can become misleading if generated from the current page instead of
  the query universe.
- Selection can accidentally force full result materialization.
- A frontend "quick fix" can reintroduce local transforms in `GridTable`.
- Backend O(N) CPU scans for unfiltered/default catalog pages can hide behind a
  paginated API unless benchmarks and allocation tests are kept current.
- A custom in-memory index can grow into an ad hoc database. The query store
  interface and storage checkpoint exist to force an explicit SQLite decision
  before that happens.
- Cursor pagination may be less fluid than browsing by scroll. That tradeoff
  is intentional for the first implementation because correctness and bounded
  memory come first.
- Treating every typed table as catalog-like would break metric sorts and
  computed status fields. Typed query mode exists to keep those semantics
  backend-owned instead of falling back to local row transforms.
- Leaving capped snapshot tables unchanged can preserve partial-data bugs. Any
  table that remains capped must say so in the UI.
- The current inventory still contains conditional mode decisions and
  unverified producer details. Implementation before those are resolved would
  repeat the original failure mode.
- Metric-sorted typed views can become impossible to page through if the plan
  treats every metrics refresh as an invalid cursor instead of choosing a frozen
  snapshot, top-k, or first-page/current-window product model.

## Resolved Questions

- Label filters wait until a backend metadata index exists; query-backed tables
  must not imply global label/annotation search from the current page.
- SQLite is not required for the accepted 100k-object target. Revisit the
  storage decision if benchmarked per-page latency, CPU, or steady-state index
  residency exceeds the budgets documented in `docs/architecture/large-data.md`.
- The first non-Browse migrations are complete for Custom resources via catalog
  query paging and for all-namespaces Pods/Workloads via typed dynamic query
  paging.
- Remaining Local Complete rows are allowed only when the producer is naturally
  bounded or measured below the table budget; capped/recent rows remain Local
  Partial with visible degraded copy.
- Metric-sorted Pods and Workloads use live keyset continuity over the latest
  metrics snapshot. Cursors carry the dynamic revision for diagnostics and
  signature visibility but do not reject solely because metrics refreshed.

## Definition Of Done

- A 100k-object synthetic cluster does not require 100k frontend rows.
- Search, filter, sort, and pagination are backend-owned for Browse.
- Browse pagination is keyset-compatible first/previous/next cursor navigation;
  numbered-page random access requires a separate bounded-cost contract.
- Every production `GridTable` consumer is classified as Local Complete, Local
  Partial, Query Backed Static, or Query Backed Dynamic.
- The production table inventory has no unresolved conditional or unverified
  cells for Browse and table-mode enforcement, and a required `tableMode` prop
  prevents new unclassified resource-grid table usage.
- Frontend retained row memory is bounded across page navigation.
- Backend catalog index residency has measured per-cluster and multi-cluster
  aggregate memory budgets.
- Query-backed `GridTable` mode cannot locally transform the full dataset.
- Query cache keys, pagination state, table persistence, and query-selection
  descriptors are scoped by `clusterId`.
- Filter options and counts come from backend query metadata and are explicitly
  exact, approximate, or degraded.
- Dynamic metric sorts are backend-owned and use the explicit metric paging
  model chosen by the typed resource query epic.
- Export and query-wide selection do not load all matching rows into React.
- The old row-cap setting is no longer presented as the way to make large
  clusters usable.
- Benchmarks exist and fail loudly if the catalog query path regresses.
- Cursor behavior is stable under normal paging, deterministic across ordinary
  live catalog mutations, and rejects only genuinely incompatible cursor state.
