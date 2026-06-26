# Luxury Yacht v2 — Remaining Work (finish the simplification)

Status: **Not started.** This is the forward "what's left" plan for the v2 data
layer. The shipped architecture — what was built and the deliberately-dropped
decisions — is documented in
[`../architecture/data-layer.md`](../architecture/data-layer.md); this plan covers
the remaining simplification (liveness + ordering).

## Where we are (verified 2026-06-25, branch `arch-rewrite`)

The "one of each" goal **landed on the data-shape axes** and **did not land on the
data-time axis**:

- ✅ **One store** (columnar `querypage`, no cgo/SQLite), **one Query→Page engine**
  (16 typed tables + Browse), **webview holds no N**, **WatchList ingestion +
  projection-at-intake**, **Fg/Bg/Cold governor + columnar spill + mmap Cold-serving**,
  **three table-row delivery models collapsed to one** (live-row-merge path deleted).
- ❌ **Liveness & ordering were not unified.** This is the single remaining axis of the
  multiplicity the redesign set out to remove.

The through-line of this plan: **finish the simplification on liveness/ordering — one
refetch signal, one scope clock — without resurrecting the complex positional-delta
machinery the team rightly skipped.**

### The remaining multiplicity (each verified this session)

1. **Four ordering authorities still coexist** where the goal was one:
   per-(domain,scope) sequence numbers (`resourcestream/manager.go:937`), per-object
   `resourceVersion`, frontend `liveDomainVersion`=`version:checksum:streamRevision`
   (`resourceStreamManager.ts`), and snapshot `Sequence` (`refresh/snapshot/service.go`).
2. **Three liveness transports tell views "refetch"** where the goal was one channel:
   the resources WebSocket `/api/v2/stream/resources` (`resourcestream`), the events
   SSE `/api/v2/stream/events` (`eventstream`), and the catalog SSE
   `/api/v2/stream/catalog` (`catalog_stream`) — registered at
   `refresh/system/streams.go`.
3. **Metrics are only half-decoupled.** The store is metrics-free and overlays at serve,
   but `snapshotVersionWithDynamicRevision` (`snapshot/table_window.go:19`, folded in by
   `pods.go:354`, `nodes.go:401`, `namespace_workloads.go:238`) still mixes the metrics
   revision into the published object version, so a periodic metrics poll bumps the object
   scope version and triggers a full object-row page refetch even on object-sorted views of
   those three domains where nothing changed.

### Out of scope on purpose (NOT "unfinished" — intentional design)

- **Detail / YAML** serve via a lazy direct client GET — the `object-details` domain
  (`object_details.go`) delegates to per-kind services (e.g. `deployment/details.go:44`),
  and YAML resolves via a dynamic-client GET (`object_yaml_by_gvk.go:103`) — correct
  (lazy full-object hydration, not a query).
- **Object-map / overview** are aggregations above the store
  (`object_map_assembler.go`, `cluster_overview.go`) — correct (graph/rollup, not a
  table query).
- **Logs / shell / exec / port-forward / permissions / metrics-poll** run on their own
  mechanisms — correct (live byte streams and access reviews are not object-state).

These share the store's *transport* (the snapshot endpoint) where it makes sense; they
should **not** be forced onto `querypage`.

---

## Phase A — One refetch signal (collapse the three liveness transports)

**Goal.** Replace the WS + 2×SSE "something changed, refetch" fan-out with a single
push channel. The pull stays the one `GET /api/v2/snapshots/{domain}` endpoint; the
push becomes one uniform **scope-changed doorbell** on the existing resources
WebSocket. Net delivery model: **page (HTTP) + doorbell (one WS)** — the realistic,
already-proven "one delivery model," minus the positional deltas that were dropped.

- **A1 [design].** Define one signal frame on the resources WS: `{domain, scope,
  version}` meaning "this query scope advanced to `version` — refetch if subscribed."
  This is what `streamRevision` already does internally; make it the only shape.
- **A2.** Fold the **events** tail onto it: the events table is already `querypage`-backed;
  convert `eventstream`'s live tail into the A1 doorbell and **delete the
  `/api/v2/stream/events` SSE transport + its frontend client**. (The per-object events
  panel keeps its own `object-events` snapshot domain.)
- **A3.** Fold the **catalog** stream onto it: convert `catalog_stream`'s push into the
  A1 doorbell for the `catalog` scope and **delete `/api/v2/stream/catalog` SSE + its
  client**. Browse keeps pulling pages from the query endpoint.
- **A4.** Frontend: one subscription manager consumes the unified doorbell for tables,
  events, and Browse; delete the two `EventSource` clients.

**Gate.** Per migration, an equivalence test that the same change still triggers the same
refetch; the deleted SSE transport is the simplification payoff. **Prerequisite for B3 and
C2.**

## Phase B — One scope clock (collapse the four ordering authorities)

