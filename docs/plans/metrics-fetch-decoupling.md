# Metrics Fetch Decoupling Plan

## Goal

Decouple object/status table data, object age display, and CPU/memory metric data
for every metric-bearing table surface:

- main Pods tables,
- main Workloads tables,
- main Nodes tables,
- Object Panel embedded Pods tables,
- Object Panel Resource Utilization details for Pods, Deployments, DaemonSets,
  StatefulSets, and Nodes.

`cluster-overview` aggregate utilization is explicitly out of scope for this
table-focused migration. It remains on the existing `cluster-overview` scoped
payload until a separate overview refresh/read-model change is planned
(`docs/architecture/resource-metrics.md:35`).

Target behavior:

- Object/status table data is stream-driven and updates independently of metric
  polling.
- Age is rendered from absolute timestamps by the frontend clock and does not
  trigger data fetches.
- CPU/memory usage and metric freshness/error metadata are fetched on the metrics
  interval, independent of object/status updates.
- CPU/memory global sorting remains backend-owned; the frontend must not sort a
  query-backed table by CPU or memory over only the current page.
- The implementation extends `frontend/src/core/resource-metrics`; it does not
  add a second frontend metrics cache.

## Current State Evidence

- The current stream-signals contract says metric-bearing query pages refetch
  through the same snapshot/query endpoint and have no client-side row overlay
  path (`docs/architecture/resource-stream-signals.md:57-60`). This plan changes
  that durable contract.
- The current table contract says query-backed tables have backend-owned global
  search/filter/sort/count/facet/pagination semantics
  (`docs/frontend/gridtable.md:87-89`) and says CPU/memory sorts must not be
  local current-page sorts (`docs/frontend/gridtable.md:100-102`).
- The current quiet-refresh contract says filter, sort, page-size, manual, and
  background refetches must not raise `loading` after the first applied result
  (`docs/frontend/gridtable.md:154-161`).
- Age is already on the right path: table age columns render `LiveAgeText` from
  `ageTimestamp` (`frontend/src/shared/components/tables/columnFactories.tsx:27-52`),
  and `LiveAgeText` formats relative text from `useAgeClock`
  (`frontend/src/shared/components/LiveAgeText.tsx:22-33`).
- The metrics poller already has its own timer: `Poller.Start` creates
  `time.NewTicker(p.interval)` and refreshes on ticker ticks
  (`backend/refresh/metrics/poller.go:171-195`). The missing piece is not the
  metrics collection timer; it is the table/read-model fetch path.
- Pods currently carry metrics in the table payload: `PodSnapshot` contains both
  `Rows` and `Metrics` (`backend/refresh/snapshot/pods.go:166-171`), and
  `overlayPodMetrics` writes `CPUUsage` and `MemUsage` into row fields
  (`backend/refresh/snapshot/pods.go:537-542`).
- Workloads currently read metrics during snapshot assembly via
  `LatestPodUsage()` (`backend/refresh/snapshot/namespace_workloads.go:267-278`)
  and write usage values into workload rows
  (`backend/refresh/snapshot/namespace_workloads.go:858-863`).
- Nodes currently read node and pod metrics during snapshot build
  (`backend/refresh/snapshot/nodes.go:151-170`) and return rows plus metrics
  metadata in one payload (`backend/refresh/snapshot/nodes.go:398-408`).
- Pods table columns currently read and sort CPU/memory from row fields
  (`frontend/src/modules/namespace/components/NsViewPods.tsx:382-408`), and the
  Pods table is query-backed dynamic
  (`frontend/src/modules/namespace/components/NsViewPods.tsx:513-538`).
- Workload columns currently read and sort CPU/memory from row fields
  (`frontend/src/modules/namespace/components/useWorkloadTableColumns.tsx:146-182`).
- Node columns currently read and sort CPU/memory from row fields
  (`frontend/src/modules/cluster/components/ClusterViewNodes.tsx:258-296`), and
  the Nodes table is query-backed dynamic
  (`frontend/src/modules/cluster/components/ClusterViewNodes.tsx:349-372`).
- Object Panel Pods currently read metric cell values from pod rows
  (`frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx:209-237`)
  and use payload-scoped metrics from the same query payload
  (`frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx:257-280`).
