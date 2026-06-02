# App-Wide Table Hardening

Status: Active. The previous large-table work completed the first production
slice: Browse, Custom resource catalog paging, all-namespaces Pods,
all-namespaces Workloads, backend-owned query export/bulk support for supported
query surfaces, and shared table-mode enforcement. That does not satisfy the
app-wide goal below.

Goal: no production table can mislead users or fall over at large scale. Every
table must either have backend-owned global query semantics, prove a complete
bounded dataset, or clearly present itself as a recent/capped/partial view with
matching counts, filters, export, selection, and destructive-action semantics.

## Baseline Already Captured

Durable rules from the first slice live in
[`docs/architecture/large-data.md`](../architecture/large-data.md) and
[`docs/frontend/gridtable.md`](../frontend/gridtable.md). They cover table
modes, query-backed catalog behavior, typed query contracts, cursor semantics,
Browse budgets, and the completed high-risk migrations for Custom resources,
all-namespaces Pods, and all-namespaces Workloads.

Do not recreate the old completed implementation plan. This document tracks the
remaining work needed to meet the app-wide product goal.

## Current Table Disposition

Completed query-backed surfaces:

- Browse: `Query Backed Static`.
- Cluster and namespace Custom resources: `Query Backed Static` through catalog
  paging and current-page hydration.
- All-namespaces Pods: `Query Backed Dynamic`.
- All-namespaces Workloads: `Query Backed Dynamic`.

Remaining `Local Partial` surfaces that need query migration or stronger
partial UX/action limits:

- Namespace Events, Cluster Events, Object Events.
- Namespace Config, Network, Storage, Quotas, Autoscaling, Helm.
- Parsed logs, where table-like filtering/export is bounded by the log buffer.

Remaining `Local Complete` or conditional surfaces that need measured bounds or
query migration:

- Cluster Nodes.
- Namespace RBAC.
- Cluster Config, Storage, RBAC, CRDs.
- Object-panel related Pods and Jobs if any owner scope can become
  namespace/cluster-scale.

Closed backend architecture gap:

- `backend/objectcatalog.Service.Query` now runs through a replaceable
  `CatalogQueryStore` seam. The default store is the existing in-memory catalog
  query index, preserving `QueryOptions` and `QueryResult` contracts.

## Phase 0 Production Table Inventory

Inventory re-run against current code on 2026-06-01. Production render sites
covered: `<GridTable`, `<ResourceGridTableView`,
`useClusterResourceGridTable`, `useNamespaceResourceGridTable`,
`useObjectPanelResourceGridTable`, `useQueryResourceGridTable`,
`useQueryBackedNamespaceResourceGridTable`, direct `useTableSort`, catalog
query export hooks, and catalog query bulk-delete hooks.

Shared action semantics unless noted: resource tables expose per-row context
menus only for visible rows and build concrete refs with `clusterId`, GVK,
namespace when namespaced, and name. Shared GridTable CSV copies visible rows
only. There is no table-wide row-selection model for these resource-grid
tables; kind/namespace dropdown "select all" selects filter options, not
objects. Browse and Custom add backend query-wide CSV for scoped catalog
queries. Browse also adds backend query-wide bulk delete, disabled for
unscoped all-namespace queries.

