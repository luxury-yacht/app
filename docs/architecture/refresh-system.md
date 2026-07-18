# Refresh System Contract

Refresh data is built per cluster through backend snapshot builders and streams,
then stored by the frontend under cluster-aware scopes.

## Agent Contract

- Every refresh scope that crosses the API boundary must name exactly one
  `clusterId`.
- Cross-cluster displays read multiple per-cluster entries and derive summaries
  above refresh state.
- `backend/refresh/snapshot` owns list/table snapshot payloads.
- Backend refresh HTTP/stream DTOs, the generic snapshot envelope,
  refresh-domain union, and backend domain-to-payload map are generated into
	`frontend/src/core/refresh/types.generated.ts`. DTO and enum registrations live
	in `backend/internal/genrefreshcontracts/registry.go`; domain payload mappings
	live beside their owners as `refreshPayloadType` in the shared domain contract.
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
  payloads instead of disappearing. The frontend checks a denied scope ONCE per
  session (typed 403 → `permissionDenied` scoped state, background refetches
  skipped; recovery is an app restart).
- The cluster loading→ready transition is SERVER-driven: a namespaces build
  after workload-store settle (self-built on each pre-Ready doorbell), with a
  permission-denied namespaces build still firing the transition. Rebuilds of an
  already-ready cluster (governor re-warm) must not demote it to loading.

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

`frontend/src/core/refresh/types.ts` is the handwritten boundary module. It
re-exports generated backend contracts and owns only frontend state that is not
a backend wire payload. `container-logs` is the current exception: its stored
snapshot is reducer-owned stream state, while its individual wire entries are
generated from the backend type.

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
- doorbell-snapshot domains (`namespaces`, `object-events`, `cluster-overview`,
  `cluster-attention`)
  are snapshot domains refetched by a signal-only doorbell; `cluster-overview`
  additionally keeps polling (poll-augmented — its metric doorbell only rings
  on successful collections)
- complete-resync streams use stream messages as resync signals
- resource-stream signal delivery is documented in
  [resource-stream-signals.md](resource-stream-signals.md)
- log streams have source-specific reducers
- detail, graph, Helm, YAML, and operation-state domains keep their own payload
  semantics

**New table/list domains must be signal-covered.** Register object change
signals (resource-stream table) or a doorbell (doorbell-snapshot) so the domain
refetches on push; the authored poll timing is the stream-down fallback, never
the primary refresh mechanism. A doorbell whose producer is conditional (it may
never fire — e.g. metric doorbells ring only on successful collections) must
set the descriptor's `pollingContinuesWhileStreaming` flag so polls stay on.
Plain timer-polled registration is reserved for domains with no push source at
all, and needs a stated reason.

Keep common lifecycle plumbing shared where behavior matches. Do not collapse
domain-specific identity, merge, cache, or recovery semantics into a generic
handler.

## Streaming Start Lifecycle (LOAD-BEARING — do not regress)

This contract fixed the single largest perceived-performance defect the app
ever had (2026-07-04): for months, EVERY first visit to a streaming view
stalled 5–10 seconds (or loaded never, for scopes without an active fallback
poller). The backend was innocent the whole time — it answered in ~1ms. The
stall was a silent race in the frontend start pipeline. If first-visit
latency ever regresses toward one fallback-poll interval, start here.

### The race this contract closes

View mount produces a lease flap: the scope is enabled, briefly disabled,
and re-enabled within milliseconds. Without this contract that killed the
scope's stream start:

1. Enable begins `streaming.start` (in-flight promise).
2. The transient disable calls `cancelStreamingStart`, flagging the
   in-flight start.
3. The immediate re-enable's own start attempt early-returns
   ("already starting") because the doomed start is still pending.
4. The doomed start resolves, sees the stale cancel flag, and dies silently.
   Nothing owns the scope; nothing paints until the fallback poller's first
   tick — and never for domains without an active poller.

