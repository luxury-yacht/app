# Unified Resource Metrics Plan

Status: Proposed. This is a planning document only; the long prerelease gate
stays out of this loop until the performance work is ready for it again.

## Problem

Resource utilization values should have one frontend read path. The branch
already has metric-specific refresh behavior for the query-backed resource
domains: `pods`, `nodes`, and `namespace-workloads` are registered with
`metricsOnly: true` in `frontend/src/core/refresh/domainRegistrations.ts:73-86`;
the helper that applies that option lives in
`frontend/src/core/refresh/domainRegistrations.ts:22-32`.

The outlier is the object panel Resource Utilization section. Its hook says it
derives CPU, memory, and pod values from the active detail DTO in
`frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:1-5`,
and the implementation reads node, pod, and workload metric fields from `detail`
or `objectData` in
`frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:68-174`.
That gives object details a live-metrics responsibility that table rows do not
need.

Object age is not part of this metrics path. The age contract is already
documented as "backend sends absolute timestamps, frontend formats relative
age" in `docs/plans/live-object-age.md:21-31`.

## Current Evidence

Backend metric updates are source-clock signals, not direct frontend row
patches. `BroadcastMetricRefresh` builds a `SourceMetric` / `SignalChanged`
update and broadcasts it only to `pods`, `namespace-workloads`, and `nodes` in
`backend/refresh/resourcestream/manager.go:918-940`.

Pod rows receive current usage when the resource stream row is built:
`podStreamRow` resolves usage from the latest pod metrics map and calls
`BuildStreamSummary` in
`backend/refresh/resourcestream/derived_rows.go:384-390`; the pod row builder
then writes `CPUUsage` and `MemUsage` in
`backend/resources/pods/streamsummary.go:44-72`.

The frontend stream manager stores metric source clocks on scoped domain state.
`flushUpdates` extracts source versions and calls `bumpSourceVersionOnly` in
`frontend/src/core/refresh/streaming/resourceStreamManager.ts:745-756`, and
`bumpSourceVersionOnly` updates `sourceVersion`, `sourceVersions`,
`streamRevision`, and timestamps in
`frontend/src/core/refresh/streaming/resourceStreamManager.ts:781-804`.

The orchestrator uses the same scoped snapshot path for metric-backed domains.
It passes `metricsOnly` from streaming registration in
`frontend/src/core/refresh/orchestrator.ts:1043-1047`, fetches with the previous
`sourceVersion` or `etag` in
`frontend/src/core/refresh/orchestrator.ts:1128-1133`, and records automatic
metrics refreshes in `frontend/src/core/refresh/orchestrator.ts:1156-1173`.

Tables already render utilization from their domain rows. Namespace pod columns
read `pod.cpuUsage`, `pod.cpuRequest`, `pod.cpuLimit`, `pod.memUsage`,
`pod.memRequest`, and `pod.memLimit` in
`frontend/src/modules/namespace/components/NsViewPods.tsx:381-408`. Workload
columns read the same workload row fields in
`frontend/src/modules/namespace/components/useWorkloadTableColumns.tsx:145-180`.
Node columns read `row.cpuUsage`, `row.cpuRequests`, `row.cpuLimits`,
`row.cpuAllocatable`, `row.memoryUsage`, `row.memRequests`, `row.memLimits`, and
`row.memoryAllocatable` in
`frontend/src/modules/cluster/components/ClusterViewNodes.tsx:257-295`.

Object-panel embedded pod tables also render from `PodSnapshotEntry` rows:
`PodsTab` reads `pod.cpuUsage` and `pod.memUsage` in
`frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx:208-235`.

Cluster Overview is an aggregate consumer. The component subscribes to the
`cluster-overview` scoped domain in
`frontend/src/modules/cluster/components/ClusterOverview.tsx:130-136`; the
Resource Utilization section reads overview CPU/memory fields and workload usage
buckets in `frontend/src/modules/cluster/components/ClusterOverview.tsx:522-585`
and renders those values in
`frontend/src/modules/cluster/components/ClusterOverview.tsx:852-940`.
The backend payload contains `WorkloadResourceUsage` in
`backend/refresh/snapshot/cluster_overview.go:150-174`, assigns it in
`backend/refresh/snapshot/cluster_overview.go:580-585`, and buckets pod usage by
workload kind in `backend/refresh/snapshot/cluster_overview.go:839-915`.

