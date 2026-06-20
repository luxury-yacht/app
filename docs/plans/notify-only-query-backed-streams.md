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
- [ ] **Slice 2 — Baseline elimination.** Settle the `queryEnabled` gate for
  notify-only domains without the full-row HTTP snapshot (version/count-only
  baseline or a stream baseline-complete signal), so the last full-row transfer
  is removed.
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
- [ ] **Slice 5 — Pods count consumers (frontend).** `NsViewPods` unhealthy
  count + stored-filter-restore validation read query meta instead of full live
  `data`.
- [ ] **Slice 6 — Permission-target source.** Replace the `NsResourcesContext`
  full-row `(clusterId, namespace)` scan with a lightweight `ref`-derived
  presence index (or per-view collection from query rows), so it no longer
  depends on retained rows.
- [ ] **Slice 7 — Flip `pods` notify-only + remove dead code.** Drop the now-
  vestigial `data` prop plumbing (`AllNamespacesView` → `NsViewPods`,
  `NsResourcesContext` pods row exposure) bottom-up.

## Out of scope

- Backend O(N)-per-page typed-table builds (separate "projected index" item).
- Per-subscriber notify-only / `ClientMessage` mode flag (not needed once
  notify-only is per-domain).

## Validation

`mage qc:prerelease` after each slice; the slice's regression tests must prove
the behavior before review.
