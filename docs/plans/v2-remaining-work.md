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
refetch signal, one object-state scope clock, and one explicit metric freshness clock
where metrics are the source — without resurrecting the complex positional-delta
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

- **A1 [design].** Define one signal envelope on the resources WS:
  `{clusterId, domain, scope, source, version, signal}`.
  - `clusterId` is required; resource-stream scopes remain single-cluster.
  - `domain` is the refresh domain; `scope` is the canonical transport scope for that
    domain.
  - `source` is `object`, `metric`, `catalog`, or `event`; it names the clock that
    advanced.
  - `version` is the source version after the change.
  - `signal` is `changed`, `reset`, or `error`. `changed` means "refetch if this
    source affects the current query"; `reset` means "resume was lost, re-snapshot";
    `error` feeds the same terminal-error/diagnostics path as current streams.

  The frame carries no rows, no positions, and no partial table payload. It is the
  formal version of what `streamRevision` already does internally: bump a live-data
  identity so a query-backed view refetches. The added fields formalize existing
  contracts instead of adding a second delivery model: `clusterId` is the routing
  identity, `source` names the producer clock that already changed, and `signal`
  preserves the existing changed/resync/error outcomes.
- **A2.** Fold the **events** tail onto it: the events table is already `querypage`-backed;
  convert `eventstream`'s live tail into the A1 doorbell and **delete the
  `/api/v2/stream/events` SSE transport + its frontend client**. (The per-object events
  panel keeps its own `object-events` snapshot domain.) Reconnect behavior must map
  missed/overflowed event resume to a `reset` signal, not to silent freshness loss.
  Deletion includes the per-cluster mux registration, the aggregate mux registration,
  the aggregate event-stream handler/buffer, and the frontend `EventSource` client.
- **A3.** Fold the **catalog** stream onto it: convert `catalog_stream`'s push into the
  A1 doorbell for the `catalog` scope and **delete `/api/v2/stream/catalog` SSE + its
  client**. Browse keeps pulling pages from the query endpoint. Catalog signals use
  `source=catalog` and must preserve the current single-cluster catalog scope boundary.
  Deletion includes the per-cluster mux registration, the aggregate mux registration,
  the aggregate catalog router, and the frontend `EventSource` client.
- **A4.** Frontend: one subscription manager consumes the unified doorbell for tables,
  events, and Browse; delete the two `EventSource` clients. The manager owns reconnect,
  visibility pause/resume, terminal-error notification, and diagnostics status for all
  doorbell sources; per-domain code decides whether `source=metric` affects the active
  query.

**Gate.** Per migration:

- same event append still refetches the events table;
- event resume overflow emits `reset` and forces re-snapshot;
- same catalog change still refetches Browse/catalog consumers;
- a signal for cluster A cannot refresh cluster B;
- a denied/unregistered domain does not create an active subscription and still reports
  diagnostics;
- frontend stream-health tests cover reconnect, visibility pause/resume, terminal error,
  and kubeconfig-change suppression through the unified manager.

The deleted SSE transports are the simplification payoff. **Prerequisite for B3 and C2.**

## Phase B — One object scope clock (quarantine non-object clocks)

**Goal.** Under refetch-on-signal there are no row deltas to order, so this does **not**
need a full LSN delta-log (a from-scratch LSN rewrite was deliberately dropped). It needs
**one object-state source version per `(clusterId, domain, scope)`** that the snapshot
endpoint stamps and the A1 doorbell references, so cursor, ETag/304, resume, and refetch
all key off one source-version contract.

- **B0 [design].** Define the source-version contract before code moves:
  - versions are opaque equality tokens at API boundaries, backed by a monotonic counter
    plus an app/store epoch so a process restart cannot reuse an old `304` token;
    the epoch is part of the HTTP validator identity, not a domain freshness clock;
  - each refresh domain declares the source clocks that can affect its rows:
    `object`, `metric`, `catalog`, or `event`;
  - object versions advance only when object-backed row membership, fields, sort keys,
    filters, or facts can change;
  - metric versions advance only when metric-backed values or metric sort keys can
    change;
  - composite domains own their domain/scope version explicitly; `StoreResourceVersion`
    can be an input, but no composite domain should expose a raw per-GVR RV as its
    public scope version;
  - snapshot `Sequence` remains an internal build/debug sequence until retired; it is
    not the cache/refetch token.