**Goal.** Under refetch-on-signal there are no deltas to order, so this does **not** need a
full LSN delta-log (a from-scratch LSN rewrite was deliberately dropped). It needs **one monotonic
per-(cluster,domain,scope) version** that the snapshot endpoint stamps and the A1 doorbell
references, so cursor, ETag/304, resume, and refetch all key off **one number**.

- **B1 [design].** Pick the single authority — generalize the ingest source's per-GVR
  `StoreResourceVersion` (`pod_aggregate_source.go:34`, today used by the ingest-fed
  domains pods/network/workloads) into one monotonic per-(cluster,domain,scope) version
  that every domain's `Build` stamps as the snapshot `ETag`.
- **B2.** Collapse `liveDomainVersion`'s three components on the frontend to that one
  version + a real `304` path; delete the `checksum`/`streamRevision` triple.
- **B3.** Retire the per-(domain,scope) sequence numbers in `resourcestream`; the A1
  doorbell carries the unified version instead.
- **B4.** Keep per-object `resourceVersion` **only** as the apiserver's reflector resume
  token (inside `ingest`), never as an app-level ordering authority — document the boundary
  so it can't leak back out.

**Gate.** Cursor-stability + "no spurious refetch" tests; a `304` returns when the scope
version is unchanged.

## Phase C — Finish the metrics split (object/metric independence)

**Goal.** Object refetch only on object change; metric refresh on its own clock — the
object/metric split (see `../architecture/data-layer.md`, Invariant 4), completed.

- **C1.** Remove the metrics revision from `snapshotVersionWithDynamicRevision`
  (`table_window.go:19`) at its three callers (`pods.go:354`, `nodes.go:401`,
  `namespace_workloads.go:238`); the object scope version (Phase B) reflects object
  changes only.
- **C2.** Deliver metric freshness as a **separate** A1 doorbell keyed by a `metricsRevision`
  (metric-sorted views refetch on it; object-sorted views just get fresher overlaid numbers
  on their next object refetch or a low-rate metric tick — no full-page churn on a poll).
- **C3.** `metricsRevision` becomes the metric clock — "one clock **per source**" (object
  version + metric version), the one deliberate two-of-something.

**Gate.** Regression test: a metrics poll does **not** bump the object scope version and does
**not** refetch an object-sorted page.

## Phase D — Smaller cleanups & consistency (low priority, profile-driven)

- **D1.** Governor memory trigger: either adopt `GOMEMLIMIT`/`debug.SetMemoryLimit` as the
  architecture named, or **document the `runtime.ReadMemStats` HeapInuse-vs-budget poll as
  the accepted mechanism** (recommended — it works; the named one is not load-bearing).
- **D2.** Order-statistics (`Rank`/`At`) index — **leave dropped** unless a profiled view
  needs O(log N) rank answers; keyset pagination suffices today.
- **D3.** Metric index on `metricsRevision` — **leave dropped** unless metric-sorted large
  views profile slow (then it's a targeted add behind C2).
- **D4.** Doc/comment drift sweep as surfaces change.

---

## Explicitly NOT building (dropped with reason — do not re-attempt as TODOs)

- **The full positional window-delta WS protocol** (INSERT/MOVE/REMOVE/DOORBELL with
  fractional posKeys, CBOR framing, h2c, MessagePack/Web-Worker decode, object/metric
  sub-channels). **Refetch-on-signal is simpler and the bounded pages it refetches are
  small** (typed tables cap at 1000 rows, `typed_table_query.go:18`) — the large payloads
  that motivated deltas were already eliminated by projection + paging. Building this would **add** complexity against the simplification goal.
  Revisit only if profiling shows page-refetch wire/CPU is a real bottleneck.
- Forcing detail/YAML/object-map/overview onto `querypage` (see "Out of scope" above).

## Principles & sequencing

- **A before B/C** (the unified doorbell is the carrier for the unified version and the
  metric signal). B and C can then proceed together.
- Every step lands behind a **new==old equivalence gate** and leaves the app correct +
  simpler; gated by `mage qc:prerelease`.
- The goal is **subtraction** — fewer clocks, fewer push channels, fewer "ways to think
  about when data is fresh." If a step adds a mechanism, it is in the wrong plan.

## Value summary

| Phase | Removes | Simplification | Effort |
|---|---|---|---|
| A — one doorbell | 2 SSE transports + their clients | High (3 push paths → 1) | Medium |
| B — one scope clock | 3 of 4 ordering authorities | High (the core unmet goal) | Medium–High |
| C — metrics split | object↔metric version coupling | Medium (+ kills poll-driven object refetch) | Medium |
| D — cleanups | naming/mechanism drift | Low | Low |

**Recommended order: A → C → B → D.** A+C together remove the most day-to-day coupling
(poll-driven refetch, duplicate push channels) for moderate effort; B is the deeper clock
unification; D is opportunistic.