Object identity already has a strict frontend shape. `buildRequiredObjectReference`
requires `clusterId`, `kind`, and `name`, then delegates to the GVK resolver in
`frontend/src/shared/utils/objectIdentity.ts:102-124`; canonical row keys include
`group`, `version`, `kind`, `namespace`, and `name` under the cluster key in
`frontend/src/shared/utils/objectIdentity.ts:205-216`. Object-panel refs require
`clusterId`, `group`, `version`, `kind`, and `name` in
`frontend/src/modules/object-panel/objectPanelRef.ts:18-24`, and object-panel
scopes are built from that ref in
`frontend/src/modules/object-panel/objectPanelRef.ts:190-293`.

Scoped refresh lifecycle is already lease-based. `useScopedRefreshDomainLifecycle`
acquires a scoped lease while mounted and releases it on teardown in
`frontend/src/core/data-access/useScopedRefreshDomainLifecycle.ts:48-77`.

ReplicaSet needs an explicit source decision. The object-panel utilization hook
includes `replicaset` in its utilization kinds and suppresses inactive
ReplicaSets in
`frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:11-18`
and
`frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:124-160`.
The namespace-workloads maintained store is fed by Deployment, StatefulSet,
DaemonSet, Job, and CronJob GVRs, not ReplicaSet GVRs, in
`backend/refresh/snapshot/namespace_workloads.go:153-160`, and pod owner keys
collapse ReplicaSet owners to Deployment names in
`backend/refresh/snapshot/namespace_workloads.go:911-921`. That means a
ReplicaSet ref must not be routed to `namespace-workloads`.

The existing `pods` domain has a workload scope format that accepts a full GVK:
frontend normalization accepts
`workload:<namespace>:<group>:<version>:<kind>:<name>` in
`frontend/src/core/refresh/streaming/resourceStreamDomains.ts:77-90`, and the
backend pods snapshot path parses and filters `workload:` scopes in
`backend/refresh/snapshot/pods.go:663-690` and
`backend/refresh/snapshot/pods.go:713-759`. The object-panel Pods tab already
builds a ReplicaSet workload scope in
`frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.ts:14-20`
and
`frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.ts:42-54`.
However, the maintained-store pods path filters workload scopes from resolved
owner fields in `backend/refresh/snapshot/pods.go:413-427` and
`backend/refresh/snapshot/pods.go:476-490`, so the ReplicaSet source slice must
not assume this scope works for Deployment-managed ReplicaSets. `PodSummary`
currently carries only the resolved owner fields in
`backend/kind/streamrows/streamrows.go:375-399`; `resolvePodOwner` rewrites a
ReplicaSet owner to Deployment when the ReplicaSet has a Deployment controller
in `backend/resources/pods/streamsummary.go:75-90`, using a map populated only
from ReplicaSet owner refs whose controller kind is Deployment in
`backend/resources/pods/streamsummary.go:116-137`. The typed-lister path checks
the pod's direct owner first in `backend/refresh/snapshot/pods.go:727-734`, but
the maintained-store path does not have that direct-owner field.

Default ReplicaSet decision for this plan: keep ReplicaSet Resource Utilization
on the detail DTO as a documented exception, because replacing it with a
refresh-store source requires backend row-shape work that carries uncollapsed
direct owner identity alongside the resolved owner used by Deployment scopes.
That backend work can be a later strict-unification slice, but it is not part of
the first implementation.

Workload rows do not currently expose explicit pod-count fields. The backend
`WorkloadSummary` has `Ready` but not `podCount` or `readyPodCount` in
`backend/kind/streamrows/streamrows.go:401-425`; the frontend
`NamespaceWorkloadSummary` mirrors `ready` and metric fields in
`frontend/src/core/refresh/types.ts:843-864`. The detail path uses
`podMetricsSummary.pods` and `podMetricsSummary.readyPods` in
`frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:134-158`.

