# Plan: Notify-only resource streams for query-backed domains

## Problem

Query-backed resource tables (all-namespaces **pods**, **namespace-workloads**,
cluster **nodes**) render a server-paginated, server-sorted page fetched over
HTTP. They keep a **live resource-stream subscription open only to learn _when_
to refetch** — they consume `liveDomainVersion` (`version:checksum:streamRevision`)
and never read the streamed rows.

Yet the live subscription still:

1. **Ships the full row set over the Wails bridge** (initial baseline snapshot +
   every per-object `ADDED`/`MODIFIED` delta carries the full projected row).
2. **Retains the full row set** in the scoped domain store.
3. **Re-merges and full-array re-sorts** that set on every 150 ms coalesced
   flush (`applyResourceRowUpdates` → `collection.sortRows`).

On a large cluster (tens of thousands of pods) this is the dominant frontend
load + steady-state cost, and **no consumer needs the rows in sorted order** —
verified: every live-row consumer is a count or an order-independent scan, and
all table rendering is query-backed.

## Goal

For domains that are *only* consumed query-backed, run the live subscription in
**notify-only** mode:

- Backend **skips the row projection and omits `Row`** from stream messages —
  rows stop crossing the bridge and the O(N) per-event projection is skipped.
  `Ref` + `Sequence` + `ResourceVersion` are still sent (they are built
  independent of the row, and `Row` is already `omitempty`; `DELETED` already
  ships row-less today).
- Frontend routes the flush to a **`streamRevision`-only apply** — no row
  retention, no sort — while still feeding drift detection from `ref`
  (`buildUpdateKey` reads only `update.ref`, never `update.row`).

## Why this is safe (verified contracts)

- **No table renders these domains' live rows.** pods/workloads/nodes tables all
  render `source.rows` from `useQueryBacked*ResourceGridTable`.
- **No consumer needs sorted live rows.** All live-row uses are counts/scans:
  - `NsViewPods` unhealthy count (`NsViewPods.tsx:469`) — count only.
  - `NsViewPods` stored-filter restore validation (`NsViewPods.tsx:578`) —
    order-independent scan, single-namespace only.
  - `NsResourcesContext` permission-target scan (`NsResourcesContext.tsx:915`) —
    extracts distinct `(clusterId, namespace)` pairs across domains.
  - `ClusterResourcesContext` startup gate (`ClusterResourcesContext.tsx:712`) —
    `nodes.data !== null` nullity check only.
- **Metrics are unaffected.** Per-row `cpuUsage`/`memUsage` come from the **query
  payload** rows (`BuildStreamSummaryFromRSMap`, `pods.go:138/152`), which the
  query build runs too — not from the live-stream merge. Notify-only preserves
  the existing refetch triggers, so metric freshness is unchanged.
- **Drift detection survives.** Shadow keys (`applyShadowUpdates`) key off
  `update.ref`; snapshot keys come from the HTTP snapshot fetch. Both work with
  a row-less stream as long as `ref` is still sent on every event.

## Mechanism

`notify-only` is a **two-sided** behavior (unlike frontend-only
`complete-resync-stream`):

- **Contract (source of truth):** add a `notifyOnly: true` marker to the
  relevant entries in `backend/refresh/domain/refresh-domain-contract.json`
  `domainInventory`.
- **Frontend (runtime):** read it (mirror `COMPLETE_RESYNC_STREAM_DOMAINS` in
  `resourceStreamDomains.ts:984`) into a `NOTIFY_ONLY_STREAM_DOMAINS` set; in
  `resourceStreamManager.flushUpdates`, route notify-only domains to a
  `streamRevision`-only store write (still call `applyShadowUpdates`).
- **Backend (runtime):** a Go-side declaration of notify-only domains drives the
  projection skip at the stream chokepoints
  (`streamObjectRowFromDescriptor` and the bespoke `derived_rows.go` handlers:
  `podStreamRow`, `BuildWorkloadSummary`, `BuildNodeSummary`); `newObjectRowUpdate`
  leaves `Row` nil. `parity_test.go` asserts the Go set == the contract's
  `notifyOnly` domains.

Per-domain (not per-subscriber) keeps it simple: a domain may go notify-only
only once **all** its consumers are migrated off live rows, so there is no
mixed-consumer conflict and no `ClientMessage`/subscription-key change.

### Two stages: deltas vs baseline (a verified gating dependency)

The live row payload arrives in two ways, and they decouple cleanly:

- **Deltas** — per-object `ADDED`/`MODIFIED` over the WebSocket, built through the
  single chokepoint `Manager.newObjectRowUpdate` (`update_helpers.go:54`). On a
  churning large cluster this is the high-frequency, high-volume cost (plus the
  per-flush re-sort). Making deltas row-less is a single backend gate +
  frontend flush route — **and is independent of gating**.
