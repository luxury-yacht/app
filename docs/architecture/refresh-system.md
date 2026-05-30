# Refresh System Contract

Refresh data is built per cluster through backend snapshot builders and streams,
then stored by the frontend under cluster-aware scopes.

## Agent Contract

- Every refresh scope that crosses the API boundary must name exactly one
  `clusterId`.
- Cross-cluster displays read multiple per-cluster entries and derive summaries
  above refresh state.
- `backend/refresh/snapshot` owns list/table snapshot payloads.
- `backend/refresh/resourcestream` owns live row updates for streamed table
  domains and must emit the same row shape as snapshots.
- `backend/resources` owns rich detail payloads and imperative helpers, not
  list/table refresh paths.
- Refresh domain names, behavior classes, timing, and registration metadata must
  stay aligned across the shared domain contract, backend registrations, and
  frontend registrations.
- Streams and snapshots for the same domain must share identity, row keys,
  merge semantics, and permission behavior.
- Snapshot caching is allowed only when the data can tolerate it. Live
  app-managed state such as node maintenance must bypass stale cache and
  singleflight paths.
- Permission-denied domains should surface diagnostics and stable denied
  payloads instead of disappearing.

## Domain Contract

Refresh domain metadata is authored in:

- `backend/refresh/domain/refresh-domain-contract.json`

The domain id is the join key for:

- backend registration in `backend/refresh/system/registrations.go`
- stream route wiring in `backend/refresh/system/streams.go`
- frontend domain registry/config in `frontend/src/core/refresh`
- diagnostics and refresh tests

Do not add parallel aliases for renamed domains. Rename through the contract,
registrations, and tests together.

## Scope Rules

Valid scope examples:

```text
clusterId|
clusterId|namespace:default
clusterId|object:<domain-owned-tail>
```

Existing cluster-prefixed scopes may be preserved so enable/disable calls do
not rewrite historical store keys after selection changes. New network requests
and store writes must still normalize through the refresh scope helpers.

## Ownership

- Backend subsystem setup and aggregate routing: `backend/app_refresh_*.go`
- Domain registry and permission gates: `backend/refresh/system`
- Snapshot builders: `backend/refresh/snapshot`
- Resource stream rows: `backend/refresh/resourcestream`
- Refresh HTTP API: `backend/refresh/api/server.go`
- Frontend scheduler: `frontend/src/core/refresh/RefreshManager.ts`
- Frontend executor and runtimes: `frontend/src/core/refresh/orchestrator.ts`
- Refresh store and hooks: `frontend/src/core/refresh/store.ts`,
  `frontend/src/core/refresh/hooks`

## Behavior Classes

Use behavior classes to preserve correctness, not to force inheritance:

- snapshot domains replace a full payload for one scope
- resource-stream table domains apply snapshot baselines plus row updates
- complete-resync streams use stream messages as resync signals
- catalog, event, and log streams have source-specific reducers
- detail, graph, Helm, YAML, and operation-state domains keep their own payload
  semantics

Keep common lifecycle plumbing shared where behavior matches. Do not collapse
domain-specific identity, merge, cache, or recovery semantics into a generic
handler.

## Change Checklist

When adding or changing a domain:

1. Update the shared domain contract and both backend/frontend registrations.
2. Define the scope shape and whether multiple active scopes are allowed.
3. Decide snapshot, stream, cache, permission, diagnostics, and row-merge
   behavior explicitly.
4. Ensure payload rows carry full cluster/object identity where applicable.
5. Add parity tests that fail if backend/frontend/domain-contract metadata
   diverge.
6. Add snapshot/stream tests for baseline, update, delete, complete/resync, and
   permission-denied behavior as relevant.

## Validation

Run focused refresh-domain backend tests and frontend refresh/orchestrator tests
for the changed area. For non-documentation work, finish with
`mage qc:prerelease`.
