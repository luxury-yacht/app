# Resource Metrics Contract

Resource utilization values use one frontend read model over the existing
refresh store. Metrics are live data, but they are not object detail data and
they are not object age.

## Serve-Time Join

Live CPU/memory usage reaches tables and panels through the BASE table domains
(`pods`, `namespace-workloads`, `nodes`): each Build reads the metrics poller's
latest sample once and joins usage onto the served row copies. There are no
separate metric domains and no client-side metric join.

- Usage is joined **at serve, never written to the stores** — a metric tick
  cannot re-project stored object rows (`backend/refresh/snapshot/pods.go`
  `overlayPodMetrics`, `nodes.go` via `reaggregateNodeSummary`,
  `namespace_workloads.go` via `assembleWorkloadRows`).
- Each snapshot stamps the poller collection revision as its `metric` source
  clock (`SourceVersions["metric"]`); the service folds it into the snapshot's
  `sourceVersion`/ETag, so a metric tick breaks the 304 validator without
  moving the object `Version`.
- Each payload publishes the poller freshness/error state as a `metrics` block
  (`PodMetricsInfo` / `NodeMetricsInfo`).
- `cpu` and `memory` are sortable fields on the base queries: the querypage
  engine sorts the joined rows numerically (`parseFormattedCPUToMilli` /
  `parseFormattedMemoryToBytes`), and the value-based keyset cursor keeps
  paging correctly across metric ticks.

## Refresh cadence — the metric doorbell

Both clocks are push-notified; the client never polls while its stream is
healthy:

- **Object clock:** informer/reflector events emit change signals over the
  resources WebSocket; the scoped `sourceVersion` advances and typed queries
  refetch (refetch-on-signal, unchanged).