- Object Panel Resource Utilization currently calls `useResourceMetrics`
  (`frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:179-193`);
  `useResourceMetrics` selects from `pods`, `namespace-workloads`, and `nodes`
  domain payload rows (`frontend/src/core/resource-metrics/useResourceMetrics.ts:95-106`).
- The existing resource-metrics contract already says resource utilization uses
  one frontend read model over refresh store and must not add a second metrics
  cache (`docs/architecture/resource-metrics.md:3-13`). Its Source Map currently
  points Pod/Workload/Node utilization and metric-bearing tables at base domain
  rows (`docs/architecture/resource-metrics.md:26-38`).
- The query-backed table wrapper currently uses live domain source identity to
  refetch typed query pages
  (`frontend/src/modules/resource-grid/useQueryBackedResourceGridTable.ts:195-239`),
  and the typed query hook stores rows from the same payload it fetched
  (`frontend/src/modules/resource-grid/useTypedResourceQuery.ts:266-270`).
- Refresh-domain metadata is partly contract-derived: `domainRegistry.ts`
  derives descriptors, streams, timing, and metrics interval refreshers from the
  backend-authored contract (`frontend/src/core/refresh/domainRegistry.ts:181-236`).
  New domains still require explicit frontend type/payload entries and domain
  registration wiring (`frontend/src/core/refresh/types.ts:1070-1133`,
  `frontend/src/core/refresh/domainRegistrations.ts:11-20`).

## Target Architecture

### Data Paths

1. Base object/status path
   - Owns object identity, status, readiness, restart counts, labels,
     annotations, age timestamp, action flags, and object-derived resource data
     such as requests/limits/capacity/allocatable.
   - Updates from object source changes.
   - Does not include live CPU/memory usage values or metric freshness/error
     metadata.

2. Age path
   - Backend carries absolute timestamp fields.
   - Frontend renders relative text through the live-age components.
   - No fetch is scheduled only because relative age text changed.

3. Metrics path
   - Owns live CPU/memory usage values and metric freshness/error metadata.
   - Updates only from the metrics interval and explicit user refresh of metrics.
   - Carries `clusterId` and full object identity for metric rows.
   - Publishes a metric revision token for sorting, freshness, diagnostics, and
     cursor metadata.
   - Each metric domain exposes two access shapes over the same domain data:
     a scope-level payload for object-sorted visible-row overlays and Object
     Panel utilization selectors, and a keyset query shape for metric-sorted
     tables that must own membership, ordering, totals, and cursor metadata.

4. Resource-metrics read model
   - `frontend/src/core/resource-metrics` remains the single frontend metrics
     selector/lifecycle/read-model layer.
   - The resource-metrics Source Map must be updated so Pod, Workload, Node,
     table, embedded table, and Object Panel utilization consumers read from the
     new metric domains or joined base+metric values instead of live usage fields
     on base rows.
   - Object-detail DTOs remain fallback-only for utilization while metric domains
     load or are unavailable, except for the documented ReplicaSet exception.
   - Workload freshness moves onto the workload metric DTOs in this migration;
     the current separate `nodes` domain freshness lease for workload utilization
     (`docs/architecture/resource-metrics.md:40-42`,
     `frontend/src/core/resource-metrics/useResourceMetrics.ts:99-103`) must be
     removed when `namespace-workloads-metrics` becomes the freshness source.

### Chosen Policies

1. CPU/memory cell ownership
   - Use Option A: metric domains own live usage plus freshness/error metadata.
   - Base object/status domains keep request, limit, capacity, allocatable, and
     other object-derived reservation fields.
   - Resource bar rendering joins base reservation values with metric usage
     values and tolerates either side being unavailable.

2. Metric-sorted cursor policy
   - Use the existing `live-keyset` policy: metric-sorted cursors are value-based
     keysets and do not reset only because metric revision changes.
   - Metric responses still publish the metric source revision used for the
     result, and a cursor whose anchor context disappears reports
     `cursorInvalid` so the table can reset to page 1.
   - This matches the large-data metric cursor contract
     (`docs/architecture/large-data.md:159-162`,
     `docs/architecture/large-data.md:214-219`).