- **Baseline** — a separate full-row **HTTP snapshot fetch**
  (`fetchSnapshotForSubscription`), done once on subscribe. The query view's
  `queryEnabled` waits on `!isLiveDomainInitialLoadPending`, which is
  `!state.data && status∈{loading,initialising}` — i.e. it depends on the
  baseline populating `state.data`. **Skipping the baseline naively would wedge
  the query disabled.** Eliminating the baseline transfer therefore needs the
  gate settled another way (a version/count-only baseline, or a stream
  baseline-complete signal) and is split into its own slice.

So slice 1 makes **deltas** notify-only (keeps the baseline fetch, gating
intact); a later slice removes the **baseline** full-row transfer. For domains
with no live consumer (workloads), stale baseline `data` is harmless — nothing
reads it.

Slice 1 omits `Row` at the `newObjectRowUpdate` chokepoint (stops rows crossing
the bridge — the stated goal).

### Discovered (2026-06-19 probe): the reactive re-projection subsystem

A throwaway probe wired the chokepoint gate + a `notifyOnly` contract flag +
parity test and flipped `namespace-workloads`. The mechanism worked, but flipping
the domain broke **5 existing stream tests** and surfaced the real per-domain
cost: `pods`, `nodes`, and `namespace-workloads` each carry a **reactive
per-event re-projection subsystem** — an HPA or pod change re-streams the
*owning* workload/node with a freshly **built** `WorkloadSummary`/`NodeSummary`
(`handleHPA`, `handleHPAEvent`, `handleWorkloadFromPod`, `handleNode` →
`BuildWorkloadSummary`/`BuildNodeSummary`, with `podsForWorkload`/`podsForNode`
lookups).

For a query-backed table this projection is **redundant** — the refetch
triggered by the `streamRevision` bump rebuilds rows fresh from the snapshot/query
builder. So notify-only is a genuine simplification, but the *clean* flip is
bigger than dropping `Row` at the chokepoint:

- **Keep the reactive RESOLUTION** (which object the change affects, and its
  scope) — the notification must still fire on the right scope or the table goes
  **stale** on HPA/pod changes. This is the staleness-bug risk.
- **Skip only the row BUILD** (`BuildWorkloadSummary` etc. + its pod lookups) —
  otherwise the chokepoint leaves compute-then-discard dead work (tech debt).
- **Rewrite the ~5 stream tests** to assert *the right object is notified on the
  right scope, `Row` nil* instead of asserting row content. Projection-content
  coverage is **safe to drop here** — `HPAManaged`/`BuildWorkloadSummary` is
  independently covered in the snapshot path (`namespace_workloads_test.go`,
  `streaming_helpers_test.go`, `parity_test.go`). VERIFIED.

Net: the chokepoint diff is trivial; the per-domain flip is reactive-handler
surgery. The probe was reverted (tree green); slice 1 below is rescoped to
include the projection-skip + test rewrites.

## Slices (tracer-bullet vertical; each independently shippable + gate-green)

- [x] **Slice 1 — Delta notify-only, end-to-end, on `namespace-workloads`**
  (zero live consumers; the safe first target). Scoped to the chokepoint +
  frontend — the row-build skip is split out to Slice 1b (it cascades into
  removing now-dead helpers and is a backend-CPU concern, not needed for the
  bridge/frontend goal).
  - ✅ Contract `notifyOnly: true` for `namespace-workloads` + Go-side
    `notifyOnlyStreamDomains` set + `notify_only_parity_test.go`.
  - ✅ Backend: omit `Row` at the `newObjectRowUpdate` chokepoint; keep
    `Ref`/`Sequence`/`ResourceVersion`. Workload handlers unchanged (still build
    the row; it is dropped at the chokepoint — Slice 1b removes that build).
    Baseline HTTP snapshot unchanged.
  - ☐ Frontend: `NOTIFY_ONLY_STREAM_DOMAINS`; `flushUpdates` streamRevision-only
    path; shadow/drift still fed from `ref`.
  - ✅ Backend tests: chokepoint omits `Row` for notify-only add/modify; 5
    workload stream tests rewritten to assert *right workload notified on right
    scope, `Row` nil* (identity via `Ref`, not row content — row-content/HPA
    coverage stays in the snapshot path). ☐ Frontend tests + coexistence.
