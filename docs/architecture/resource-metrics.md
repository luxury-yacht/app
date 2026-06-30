# Resource Metrics Contract

Resource utilization values use one frontend read model over the existing
refresh store. Metrics are live data, but they are not object detail data and
they are not object age.

## Invariants

- Live CPU, memory, request, limit, capacity, allocatable, pod-count,
  ready-pod-count, freshness, and error metadata should flow through
  `frontend/src/core/resource-metrics`.
- The metrics module is a selector and lifecycle layer over refresh-domain
  state. Do not add a second frontend metrics cache.
- Object-detail DTOs may provide initial fallback values while the metrics
  domain is loading, unavailable, or permission denied. They must not become
  the live metrics source except for the documented ReplicaSet exception.
- Metrics reads are keyed by full object identity: `clusterId`, `group`,
  `version`, `kind`, plus `namespace` and `name` for namespaced concrete
  objects.
- Table rows may use shared value adapters directly when their local row shape
  lacks full GVK identity. Do not route table rows through the identity-keyed
  `useResourceMetrics` hook unless they carry the full object reference.
- Base object/status domains carry object identity, status, readiness, restart
  counts, labels, annotations, absolute age timestamps, and object-derived
  reservation values such as requests, limits, capacity, and allocatable.
- Metric domains carry live CPU/memory usage plus metric freshness and error
  metadata. Joining code must tolerate missing base reservation values, missing
  metric usage, and fully joined rows.
- Object age is computed from timestamps by the frontend live-age contract and
  must not participate in metric refresh.

## Source Map

| Consumer | Source |
| --- | --- |
| Pod object utilization | `pods-metrics` scoped rows joined with base `pods` rows |
| Deployment, DaemonSet, StatefulSet utilization | `namespace-workloads-metrics` scoped rows joined with base `namespace-workloads` rows |
| Deployment, DaemonSet, StatefulSet freshness | `namespace-workloads-metrics` scoped metrics metadata |
| ReplicaSet utilization | object-detail DTO exception |
| Node utilization | `nodes-metrics` scoped rows joined with base `nodes` rows |
| Cluster aggregate utilization | `cluster-overview` scoped payload; out of scope for table metrics decoupling |
| Pod tables and embedded pod tables | base `pods` rows overlaid with `pods-metrics`; CPU/memory sorts query `pods-metrics` and hydrate base `pods` rows |
| Workload tables | base `namespace-workloads` rows overlaid with `namespace-workloads-metrics`; CPU/memory sorts query `namespace-workloads-metrics` and hydrate base workload rows |
| Node tables | base `nodes` rows overlaid with `nodes-metrics`; CPU/memory sorts query `nodes-metrics` and hydrate base node rows |

Each metric domain exposes two access shapes over the same refresh-domain data:
a scoped payload selector for object-sorted table overlays and Object Panel
utilization, and a keyset query shape for CPU/memory sorts that own page
membership, ordering, totals, and cursor metadata. Do not create parallel
frontend metric caches for these shapes.

Object-sorted tables keep base query membership, ordering, filters, search,
facets, totals, and pagination in the base object/status query. They fetch
metric values for the visible row identities and overlay those values without
resetting base pagination, search, filters, or row order.

CPU/memory-sorted tables use the metric-domain query for membership, ordering,
cursor, total, metric values, freshness metadata, and metric revision. The
metric query applies the same base scope, search, metadata-search flag,
namespace filters, kind filters, backend predicates, page size, sort direction,
and cursor state before sorting and paginating. It returns ordered object refs
plus metric values; the base object/status path hydrates the corresponding base
rows by exact refs.

Workload freshness comes from `namespace-workloads-metrics` metadata. Do not keep
the previous `nodes` domain freshness lease for workload utilization after
migrating consumers.

## ReplicaSet Exception

ReplicaSet remains detail-backed until pod rows carry both direct owner identity
and resolved owner identity. The maintained-store pod path resolves
Deployment-managed ReplicaSet pods to their Deployment owner so Deployment
workload scopes keep working; routing a ReplicaSet ref through that path can
miss common Deployment-managed ReplicaSets.

A strict ReplicaSet unification slice must:

- add uncollapsed direct owner fields without removing the existing resolved
  owner fields,
- update snapshot, maintained-store, querypage, resource-stream row parity, and
  frontend types,
- test Deployment-managed ReplicaSet workload scopes and existing Deployment
  workload scopes,
- preserve the ReplicaSet `isActive === false` behavior until an equivalent
  refresh-store source exists.

## Frontend Ownership

- Types and result shape: `frontend/src/core/resource-metrics/types.ts`
- Object-ref normalization and domain/scope resolution:
  `frontend/src/core/resource-metrics/scope.ts`
- Pure row selectors: `frontend/src/core/resource-metrics/selectors.ts`
- Hook and domain leases:
  `frontend/src/core/resource-metrics/useResourceMetrics.ts`
- Row and aggregate value adapters:
  `frontend/src/core/resource-metrics/valueAdapters.ts`
- Object-panel utilization consumer:
  `frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts`

`useResourceMetrics` should lease only the needed scoped metric domain:

- Pod panels use the `pods-metrics` namespace scope because there is no single-pod
  scope.
- Workload panels use the `namespace-workloads-metrics` namespace scope.
- Node panels use the `nodes-metrics` cluster scope.
- ReplicaSet panels should not lease a pods workload scope under the current
  row-shape contract.

## Refresh Contract

Metric refresh is driven by the `metric` source clock described in
`resource-stream-signals.md`. A metric-only update can refresh metric-backed
views, but it must not advance the object source version or re-project stored
object rows.

## Validation

Focused frontend loop:

```sh
npm run test --prefix frontend -- resource-metrics useUtilizationData DetailsTab NsViewPods useWorkloadTableColumns ClusterViewNodes ClusterOverview
npm run typecheck --prefix frontend
```

Backend tests belong with changes to pod counts, DTO cleanup, or strict
ReplicaSet unification:

```sh
go test ./backend/resources/... ./backend/refresh/snapshot
go test ./backend/refresh/resourcestream
```

For non-documentation changes, finish with `mage qc:prerelease`.
