# Data Freshness Contract

The single normative contract for when cluster data appears, refreshes, and
causes Kubernetes API work. Mechanics and transport live in
[refresh-system.md](refresh-system.md); backend store and governor in
[data-layer.md](data-layer.md); metric payloads in
[resource-metrics.md](resource-metrics.md).

## User-visible contract

1. **Paint retained data immediately.** Selecting a tab or view reads that
   cluster and scope's retained snapshot in the same render; never clear it,
   wait for readiness, or show a loading screen before requesting fresh data.
2. **Reconcile immediately after activation.** A newly leased scope starts one
   non-manual read, from its stream start or its `fetchOnEnable` request; the
   result replaces the retained data. While a cooled backend re-establishes
   producers, every domain and dispatch path (polled, stream-triggered,
   stream-only) waits on the
   activation boundary instead of surfacing transient service-unavailable
   errors. Backend cool/re-warm transitions are serialized so the boundary
   cannot complete against a half-cooled subsystem.
3. **Keep background work passive.** Only leases create demand. An open
   inactive cluster keeps its retained snapshots and its `namespaces` lease,
   which reads on that list's doorbell and polls only while its stream is
   down. Nothing else reads the cluster, starts metrics collection, or
   produces manual-refresh errors because its tab is open.
4. **Push represents change.** A healthy stream rings a doorbell only when its
   declared source changes. The signal names cluster, domain, scope, source
   clock, and version; the snapshot/query path owns rows.
5. **Polling is recovery.** Every leased scope polls at its contract interval,
   scheduled after the previous poll settles. While the scope's stream is
   healthy the poll skips its read, so the interval is the stream-down
   fallback. A domain whose producer may stay silent reads on every poll
   (`pollingContinuesWhileStreaming`: `cluster-overview` and
   `object-details`). Polls stop while auto-refresh is off or the window is
   hidden.
6. **Manual means the user asked.** Buttons and commands use manual jobs.
   Startup, foreground, stream signals, and fallback polling are non-manual and
   never surface manual-job timeout errors. Only manual refresh emits
   `refresh:start`/`refresh:complete`, which drive the connectivity
   indicator's refreshing state; polls and signal refetches stay quiet.

## Request intents

| Intent | Meaning | Runs while auto-refresh is paused? |
| --- | --- | --- |
| `startup` | First passive acquisition of a scope | No |
| `foreground` | A retained scope became visible | Yes |
| `background` | Poll or fallback upkeep | No |
| `stream-signal` | A declared source clock changed | No; the scope stays pending and reconciles on the first allowed read |
| `user` | Explicit user action/manual refresh | Yes |

- Foreground is not manual: it bypasses the passive pause but uses the
  ordinary snapshot/stream reconciliation path, never a ManualQueue job.
  Activation reads come from the lease (a stream start or `fetchOnEnable`),
  never from navigation; the orchestrator holds no navigation context.
- The orchestrator refetches every scope with snapshot demand when its
  doorbell advances a declared clock (`refresh:stream-signal`). Doorbell
  refetches must use `stream-signal`, which bypasses the
  skip-while-stream-healthy gate; that gate silently swallows a `background`
  refetch. Query-only demand reconciles through `useQueryStreamSignal`.
- Manual refresh (`refreshCluster`) reads every leased scope of one cluster
  and accepts only `user`.

## Retention and leases

- Refresh state is keyed by one `clusterId` plus the domain-owned scope; the
  selected cluster and scope form the retained-data read key. Lifecycle and
  readiness may gate leases, requests, and signals, but never remove that key
  or hide rendered rows.
- Disabling or switching a visible scope preserves its last successful data
  (`preserveState: true`; audit enable/disable calls when adding a snapshot
  stream so remounts do not blank rows). Re-enabling paints it before the
  activation request settles.
- Temporary loss of refresh eligibility, including for every open cluster,
  stops active work with state preserved. Only closing/removing the cluster
  clears its scopes.
- Cross-cluster views hold one lease per displayed cluster; membership changes
  acquire/release only the changed clusters.
- A lease is consumer demand. An open background workspace is not demand for
  expensive producers that only feed visible data.
- Scoped leases declare `query` or `snapshot` demand with independent reference
  counts over one shared live source (subscription, readiness, permission,
  stream health, source clocks, fallback polling). Query demand owns the
  consumer's current bounded page and never fetches or retains the domain's
  snapshot payload; snapshot demand owns that payload. Snapshot demand joining
  a live query scope triggers snapshot reconciliation. Releasing one mode keeps
  the other's work; releasing the last stops the source under these rules.
- Query demand subscribes before its initial page read. The backend `ACK` or
  initial `RESET` advances an acknowledgement identity that causes one
  acknowledged page read; a response for an older query identity cannot
  overwrite a newer page. This closes the send/registration race without a
  second retained row snapshot.
