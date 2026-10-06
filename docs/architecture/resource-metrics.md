# Resource Metrics Contract

Resource utilization uses the refresh store and the backend metrics poller.
Timing, demand, and failure signalling follow
[data-freshness.md](data-freshness.md#metrics); the store-side overlay rule is
in [data-layer.md](data-layer.md#invariants).

## Data model

- Pod, workload, and node snapshot/query builders join one poller sample onto
  served row copies. Each metric-bearing payload publishes freshness/error
  metadata and stamps the collection revision as its `metric` source clock.
- Rows carry CPU in millicores and memory in bytes (`…Milli`/`…Bytes`), never
  display strings. An absent usage field means no valid sample, distinct from
  a real zero. The frontend formats values; table Download writes plain
  millicores and KiB.
- CPU/memory sorting is backend-owned on the joined numeric values; keyset
  cursors stay query-owned.
- Namespaces are the exception: `namespace-metrics` is a metric-only sibling
  payload that namespace surfaces join with `namespaces` by full Namespace
  `ResourceRef`, never by name alone.
- Requests, limits, capacity, allocatable, and other object-derived reservation
  values stay on object rows; usage stays metric-clocked.
- A table adapter may use a local row shape only inside the table that owns
  it; never cross a module/API/cache boundary with partial identity.

## Frontend ownership

`frontend/src/core/resource-metrics` owns metric selectors, scope resolution,
freshness presentation, and object-panel leases. It is not a second cache.

- Pod panels lease a `pods` namespace scope, workload panels a
  `namespace-workloads` namespace scope, and node panels a `nodes` cluster
  scope.
- ReplicaSets have no panel metrics until pod rows expose both direct and
  resolved owner identity.
- Namespace list/table consumers use the namespace context's object/metric
  composition (`NamespaceContext.tsx`), not `useResourceMetrics`.
- Object detail values may be an initial fallback while refresh data is
  unavailable; they are not the live source.

## Freshness presentation

- A sample older than the object's creation belongs to a prior same-named
  object and renders as no data.
- Payloads include `staleAfterSeconds` and `collectedAt`; a local timer may
  move presentation to stale without refetching. Go builders omit zero
  `collectedAt`, and consumers treat non-positive values as absent.
- No successful sample and no failure renders "Collecting metrics…". A failed
  collection reaches the namespace UI immediately through `namespace-metrics`;
  other metric payloads keep their last sample and rely on the stale timer.
- The app header is the persistent metrics-availability indicator. Table cells
  still receive freshness/error metadata; Cluster Overview may show contextual
  status.
- Object age follows the live-age contract and never drives metric refresh.

## Object panel Metrics tab

The **Metrics** tab has CPU and Memory sections, each with a utilization bar
and a chart of samples collected since the panel opened. The Details tab has
no utilization section and holds no metrics lease.

- **Availability:** `useObjectPanelTabs` offers the tab when
  `resolveResourceMetricsScope` serves the object from a refresh domain (Pods,
  Nodes, Deployments, StatefulSets, DaemonSets with built-in group/version).
  ReplicaSets, other kinds, custom resources sharing a built-in kind name, and
  Helm releases get no tab. Do not gate it with a separate kind list.
- **Utilization bars** show current usage against requests, limits, and a
  Node's allocatable, using detail values until the first live sample. The
  legend lists use, peak (highest charted usage, once samples exist), request,
  and limit, plus allocatable and overcommitted for a Node; unset values read
  `-`. Bars stay while auto-refresh is paused and read the store without their
  own lease, so a doorbell is fetched once, not once per reader.
- **Collection:** `usePanelMetricsCollector`, mounted in `ObjectPanel`, holds
  the panel's one metrics lease and signal refetch for the panel's whole life,
  whatever tab shows and even behind another panel in its dock group. It sends
  one sample each time `collectedAt` advances, skipping data retained from
  before it started. Pausing auto-refresh or a cluster switch (which unmounts
  the panel) pauses collection; samples stay.
- **Storage:** `PanelMetricsService` keeps samples in backend memory
  (`backend/panelmetrics`), never on disk, keyed by cluster and panel ID. A
  sample stores its time and two usage values; requests, limits, capacity, and
  allocatable are stored only when they change. Each panel keeps at most 720
  samples (an hour at the default 5-second poll); a shorter poll shortens the
  window instead of growing memory.
- **Lifetime:** the panel workspace directory owns it. A sample is accepted only
  for a panel the directory holds (in a window or retained without one); the
  directory's removal handler drops a panel's samples when it closes (its
  window republishes without it, or the window or cluster is removed). Moving a
  panel between windows or retaining it after its app window closes keeps
  them; snapshots never carry them.
- **Reading:** the tab reads the whole series when its panel is shown, then only
  newer samples after each one its window sends, through `dataAccess`
  (`readPanelMetricSeries`). The show read uses `foreground` so retained
  samples stay visible while auto-refresh is paused; later reads use
  `stream-signal`. A spacing over three times the usual one draws as a gap.
- **Values:** usage is a solid filled line; requests, limits, and a Node's
  allocatable are dashed and drawn only when reported. Workload values sum pods
  that have not finished. A missing sample is a gap, never zero.
- **Charts:** Recharts with theme-token colors; `react-is` must match the
  installed React version, as the Recharts README requires.
- Rejected: stored history and external metrics providers (Prometheus or
  other) — built and removed in October 2026 because per-store auth, cluster
  scoping, query languages, and settings turned the tab into a multi-platform
  dashboard; on-disk storage would also have to follow the pure-Go rule in
  [data-layer.md](data-layer.md).

## Starting points

- Poller and demand: `backend/refresh/metrics`,
  `backend/refresh_aggregate_metrics.go`
- Serve-time joins: `backend/refresh/snapshot`; namespace payload:
  `backend/refresh/snapshot/namespace_metrics.go`
- Frontend selectors/leases: `frontend/src/core/resource-metrics`
- Panel samples: `backend/panelmetrics`, `backend/panel_metrics_service.go`
- Metrics tab: `frontend/src/modules/object-panel/components/ObjectPanel/Metrics`
- Namespace composition:
  `frontend/src/modules/namespace/contexts/NamespaceContext.tsx`
