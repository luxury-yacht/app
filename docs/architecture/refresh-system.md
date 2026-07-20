# Refresh System Contract

The refresh system is the implementation boundary for per-cluster snapshots,
queries, signals, manual jobs, retained frontend state, and diagnostics. The
normative timing and visibility rules live in
[data-freshness.md](data-freshness.md).

## Domain contract

`backend/refresh/domain/refresh-domain-contract.json` is the join key for:

- backend registration in `backend/refresh/system/registrations.go`;
- backend DTO registration in `backend/internal/genrefreshcontracts/registry.go`;
- stream routing and source clocks;
- generated frontend domain/payload types;
- frontend registration, scheduling, diagnostics, and tests.

Do not add aliases or parallel registration tables. Change the authored entry,
backend/frontend registrations, generated types, and parity tests together.

## Scope and identity

Every API scope names exactly one cluster:

```text
clusterId|
clusterId|namespace:default
clusterId|<domain-owned-tail>
```

Cross-cluster views read multiple single-cluster entries. Concrete object rows
carry a complete `ResourceRef`: `clusterId`, `group`, `version`, `kind`,
`namespace`, and `name` (cluster-scoped objects omit namespace).

## Ownership

- Subsystem lifecycle and aggregate routing: `backend/app_refresh_*.go`
- Registry, permission gates, manual jobs: `backend/refresh/system`
- List/table payloads: `backend/refresh/snapshot`
- Query-backed change signals: `backend/refresh/resourcestream`
- HTTP API: `backend/refresh/api/server.go`
- Scheduler: `frontend/src/core/refresh/RefreshManager.ts`
- Executor and per-cluster runtimes: `frontend/src/core/refresh/orchestrator.ts`
- Store and hooks: `frontend/src/core/refresh/store.ts`,
  `frontend/src/core/refresh/hooks`
- Request policy: `frontend/src/core/data-access`

`backend/resources` owns details and imperative helpers, not list/table refresh
payloads. `frontend/src/core/refresh/types.generated.ts` is generated; register
Go DTOs and run `go generate ./backend` instead of editing it.

## Behavior classes

- Snapshot domains replace one scoped payload.
- Resource-stream table domains render snapshot/query pages and use change
  signals only as refetch identity.
- Doorbell-snapshot domains have no streamed rows; the signal tells their
  snapshot consumer to refetch.
- Complete-resync streams send scope-level reconciliation signals.
- Log, detail, graph, Helm, YAML, and operation domains keep their specialized
  reducers and payload rules.

New list/table domains need a declared push source or an explicit reason that
only fallback polling exists. Source clocks and polling behavior must follow
[the freshness contract](data-freshness.md#signals-and-source-clocks).

## Query payloads

Typed table domains embed the normalized `ResourceQueryEnvelope` and typed
`Rows`. The backend owns filtering, sorting, facets, totals, cursor identity,
and keyset pagination. Catalog exposes the same query contract with its richer
kind metadata. See [large-data.md](large-data.md) and
[GridTable](../frontend/gridtable.md).

## Permission and readiness

- Runtime permission checks must match the scope of the data source.
- Permission-denied domains return typed settled state and diagnostics rather
  than disappearing or retrying indefinitely.
- The server owns cluster loading-to-ready progression. A governor replacement
  must not demote an already-ready cluster.
- Snapshot caches are allowed only for cache-tolerant data. Live app-managed
  operation state bypasses stale snapshot/singleflight paths.

## Stream start invariant

A view lease can flap enable/disable/re-enable during mount. An obsolete
cancellation must restart if the scope is enabled again, cleanup must have one
owner, and a newly healthy stream with no retained data must perform one
immediate non-manual reconciliation fetch. A reconnect may keep retained data
without another fetch only after the server successfully replays from its
resume token. A reset that cannot prove continuity advances a declared signal
clock and performs one immediate non-manual reconciliation before that retained
snapshot is trusted. Snapshotless streams are exempt.

When a governor re-warm or recovery replaces a cluster's stream manager, the
aggregate router points at the replacement first, then sends `COMPLETE` for only
that cluster's existing subscriptions. The client re-subscribes through the
current adapter and the normal ACK/replay/reset handshake re-establishes trust;
the aggregate WebSocket and other clusters' subscriptions remain connected.

The regression harnesses are
`frontend/src/core/refresh/orchestrator.streamingFlap.test.ts` for lease flaps
and `frontend/src/core/refresh/streaming/resourceStreamManager.test.ts` for
resume/reset gaps, plus
`backend/refresh_aggregate_resourcestream_test.go` for manager replacement.
First-paint latency near a fallback interval, retained data surviving a
non-replayable reset without a clock change, or a replacement manager with zero
subscribers indicates this contract regressed.

## Change checklist

1. Update the authored domain entry, backend/frontend registrations, DTO
   registry, and generated types.
2. Define scope, identity, permission, cache, source clocks, signal behavior,
   fallback polling, diagnostics, and merge/replace semantics.
3. Trace producer, consumers, ordering, teardown, and permission recovery.
4. Add contract parity plus behavior tests at the real snapshot/stream/consumer
   seams.
5. Run focused backend/frontend tests and `mage qc:prerelease`.