3. Base row delivery shape
   - Keep the current stream-signal-driven query refetch model for base pages.
   - Do not introduce row-payload base streams in this migration.

4. Metric-sorted page hydration
   - Metric queries return ordered refs and metric values.
   - The frontend hydrates missing base object/status rows by exact refs through
     the base path.
   - The metric response must not include full base rows.

### Sorting And Query Model

Object-sorted tables:

- Base query owns page membership, ordering, filters, search, predicates, facets,
  totals, and pagination.
- Metrics query fetches metric values for the visible base-row identities.
- A metrics tick updates CPU/memory cells without resetting base pagination,
  sort, filters, or search.
- Background metrics updates must preserve the quiet-refresh contract.

Metric-sorted tables:

- Metrics query owns page membership, ordering, cursor, total, and metric values.
- Metrics query accepts the same query state as the base table: base scope,
  search, metadata-search flag, namespace filters, kind filters, backend
  predicates, page size, sort direction, and continue token.
- The metric query applies those filters/search/predicates before sorting and
  paginating so filtered metric-sorted pages have the same row universe as
  object-sorted pages.
- The query returns ordered object refs plus metric values. The base
  object/status path supplies base row data for those refs.
- The frontend renders joined rows in metric-query order.

This preserves the table contract that global metric-backed sorts are
backend-owned (`docs/frontend/gridtable.md:100-102`) while keeping metric updates
on a separate timer.

### ReplicaSet Scope

- ReplicaSet utilization remains the documented object-detail DTO exception in
  this migration.
- Do not route ReplicaSet panels through pod/workload metric domains until a
  separate ReplicaSet unification slice adds direct owner identity and preserves
  existing resolved-owner behavior.
- Preserve the current `isActive === false` behavior for ReplicaSet utilization
  until an equivalent refresh-store source exists
  (`docs/architecture/resource-metrics.md:44-61`).

## Backend Work

1. Add metric query contracts.
   - Add metric payload DTOs for Pods, Workloads, and Nodes under
     `backend/refresh/snapshot`.
   - Include `clusterId`, full object ref, row key, CPU usage, memory usage,
     freshness/error metadata, metric revision, and cursor metadata.
   - Workload metric DTOs own workload freshness/error metadata; do not keep a
     separate dependency on `nodes` metrics metadata after workload consumers are
     migrated.
   - For metric-sorted requests, return ordered refs and metric values using the
     backend's metric snapshot/revision.

2. Add metric fetch domains.
   - Register metric domains through `backend/refresh/domain/refresh-domain-contract.json`
     plus backend domain registration, so diagnostics, permissions, timing, and
     frontend metadata stay aligned.
   - Candidate domain ids:
     - `pods-metrics`
     - `namespace-workloads-metrics`
     - `nodes-metrics`
   - Each domain remains single-cluster scoped.
   - Domain metadata/timing/diagnostics should be authored in the shared contract;
     behavior still needs explicit backend registration and frontend orchestration
     wiring.

3. Split base row payloads from live usage.
   - Remove live `cpuUsage`, `memUsage`, and `memoryUsage` dependencies from base
     object/status table rows for Pods, Workloads, and Nodes.
   - Keep object-derived resource reservation fields in the base path.
   - Keep Age timestamp fields in base rows.
   - Do not remove or repurpose row fields until every table and Object Panel
     utilization consumer has migrated to resource-metrics joins.

4. Add base-row-by-ref support for metric-sorted pages.
   - When a metric-sorted page contains refs not present in the frontend base row
     cache, the frontend needs a base object/status read by exact refs.
   - That read must use the base object/status path, not the metrics path.
   - Requests and responses must carry `clusterId`, group, version, kind,
     namespace, and name for every concrete object.

5. Preserve global metric sorting.
   - Backend metric query adapters must use one comparable metric sort value per
     row and keyset cursor.
   - Missing metrics must sort with a numeric sentinel, not a string fallback,
     matching the large-data numeric sort invariant in
     `docs/architecture/large-data.md:164-173`.
   - Metric query cursors must carry both object/filter query identity and metric
     revision metadata while using the `live-keyset` matching policy.

