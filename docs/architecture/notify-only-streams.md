# Notify-only resource streams

Some resource tables — all-namespaces **pods**, **namespace-workloads**, and
cluster **nodes** — render a server-paginated, server-sorted page fetched over
HTTP (query-backed). They keep a live resource-stream subscription open **only to
learn _when_ to refetch**: they consume `liveDomainVersion`
(`version:checksum:streamRevision`) and never read the streamed rows.

A normal live subscription still ships, retains, and re-sorts the full row set on
every change. For a domain that never renders those rows, that is pure waste.
**Notify-only** mode removes it: the subscription delivers only the change
*signal*, not the rows.

## What notify-only changes

- **Backend** omits `Row` from stream messages at the
  `Manager.newObjectRowUpdate` chokepoint (`update_helpers.go:54`). `Ref`,
  `Sequence`, and `ResourceVersion` are still sent (they are built independent of
  the row, and `Row` is already `omitempty`). For pods/workloads/nodes the
  per-event reactive **re-projection** (`BuildWorkloadSummary` / `BuildNodeSummary`
  and their pod lookups) is also dropped — the handlers still *resolve* which
  object changed and on what scope (so the notification fires correctly), they
  just no longer *build* a row the chokepoint would discard.
- **Frontend** routes the flush to a `streamRevision`-only apply
  (`resourceStreamManager.flushUpdates`, `resourceStreamManager.ts:742`): it bumps
  `streamRevision` (the refetch trigger) and **never** runs the
  retain/merge/sort row path (`applyRowUpdates` → `applyResourceRowUpdates`). Drift
  detection still runs — `applyShadowUpdates` keys off `ref`, not `row`.

The retained-row path that notify-only skips
(`resourceStreamRows.ts:152-190`) rebuilds an N-entry `Map` of every retained row
and runs a full `O(N log N)` sort on **every** coalesced flush
(`UPDATE_COALESCE_MS = 150`, `resourceStreamManager.ts:57`), where N is every
object in scope.

## How a domain becomes notify-only (two-sided contract)

It is a per-**domain** behavior (not per-subscriber), so a domain may go
notify-only only once **all** its consumers are migrated off live rows.

1. **Source of truth:** `"notifyOnly": true` on the domain entry in
   `backend/refresh/domain/refresh-domain-contract.json` (pods, namespace-workloads,
   nodes today).
2. **Backend runtime:** the Go set `notifyOnlyStreamDomains`
   (`backend/refresh/resourcestream/notify_only.go:23`) drives the projection
   skip. `TestNotifyOnlyStreamDomainsMatchContract`
   (`notify_only_parity_test.go:16`) asserts the Go set equals the contract's
   `notifyOnly` domains.
3. **Frontend runtime:** `NOTIFY_ONLY_STREAM_DOMAINS`
   (`resourceStreamDomains.ts:999`) is derived from the same contract and gates
   the flush route.

Regression coverage: `TestManagerNewObjectRowUpdateOmitsRowsForNotifyOnlyDomains`
(`update_helpers_test.go:100`) and `TestManagerWorkloadEventBroadcastsNotifyOnly`
(`manager_test.go:922`).

## Consumers that used to read the live rows

A domain can only flip once nothing reads its rows. The migrations that made
pods/workloads/nodes eligible:

- **Counts** (pods total + unhealthy badge) come from the **query payload** meta
  (`PodSnapshot.TotalCount` / `HealthCounts`), not a live-row scan.
- **Permission pre-fetch:** the `NsResourcesContext` all-namespaces scan
  **excludes** notify-only domains' live rows (`NsResourcesContext.tsx` ~884,
  `pods: []`, `workloads: []`). Visible pods get fresh pre-checks from
  `NsViewPods`'s per-view query-row scan; the rest fall back to on-demand
  permission checks. (This is why the separately-tracked "permission-target
  source" rework was not needed — the staleness is covered by exclusion +
  on-demand checks.)
- **Startup gate:** `nodes` is in `QUERY_BACKED_CLUSTER_VIEWS`, so the
  `ClusterResourcesContext` startup gate early-returns instead of reading
  `nodes.data`.
- **Baseline:** notify-only domains resync by bumping `streamRevision` + re-arming
  the stream instead of fetching a full-row HTTP snapshot
  (`resourceStreamManager.resyncSubscription`); `status → 'ready'` clears the
  query gate, so the view fetches page 1 without waiting for a full-row baseline.

## What it costs / what it saves (measured)

The win is **frontend**, and it scales with cluster size × churn:

- **Per coalesced flush** (every 150 ms under churn): the merge+sort that
  notify-only skips measured **~4.7 ms at 10k rows and ~26 ms at 50k rows**
  (component microbenchmark of `applyResourceRowUpdates` with the real pods
  collection — _not_ an end-to-end webview/cluster measurement). Under continuous
  churn that is roughly 3% of one core at 10k and ~17% at 50k, on rows nothing
  renders.
- **Per event:** the full `Row` payload no longer crosses the Wails bridge.
- **At view-open:** one full-row baseline transfer is removed from the critical
  path.

The **backend build is not the bottleneck**: `BenchmarkPodBuilderBuildCold/Warm`
(`pods_test.go:348/368`) measured tens of ms even at large N (~100 ms at 50k
pods), dominated by the informer LIST / cluster connect / network, not the
projection. So the backend projection-skip is modest cleanup; the load-time win
is removing the view-open baseline, and the steady-state win is the per-flush
merge+sort.

For pods specifically, the per-page build also memoizes projected rows
(`podProjectionCache`, `pods.go:46`, keyed by pod UID + resourceVersion + metrics
revision), so steady-state refetches re-project only changed pods.

## Deliberately out of scope

- **A pre-built incremental index / SQLite store** for typed-table page builds.
  The evidence above shows the backend build is not the bottleneck, so this
  large project has diminishing returns until measured against a real large
  cluster's `BuildDurationMs`. See `large-data.md` for the broader index
  decision.
- **Skipping the pod row _build_** (vs just dropping `Row` at the chokepoint).
  Unlike workloads/nodes, the pod build computes the broadcast multi-scope
  (namespace / node / owner via RS→Deployment), so it is load-bearing; a parallel
  scope resolver would add divergence risk for a modest CPU saving.
- **Per-subscriber notify-only / a `ClientMessage` mode flag** — unnecessary once
  notify-only is per-domain.