| Surface                               | View id / owner                                                       | Producer and row type                                                                                                           | Scope                                                           | Completeness and current mode                                                                                                                               | Counts, facets, pagination                                                                                              | Export, selection, actions                                                                                                                    | Expected worst-case cardinality                                                    |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Browse catalog                        | `browse`, `all-namespaces-browse`, `namespace-browse` in `BrowseView` | `backend/objectcatalog.Service.Query` through `backend/refresh/snapshot/catalog.go`; frontend `CatalogItem` -> `BrowseTableRow` | cluster, namespace, or all-namespaces within one `clusterId`    | Backend paged catalog query; `Query Backed Static`                                                                                                          | Backend total/exactness, kind and namespace facets, cursor previous/next, bounded page size                             | Visible-row CSV plus scoped backend query CSV; query-wide bulk delete disabled for unscoped all-namespace query; row actions use catalog refs | Catalog scale, measured to 250k objects per cluster in current budget              |
| Cluster Custom resources              | `cluster-custom` in `ClusterViewCustom`                               | Catalog query with `customOnly=true`; current page hydrated by `HydrateCatalogCustomRows` into `ClusterCustomData`              | cluster-scoped custom resources for one cluster                 | Backend paged catalog query plus page hydration; `Query Backed Static`                                                                                      | Backend total/exactness, kind facets, cursor previous/next                                                              | Visible/current-page actions; backend query CSV for scoped query; no query-wide destructive action                                            | CRD fanout scale, bounded to current catalog page in React                         |
| Namespace Custom resources            | `namespace-custom` in `NsViewCustom`                                  | Catalog query with `customOnly=true`; current page hydrated into `CustomResourceData`                                           | single namespace or all-namespaces for one cluster              | Backend paged catalog query plus page hydration; `Query Backed Static`                                                                                      | Backend total/exactness, kind and namespace facets, cursor previous/next                                                | Visible/current-page actions; backend query CSV for scoped query, disabled when all-namespaces is unscoped                                    | CRD fanout scale, bounded to current catalog page in React                         |
| Namespace Pods, all namespaces        | `namespace-pods` in `NsViewPods`                                      | `backend/refresh/snapshot/pods.go` typed query `PodSnapshotPayload`; frontend `PodSnapshotEntry`                                | all namespaces for one cluster                                  | Backend search/filter/sort/page with metrics revision; `Query Backed Dynamic`                                                                               | Backend total/exactness, namespace facets, keyset next page                                                             | Visible-row CSV and row actions only; permission checks use visible namespace targets                                                         | Pod scale, bounded page in React                                                   |
| Namespace Pods, single namespace      | `namespace-pods` in `NsViewPods`                                      | `pods` refresh snapshot/stream; `PodSnapshotEntry`                                                                              | one namespace for one cluster                                   | Namespace-scoped snapshot; `Local Complete` pending measured bound in Phase 2                                                                               | Local count/facets/search/sort; no pagination beyond local max-row cap                                                  | Visible-row CSV and row actions only                                                                                                          | Namespace pod count; can be high in large tenant namespaces                        |
| Namespace Workloads, all namespaces   | `namespace-workloads` in `NsViewWorkloads`                            | `backend/refresh/snapshot/namespace_workloads.go` typed query; `NamespaceWorkloadSummary`/`WorkloadData`                        | all namespaces for one cluster                                  | Backend search/filter/sort/page with metrics revision; `Query Backed Dynamic`                                                                               | Backend total/exactness, kind and namespace facets, keyset next page                                                    | Visible-row CSV and row actions only                                                                                                          | Workload scale across cluster, bounded page in React                               |
| Namespace Workloads, single namespace | `namespace-workloads` in `NsViewWorkloads`                            | `namespace-workloads` refresh snapshot; `WorkloadData`                                                                          | one namespace for one cluster                                   | Namespace-scoped typed snapshot; `Local Complete` per current large-data contract                                                                           | Local count/facets/search/sort; no query pagination                                                                     | Visible-row CSV and row actions only                                                                                                          | Namespace workload count; currently treated as bounded by namespace                |
| Cluster Events                        | `cluster-events` in `ClusterViewEvents`                               | `backend/refresh/snapshot/cluster_events.go`; `ClusterEventEntry`                                                               | cluster event window for one cluster                            | Recent/capped snapshot with `SnapshotStats.Truncated`; `Local Partial`                                                                                      | Local count/search/sort over recent window; no pagination                                                               | Visible-row CSV and involved-object action only                                                                                               | Event volume is unbounded; backend keeps recent window                             |
| Namespace Events                      | `namespace-events` in `NsViewEvents`                                  | `backend/refresh/snapshot/namespace_events.go`; `NamespaceEventSummary`                                                         | single namespace or all-namespaces event window for one cluster | Recent/capped snapshot with `SnapshotStats.Truncated`; `Local Partial`                                                                                      | Local count/search/sort over recent window; namespace filter local when all-namespaces                                  | Visible-row CSV and involved-object action only                                                                                               | Event volume is unbounded; backend keeps recent window                             |
| Object Events                         | direct `GridTable` in `EventsTab`                                     | `backend/refresh/snapshot/object_events.go`; `ObjectEventSummary` -> `EventDisplay`                                             | one object-scoped event window                                  | Recent/capped object-event snapshot with `SnapshotStats.Truncated`; `Local Partial`                                                                         | Local sort over object event window; no filter bar or pagination                                                        | No table CSV; row click opens involved object when resolvable                                                                                 | Object event volume is unbounded; backend keeps recent window                      |
| Namespace Config                      | `namespace-config` in `NsViewConfig`                                  | `backend/refresh/snapshot/namespace_config.go`; `NamespaceConfigSummary`                                                        | single namespace or all-namespaces for one cluster              | Snapshot payload; currently classified `Local Partial`                                                                                                      | Local count/facets/search/sort, namespace filter local for all-namespaces; no pagination                                | Visible-row CSV and row actions only                                                                                                          | ConfigMap/Secret count can be high, especially all-namespaces                      |
| Namespace Network                     | `namespace-network` in `NsViewNetwork`                                | `backend/refresh/snapshot/namespace_network.go`; `NamespaceNetworkSummary`                                                      | single namespace or all-namespaces for one cluster              | Snapshot payload; currently classified `Local Partial`                                                                                                      | Local count/facets/search/sort, namespace filter local for all-namespaces; no pagination                                | Visible-row CSV and row actions only                                                                                                          | Services/Ingresses/EndpointSlices/policies can be high                             |
| Namespace Storage                     | `namespace-storage` in `NsViewStorage`                                | `backend/refresh/snapshot/namespace_storage.go`; `NamespaceStorageSummary`                                                      | single namespace or all-namespaces for one cluster              | Snapshot payload; currently classified `Local Partial`                                                                                                      | Local count/search/sort, namespace filter local for all-namespaces; no pagination                                       | Visible-row CSV and row actions only                                                                                                          | PVC count can be high across namespaces                                            |
| Namespace Quotas                      | `namespace-quotas` in `NsViewQuotas`                                  | `backend/refresh/snapshot/namespace_quotas.go`; `NamespaceQuotaSummary`                                                         | single namespace or all-namespaces for one cluster              | Snapshot payload; currently classified `Local Partial`                                                                                                      | Local count/facets/search/sort, namespace filter local for all-namespaces; no pagination                                | Visible-row CSV and row actions only                                                                                                          | Usually moderate, but all-namespaces PDBs can be high                              |
| Namespace Autoscaling                 | `namespace-autoscaling` in `NsViewAutoscaling`                        | `backend/refresh/snapshot/namespace_autoscaling.go`; `NamespaceAutoscalingSummary` -> `AutoscalingData`                         | single namespace or all-namespaces for one cluster              | Snapshot payload; currently classified `Local Partial`                                                                                                      | Local count/facets/search/sort, namespace filter local for all-namespaces; no pagination                                | Visible-row CSV and row actions only                                                                                                          | HPA count can grow with workload count                                             |
| Namespace RBAC                        | `namespace-rbac` in `NsViewRBAC`                                      | `backend/refresh/snapshot/namespace_rbac.go`; `NamespaceRBACSummary`                                                            | single namespace or all-namespaces for one cluster              | Snapshot payload capped at 1,000 rows; single namespace is `Local Complete` below cap and `Local Partial` when truncated; all-namespaces is `Local Partial` | Local count/facets/search/sort over the loaded bounded window; namespace filter local for all-namespaces; no pagination | Visible-row CSV and row actions only                                                                                                          | Role/RoleBinding count can be high across namespaces                               |
| Namespace Helm                        | `namespace-helm` in `NsViewHelm`                                      | `backend/refresh/snapshot/namespace_helm.go`; `NamespaceHelmSummary` -> synthetic HelmRelease row                               | single namespace or all-namespaces for one cluster              | Snapshot payload capped at 1,000 rows; single namespace is `Local Complete` below cap and `Local Partial` when truncated; all-namespaces is `Local Partial` | Local count/search/sort over the loaded bounded window; namespace filter local for all-namespaces; no pagination        | Visible-row CSV and synthetic HelmRelease actions only                                                                                        | Release count can be high across namespaces                                        |
| Cluster Nodes                         | `cluster-nodes` in `ClusterViewNodes`                                 | `backend/refresh/snapshot/nodes.go`; `ClusterNodeRow` with metrics                                                              | cluster for one cluster                                         | Snapshot payload capped at 1,000 rows; `Local Complete` below cap and `Local Partial` when truncated                                                        | Local count/search/sort including CPU/memory over the loaded bounded window; no pagination                              | Visible-row CSV and row actions only                                                                                                          | Node count is usually bounded; cap prevents oversized payloads                     |
| Cluster Config                        | `cluster-config` in `ClusterViewConfig`                               | `backend/refresh/snapshot/cluster_config.go`; `ClusterConfigEntry`                                                              | cluster-scoped config kinds for one cluster                     | Snapshot payload capped at 1,000 rows; `Local Complete` below cap and `Local Partial` when truncated                                                        | Local count/facets/search/sort over the loaded bounded window; no pagination                                            | Visible-row CSV and row actions only                                                                                                          | StorageClass/IngressClass/GatewayClass/webhook count can be high in large clusters |
| Cluster Storage                       | `cluster-storage` in `ClusterViewStorage`                             | `backend/refresh/snapshot/cluster_storage.go`; `ClusterStorageEntry`                                                            | cluster-scoped PVs for one cluster                              | Snapshot payload capped at 1,000 rows; `Local Complete` below cap and `Local Partial` when truncated                                                        | Local count/search/sort over the loaded bounded window; no pagination                                                   | Visible-row CSV and row actions only                                                                                                          | PersistentVolume count can be high                                                 |
| Cluster RBAC                          | `cluster-rbac` in `ClusterViewRBAC`                                   | `backend/refresh/snapshot/cluster_rbac.go`; `ClusterRBACEntry`                                                                  | cluster-scoped RBAC for one cluster                             | Snapshot payload capped at 1,000 rows; `Local Complete` below cap and `Local Partial` when truncated                                                        | Local count/facets/search/sort over the loaded bounded window; no pagination                                            | Visible-row CSV and row actions only                                                                                                          | ClusterRole/Binding count can be high                                              |
| Cluster CRDs                          | `cluster-crds` in `ClusterViewCRDs`                                   | `backend/refresh/snapshot/cluster_crds.go`; `ClusterCRDEntry`                                                                   | cluster-scoped CRDs for one cluster                             | Snapshot payload capped at 1,000 rows; `Local Complete` below cap and `Local Partial` when truncated                                                        | Local count/search/sort over the loaded bounded window; no pagination                                                   | Visible-row CSV and row actions only                                                                                                          | CRD count can be high in extension-heavy clusters                                  |
| Object Panel Pods                     | `object-panel-pods` in `PodsTab`                                      | object-panel pod relation hook plus `pods` domain data; `PodSnapshotEntry`                                                      | owner/object-scoped related pod set                             | Owner-scoped relation; currently `Local Complete`, Phase 2 verifies no namespace fanout                                                                     | Local count/search/sort; no pagination                                                                                  | Visible-row CSV and row actions only                                                                                                          | Expected bounded by owner, but large ReplicaSets can be high                       |
| Object Panel Jobs                     | `object-panel-jobs` in `JobsTab`                                      | object-panel related job data; `JobRow`                                                                                         | owner/object-scoped related job set                             | Owner-scoped relation; currently `Local Complete`, Phase 2 verifies no namespace fanout                                                                     | Local count/search/sort; no pagination                                                                                  | Visible-row CSV and row actions only                                                                                                          | Expected bounded by owner, but CronJob history can grow                            |
| Parsed Logs                           | direct `GridTable` in `ParsedLogTable`                                | object-panel `container-logs` stream/fallback; `ParsedLogEntry` from current log buffer                                         | object-panel log buffer                                         | Bounded client log buffer; `Local Partial`                                                                                                                  | Local parsed table display over filtered buffer; no pagination                                                          | Copy action exports current raw or parsed filtered buffer only; no object actions                                                             | Bounded by object-panel log buffer setting and stream backpressure                 |