- [x] **Slice 1b — Remove the redundant reactive workload projection.** ✅ Done:
  the 5 workload handlers now resolve + notify via `broadcastWorkloadNotification`
  (no build); `handleWorkloadFromHPA` simplified; dead `podsForWorkload`,
  `hpasForWorkloadContext`, `listHPAs`, the `hpaLister` field/assignment, and the
  stale lister-gating test removed. Behavior unchanged (Slice-1 tests stay green).
  Original scope: With
  workloads notify-only, the stream handlers build a `WorkloadSummary` that the
  chokepoint discards. Remove the build from `handleWorkload`,
  `handleWorkloadFromPod`, `handleStandalonePodWorkload`, `broadcastWorkloadRow`,
  `broadcastStandalonePodWorkloadRow` (keep resolution + scope), simplify
  `handleWorkloadFromHPA`, and bottom-up remove the then-dead `podsForWorkload`
  and `hpasForWorkloadContext` (+ their tests). Pure backend-CPU cleanup; no
  contract/frontend change.
- [x] **Slice 2 — Baseline elimination. ✅ DONE + gate-green.** Notify-only
  domains now resync by bumping `streamRevision` + re-arming the stream instead
  of fetching a full-row snapshot (`resourceStreamManager.resyncSubscription`),
  and `status→'ready'` clears the query gate — so the table fetches page 1
  **without waiting for the full-row baseline**. This removes one of the two
  sequential O(all-objects) projections from the view-open critical path (the
  baseline used to gate the query, then the query built its page; now just the
  query). ~6 lifecycle tests migrated to `namespace-config` (non-notify) to keep
  testing resync→fetch; the pods stale-RV test now asserts the notify-only
  no-fetch behavior. **This is where the notify-only conversion pays off on load
  time** — it was the prerequisite that made the baseline safely skippable.

  Original scope: Give
  notify-only domains a resync that bumps `streamRevision` + re-arms the delta
  stream instead of fetching a full-row snapshot, so the one-time-per-view
  baseline stops crossing the bridge. Slice 6 (done) already removed the
  permission scan's dependency on the live rows, so the data going null is safe.
  - Production change is small + contained: one notify-only branch in
    `resourceStreamManager.resyncSubscription` (status→'ready' clears the query
    gate; `applyShadowUpdates` already no-ops without a baseline, so drift is
    safe). Prototyped and works.
  - **Cost is the test cascade, not the prod code:** ~7 lifecycle tests
    (resync/reset/reconnect/visibility/complete-error) plus the RV/sequence
    tests currently exercise resync→fetch using notify-only domains
    (`namespace-workloads`/`pods`); they must move to a non-notify domain
    (`namespace-config`), which re-introduces the collection-merge subtleties
    seen with `cluster-rbac` (RV-aware merge dropping a regressed row). Done as a
    focused pass to keep the lifecycle coverage correct.
  - Value is **initial-load only** (one full-row fetch per view-open); the
    dominant *continuous*-stream cost is already eliminated by the slices above.
- [x] **Slice 3 — Extend to `nodes`.** ✅ Done: `nodes` flagged notify-only
  (contract + Go set + parity); node handlers (`handleNode`, `handleNodeFromPod`)
  resolve + notify via `broadcastNodeNotification`; dead `podsForNode`, `listPods`,
  `nodeMetricsSnapshot`, the pod-by-node `podIndexer`/`podNodeIndexName`/
  `convertPodIndexerItems` removed. No `ClusterResourcesContext` gate change needed
  — `nodes` is in `QUERY_BACKED_CLUSTER_VIEWS`, so the startup gate early-returns.
  Frontend NOTIFY_ONLY auto-includes nodes (contract-driven); 5 generic stream
  tests that used `nodes` moved to `cluster-rbac`/`pods` (non-notify). Gate-green.

  NOTE (interim, low severity): the `NsResourcesContext` all-namespaces permission
  scan (`NsResourcesContext.tsx:884-928`) reads `workloads.data`/`nodes` live rows,
  now static at baseline under notify-only. Effect: namespaces created *after*
  view-open may miss permission pre-fetch (on-demand checks still cover them).
  Slice 6 resolves this for all notify-only domains and MUST land before Slice 7
  (pods churn far more, so the staleness would matter).
- [ ] **Slice 4 — Pods count metadata (backend).** Emit `totalCount` +
  `unhealthyCount` on `PodSnapshotPayload` meta (cheap: the query build already
  iterates all pods). TDD on the builder.
- [x] **Slice 4 — Pods count metadata (backend).** ✅ `PodSnapshot.TotalCount` +
  `HealthCounts` (per `health` mode), computed via the shared `podSummaryUnhealthy`
  helper / query predicate during the existing build loop. Gate-green.
- [x] **Slice 5 — Pods count consumers (frontend).** ✅ `NsViewPods` unhealthy
  count + total badge read `queryPayload` meta (mirrored into state); backend
  `healthCounts` added to `PodSnapshotPayload`. Gate-green.