6. Preserve object-source clocks.
   - Metric-only refreshes must use the metric source clock and must not advance
     the base object source version.
   - Object/status updates must not require metric provider reads.

## Frontend Work

1. Extend refresh-store-backed metric readers.
   - Add typed metric payloads in `frontend/src/core/refresh/types.ts`.
   - Add metric domains to the shared refresh-domain contract.
   - Add explicit frontend refresher names, domain registrations/orchestrator
     wiring, and any needed diagnostics wiring that is not derived from the
     contract.
   - Use the metrics interval from refresh settings via the contract-derived
     metrics interval refresher set rather than object stream source identity.

2. Extend `frontend/src/core/resource-metrics`.
   - Add metric-domain result types, selectors, value adapters, and lifecycle
     helpers in the existing resource-metrics module.
   - Do not add a parallel metrics cache under `resource-grid`.
   - Model the scope-level overlay/read path and metric-sorted keyset query path
     as two access shapes for the same metric domains, not as separate metric
     domains or caches.
   - Add a table-oriented resource-metrics hook/controller that accepts cluster,
     domain, base scope, visible base row refs, query state, sort state, and page
     cursor.
   - It returns metric rows keyed by full object identity, freshness/error
     metadata, metric revision, and metric-sorted order when CPU/memory sort is
     active.
   - It uses refresh/data-access broker paths, not direct feature-component
     fetches.

3. Add base + metrics joining.
   - For object-sorted tables, join base rows with metrics by full object identity
     and keep base row order.
   - For metric-sorted tables, use metric-query ordered refs, hydrate missing
     base rows by ref, then join metrics onto base rows.
   - The join must tolerate metric usage being absent while base reservation
     values are present, and base reservation values being absent while metric
     usage has arrived.
   - Keep rendering through `ResourceInventoryTable` and the existing
     query-backed table controller.

4. Update metric value adapters.
   - Change pod/workload/node metric adapters to accept joined base+metric inputs.
   - Stop reading live usage from base row fields after migration.
   - Keep shared resource-bar columns; only their value sources change.

5. Migrate table surfaces.
   - Main Pods.
   - Main Workloads.
   - Main Nodes.
   - Object Panel Pods.
   - Object Panel Resource Utilization for Pods, Deployments, DaemonSets,
     StatefulSets, and Nodes.
   - Keep ReplicaSet utilization on the documented detail DTO fallback path.

6. Keep Age isolated.
   - Continue using `createAgeColumn`/`LiveAgeText`.
   - Add regression tests proving age text advances without base or metric
     fetches.

## Tests And Acceptance Criteria

Use red/green/refactor for every behavior change.

Backend tests:

- Metric-only refresh does not change base object/source version.
- Base object/status update does not require metric provider reads.
- Metric query returns values keyed by full object identity.
- Metric query accepts and applies the same search, namespace filter, kind
  filter, metadata-search flag, and predicates as the base table query before
  metric sorting.
- Metric query returns globally sorted CPU/memory pages for Pods, Workloads, and
  Nodes.
- Metric query cursor remains stable across metric revision changes under the
  `live-keyset` policy.
- Metric query reports `cursorInvalid` when the cursor anchor context is no
  longer valid.
- Missing metrics sort using the numeric sentinel.
- Permission-denied or unavailable metrics produce diagnostic metadata without
  hiding base rows.
- Base-row-by-ref requests reject missing `clusterId`, group, version, kind, or
  concrete object name/namespace when required.

Frontend tests:

- Object/source stream update changes status/readiness cells without triggering
  metrics fetch.
- Metrics timer updates CPU/memory cells without triggering base query fetch.
- Object-sorted page keeps row order when only metrics update.
- Metric-sorted page sends the active table filters/search/predicates to the
  metrics query and renders backend metric order without locally sorting the
  current page.
- Base+metric joins render usage-only, reservation-only, and fully joined states.
- Object Panel Pods uses the same metric overlay path as main Pods.
- Object Panel Resource Utilization uses the migrated `resource-metrics` path
  for Pods, Deployments, DaemonSets, StatefulSets, and Nodes.