Static enforcement: `gridTableViewRegistry.contract.test.ts` scans production
resource-grid adapter calls for `tableMode`, rejects unclassified direct
`GridTable` and direct `useTableSort` usage, and requires direct bypass
exceptions to carry an explicit mode/reason. It also requires stats-backed
Local Partial resource tables to pass producer `SnapshotStats` into visible
partial-state copy.

## Non-Negotiable Rules

- `clusterId` must be present in every cluster-data query, cache key,
  persistence key, row identity, action, and selection descriptor.
- Concrete object refs crossing boundaries must include `clusterId`, group,
  version, kind, namespace when namespaced, and name.
- Query-backed tables must not locally search, filter, sort, count, or derive
  facets from the current page as if it were the full result set.
- Local Partial tables must visibly state that they are recent, capped,
  buffered, degraded, or otherwise incomplete.
- Local Partial export, selection, select-all, and destructive actions apply
  only to the visible/windowed rows unless a backend query-wide operation exists.
- Local Complete tables require a real bound. A user-tunable row cap is not a
  bound.
- Pagination UI must be coherent: controls together, visible range, page size,
  previous/next availability, and exact total/page count only when the backend
  can honestly provide exact totals.

## Phase 0: Reconcile Scope And Evidence

- [x] Remove any remaining docs or release text that implies app-wide table
      hardening is complete.