Freshness metadata is source data, not a new frontend threshold. The backend
metrics provider exposes `CollectedAt`, `LastError`, and counters in
`backend/refresh/metrics/poller.go:44-64` and returns those fields in
`backend/refresh/metrics/poller.go:149-160`. The pods snapshot maps that
metadata into `PodMetricsInfo` in
`backend/refresh/snapshot/pods.go:220-227` and
`backend/refresh/snapshot/pods.go:339-360`; the nodes snapshot maps it into
`NodeMetricsInfo` in `backend/refresh/snapshot/nodes.go:85-92` and
`backend/refresh/snapshot/nodes.go:361-375`; Cluster Overview maps it into
`ClusterOverviewMetrics` in
`backend/refresh/snapshot/cluster_overview.go:103-110` and
`backend/refresh/snapshot/cluster_overview.go:564-583`. Current workload
columns receive metadata from `NsViewWorkloads`, which reads the active
cluster's `nodes` scoped domain metrics in
`frontend/src/modules/namespace/components/NsViewWorkloads.tsx:52-58`.
First-pass behavior should preserve that current freshness source for workload
resource bars. If a later implementation moves workload freshness to
`namespace-workloads`, that is a behavior change and needs its own backend
payload field plus tests.

Cluster separation happens before pure row selection. The refresh store is a
`domain -> scope -> state` map in `frontend/src/core/refresh/store.ts:37-43`,
`getScopedDomainState` indexes by one domain and one scope in
`frontend/src/core/refresh/store.ts:140-151`, and
`useRefreshScopedDomain` subscribes to that same pair in
`frontend/src/core/refresh/store.ts:292-296`. Scope construction prefixes the
cluster ID in `frontend/src/core/refresh/clusterScope.ts:26-41`.

## Target Contract

All resource utilization consumers read live CPU, memory, pod count, request,
limit, capacity, allocatable, freshness, and error metadata through one
frontend metrics read model.

