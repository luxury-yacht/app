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
- Rows carry CPU in millicores and memory in bytes (`…Milli` / `…Bytes`
  fields), never display strings. An absent usage field means no valid sample,
  which is distinct from a real zero. The frontend formats every value for
  display; table Copy/Export write plain millicores and KiB.
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
- ReplicaSets have no panel metrics until pod rows expose both direct and
  resolved owner identity.
- Namespace list/table consumers use the namespace context's object/metric
  composition rather than `useResourceMetrics`.

Object detail values may be initial fallback while refresh data is unavailable;
they are not the ongoing live source.

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

## Object panel Metrics tab

The **Metrics** tab shows a CPU and a Memory section, each with the resource's
utilization bar and its chart of the samples the panel has collected since it
opened. The Details tab has no utilization section and holds
no metrics lease.

- **Availability.** `useObjectPanelTabs` offers the tab when
  `resolveResourceMetricsScope` serves the object from a refresh domain: Pods,
  Nodes, Deployments, StatefulSets, and DaemonSets with built-in group/version.
  ReplicaSets, other kinds, custom resources that share a built-in kind name,
  and Helm releases get no tab. Do not gate it with a separate kind list.
- **Utilization bars.** Each bar shows the current usage against requests,
  limits, and a Node's allocatable, using the object's detail values until the
  first live sample arrives. The legend lists use, peak (the highest charted
  usage, once samples exist), request, and limit, plus allocatable and
  overcommitted for a Node; an unset value reads `-`. The bars stay while
  auto-refresh is paused. They read the store without a lease of their own:
  the panel's collector holds the one metrics lease and signal refetch, so a
  doorbell is not fetched once per reader.
- **Collection.** `usePanelMetricsCollector`, mounted in `ObjectPanel`, leases
  the object's metrics scope for the panel's whole life, whatever tab it shows
  and even behind another panel of its dock group. It sends one sample each
  time the payload's `collectedAt` advances, skipping data retained from before
  it started. Pausing auto-refresh and a cluster switch (which unmounts the
  panel) pause collection; the samples stay.
- **Storage.** `PanelMetricsService` keeps the samples in backend memory
  (`backend/panelmetrics`), never on disk, keyed by cluster and panel ID. A
  sample stores its time and the two usage values; requests, limits, capacity,
  and allocatable are stored only when they change. Each panel keeps at most
  720 samples (an hour at the default 5-second poll); a shorter poll shortens
  the window instead of growing memory.
- **Lifetime.** The panel workspace directory owns it: a sample is accepted only
  for a panel the directory holds (in a window, or retained without one), and
  the directory's removal handler drops a panel's samples when it closes (its
  window republishes without it, or the window or cluster is removed). Moving a
  panel between windows, or retaining it after its app window closes, keeps
  them; snapshots never carry them.
- **Reading.** The tab reads the whole series when its panel is shown, then
  only what is newer after each sample its window sends, through `dataAccess`
  (`readPanelMetricSeries`). The show read uses reason `foreground`, which runs
  while auto-refresh is paused, so retained samples stay visible; the later
  reads use `stream-signal`. A spacing over three times the usual one is drawn
  as a gap.
- **No history.** There is no stored history and no external metrics provider
  (Prometheus or other). Both were built and removed in October 2026: per-store
  authentication, cluster scoping, query languages, and settings turned the tab
  into a multi-platform dashboard. On-disk storage would also have to follow
  the pure-Go rule in [data-layer.md](data-layer.md).
- **Values.** Usage is a solid line with the area under it filled; requests,
  limits, and a Node's allocatable are dashed, drawn only when the object
  reports them. Workload values are sums over pods that have not finished. A
  missing sample is a gap, never a zero.
- **Charts.** Recharts draws the charts with theme-token colors. `react-is` must
  match the installed React version, as the Recharts README requires.

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
- Panel sample buffer: `backend/panelmetrics`, `backend/panel_metrics_service.go`
- Metrics tab: `frontend/src/modules/object-panel/components/ObjectPanel/Metrics`
- Namespace composition:
  `frontend/src/modules/namespace/contexts/NamespaceContext.tsx`

Run affected snapshot, metric-selector, table/panel, orchestrator, and
multi-cluster tests plus frontend typecheck. Finish non-doc-only changes with
`wails3 task qc:prerelease`.