- [x] Re-run the production table inventory against current code:
      `GridTable`, `ResourceGridTableView`, resource-grid hooks, direct
      `useTableSort`, export hooks, and bulk-action hooks.
- [x] For every table, record producer, scope, completeness, current mode,
      counts/facets source, pagination model, export/selection semantics, and
      expected worst-case cardinality.
- [x] Add or update a static contract test that fails when a new production
      table lacks mode classification or bypasses the shared resource-grid
      mode contract.

Validated with `npm run test --prefix frontend -- gridTableViewRegistry.contract`
on 2026-06-01.

Acceptance:

- The inventory has no "unknown" producer, scope, mode, or action semantics.
- Completed-scope language names only Browse, Custom, all-namespaces Pods, and
  all-namespaces Workloads.

## Phase 1: Make Partial Tables Honest

- [x] For Events, display that results are recent/windowed and ensure counts,
      empty states, filters, sort, CSV, selection, and bulk actions describe or
      enforce the recent window.
- [x] For namespace Config, Network, Storage, Quotas, Autoscaling, and Helm,
      surface capped/partial state from the backend producer instead of showing
      normal global table semantics over a capped snapshot.
- [x] For Parsed Logs, ensure filtering/export language is scoped to the
      current log buffer.
- [x] Add tests proving Local Partial tables do not expose global totals,
      global facets, all-matching export, or query-wide destructive actions.

