---
name: refresh-subsystem
description: Guide for safely modifying the refresh/streaming subsystem — covers the full domain lifecycle, registration points, and known fragility areas
user-invocable: false
---

# Refresh Subsystem Guide

This subsystem is **fragile**. Changes historically break things. This skill is
the modification guide — chokepoints, invariants, and the pre-change checklist.
Architecture lives in the docs; read the one that owns your change first:

| Topic | Doc |
| --- | --- |
| Domain contract, scope rules, behavior classes, normalized query envelope | `docs/architecture/refresh-system.md` |
| Store, ingest, governor/lifecycle, spill/Cold-serving, delivery | `docs/architecture/data-layer.md` |
| Retained-first activation, stream signals, source clocks, polling fallback | `docs/architecture/data-freshness.md` |
| Serve-time metric join, metric doorbell, staleness/collecting states | `docs/architecture/resource-metrics.md` |
| Multi-cluster identity and scope rules | `docs/architecture/multi-cluster.md` |

## Initialization order (don't rearrange)

Per cluster: informer factory + permission checker → **preflight permission
warming** → domain registration (gate checks) → snapshot service/queues/streams
→ manager start → revalidation loop. Then the aggregate mux and the loopback
HTTP server. Key files: `backend/app_refresh_setup.go` (orchestration),
`app_refresh_update.go` (selection changes without server restart),
`app_refresh_subsystems.go` (subsystem swap/store), `app_refresh_recovery.go`
(teardown/auth recovery), `refresh/system/manager.go` (per-cluster build).

`buildRefreshSubsystemForSelection` is the **per-cluster chokepoint**: every
construction path (startup, selector-open, auth-recovery, governor re-warm)
passes through it. Per-cluster wiring (lifecycle transition, readiness
observer, response-cache invalidation) belongs there — never in a one-shot
loop at aggregate construction.

## Adding or changing a domain

**New table/list domains must be signal-covered** — change signals or a
doorbell, with polls as the stream-down fallback only (plain timer polling
needs a stated reason; conditional-producer doorbells set
`pollingContinuesWhileStreaming`). See `refresh-system.md` Behavior Classes.

Backend: add to `domainRegistrations()` in
`backend/refresh/system/registrations.go` — order matters (dependencies first).
Registration kinds: `direct` (no gate), `list` (list permission or skip),
`listWatch` (list+watch, optional list-only fallback, denial registers a
permission-denied domain). Declare needed permissions on the registration
config; the `permissionGate` (`permission_gate.go`) evaluates them after
preflight. Informers register in `backend/refresh/informer/factory.go`.

Shared metadata (category, refresher name, timing, orchestrator kind,
diagnostics stream, source clocks, stream participation) is authored once in
`backend/refresh/domain/refresh-domain-contract.json`; backend and frontend
contract tests lock both sides to it.

Frontend counterpart (all must stay synchronized through the contract tests):

| File | What to update |
| --- | --- |
| `backend/internal/genrefreshcontracts/registry.go` | Backend-owned DTOs and named enums; run `go generate ./backend` |
| `frontend/src/core/refresh/types.ts` | Frontend-owned reducer state only; never hand-edit `types.generated.ts` |
| `frontend/src/core/refresh/refresherTypes.ts` | Refresher name + view mapping |
| `frontend/src/core/refresh/domainRegistrations.ts` | Orchestrator/stream wiring |
| `refresh-domain-contract.json` | Shared metadata plus each domain's generated `refreshPayloadType` mapping |

Resource WebSocket (streamed table) domains additionally touch:

| File | What |
| --- | --- |
| `frontend/src/core/refresh/streaming/resourceStreamDomains.ts` | Scope kind, descriptor flags |
| `frontend/src/core/refresh/streaming/resourceStreamManager.ts` | Signal application |
| `backend/kind/kindregistry/registry.go` | `Stream` facet for the kind |
| `backend/refresh/resourcestream/projection_descriptors.go` | Projection + clocks + permissions |
| `backend/refresh/resourcestream/stream_registration_*.go` | Bespoke informer/lister handlers |

