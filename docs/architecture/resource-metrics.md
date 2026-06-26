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
- Object age is computed from timestamps by the frontend live-age contract and
  must not participate in metric refresh.

## Source Map

| Consumer | Source |
| --- | --- |
| Pod object utilization | `pods` scoped rows |
| Deployment, DaemonSet, StatefulSet utilization | `namespace-workloads` scoped rows |
| Deployment, DaemonSet, StatefulSet freshness | current `nodes` scoped metrics metadata |
| ReplicaSet utilization | object-detail DTO exception |
| Node utilization | `nodes` scoped rows |
| Cluster aggregate utilization | `cluster-overview` scoped payload |
| Pod tables and embedded pod tables | row value adapters over `PodSnapshotEntry` |
| Workload tables | row value adapters over namespace workload rows |
| Node tables | row value adapters over node rows |

The first-pass workload freshness source is the active cluster `nodes` domain.
Moving freshness onto `namespace-workloads` is a behavior change and needs a
backend payload field plus tests.

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

`useResourceMetrics` should lease only the needed scoped domain:

- Pod panels use the `pods` namespace scope because there is no single-pod
  scope.
- Workload panels use the `namespace-workloads` namespace scope.
- Node panels use the `nodes` cluster scope.
- Workload freshness may add a separate `nodes` cluster-scope lease.
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