Validated with
`npm run test --prefix frontend -- tablePartialState useResourceGridTable gridTableViewRegistry.contract NsResourcesViews NsViewConfig NsViewNetwork NsViewStorage NsViewQuotas NsViewAutoscaling NsViewRBAC ClusterViewEvents NsViewEvents EventsTab LogViewer`
on 2026-06-01.

Acceptance:

- No Local Partial table looks like a complete global table.
- Every Local Partial table has visible partial-state UI and action limits.

## Phase 2: Prove Or Migrate Local Complete Tables

- [x] Establish measured fixtures and thresholds for Cluster Nodes, Namespace
      RBAC, Cluster Config, Cluster Storage, Cluster RBAC, and Cluster CRDs.
- [x] Keep a table Local Complete only when the domain is naturally bounded or
      measured below the table budget under large-cluster fixtures.
- [x] Migrate any table that exceeds the budget to `Query Backed Static`,
      `Query Backed Dynamic`, or cap-backed `Local Partial`.
- [x] Verify object-panel related Pods and Jobs remain owner-scoped and cannot
      accidentally fan out to namespace/cluster scale.

Validated with `go test ./backend/refresh/snapshot` and
`npm run test --prefix frontend -- NsViewRBAC gridTableViewRegistry.contract ClusterResourcesManager ClusterViewConfig useObjectPanelPods`
on 2026-06-01.

Acceptance:

- Every Local Complete table has a documented measured bound or has been
  migrated.
- No local table depends on `maxTableRows` or another user setting for
  correctness.

## Phase 3: Expand Typed Query Coverage

- [x] Add typed query support for high-cardinality namespace resource families
      selected by Phase 1/2 evidence.
- [x] Add typed query support for high-cardinality cluster resource families
      selected by Phase 1/2 evidence.
- [x] Preserve table-specific predicates and projected fields in backend query
      contracts instead of reimplementing them as frontend local filters.
- [x] Keep metric-backed sorts backend-owned with an explicit dynamic revision
      model.

Phase 1/2 evidence selected no additional typed-query migrations: the remaining
high-cardinality namespace and cluster families are cap-backed `Local Partial`
when they exceed the 1,000-row table budget. Existing selected typed-query
families remain Browse, Custom, all-namespaces Pods, and all-namespaces
Workloads.

Acceptance:

- All high-cardinality all-namespaces and cluster-scope tables have
  backend-owned search/filter/sort/page semantics.
- The frontend renders only the current page/window for migrated tables.

## Phase 4: Finish Degraded-State Semantics

- [x] Extend query results and snapshot table stats with reason-bearing
      degraded state for stale data, unavailable metrics, permission-blocked
      kinds/namespaces, capped snapshots, failed fanout, approximate totals, and
      approximate facets.