- **Metric clock:** the BACKEND metrics poller owns the schedule. After each
  successful collection it notifies a collection observer
  (`metrics.Poller.SetCollectionObserver`, wired in
  `backend/refresh/system/manager.go`), which fans a `SourceMetric` doorbell
  over the same stream to every subscribed scope of the metric-clock domains
  (`resourcestream.Manager.BroadcastMetricsRefresh`, table domains derived
  from `ProjectionDescriptors` `MetricsDependency()`, plus an explicit fan-out
  to `cluster-overview` subscribers). The doorbell version is the collection
  revision (CollectedAt nanos) — the same value the snapshot builders stamp as
  `SourceVersions["metric"]`, so the doorbell and the snapshot ETag advance
  together. The frontend accepts the signal because those domains declare the
  `metric` source clock in the contract (`domainSupportsSourceClock`); it
  advances the scoped `signalVersions`/`sourceVersion` and the joined query
  (or the overview's signal hook) refetches.

The user's metrics-interval preference configures the backend poller: at
subsystem build (`resolveMetricsInterval`) and live on preference change
(`UpdateAppPreferences` side effect → `Manager.SetMetricsInterval` →
`Poller.SetInterval`, which retimes the running ticker).

Snapshot polling by the frontend refresher exists only as the stream-DOWN
fallback (`pauseRefresherWhenStreaming` semantics: covered scopes are skipped
while the stream is healthy), at the domain's authored contract timing — with
one exception: `cluster-overview` is a POLL-AUGMENTED doorbell domain whose
polls stay on even while its stream is healthy (descriptor
`pollingContinuesWhileStreaming`), because the metric doorbell only rings on
successful collections and would otherwise freeze the overview's
object-derived counts on metrics-less clusters.

Backend metrics-poller demand is any active lease on `cluster-overview`,
`namespaces`, `nodes`, `pods`, or `namespace-workloads`
(`frontend/src/core/refresh/orchestrator.ts` `isMetricsDemandActive`).

## Design history and trade-offs

Before 2026-07 these tables used three separate `*-metrics` domains plus a
client-side join: the frontend queried the base domain for the page, then
queried the metric domain with the page's row keys as a `predicate.rowKeys`
URL predicate (up to 250 pipe-joined keys, double-encoded into the `scope`
query param), inverting the two legs for CPU/memory sorts. That cost 2–3
correlated HTTP requests per table per tick, tens-of-KB request URLs, batching
and mismatch-logging machinery, and duplicate maintained stores. The serve-time
join replaced all of it; do not reintroduce a metric domain, a `rowKeys`-style
membership predicate, or a client-side metric merge.

The accepted trade-off: a metric tick now re-downloads the full joined page
(HTTP 200) where the old split let the object page answer 304 while only a
small metric page re-downloaded. On the loopback transport this is cheap, and
it is strictly fewer requests. If joined-page re-serialization ever shows up on
very large clusters, the revisit knobs are (in order): lengthen the
metrics-interval preference, then consider splitting usage into a sibling
sub-payload with its own validator — NOT resurrecting the metric domains or the
row-key round-trips.

## Invariants

- Live CPU, memory, request, limit, capacity, allocatable, pod-count,
  ready-pod-count, freshness, and error metadata should flow through
  `frontend/src/core/resource-metrics`.
- The metrics module is a selector and lifecycle layer over refresh-domain
  state. Do not add a second frontend metrics cache.
- Object-detail DTOs may provide initial fallback values while the base domain
  is loading, unavailable, or permission denied. They must not become the live
  metrics source except for the documented ReplicaSet exception.
- Metrics reads are keyed by full object identity: `clusterId`, `group`,
  `version`, `kind`, plus `namespace` and `name` for namespaced concrete
  objects.
- Table rows may use shared value adapters directly when their local row shape
  lacks full GVK identity. Do not route table rows through the identity-keyed
  `useResourceMetrics` hook unless they carry the full object reference.
- Rows carry object identity, status, readiness, restart counts, labels,
  annotations, absolute age timestamps, object-derived reservation values
  (requests, limits, capacity, allocatable), AND the live usage joined at
  serve. Joining code must tolerate the no-data marker for rows with no valid
  sample.
- A usage sample scraped before the object's creation belongs to a prior
  same-named incarnation and renders the no-data marker (`metricSampleValid`),
  never stale or zero numbers.
- Staleness is evaluated CLIENT-SIDE: the payloads' `metrics` block ships
  `staleAfterSeconds` alongside `collectedAt`, and `useMetricsBannerInfo`
  updates the app-level metrics status (and Cluster Overview's contextual
  presentation) at that boundary on a local timer — never via a refetch. This
  matters because the poller rings no doorbell on failure: a dead
  metrics-server on a quiet cluster produces no refetch, so a server-computed
  stale flag would never reach the screen. The server's `stale` flag stays
  authoritative when set (the cluster-overview payload carries no threshold
  and keeps server-stale-only behavior).
- Metric-bearing table surfaces do not render availability banners. The app
  header's metrics status is the single persistent availability indicator;
  table CPU/memory cells still receive freshness, error, and last-updated
  metadata for their value-level presentation. Cluster Overview may render its
  own contextual metrics message because it summarizes cluster state rather
  than duplicating a table-level warning.
- The PRISTINE first-collection window has its own state: a payload with
  `successCount == 0`, no failures, and no error means the demand-driven
  poller has started but nothing has been collected yet — the metrics status
  reports "Collecting metrics…" (never zero gauges with no indication).
  Builders MUST omit `collectedAt` for the zero time (`IsZero` guard) —
  serializing Go's zero time as a Unix stamp (-62135596800) reads as "present"
  downstream and suppresses the indication; the frontend additionally treats
  non-positive `collectedAt` as absent.
- Object age is computed from timestamps by the frontend live-age contract and
  must not participate in metric refresh.

## Source Map

| Consumer | Source |
| --- | --- |
| Pod object utilization | `pods` scoped payload rows (usage joined at serve) |
| Deployment, DaemonSet, StatefulSet utilization | `namespace-workloads` scoped payload rows |
| Workload freshness | `namespace-workloads` payload `metrics` block |
| ReplicaSet utilization | object-detail DTO exception |
| Node utilization | `nodes` scoped payload rows |
| Cluster aggregate utilization | `cluster-overview` scoped payload; out of scope for table metrics |
| Namespace aggregate utilization | `namespaces` payload rows: usage joined from one poller sample at serve; requests and limits summed from active pod aggregate rows |
| Pod / workload / node tables | ONE base-domain query per table; CPU/memory sorts run server-side on the joined usage |

Tables read the freshness block from the query payload (`queryPayload.metrics`).
The object panel's `useResourceMetrics` leases one scoped base domain per kind
(`pods` namespace scope, `namespace-workloads` namespace scope, `nodes` cluster
scope) and selects the object's row by full identity.

Namespace request and limit totals sum regular-container values from
non-terminal pods. Init-container values stay separate in the pod aggregate and
are not included, matching the pod and namespace-workload table semantics.

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

`useResourceMetrics` should lease only the needed scoped base domain:

- Pod panels use the `pods` namespace scope because there is no single-pod
  scope.
- Workload panels use the `namespace-workloads` namespace scope.
- Node panels use the `nodes` cluster scope.
- ReplicaSet panels should not lease a pods workload scope under the current
  row-shape contract.

## Refresh Contract

Metric refresh is driven by the `metric` source clock described in
`resource-stream-signals.md`. A metric-only update advances the snapshot's
metric source clock (and therefore its ETag) but must not advance the object
`Version` or re-project stored object rows.

## Validation

Focused loops:

```sh
go test ./backend/refresh/snapshot -run 'MetricsJoin|OverlaysLiveUsage|WithoutProvider|MetricSort'
npm run test --prefix frontend -- resource-metrics useUtilizationData DetailsTab NsViewPods useWorkloadTableColumns ClusterViewNodes ClusterOverview
npm run typecheck --prefix frontend
```

For non-documentation changes, finish with `mage qc:prerelease`.