Backend stream registration split (keep it; don't collapse into one table):
`stream_descriptor_dispatch.go` (generic registry-driven kinds),
`stream_registration_helpers.go` (permissions + event mapping),
`_direct.go` (bespoke informers: configmap/secret/HPA), `_network.go`
(service/endpointslice correlation), `_related.go` (pod/node/workload related
lookups). Do not assign `Update.Row` in stream handlers — snapshot and stream
rows must come from the same canonical projection helpers. Identity crosses the
wire only as the top-level `ref`; never guess GVK from kind/name.

**Parity gates**: snapshot-vs-stream row parity
(`backend/refresh/snapshot/parity_test.go`) needs a case per streamed domain
(or an explicit exclusion); every new `*Summary` field needs a populate
assertion. Typed table payloads must embed the normalized query envelope
(enforced by `TestEveryTypedResourceDomainEmbedsTheNormalizedEnvelope`).

## Snapshot service rules

`backend/refresh/snapshot/service.go`: singleflight per cache key; truncated
and partial-batch snapshots are never cached; only final batches are. Doorbell
and resource-stream domains invalidate their cache in
`resourcestream.Manager.broadcast` before signal delivery (fragility point 9.1).

## Frontend scheduling in one paragraph

`RefreshManager.ts` runs refreshers `idle → refreshing → cooldown` with
exponential backoff (capped 60s); callbacks via `Promise.allSettled`; context
changes abort then issue a foreground (non-manual) reconciliation; global pause
blocks passive automatic work but not foreground or manual refresh; streams
suspend when the app document is hidden. The orchestrator
(`orchestrator.ts`) owns per-cluster runtimes: enabled scopes, in-flight
dedupe, stream health gating, metrics demand.

## Known fragility points

Each numbered item below broke in production at least once. Treat them as a
checklist when touching anything they name.

1. **Permission gate ordering** — preflight before registration; registration
   order fixed.
2. **Metrics polling disable reasons** — permissions vs discovery produce
   different UI messages; don't conflate.
3. **Multi-cluster add/remove** — aggregate handlers update via the update
   path, never merge clusters into one result.
4. **Single-cluster scopes** — refresh domains target exactly one cluster;
   fan out per-cluster, never pass multi-cluster scopes.
5. **Stream resume gaps** — failed resume must fall back to full re-snapshot or
   the UI silently shows stale rows. A token-less subscription with retained
   data has the same requirement: the server's RESET advances a declared
   signal clock; it is not only an acknowledgement.
6. **Rapid context changes** — abort→retrigger races when context updates beat
   abort completion.
7. **Informer shutdown** — cancellation stops informers; `Shutdown()` only
   clears references. Cancel first or leak.
8. **Metric doorbell chain** — poller collection observer
   (`system/manager.go`) → successful samples use `BroadcastMetricsRefresh` for
   every metric-clock domain; failed attempts use the targeted
   `BroadcastNamespaceMetricsRefresh` so namespace utilization leaves its
   loading/previous-health state without refetching sample-bearing domains →
   contract `metric` source clock → `signalVersions` advance → refetch.
   Severing any link silently freezes live usage between object events.
   Staleness for retained samples still rides OUTSIDE this chain (client-side
   timer at `collectedAt + staleAfterSeconds`). See
   `docs/architecture/resource-metrics.md`.
9. **Doorbell-snapshot domains** (`namespaces` object clock,
   `namespace-metrics` metric clock, `object-events` event clock,
   `cluster-overview` metric clock — poll-augmented):
   1. **Invalidate before broadcast** (`resourcestream.Manager.broadcast` →
      the subsystem's `SnapshotService.InvalidateDomainCache` callback): the
      refetch lands inside the 5s cache TTL; served from cache it applies the
      pre-change snapshot forever. The manager test pins this ordering for all
      resource-stream signal producers.
   2. **Doorbell refetches carry `reason: 'stream-signal'`** or the
      skip-while-stream-healthy gate swallows them.
   3. **Key refetch identity on `signalVersions` only** (never folded
      `sourceVersion`/`sourceVersions` — payload applies rewrite those every
      fetch → echo refetches/fetch storms). Applies to query tables'
      `liveDataVersion` too. Watch the first-ring sentinel: an empty-string
      "previous" swallows the first doorbell (Browse uses a has-observed
      guard).
   4. **Latch colliding signals** (`rerunStreamSignal`): one trailing refetch;
      never drop, never abort-and-replace.
   5. **Cluster-Ready is server-side**: pre-Ready doorbells trigger
      `runNamespacesReadinessSelfBuild` via `Subsystem.NamespacesDoorbell`,
      wired at the per-cluster chokepoint (the post-settle ring is one-shot —
      an unwired late-built subsystem wedges in loading);
      `sweepNamespacesReadiness` heals rings dropped while aggregates were
      nil; `refreshAggregates` is atomic (doorbell-goroutine reads).
      Permission-denied namespaces builds still fire the Ready notify.
   6. **Skip resync echoes** (`namespaceUpdateIsEcho`) or the doorbell becomes
      a resync-period metronome.
   7. **`isStreamingHealthy` stays descriptor-table-driven** — hardcoded lists
      silently keep new doorbell domains polling.
   8. **Every teardown/cool path calls `StopDoorbellNotifiers()`**
      (`stopClusterFeeds`, `teardownRefreshSubsystem`, `stopRefreshSubsystem`,
      `swapRefreshSubsystem`).
   9. **Poll-augmented doorbells**: conditional producers (metric doorbells
      ring only on success) require `pollingContinuesWhileStreaming` so a
      healthy-but-silent stream never suppresses polls; and converting a
      snapshot domain to streaming requires auditing enable call sites for
      `preserveState: true` (the streaming enable path resets scoped state
      without it — blank view per remount).
   10. **Validator completeness**: rows joining another store's data fold that
       store's version into the watermark (nodes: node+pod;
       workloads: workload+pod) or joined changes 304 away.
   11. **Rebuilds must not demote Ready**: the governor re-warms cooled
       clusters through the build chokepoint on tab switch;
       `transitionClusterToLoading` keeps an already-ready cluster ready
       (re-warm serving is continuous).
10. **Stream health = connected + server-confirmed synchronized**, not
    recently-delivered (`computeSubscriptionHealth`;
    `markSubscriptionSynchronized` only after the mux confirms the subscribe).
    A token-less RESET may confirm the tail only after it advances a declared
    signal clock when retained data exists. Marking synchronized on merely
    SENDING a subscribe lets a backend that rejects the domain freeze it with
    polls skipped. If health regresses to delivery-only, every quiet domain
    reverts to timer polling.

**Consumer rule**: any reader of a stream-domain scope's `state.data` needs
`useStreamSignalRefetch(domain, scopes)` or the query-table `liveDataVersion`
equivalent — without one it freezes at first load. Enforced by the drift guard
(`frontend/src/core/refresh/streamConsumerDrift.test.ts`; exemptions in
EXEMPT_FILES with reasons). Contexts hold NO domain data — before adding a
context-held copy, name the component that renders it; query-backed tables own
their rows and their own base-scope lease. Permission-denied scopes are
checked once per session (typed 403 → `permissionDenied` scoped state; only
manual refetches retry; recovery = restart).

## Debugging

- Doorbells log at DEBUG on both sides ("namespaces doorbell <v>: <reason> —
  signaling N scope(s)" / "namespaces doorbell <v> received … advancing the
  object clock"). Use the pair to localize a dead doorbell; if both look
  perfect and the UI is frozen, check the snapshot cache (9.1) first.
- Verify payload-shaped UI claims against a REAL payload (`curl` the snapshot
  endpoint) — unit tests only prove the shapes you imagined.
- For wedges/deadlocks anywhere in ingest/catalog/refresh: capture a goroutine
  dump FIRST (`ENABLE_GOROUTINE_DUMP=true`, then the logged `kill -USR1`
  command; see `docs/workflows/goroutine-dump.md`). `IngestManager.mu` is a
  leaf lock; sink deliveries run under the store write lock.

## Before modifying this subsystem

- [ ] Read the file you're changing AND its callers
- [ ] Check domain registration order and both permission layers
- [ ] Check frontend mappings (types, refresher config, contract JSON, diagnostics)
- [ ] For streams: descriptors, supported domains, registration files, single-cluster scope tests, parity cases
- [ ] One cluster scope at a time; cross-cluster display derives above refresh state
- [ ] Aggregate handlers route as a mux — never merge cluster results
- [ ] Metric-only changes ride the metric clock; never re-project or re-store object rows
- [ ] Doorbell changes: walk fragility points 8–10 as a checklist
- [ ] Test with multiple clusters connected AND with restricted RBAC
- [ ] Verify the diagnostics panel still reports correctly