- **B1.** Implement the single authority from B0 — a domain/scope version source used by
  snapshot builders and the A1 doorbell. Ingest-fed domains can derive object changes
  from `StoreResourceVersion`; derived domains must bump their own domain/scope version
  when any object input can affect the projected rows.
- **B2.** Collapse `liveDomainVersion`'s three components on the frontend to the source
  version + a real `304` path; delete the `checksum`/`streamRevision` triple.
- **B3.** Retire the per-(domain,scope) sequence numbers in `resourcestream` after A1
  supplies `changed`/`reset` semantics; the A1 doorbell carries the source version
  instead.
- **B4.** Keep per-object `resourceVersion` **only** as the apiserver's reflector resume
  token (inside `ingest`), never as an app-level ordering authority — document the boundary
  so it can't leak back out.

**Gate.**

- unchanged object source version returns `304`;
- object source version changes when an object-backed row field/sort/filter input changes;
- metric-only polling does not change object source version;
- composite domains have tests proving all row-affecting object inputs bump the
  domain/scope version;
- epoch/restart behavior cannot return `304` for stale client tokens;
- cursor-stability and no-spurious-refetch tests pass with the source-version token.

## Phase C — Finish the metrics split (object/metric independence)

**Goal.** Object refetch only on object change; metric refresh on its own clock — the
object/metric split (see `../architecture/data-layer.md`, Invariant 4), completed.

- **C0 [design, after A].** Pin down the object-sorted metric freshness contract before
  implementation. Choose exactly one:
  - **No automatic metric refresh for object-sorted pages.** Object-sorted pages ignore
    `source=metric`; visible metric cells refresh on the next object refetch, manual
    refresh, or query reload.
  - **Throttled visible-row metric refresh.** Object-sorted pages subscribe to
    `source=metric` through an explicit throttle interval `N`; only visible metric
    overlays refresh, and object rows/pages do not refetch.
- **C1 [after C0, can precede B].** Classify query dependency on metrics in one place:
  metric-sorted or metric-filtered queries listen to `source=metric`; object-sorted queries
  follow the C0 policy.
- **C2 [after A, before or with B].** Remove the metrics revision from
  `snapshotVersionWithDynamicRevision` (`table_window.go:19`) at its three callers
  (`pods.go:354`, `nodes.go:401`, `namespace_workloads.go:238`) and deliver metric
  freshness as a **separate** A1 doorbell keyed by `metricsRevision`. Metric-dependent
  views refetch on it; object-only views do not churn on a poll.
- **C3 [after B0/B1].** `metricsRevision` becomes the metric source clock under the same
  source-version contract — "one clock **per source**" (object version + metric version),
  the one deliberate two-of-something.

**Gate.**

- a metrics poll does **not** bump the object source version;
- a metrics poll does **not** refetch an object-sorted page;
- a metrics poll **does** refetch a metric-sorted or metric-filtered page;
- if C0 chooses no automatic metric refresh, object-sorted metric cells change only after
  object refetch, manual refresh, or query reload;
- if C0 chooses throttled visible-row metric refresh, visible metric overlays refresh
  within the chosen interval `N` without object page refetch;
- disabled/unavailable metrics keep their current diagnostics distinction.

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

- **A first** (the unified doorbell is the carrier for the unified version and the metric
  signal).
- **C1/C2 may land before B** because they remove the poll-driven object refetch coupling
  using the A1 signal shape.
- **B before C3** because the final metric clock should use the same source-version contract
  as object state.
- Every step lands behind a **new==old equivalence gate** and leaves the app correct +
  simpler; gated by `mage qc:prerelease`.
- The goal is **subtraction** — fewer clocks, fewer push channels, fewer "ways to think
  about when data is fresh." If a step adds a mechanism, it is in the wrong plan.

## Value summary

| Phase | Removes | Simplification | Effort |
|---|---|---|---|
| A — one doorbell | 2 SSE transports + aggregate routers + their clients | High (3 push paths → 1) | Medium–High |
| B — one object scope clock | 3 of 4 object ordering authorities | High (the core unmet goal) | Medium–High |
| C — metrics split | object↔metric version coupling | Medium (+ kills poll-driven object refetch) | Medium |
| D — cleanups | naming/mechanism drift | Low | Low |

**Recommended order: A → C1/C2 → B → C3 → D.** A+C1/C2 together remove the most
day-to-day coupling (poll-driven refetch, duplicate push channels) for moderate effort;
B is the deeper object-clock unification; C3 folds metrics into that same contract; D is
opportunistic.
