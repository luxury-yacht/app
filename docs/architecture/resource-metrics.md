# Resource Metrics Contract

Resource utilization uses the existing refresh store and the backend metrics
poller. Metric timing, demand, and background behavior are governed by
[data-freshness.md](data-freshness.md#metrics).

## Data model

- Pod, workload, and node snapshot/query builders read one poller sample and
  join usage onto served row copies. Object stores keep object projections, not
  metric samples.
- Each metric-bearing payload publishes freshness/error metadata and stamps the
  collection revision as its `metric` source clock.
- CPU/memory sorting is backend-owned and uses the joined numeric values; keyset
  cursors remain query-owned.
- Namespace objects are the exception to the base-row join:
  `namespace-metrics` is a metric-only sibling payload. Namespace surfaces join
  it with `namespaces` by full Namespace `ResourceRef`, never by name alone.
- Requests, limits, capacity, allocatable, and other object-derived reservation
  values stay with their object rows. Usage stays metric-clocked.

## Frontend ownership

`frontend/src/core/resource-metrics` owns metric selectors, scope resolution,
freshness presentation, and object-panel leases. It is not a second cache.

- Pod panels lease a `pods` namespace scope.
- Workload panels lease a `namespace-workloads` namespace scope.
- Node panels lease a `nodes` cluster scope.
- ReplicaSet remains detail-backed until pod rows expose both direct and
  resolved owner identity.
- Namespace list/table consumers use the namespace context's object/metric
  composition rather than `useResourceMetrics`.

Object detail values may be initial fallback while refresh data is unavailable;
they are not the ongoing live source except for the ReplicaSet exception.

## Freshness presentation

- A sample older than the object's creation belongs to a prior same-named
  object and renders as no data.
- Payloads include `staleAfterSeconds` and `collectedAt`. The frontend may
  transition fresh presentation to stale on a local timer; it does not refetch
  for that transition.
- No successful sample plus no failure means “Collecting metrics…”. Go builders
  omit zero `collectedAt`; consumers treat non-positive values as absent.
- A failed collection rings a targeted `namespace-metrics` doorbell so the
  namespace UI leaves “Collecting metrics…” and displays the current failure
  state immediately. Other metric-bearing payloads retain their last sample and
  use the local stale-boundary timer.
- The app header is the persistent metrics-availability indicator. Table cells
  still receive freshness/error metadata; Cluster Overview may show contextual
  metrics status.
- Object age follows the live-age contract and never drives metric refresh.

## Identity

Metric selection and joins use `clusterId`, `group`, `version`, `kind`, and the
concrete object's `namespace` and `name`. A table adapter may consume a local
row shape only within the table that owns it; do not cross a module/API/cache
boundary with partial identity.

## Starting points

- Poller and demand: `backend/refresh/metrics`,
  `backend/refresh_aggregate_metrics.go`
- Serve-time joins: `backend/refresh/snapshot`
- Namespace metric payload: `backend/refresh/snapshot/namespace_metrics.go`
- Frontend selectors/leases: `frontend/src/core/resource-metrics`
- Namespace composition:
  `frontend/src/modules/namespace/contexts/NamespaceContext.tsx`

Run affected snapshot, metric-selector, table/panel, orchestrator, and
multi-cluster tests plus frontend typecheck. Finish non-doc-only changes with
`mage qc:prerelease`.
