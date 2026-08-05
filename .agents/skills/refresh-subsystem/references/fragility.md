# Refresh Fragility Reference

Load only the sections named by the task.

## Contents

- Permission, scope, and teardown
- Metrics and signal clocks
- Doorbell snapshot ordering
- Governor and retained-state lifecycle
- Stream synchronization and consumers
- Debugging

## Permission, scope, and teardown

1. Permission preflight precedes ordered registration; permission and discovery
   failures retain distinct diagnostics.
2. Aggregate handlers update through the per-cluster mux. Refresh domains never
   accept multi-cluster scopes.
3. Failed stream resume, including token-less subscriptions with retained data,
   falls back to a full snapshot unless a server RESET advances a declared
   signal clock.
4. Rapid context changes preserve abort-then-retrigger ordering.
5. Cancel informer contexts before `Shutdown()` clears references.
6. Every teardown, cooling, replacement, and stop path calls
   `StopDoorbellNotifiers()`.

## Metrics and signal clocks

1. Successful metric samples broadcast every metric-clock domain. Failed
   attempts still target namespace metrics so collecting/previous-health state
   can advance without refetching sample-bearing domains.
2. The chain is collection observer → broadcast → contract source clock →
   frontend signal version → refetch. Staleness of retained samples is a
   separate client timer based on collection time plus stale threshold.
3. A domain joining another store folds that store revision into its watermark
   (for example nodes with pods and workloads with pods), or joined updates can
   receive an incorrect 304.
4. Metric-only changes ride the metric clock and do not re-project or re-store
   base object rows.

## Doorbell snapshot ordering

These rules apply to namespaces, namespace metrics, object events, cluster
overview, and any new doorbell-backed snapshot domain:

1. Invalidate snapshot cache before broadcast; otherwise the refetch can land
   inside cache TTL and reapply the previous payload.
2. Signal refetches carry `reason: 'stream-signal'` so stream-health polling
   gates do not swallow them.
3. Refetch identity uses `signalVersions`, not payload-rewritten source versions.
   Preserve a first-signal sentinel so an empty previous value cannot swallow
   the first ring.
4. Colliding signals latch one trailing `rerunStreamSignal` in
   `frontend/src/core/refresh/orchestrator.ts`; do not drop them or repeatedly
   abort-and-replace.
5. Namespace readiness is server-owned. Pre-ready doorbells invoke the
   subsystem readiness build from the per-cluster chokepoint; post-settle notify
   is one-shot, aggregate refresh is atomic, and permission-denied builds still
   notify ready. `sweepNamespacesReadiness` in `backend/app_refresh_setup.go`
   repairs rings missed before aggregate wiring exists.
6. Skip informer resync echoes through `namespaceUpdateIsEcho` in
   `backend/refresh/snapshot/namespaces.go`.
7. Derive stream health from descriptor metadata rather than hardcoded domain
   lists; the frontend calculation lives at `computeSubscriptionHealth` in
   `frontend/src/core/refresh/streaming/resourceStreamManager.ts`.
8. Conditional producers set `pollingContinuesWhileStreaming`. When enabling a
   snapshot stream, audit enable calls for `preserveState: true` so remounts do
   not blank retained rows.

## Governor and retained-state lifecycle

1. Re-warm through the construction chokepoint must not demote a ready cluster;
   `transitionClusterToLoading` in `backend/app_refresh_setup.go` owns that gate.
2. Governor reconciliation publishes desired/planned tier before executor work,
   serializes executor actions, and publishes applied tier only after reaching
   it. Planned and applied maps encode different ordering contracts.
3. Cold clusters do not start object catalogs. `startObjectCatalogForTarget` in
   `backend/app_object_catalog.go` gates on the serialized planned tier; re-warm
   publishes a live plan before building and does not report the tier reached
   until the catalog exists.
4. Foreground activation replays current lifecycle truth after serialized
   reconciliation even when state is unchanged. The Wails relay reaches React
   state and event-bus readiness consumers.
5. Retained-data reads key from selected cluster identity. Lifecycle gates
   requests, signals, and leases—not the read key or already rendered rows.
   Temporary ineligibility disables scopes with `preserveState: true`; actual
   cluster removal clears them.
6. Enter Cold only after server-owned namespace readiness and the exact
   per-cluster cluster-overview baseline exist. Use both aggregate readiness and
   the current subsystem generation's namespace readiness. Preparation belongs
   to that generation and replacement/teardown cancels it.
7. Under sustained memory pressure after the preparation grace, re-drive
   reconciliation on each over-budget sample and use normal teardown. Do not
   serve an unsettled retained baseline.

## Stream synchronization and consumers

Stream health means connected plus server-confirmed synchronized, not recent
delivery. `markSubscriptionSynchronized` in
`frontend/src/core/refresh/streaming/resourceStreamManager.ts` runs only after
the mux confirms subscribe; `computeSubscriptionHealth` derives the result. A
token-less RESET confirms a retained tail only when it advances a declared
signal clock; marking health on send can suppress polling for a rejected domain.

Consumers of a stream scope use `useStreamSignalRefetch` or query-table
`liveDataVersion`. Permission-denied scopes retry only on manual refresh during
the session; restart/recovery rebuilds them.

## Debugging

- Pair backend doorbell broadcast logs with frontend receipt/signal logs. When
  both occur but UI data does not move, inspect invalidation ordering first.
- Verify DTO and cache claims using a real snapshot payload when the app is
  reachable.
- Capture the documented goroutine dump before changing locks in an ingest,
  catalog, or refresh wedge. Treat `IngestManager.mu` as a leaf lock; sink
  delivery occurs under the store write lock.
