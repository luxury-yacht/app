# Refresh System Contract

Refresh data is built per cluster through backend snapshot builders and streams,
then stored by the frontend under cluster-aware scopes.

## Agent Contract

- Every refresh scope that crosses the API boundary must name exactly one
  `clusterId`.
- Cross-cluster displays read multiple per-cluster entries and derive summaries
  above refresh state.
- `backend/refresh/snapshot` owns list/table snapshot payloads.
- `backend/refresh/resourcestream` owns change signals for streamed table
  domains; rows are served by the snapshot/query path.
- `backend/resources` owns rich detail payloads and imperative helpers, not
  list/table refresh paths.
- Refresh domain names, behavior classes, timing, and registration metadata must
  stay aligned across the shared domain contract, backend registrations, and
  frontend registrations.
- Streams and snapshots for the same domain must share identity, scope, liveness,
  and permission behavior.
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
- Resource stream signals: `backend/refresh/resourcestream`
- Refresh HTTP API: `backend/refresh/api/server.go`
- Frontend scheduler: `frontend/src/core/refresh/RefreshManager.ts`
- Frontend executor and runtimes: `frontend/src/core/refresh/orchestrator.ts`
- Refresh store and hooks: `frontend/src/core/refresh/store.ts`,
  `frontend/src/core/refresh/hooks`

## Behavior Classes

Use behavior classes to preserve correctness, not to force inheritance:

- snapshot domains replace a full payload for one scope
- resource-stream table domains render snapshot/query pages and refetch them from
  WebSocket change signals
- event and catalog domains also use resource WebSocket doorbells for liveness
  and refetch rows through their snapshot/query domains
- complete-resync streams use stream messages as resync signals
- resource-stream signal delivery is documented in
  [resource-stream-signals.md](resource-stream-signals.md)
- log streams have source-specific reducers
- detail, graph, Helm, YAML, and operation-state domains keep their own payload
  semantics

Keep common lifecycle plumbing shared where behavior matches. Do not collapse
domain-specific identity, merge, cache, or recovery semantics into a generic
handler.

## Normalized Resource Query Provider Contract

Snapshot domains that back a resource inventory table expose one normalized query
shape so the frontend consumes them uniformly (see
[`docs/architecture/large-data.md`](large-data.md) and
[`docs/frontend/gridtable.md`](../frontend/gridtable.md)):

- Typed-resource domains embed `ResourceQueryEnvelope`
  (`backend/refresh/snapshot/resource_query_contract.go`) in their payload — flat
  facets (kinds/namespaces/statuses/nodes), `completeness`, `capabilities`, and
  exactness flags — alongside a typed `Rows` slice. Go embedding flattens the
  envelope to top-level JSON keys, so every typed payload presents the same shape.
- The catalog provider (`catalog.go`) does not embed the envelope (its kinds facet
  is the richer `[]KindInfo` and it owns keyset pagination) but surfaces the same
  provider/completeness/capabilities contract fields directly.
- Capabilities describe the query surface (sortable/filterable/searchable
  fields). Export and copy are client-driven: the current page by default, or a
  cursor walk over the same query path for the "all matching rows" scope.
- Pagination is keyset (`continue`/`previous`). Any batch-streaming fields are
  diagnostics only, never page metadata.

Conformance is enforced in `backend/refresh/snapshot`:
`TestEveryTypedResourceDomainEmbedsTheNormalizedEnvelope` (source discovery, in
`typed_provider_discovery_test.go`) fails if a typed payload omits the envelope,
its `Rows`, or constructs the envelope outside the canonical helpers
(`typedQueryEnvelope`/`typedWindowEnvelope`/`resolveTypedSnapshotPage`), and the
provider/capability conformance tests check provider, completeness, and
capability fields. A new typed domain must embed the envelope and be added to
the capability conformance table.

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