- [x] **Slice 7 — Flip `pods` notify-only + remove `data` plumbing.** ✅ `pods`
  flagged notify-only (contract + set + parity); pod stream tests assert
  notify-only; the filter-restore guard reads `queryPayload.healthCounts` (not
  live rows); the `data` prop removed from `NsViewPods` and its chain
  (`AllNamespacesView`, `NsResourcesViews`, `NsResourcesManager`). Gate-green.
  - **Slice 7c (pod stream build-skip) — NOT pursued.** Unlike workloads/nodes
    (build produced only a row; scope was trivial), the pod build computes the
    broadcast multi-scope (namespace/node/**owner via RS→Deployment**), so it is
    load-bearing. The chokepoint already drops the `Row` (the bridge goal); a
    build-skip would need a parallel scope-field resolver with real divergence
    risk for only a modest per-event CPU saving. Determined out of scope.
- [ ] **Slice 6 — Permission-target source.** Replace the `NsResourcesContext`
  full-row `(clusterId, namespace)` scan with per-view query-row collection (the
  `NsViewPods` pattern) so it no longer reads retained rows. **Lower priority
  than the plan first assumed**: `NsViewPods` already scans its query rows for
  pod permission targets, so visible pods get fresh pre-checks; the context
  scan's staleness (baseline-only for notify-only domains) is a low-severity
  pre-fetch miss covered by on-demand checks. Required before Slice 2.

## Finding #2 — the O(all-objects)-per-page build (separate, larger effort)

The original load-speed analysis flagged that each table page request projects
**all** objects in scope (e.g. every pod) to produce one 50-row page, and that
every sort/filter/page re-does it. After tracing the collector
(`typed_table_query.go`), the conclusion is:

- **It can't be fixed with a cache** for the target case — on a busy large
  cluster the scope's data version changes constantly, so a per-version
  projection cache is invalidated before it's reused.
- **It can't be made O(page) by lazy projection** — returning a correctly
  *sorted + filtered + faceted* page over N objects inherently requires
  examining all N (you can't find the top-50-by-field, the match count, or the
  present namespaces/kinds without touching every object). The collector already
  does this efficiently (rejects out-of-window rows in O(1)).
- **The real fix is a pre-built incremental index/store** maintained on informer
  events, so a page query reads pre-sorted/pre-indexed state instead of
  re-scanning N. This is the "SQLite/index decision point" called out in
  `docs/architecture` / `large-data.md`. It is a **major architecture project**,
  and its payoff should be **measured first** (the existing `BuildDurationMs` /
  `TimeToFirstRowMs` telemetry, against a real large cluster) before committing —
  not guessed and built.

Slice 2 above already removes one of the two O(N) scans from view-open; this
index work is the way to attack the remaining one and all sort/filter/page
latency, as a deliberate, measured follow-up.

### Finding #2 — DONE for pods (the dominant view): projection memo cache

`pods.go` now memoizes projected rows (`podProjectionCache`, keyed by pod UID,
validated on `resourceVersion` + the metrics revision, TTL-pruned). The frequent
refetches a busy cluster drives — which used to re-project **every** pod each
request — now reuse cached summaries for unchanged pods; only changed pods (new
RV) or a metrics poll re-project. Cold first-open still projects all (inherent —
a correct sorted/filtered/faceted page must examine every object), but the
steady-state refetch cost drops from O(all pods) to O(changed pods). Gate-green;
proven by a test asserting two identical builds project each pod once, not twice.

**Measured (BenchmarkPodBuilderBuild, 10k synthetic pods):** cold full build
~21 ms/op; warm (cache reuse) ~10.7 ms/op — the memo cache ~halves it
(validated, not guessed). Crucially, the absolute build cost is **tens of
milliseconds, not seconds** (~100 ms even at 50k pods), so the backend
projection is **not** the dominant "load feels slow" cost — the initial informer
LIST / cluster connect / network (k8s-side) is. That evidence is why the large
incremental-index project below is **not** worth building: it would shave tens
of ms off a path that isn't the bottleneck. Slice 2 (removing one full build
from view-open) + this memo cache are the load-time changes the evidence
supports; further backend indexing has diminishing returns until measured
against a real large cluster's `BuildDurationMs`.

**Why pods only:** a pod's summary is self-contained — it depends on the pod, its
*immutable* RS→Deployment owner, and metrics — so (RV, metricsRev) fully key it.
Workloads and nodes summaries **aggregate other objects** (a workload row
reflects its pods; a node row reflects its pods), so they change without the
entity's own RV changing; keying on own-RV there would serve stale data. The
memo cache is therefore correct for pods (and would extend to events, whose rows
are self-contained) but **not** to the aggregate domains — those need the
incremental-index approach above.

## Out of scope

- Backend O(N)-per-page typed-table builds (separate "projected index" item).
- Per-subscriber notify-only / `ClientMessage` mode flag (not needed once
  notify-only is per-domain).

## Validation

`mage qc:prerelease` after each slice; the slice's regression tests must prove
the behavior before review.