- [x] Render table-level degraded/partial state consistently in Browse,
      Custom, Pods, Workloads, Events, and every remaining Local Partial table.
- [x] Ensure permission-denied or unavailable data is not silently dropped while
      reporting exact results.

Validated with `go test ./backend/refresh/snapshot ./backend/objectcatalog` and
`npm run test --prefix frontend -- browseCatalogData BrowseView ClusterViewCustom NsViewCustom CatalogPaginationControls useTypedResourceQuery NsViewPods NsViewWorkloads`
on 2026-06-01.

Acceptance:

- Users can tell when a table is complete, approximate, stale, capped,
  permission-limited, or metric-degraded.
- Exactness flags and reason strings agree between backend result contracts and
  UI copy.

## Phase 5: Make Pagination Production-Quality

- [x] Unify query-backed pagination controls in the table footer.
- [x] Show page size and visible range, such as `Showing 101-200 of 2,431`.
- [x] Show `Page N of M` only when total is exact; otherwise show an
      approximate total without pretending random access exists.
- [x] Keep first/previous/next available for cursor-backed tables. Add numbered
      page jumps only if the backend implements a bounded random-access or
      offset-into-index contract.
- [x] Remove instructional filler such as "Use Next page to navigate results."
- [x] Add interaction tests for initial load, filter changes, page-size
      changes, cursor invalidation, and page state reset.

Validated with
`npm run test --prefix frontend -- CatalogPaginationControls BrowseView ClusterViewCustom NsViewCustom useTypedResourceQuery NsViewPods NsViewWorkloads`
on 2026-06-01.

Acceptance:

- Pagination controls are visually and semantically one control group.
- Users can see where they are in the result set without the UI overstating
  backend capabilities.

## Phase 6: Add The Catalog Query Store Seam

- [x] Introduce a `CatalogQueryStore` interface behind `backend/objectcatalog`.
- [x] Move the in-memory catalog index behind that interface without changing
      frontend contracts.
- [x] Keep benchmarks for the current in-memory implementation.
- [x] Document the decision point for SQLite or another backing store.

Validated with `go test ./backend/objectcatalog` and
`go test ./backend/objectcatalog -run '^$' -bench 'BenchmarkCatalogQueryPages/empty-search-10000$' -benchtime=1x`
on 2026-06-01.

Acceptance:

- Storage can be swapped without changing query request/result contracts.
- The current in-memory implementation remains benchmarked and covered.

## Phase 7: Regression Coverage And Validation

- [x] Add first-load tests for all-namespaces and single-namespace versions of
      every query-backed table.
- [x] Add tests for namespace filter initialization, deselection back to
      all-namespaces, table persistence keys, and filter state publication.
- [x] Add backend contract tests for degraded reasons, typed query predicates,
      cursor signatures, and exactness flags.
- [x] Add large-fixture benchmarks for every table family migrated in this
      plan.
- [x] Run `mage qc:prerelease` before calling implementation complete.

Focused validation so far: `go test ./backend/refresh/snapshot ./backend/objectcatalog`,
`go test ./backend/objectcatalog -run '^$' -bench 'BenchmarkCatalogQueryPages/empty-search-10000$' -benchtime=1x`,
and
`npm run test --prefix frontend -- NsViewPods NsViewWorkloads useTypedResourceQuery CatalogPaginationControls BrowseView ClusterViewCustom NsViewCustom browseCatalogData`
on 2026-06-01.

Final validation: `mage qc:knip` and `mage qc:prerelease` passed on
2026-06-01.

Acceptance:

- The exact all-namespaces first-load class of bug is covered for query-backed
  namespace tables.
- Validation is based on the latest worktree, not an earlier intermediate fix.

## Definition Of Done

- Every production table is either query-backed, proven Local Complete, or
  visibly Local Partial.
- No table presents local transforms over a capped/windowed dataset as global
  search, filter, sort, counts, or facets.
- No high-cardinality table requires loading all matching rows into React.
- Export, select-all, and destructive bulk actions match the table mode.
- Degraded, stale, permission-blocked, unavailable-metric, capped, approximate,
  and partial states are visible and reason-bearing.
- Query-backed pagination is coherent, grouped, and honest about totals/page
  counts.
- Catalog query storage has a replaceable interface seam.
- `mage qc:prerelease` passes on the final implementation.