- ReplicaSet utilization remains detail-backed and preserves `isActive === false`.
- Workload utilization no longer leases `nodes` only for workload freshness after
  `namespace-workloads-metrics` carries workload freshness metadata.
- Age text advances by frontend clock without base or metrics fetch.
- Diagnostics show separate object/source and metric freshness states.
- Metrics timer refetches and base query refetches preserve the quiet-refresh
  contract: no mid-session `loading`, no table dim/flash, and no filter input
  unmount/focus loss.

Contract/static tests:

- Metric-bearing table columns cannot read live usage from base row fields after
  migration.
- Metric-bearing tables stay classified as query-backed dynamic where global
  CPU/memory sort is enabled.
- Refresh domain contract, backend registration, frontend registration,
  diagnostics config, and refresher timing remain aligned.
- `docs/architecture/resource-metrics.md` Source Map points migrated consumers at
  metric domains or joined base+metric resource-metrics values, not live usage on
  base rows.
- No second frontend metrics cache is introduced outside
  `frontend/src/core/resource-metrics`.

Focused validation during implementation:

```sh
go test ./backend/refresh/snapshot ./backend/refresh/system
npm run test --prefix frontend -- resource-metrics useUtilizationData useQueryBackedResourceGridTable useTypedResourceQuery NsViewPods useWorkloadTableColumns ClusterViewNodes PodsTab LiveAgeText columnFactories
npm run typecheck --prefix frontend
```

Final validation for non-documentation implementation:

```sh
mage qc:prerelease
git diff --check
git status --short
```

## Phased Rollout

1. Contract and failing tests
   - Update `docs/architecture/resource-metrics.md` Source Map to describe the
     new metrics domains and joined base+metric read model.
   - Update `docs/architecture/resource-stream-signals.md`,
     `docs/architecture/large-data.md`, and `docs/frontend/gridtable.md` only for
     durable contract changes that survive this implementation plan.
   - Add failing backend/frontend contract tests for decoupled base and metric
     refresh behavior.
   - Add failing tests for metric-sorted filters/search/predicates, live-keyset
     cursor behavior, quiet refresh, and Object Panel utilization migration.

2. Backend metrics domains
   - Add metric DTOs and metric query builders for Pods, Workloads, and Nodes.
   - Add metric-sort pagination/cursor support using `live-keyset`.
   - Register backend domains and diagnostics metadata.
   - Preserve numeric-sentinel sort behavior.

3. Frontend resource-metrics extension
   - Add refresh types, registrations, timing, diagnostics, and resource-metrics
     table hook/controller.
   - Implement scope-level overlay and metric-sorted keyset query reads as two
     access shapes for the same metric domains.
   - Add object-sorted visible-row overlay behavior.
   - Add metric-sorted query/hydration behavior with base-row-by-ref reads.

4. Consumer migrations
   - Migrate Pods, Workloads, Nodes, Object Panel Pods, and Object Panel Resource
     Utilization.
   - Keep ReplicaSet detail-backed behavior.
   - Keep old row metric fields temporarily only if needed behind tests that
     prevent consumers from reading them.

5. Remove row-coupled live metrics
   - Remove live usage fields from base row contracts or mark them non-live
     compatibility fields until generated bindings and consumers are migrated.
   - Remove backend serve-time usage overlay from base row endpoints.
   - This phase is blocked until Object Panel Resource Utilization is migrated.

6. Durable docs and guardrails
   - Finalize `docs/architecture/resource-metrics.md`,
     `docs/architecture/resource-stream-signals.md`,
     `docs/architecture/large-data.md`, and `docs/frontend/gridtable.md`.
   - Add or update static tests that reject future row-coupled metric table
     usage.

## Deferred Decisions

These are intentionally out of scope for this migration:

1. Row-payload base streams
   - The migration keeps the current stream-signal-driven query refetch model for
     base pages.
   - Introducing row-payload base streams is a separate table architecture change.

2. ReplicaSet unification
   - ReplicaSet remains detail-backed until a separate slice adds direct owner
     identity and preserves resolved-owner behavior.

3. Full metric-cell transport ownership
   - Metric domains own live usage plus freshness/error in this plan.
   - Moving request/limit/capacity/allocatable into metric payloads is a separate
     contract change.