- The scheduler never satisfies query-only fallback or global manual refresh by
  fetching the bounded base snapshot. While the stream is unhealthy, or on
  global manual refresh, it advances a query-reconciliation identity and the
  mounted consumer reissues its page; a healthy stream leaves it unchanged.
- Governor Cold entry and pressure-forced teardown follow
  [data-layer.md](data-layer.md#lifecycle--governor). Frontend leases keep their
  last successful rows through both; after a forced teardown the backend serves
  nothing for that cluster until a foreground re-warm.

## Signals and source clocks

The authored domain contract declares which clocks can change a payload:
`object`, `metric`, `event`, `catalog`, and `attention`. Transport:
[refresh-system.md](refresh-system.md#transport-boundary).

- Signal-driven refetch keys only on declared `signalVersions`, never the
  payload-rewritten `sourceVersion`; keep a first-signal sentinel so an empty
  previous value cannot swallow the first ring. Snapshot responses update
  validators and must not echo into another refetch.
- Signal versions are opaque equality tokens. Sequence numbers and Kubernetes
  `resourceVersion` are transport/object metadata, not global ordering clocks.
- Stream messages never carry table rows, query state, positions, or cursors.
- A source advances only the payload it owns: a metric tick never advances an
  object clock or makes an object snapshot appear changed.
- Every producer rings the cluster generation's doorbell (`doorbell.Bell`,
  implemented by `resourcestream.Manager`). `Ring` invalidates the domain's
  snapshot/query cache before delivering the new clock, even when no view is
  subscribed; otherwise a signal-triggered read, or a view reopened before the
  cache expires, can consume the pre-change cached page and no later signal
  arrives. The bell exists before any producer is built and accepts
  rings from construction; rings during initial sync reach only existing
  subscribers. `Ring` takes only leaf locks and never calls back into a store,
  so stores may ring under their own write lock.
- Signals that collide with an in-flight read latch exactly one trailing
  `stream-signal` read (`latchTrailingStreamSignal`); never drop them or
  repeatedly abort-and-replace.
- A stream resync follows the same rule. A non-forced resync requested during
  another resync or inside the resync cooldown latches one trailing resync,
  which runs when the cooldown ends (`latchTrailingResync`,
  `resourceStreamProtocol.ts`). Complete-resync domains such as
  `namespace-helm` depend on this: a Helm upgrade rings several times within
  milliseconds, and only the last ring carries the final status.
- A healthy transport does not prove every collection supplies changes. A
  table's declared source must carry Kubernetes changes through the actual
  snapshot owner to the signal that table consumes, at any object count; prove
  it with real state owners, not separate mocked producer and consumer tests.
- A store's own mutation path is the only place its domain rings. A
  maintained store rings from its ingest sink after its querypage mutation
  returns (`backend/refresh/snapshot/store_doorbell.go`; the Events tables
  through their debounced notifier, `event_ingest.go`). `resourcestream`
  registers no ringing handler or sink. Its ReplicaSet and Job
  owner heals only rewrite pod bundles, which the pods store then publishes.
  A LIST-fallback domain has no maintained store, so the ingest store of the
  kind it lists rings it: the Nodes fallback (no pod access) rings from the node
  ingest store.
- A domain that joins an ingest store at serve time (pod aggregates for
  workloads and nodes, Identities' bindings) rings from inside that store's
  sink fan-out, under its write lock, so a read that starts after the ring
  waits for the commit.
- A change rings the union of the row's scopes before and after it, for its
  domain and every derived domain, so a row that leaves a scope (a pod whose
  owner changes) refreshes the window it left. Object rings carry a complete
  `Ref`; derived rings carry none. Namespaced tables ring both
  `namespace:<name>` and `namespace:all`; the Events tables ring the
  involved-object namespace of every row they add, change, or remove.
- Only real changes ring. Reflectors run without resync; a re-delivered row
  with an unchanged `resourceVersion` (`ResourceVersionUnchanged`,
  `backend/refresh/snapshot/util.go`) still applies but does not ring. An
  Events relist rings only the namespaces whose rows it changed.
- A relist rings each affected scope once, after its commit. `ProjectingStore`
  brackets `Replace` and `ReplacePartition` with `RelistBoundary`, and each
  source registration's sink collects its own relist's scopes: a namespace
  partition never rings a sibling namespace, and an unscoped bulk relist rings
  every subscribed scope of the domain and its derived domains. One source's
  relist never delays, flushes, or clears another source's rings.
- Timed producer callbacks (debounce flushes, re-arms, attention deadlines)
  run through `Bell.AfterFunc`. `Manager.Stop` is a barrier: it rejects new
  rings and callbacks, cancels pending timers, and waits for running ones
  before closing subscriptions. After it returns nothing invalidates or
  delivers for that generation, and a cooled generation keeps serving its
  cached snapshots.
- `namespaces` advances its `object` clock when a Namespace add, update, or
  delete can change the list, invalidating its cache first; every leased
  consumer performs one `stream-signal` reconciliation.
- A reconnect may reuse retained data without fetching only when the server
  replays from the client's resume token. A RESET means continuity is unproven
  (including token-less subscriptions with retained data): it advances a
  declared signal clock and causes one `stream-signal` reconciliation, and is
  never accepted as a bare acknowledgement while retained data stays visible.
- Replacing one cluster's stream manager re-establishes only that cluster's
  subscriptions, and the new tail follows the same replay-or-reset rule.
  Overflow and replacement mechanics:
  [refresh-system.md](refresh-system.md#backend-subscription-lifetime).

## Metrics

Payload shape and presentation: [resource-metrics.md](resource-metrics.md).

- The backend poller owns cadence and runs only for clusters with an active
  metric-bearing consumer.
- A successful sample advances the `metric` clock and rings every subscribed
  metric doorbell. A failed attempt advances only `namespace-metrics`, which
  owns namespace utilization lifecycle/error state; it rings no sample-bearing
  pod, workload, node, or overview doorbell and never invents an object change.
- The active cluster leases `namespace-metrics`; inactive cluster tabs do not.
  Global Namespaces leases it for each cluster whose rows are displayed and
  releases those leases on exit.
- Frontend metrics-demand changes are sent in order. A transient failure
  retries with bounded backoff while the desired cluster set is unchanged; a
  newer set is reconciled after the in-flight request.
- Client timers may change presentation from fresh to stale but never fetch
  merely to advance staleness or relative age text.

## Errors and readiness

- Retained data stays visible through refresh and transient failure with the
  refresh/error state attached; never replace it with an empty payload.
- Retries are per scope. A failed read keeps that scope pending and its next
  poll retries after a backoff (immediate, then 1 s doubling to 60 s); a failed
  stream start retries on its own timer (1 s doubling to 30 s). One scope's
  failures never delay another's reads. A poll that outlives its contract
  timeout is a failed read (`TimeoutError`) and backs off like any other; a
  read its owner cancels (release, kubeconfig or selection change, view reset,
  foreground activation) records nothing.
- Foreground activation is a per-cluster dispatch boundary. Beginning it stops
  that cluster's streams and aborts its in-flight snapshots before the backend
  replaces or re-warms producers. Visible leased work is replayed afterwards
  with its original `user` or `stream-signal` intent; passive background work
  is dropped. Releasing the boundary restarts retained stream-only leases,
  which have no snapshot request to queue.
- After foreground governor reconciliation the backend returns the current
  authoritative cluster-workspace snapshot even without a lifecycle transition.
  The workspace store applies it to React selectors and the refresh-readiness
  boundary so a missed event cannot leave the tab behind the serving gate.
  Runtime lifecycle events that arrive before hydration win over that older
  snapshot.
- A typed permission denial is settled until manual refresh or a
  cluster-scoped auth, namespace-scope, or permission recovery resets its epoch.
- Error notifications are deduplicated by full refresh scope. Reselecting a
  retained failing scope does not re-notify; leaving the error state clears
  that scope's dedupe.
- Closing/removing a cluster tears down its leases, streams, jobs, and retained
  state. Switching tabs does not.

## Change checklist

### Required evidence for resource-source changes

Adding a resource collection or table, changing its source, or changing watch,
cache, or signal wiring needs freshness evidence even when the visible table
and transport are unchanged:

- Trace a Kubernetes change through the authoritative state owner,
  snapshot/cache invalidation, declared signal, and consuming table adapter,
  using production registrations and bindings. A test that hand-connects a
  replacement source cannot prove production wiring.
- With the view open and a healthy stream, on a small collection below any
  watch-promotion threshold, exercise create, update, and completed deletion.
  Assert changed rows and affected counts/facets before periodic resync can
  run, without manual refresh, navigation, or an optimistic action result.
  External cluster mutations must converge through the same path.
- Distinguish deletion requested from deletion completed when finalizers
  apply. Exercise startup/reconnect races and scope isolation; retained or
  unauthorized data must not become authoritative absence.
- Show the regression test fails with the connection removed (before the fix,
  or in an isolated test build) and passes with it restored.

Record which seams automated tests cover and which need native interaction
evidence: a hook harness does not establish the view's binding, and a healthy
stream does not establish source coverage.

### Seam checks

Test each affected rule above at the producer/consumer seam rather than per
side. Commonly missed cases: an inactive retained scope creating demand; a
successful replay adding a snapshot request; a stream-manager replacement
touching other clusters; the activation boundary converting passive work into
queued demand; every open cluster unavailable at once; activation replaying
unchanged lifecycle state to both frontend consumer paths (React selectors and
refresh readiness); and Cold preparation under sustained memory pressure
re-driving until a settled mmap transition or the full-teardown fallback.
