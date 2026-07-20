# Data Freshness Contract

This is the single normative contract for when cluster data appears, refreshes,
and causes Kubernetes API work. Other architecture docs describe ownership and
payload shape; they link here instead of restating freshness behavior.

## User-visible contract

1. **Paint retained data immediately.** Selecting a tab or view reads that
   cluster and scope's retained snapshot during the same render. Do not clear it,
   wait for readiness, or replace it with a loading screen before asking for
   fresh data.
2. **Reconcile immediately after activation.** Foreground activation starts one
   non-manual refresh for the newly visible scopes. When it completes, its
   snapshot replaces the retained data.
3. **Keep background work passive.** An open inactive cluster retains snapshots
   and object-change subscriptions. It does not continuously fetch snapshots,
   start metrics collection, or produce manual-refresh errors merely because
   its tab is open.
4. **Push represents change.** A healthy stream rings a doorbell only when its
   declared source changes. The signal identifies the cluster, domain, scope,
   source clock, and version; the snapshot/query path still owns rows.
5. **Polling is recovery.** A domain with a reliable push source pauses its
   timer while the stream is healthy. Its authored interval is the stream-down
   fallback. A domain whose signal producer may remain silent must explicitly
   keep its fallback poll running.
6. **Manual means the user asked.** Buttons and commands use manual jobs.
   Startup, foreground activation, stream signals, and fallback polling are
   non-manual and must not surface manual-job timeout errors.

## Request intents

| Intent | Meaning | Allowed while automatic refresh is paused? |
| --- | --- | --- |
| `startup` | First passive acquisition of a scope | No |
| `foreground` | A retained scope became visible | Yes |
| `background` | Scheduler/fallback upkeep | No |
| `stream-signal` | A declared source clock changed | Yes |
| `user` | Explicit user action/manual refresh | Yes |

Foreground is not manual. It bypasses passive-refresh pauses and cooldowns so a
tab activation reconciles now, but it calls the backend's ordinary snapshot or
stream reconciliation path rather than creating a ManualQueue job.

## Retention and leases

- Refresh state is keyed by one `clusterId` plus the domain-owned scope.
- Disabling or switching a visible scope preserves its last successful data.
- Re-enabling paints that data before the activation request settles.
- Cross-cluster views acquire one lease per displayed cluster; membership
  changes acquire/release only the changed clusters.
- A lease expresses consumer demand. Do not use an open background workspace as
  demand for expensive producers that only feed visible data.

## Signals and source clocks

The authored domain contract declares which clocks can change a payload:
`object`, `metric`, `event`, `catalog`, and `attention`.

- Signal-driven refetch keys only on the declared `signalVersions`. Snapshot
  responses also update validators and must not echo into another refetch.
- Signal versions are opaque equality tokens. Sequence and Kubernetes
  `resourceVersion` are transport/object metadata, not global ordering clocks.
- Stream messages do not carry table rows, query state, positions, or cursors.
- A source must advance only the payload it owns. In particular, a metric tick
  must not advance an object clock or make an object snapshot appear changed.
- `namespaces` advances its `object` signal clock when a Namespace add, update,
  or delete can change the list. The producer invalidates the namespace
  snapshot cache before ringing that doorbell, and every leased namespace
  consumer performs one `stream-signal` reconciliation for the new clock.
- A reconnect may reuse retained data without fetching only when the server
  successfully replays from the client's resume token. If the server sends a
  reset because it cannot prove continuity, retained data is invalidated by
  advancing one of the domain's declared signal clocks; consumers then perform
  one `stream-signal` reconciliation. A reset must never be accepted as only an
  acknowledgement while retained data remains visible.
- Replacing one cluster's backend stream manager invalidates subscriptions bound
  to the previous manager. After routing the replacement, affected subscriptions
  re-establish against the current manager over the existing aggregate
  connection; subscriptions for other clusters remain connected. The new tail
  follows the same replay-or-reset rule before retained data is trusted.

## Metrics

- The backend poller owns metric cadence and runs only for clusters with an
  active metric-bearing consumer.
- A successful sample advances the `metric` clock and rings every subscribed
  metric doorbell. A failed attempt advances only `namespace-metrics`, whose
  payload owns the namespace utilization lifecycle/error state; it does not ring
  sample-bearing pod, workload, node, or overview doorbells and never invents an
  object change.
- Pod, workload, and node queries join the latest sample onto served row copies.
- Namespace utilization is deliberately separate: `namespaces` owns namespace
  objects and object-derived rollups; `namespace-metrics` owns only utilization
  rows and metric freshness. Visible namespace surfaces join them by the full
  Namespace `ResourceRef`.
- The active cluster leases `namespace-metrics`; inactive cluster tabs do not.
  Global Namespaces leases it for each cluster whose namespace rows are
  currently displayed, and releases those leases on exit.
- Frontend metrics-demand changes are sent in order. A transient demand-request
  failure retries with bounded backoff while the desired cluster set remains
  unchanged; a newer desired set is reconciled after the in-flight request.
- Client timers may change presentation from fresh to stale, but may not fetch
  data merely to advance staleness or relative age text.

## Errors and readiness

- Retained data remains visible during refresh and transient failure. Attach the
  refresh/error state to it instead of replacing it with an empty payload.
- A typed permission denial is a settled domain state, not a retry loop.
- Error notifications are deduplicated by full refresh scope. Re-selecting a
  retained failing scope does not repeat the same notification; leaving the
  error state clears that scope's dedupe so a later failure can notify again.
- Loading gates may block invalid early reads, but must still allow the request
  that advances the cluster to ready.
- When a cluster subsystem is replaced, queued or running manual work moves to
  its replacement queue. Succeeded, failed, and cancelled jobs remain terminal
  and are never re-enqueued.
- Closing/removing a cluster tears down its leases, streams, jobs, and retained
  state. Switching tabs does not.

## Owning code

- Authored domain metadata: `backend/refresh/domain/refresh-domain-contract.json`
- Backend snapshots and signals: `backend/refresh/snapshot`,
  `backend/refresh/resourcestream`
- Backend manual jobs and metrics demand: `backend/refresh/system`,
  `backend/refresh/types.go`, `backend/refresh_aggregate_metrics.go`
- Frontend request policy, runtimes, and retained store:
  `frontend/src/core/data-access`, `frontend/src/core/refresh`
- Namespace object/metric composition:
  `frontend/src/modules/namespace/contexts/NamespaceContext.tsx`

## Change checklist

For a freshness change, test the contract at the producer/consumer seam:

1. retained data paints before the activation request completes;
2. foreground activation issues one non-manual request for the visible scope;
3. an inactive retained scope does not create producer demand or periodic
   requests;
4. the declared source signal refetches the affected payload once;
5. a reconnect that cannot replay invalidates retained data and refetches it
   once, while a successful replay does not add a snapshot request;
6. replacing one cluster's stream manager re-establishes only that cluster's
   subscriptions and reconciles any continuity gap;
7. retained errors notify once per scope and can notify again after recovery;
8. a metric-only change leaves object clocks and object snapshots unchanged;
9. permission, stream-down fallback, teardown, and multi-cluster isolation still
   converge.

Finish non-documentation changes with `mage qc:prerelease`.