The read model is keyed by full object identity:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace` when the resource is namespaced
- `name`

The read model must not depend on object-details data to become live. Object
details may provide an initial fallback while a metric domain is loading or
while RBAC prevents the metric domain from producing rows.

The source data remains the existing refresh domains:

- Pod metrics: `pods` scoped rows.
- Deployment, DaemonSet, and StatefulSet values: `namespace-workloads` scoped
  rows.
- Deployment, DaemonSet, and StatefulSet freshness: preserve the current active
  cluster `nodes` metrics source unless a separate slice adds freshness metadata
  to `namespace-workloads`.
- ReplicaSet metrics: documented detail-DTO exception in the first
  implementation. A refresh-store ReplicaSet source requires backend row-shape
  work to carry both direct and resolved owner identity.
- Node metrics: `nodes` scoped rows.
- Cluster-level aggregates: `cluster-overview` scoped payload for aggregate
  totals that do not correspond to one object row.

The first implementation should not add a second metrics cache. Backend changes
in the first pass are limited to explicit workload pod-count fields or
row-shape parity for existing non-ReplicaSet metric values. ReplicaSet
refresh-store sourcing is deferred.

## Proposed Frontend Shape

Add a small metrics module under `frontend/src/core/resource-metrics/`:

- `types.ts`: define `ResourceMetricsRef`, `ResourceMetricsData`,
  `ResourceMetricsFreshness`, and the source descriptor.
- `identity.ts`: normalize object refs through the existing
  `buildRequiredObjectReference` contract.
- `scope.ts`: map a ref to the needed refresh domain and scope:
  - Pod -> `pods`, namespace scope.
  - Deployment/DaemonSet/StatefulSet -> `namespace-workloads`, namespace scope.
  - ReplicaSet -> detail DTO exception. Do not route ReplicaSet through the
    `pods` workload scope until the backend carries enough owner identity for
    Deployment-managed ReplicaSets in the maintained-store path.
  - Node -> `nodes`, cluster scope.
  - Cluster aggregate -> `cluster-overview`, cluster scope.
- `selectors.ts`: select metric data from scoped domain payloads and return one
  `ResourceMetricsData` shape.
- `useResourceMetrics.ts`: subscribe to the selected scoped domain state, lease
  the needed domain with `useScopedRefreshDomainLifecycle`, request an initial
  fetch, and return metrics plus freshness/error state.

This module is a selector and lifecycle layer over the refresh store. It should
not introduce a second metrics cache.

Keep two adapters separate:

- Identity selectors: full object ref -> refresh domain/scope -> selected metric
  data. These may call `buildRequiredObjectReference`.
- Value adapters: row/payload metric fields -> `ResourceBar`/Utilization props.
  Table rows use these because their local row shapes may not contain full GVK
  identity; `WorkloadData` declares `kind`, `name`, and `namespace`, but not
  `clusterId`, `group`, or `version`, in
  `frontend/src/modules/namespace/components/NsViewWorkloads.helpers.ts:8-30`.

## Implementation Slices

1. Inventory and tests first.
   - Add selector tests that construct fake `pods`, `namespace-workloads`,
     `nodes`, and `cluster-overview` payloads.
   - Prove `scope.ts` carries `clusterId` into the scope string and that
     subscribing to cluster A's scope and cluster B's scope reads different
     scoped states.
   - Prove the selector rejects refs missing required identity by exercising the
     existing object identity builder.
   - Add a regression test documenting the ReplicaSet exception: a
     Deployment-managed ReplicaSet must not be silently routed through the
     current `pods` workload-scope maintained-store path.

2. Build the shared read model.
   - Implement `frontend/src/core/resource-metrics/types.ts`.
   - Implement identity normalization and domain/scope resolution.
   - Implement pure selectors for pod, Deployment/DaemonSet/StatefulSet, node,
     and cluster aggregate payloads.
   - Keep field names close to existing row fields so the adapter stays small.
   - Preserve freshness metadata from current source payloads; for workload
     resource bars, that means preserving the existing active-cluster `nodes`
     metrics metadata unless a later slice adds `namespace-workloads` metadata.
   - Do not recompute stale thresholds in the frontend read model.

3. Wire object-panel Resource Utilization.
   - Replace detail-driven live reads in `useUtilizationData` with
     `useResourceMetrics(objectData)`.
   - Preserve detail-derived values only as fallback while metric state is
     loading, unavailable, or permission-denied.
   - Keep `podMetricsSummary` DTO use behind the fallback path during this
     slice, except for ReplicaSet. ReplicaSet remains detail-backed for both
     metrics and the existing `isActive === false` gate in this first pass.
   - Derive workload `podCount` and `readyPodCount` from explicit row fields if
     they are added; otherwise parse and test the `ready` value before using it
     as the count source.

4. Wire table resource bars to shared adapters.
   - Keep table rows sourced from their existing refresh domains.
   - Route row-to-resource-bar value shaping through shared value adapters, not
     through the identity-keyed `useResourceMetrics` hook.
   - Preserve table sort values because current sort code reads row values in
     `NsViewPods.tsx:393-407`,
     `useWorkloadTableColumns.tsx:160-180`, and
     `ClusterViewNodes.tsx:275-295`.

5. Audit embedded and aggregate surfaces.
   - Confirm object-panel Pods stays on `PodSnapshotEntry` rows and shared
     adapters.
   - Keep Cluster Overview on `cluster-overview` aggregate data for totals; add
     shared formatting/freshness adapters so the utilization display path is
     consistent with table and panel consumers.
   - Search object-map code for resource utilization fields before changing it;
     if object-map does not expose metrics, leave it outside this plan.

6. Remove backend detail DTO metric dependency only after frontend consumers
   move.
   - Replace object-panel tests that assert detail-derived live metric rendering
     with tests that update refresh-domain state while keeping object details
     stable.
   - Add equivalence tests before removing detail fields: detail
     `podMetricsSummary`/`ResourceUtilization` values and refresh-store
     read-model values must match for Deployment, DaemonSet, and StatefulSet,
     or the behavior change must be documented and approved.
   - After the fallback is no longer needed for live metric values, remove or
     narrow detail DTO metric fields in the specific backend kind packages that
     still populate `PodMetricsSummary`.
   - Do not remove ReplicaSet detail metric fields in this plan.

7. Measure and constrain the new leases.
   - Pod object metrics require a `pods` namespace scope because the current pods
     domain accepts namespace, node, and workload scopes but no single-pod scope
     in `frontend/src/core/refresh/streaming/resourceStreamDomains.ts:59-92`.
   - Node object metrics require the `nodes` cluster scope because the nodes
     stream descriptor is cluster-scoped in
     `frontend/src/core/refresh/streaming/resourceStreamDomains.ts:187-190`.
   - Workload object metrics should prefer the narrowest existing scope:
     `namespace-workloads` namespace scope for Deployment/DaemonSet/StatefulSet.
   - Add tests or instrumentation around lease acquisition so opening a detail
     panel does not accidentally start broader scopes than the selected source
     requires.

## Deferred Strict ReplicaSet Unification

Strictly unifying ReplicaSet metrics under the refresh-store path requires a
backend row-shape change:

- Add uncollapsed direct owner identity to pod rows while preserving the
  resolved `OwnerKind`/`OwnerName`/`OwnerAPIVersion` fields that Deployment
  workload scopes already depend on.
- Update snapshot, maintained-store, querypage, resource-stream row parity, and
  generated frontend types for the new fields.
- Add red tests for a Deployment-managed ReplicaSet workload scope in the
  maintained-store path and for an existing Deployment workload scope so the
  fix cannot break Deployment aggregation.
- Revisit ReplicaSet `isActive` because the current detail builder computes it
  with a live Deployment lookup in
  `backend/resources/replicaset/details.go:57-92`.

## Regression Tests

Use red/green/refactor per behavior slice.

- Pure selector tests:
  - pod ref builds a cluster-prefixed `pods` namespace scope and selects the
    matching pod row from that one scoped payload.
  - workload ref selects the matching `namespace-workloads` row by cluster,
    namespace, kind, and name for Deployment/DaemonSet/StatefulSet.
  - ReplicaSet ref uses the documented detail exception; a Deployment-managed
    ReplicaSet test proves the current maintained-store `pods` workload scope is
    not used as the live metric source.
  - node ref builds a cluster-prefixed `nodes` scope and selects the matching
    node row.
  - cluster partitioning is proved by writing different data under two scoped
    store keys and subscribing to each scope.
  - missing full identity throws through the existing object identity path.
  - workload pod counts are either read from explicit fields or parsed from
    `ready`; the test must cover `3/4`, `0/0`, and malformed values.

- Hook/lifecycle tests:
  - opening object-panel Resource Utilization leases the expected metric domain
    and scope.
  - unmount releases the lease.
  - initial fetch is requested without depending on object-details completion.
  - metric `sourceVersion` changes update returned metrics while object details
    stay unchanged.
  - opening a Pod panel leases the namespace pods scope; opening a ReplicaSet
    panel does not lease `pods` workload scope in the first implementation;
    opening a Node panel leases the nodes cluster scope.

- Component tests:
  - object-panel pod, node, and workload utilization repaint from refresh-domain
    metric state.
  - object-panel fallback displays detail metrics only while no metric row is
    available.
  - table resource bars still render the same CPU/memory text from row payloads.
  - Cluster Overview Resource Utilization continues to render aggregate totals
    from `cluster-overview` payload data.

- Permission and stale-state tests:
  - metrics unavailable and permission-denied states preserve the current banner
    semantics.
  - stale/error/last-updated metadata flows through the shared metrics result.

- Numeric equivalence tests:
  - Deployment, DaemonSet, and StatefulSet refresh-store metrics match the
    existing detail DTO values before those detail metric fields are removed or
    narrowed.
  - ReplicaSet detail-backed values remain covered by existing detail tests until
    the deferred strict-unification slice exists.
  - Succeeded and Failed pods are covered because both
    `SummarizePodMetrics` and `aggregateWorkloadPodResources` skip those phases
    in `backend/resources/workloads/helpers.go:109-118` and
    `backend/refresh/snapshot/namespace_workloads.go:878-901`.

## Validation Commands

Focused loop:

```sh
npm run test --prefix frontend -- resource-metrics useUtilizationData DetailsTab NsViewPods useWorkloadTableColumns ClusterViewNodes ClusterOverview
npm run typecheck --prefix frontend
```

Backend tests belong to pod-count, DTO cleanup, or deferred strict-ReplicaSet
unification slices:

```sh
go test ./backend/resources/... ./backend/refresh/snapshot
go test ./backend/refresh/resourcestream
```

Run `mage qc:prerelease` after the performance loop is ready for the long gate
again.

## Completion Criteria

- Non-ReplicaSet object-panel Resource Utilization updates from refresh-domain
  metric state while object-detail data stays unchanged.
- Tables, object-panel Resource Utilization, object-panel embedded pod tables,
  and Cluster Overview Resource Utilization share metric adapters and freshness
  metadata.
- No live CPU, memory, request, limit, capacity, allocatable, pod-count, or
  ready-pod-count value depends on an object-detail DTO except the documented
  fallback path and the documented ReplicaSet exception.
- ReplicaSet detail metric fields remain until a separate backend
  strict-unification slice carries direct owner identity in pod rows.
- Age remains frontend-computed from creation timestamps and does not participate
  in metric refresh.