Log signature of a recurrence: a scope stuck in `initialising` with
first-paint latency ≈ its poller interval, and no snapshot fetch between
view open and the first tick.

### The rules (all enforced by `orchestrator.streamingFlap.test.ts`)

1. **Obsolete cancellation → adopt-restart.** A start that arrives cancelled
   while its scope is ENABLED again must not die: clean up the doomed start
   and immediately run `startStreamingScope` afresh. The stream manager's
   `ensure` cancels the linger-scheduled unsubscribe
   (`resourceStreamSubscriptions.ts` `ensureForCluster` →
   `cancelPendingUnsubscribe`), so the subscription survives the handoff.
2. **Teardown has exactly one owner.** Both the start's own continuation and
   `stopStreamingScope`'s deferred block observe a cancelled start; the
   cancel flag is the ownership token. The start continuation clears it in
   every handled path; the stop's deferred block acts only if the flag is
   still set. Running cleanup twice double-releases the manager
   subscription's refcount.
3. **A freshly started scope with no data fetches once, immediately.**
   Streams signal CHANGES only — a quiet (or permission-denied) domain never
   delivers a first frame. The `startStreamingScope` success path fires an
   initial reconciliation fetch (`streamSignal: true`, deduped in-flight)
   so the scope leaves `initialising` now, not at the first poll tick.
   EXCEPTION: registrations with `snapshotless: true` (container-logs) have
   no snapshot endpoint — their data flows only through their own stream —
   and are never snapshot-fetched; the backend answers such fetches
   "unknown domain".
4. **A typed 403 is a settled answer at every layer** (see
   `docs/architecture/namespace-scope.md`, "Fail-fast contract"): the query
   hook settles without warm-up retries, tables render "Insufficient
   permissions", and stream permission frames block resync instead of
   looping.

### Guarding tests

- `frontend/src/core/refresh/orchestrator.streamingFlap.test.ts` — the
  flap race end to end at the real orchestrator seam (public
  `registerDomain` + `setScopedDomainEnabled` with a controllable fake
  streaming domain). Extend this harness for future orchestrator races.
- `frontend/src/modules/resource-grid/queryBackedLeafFirstLoad.test.tsx`
  ("settles a permission-denied domain…") — fail-fast at the view seam.

Known follow-up: the mount-time lease flap itself (enable→disable→re-enable)
still happens and is wasted work; the pipeline is robust to it. Tracing its
source is tracked in `docs/plans/namespace-scope.md` follow-ups.

## Normalized Resource Query Provider Contract

Snapshot domains that back a resource inventory table expose one normalized query
shape so the frontend consumes them uniformly (see
[`docs/architecture/large-data.md`](large-data.md) and
[`docs/frontend/gridtable.md`](../frontend/gridtable.md)):

- Typed-resource domains embed `ResourceQueryEnvelope`
  (`backend/refresh/snapshot/resource_query_contract.go`) in their payload — flat
  structural facets (kinds/namespaces), provider-owned `facetValues`,
  `completeness`, `capabilities`, and exactness flags — alongside a typed `Rows`
  slice. Go embedding flattens the envelope to top-level JSON keys, so every
  typed payload presents the same shape.
- The catalog provider (`catalog.go`) does not embed the envelope (its kinds facet
  is the richer `[]KindInfo` and it owns keyset pagination) but surfaces the same
  provider/completeness/capabilities contract fields directly.
- Capabilities describe the query surface (sortable/filterable/searchable
  fields) and publish provider facet descriptors. A descriptor owns its stable
  key, label, placeholder, searchable behavior, and bulk-action behavior;
  envelope `facetValues` own selection values, display labels, and per-facet
  exactness. Requests serialize selections as `facet.<key>`, and the backend
  includes every facet selection in matcher/cache/cursor identity. Export and
  copy are client-driven: the current page by default, or a
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
	 Register its backend DTO in `backend/internal/genrefreshcontracts/registry.go`,
	 set its authored `refreshPayloadType`, then run `go generate ./backend`.
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
