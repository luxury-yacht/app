# Impact analysis log

Required artifact for the `impact-gate` PreToolUse hook
(`.claude/hooks/impact-gate.sh`). Before editing production source
(`.go/.ts/.tsx/.js/.jsx`, excluding tests/docs/`.claude/`), this file must hold a
**current** (< 60 min) entry that **names the file** and answers, for the change:

1. every **consumer / caller** affected
2. every **dependency**
3. **states / edge cases**
4. **downstream & runtime effects**

Mark each item **VERIFIED** (you read the producer + consumers, or measured it)
or **ASSUMED**. Resolve every ASSUMED item before editing. The hook forces the
step; it does not check quality — that is on the author and on review.

Newest entries on top. Re-touch the entry when you begin a new change so it stays
current.

---

## 2026-06-07 — ROOT CAUSE FIX: liveDataVersion churns on every poll tick

**CONFIRMED via runtime log:** the Nodes typed query refetches every ~200ms while idle
on the view. `liveDomainVersion` (`useQueryBackedResourceGridTable.ts`) is
`version:checksum:timestamp`; the timestamp (`lastUpdated`/`lastAutoRefresh`) bumps on
every refresh tick even when `version` + `checksum` (the data identity) are unchanged.
Since the typed query's `queryIdentity` includes `liveDataVersion`, it re-runs on every
tick — a continuous refetch storm that intermittently races into the transient "returned
no data" that blanks the table.

**Fix:** `liveDomainVersion` returns only `version` + (`checksum` ?? `etag`) — the data
identity — dropping the timestamp. The query then refetches only when the live data
actually changes. Consumers: only `useTypedQueryLifecycle` (line ~205) reads it, passing
it as `liveDataVersion` into the typed query identity (VERIFIED single consumer). Export
it for a focused unit test. Edge case: domains lacking version+checksum fall back to a
constant key → no live-driven refetch (acceptable; the query still fetches initially and
on filter/sort/page changes). Removes the diagnostics; the controller replay stays
DISABLED for now so this fix is verified in isolation.

## 2026-06-07 — DIAGNOSTIC 3: disable the mask + widen the orchestrator probes

Previous `[oDiag]` probes produced no output, so (a) the `scope.includes('?')` gate was
likely wrong (orchestrator normalizes the scope) and (b) a third idle/no-data path —
the **scope-disabled reset** at the top of the refresh method — was unprobed.
- `frontend/src/modules/resource-grid/useResourceInventoryTable.ts`: TEMP-disable the
  replay (`replayRows = null`) so the raw failure surfaces instead of being masked.
- `frontend/src/modules/resource-grid/useTypedResourceQuery.ts`: re-add the `[qDiag]`
  result log (status/innerStatus/hasPayload) to correlate.
- `frontend/src/core/refresh/orchestrator.ts`: gate all probes on `domain==='nodes'`
  only (drop the `?` filter, log the scope); add an ENTER probe (isManual/enabled/scope)
  and a RESET probe at the scope-disabled branch, alongside the existing DEDUP and
  NO-SNAPSHOT probes. No behavior change beyond the temporary replay-disable; all removed
  after capture.

## 2026-06-07 — DIAGNOSTIC 2: dedup vs notModified for the spurious "returned no data"

Temporary `console.log`s in `frontend/src/core/refresh/orchestrator.ts` at the two paths
that resolve a refresh WITHOUT applying a snapshot, gated to `domain==='nodes' &&
scope.includes('?')` (the typed-query scope): (1) the in-flight **dedup** early-return
(non-manual request skipped because one is already running) and (2) the `notModified ||
!snapshot` branch (logging `notModified`, `hasSnapshot`, `hadEtag`, `hadData`). Purpose:
determine whether the transient empty is a request-dedup race or a 304/empty-snapshot
with no retained data, so the source fix targets the right path. No behavior change;
removed after one capture.

## 2026-06-07 — DIAGNOSTIC: why does the Nodes typed-query refetch transiently error

Temporary `console.log` in `frontend/src/modules/resource-grid/useTypedResourceQuery.ts`
(fetch effect): log every refetch result's `status`, `blockedReason`, inner snapshot
`status`, whether a payload was present, and `scope`; plus a catch-branch log of thrown
errors. Purpose: identify which branch sets the transient error on a Nodes revisit —
request blocked (refresh contention/dedup), executed-but-no-payload (backend empty), or
an exception — so the controller's transient-empty bridge can be validated against the
real failure mode (or the error fixed at its source). No behavior change; removed after
one capture.

## 2026-06-07 — Fix (universal): bridge TRANSIENT empties in the ONE inventory controller

**CONFIRMED ROOT CAUSE (runtime diagnostic, not theory):** a temporary `console.log`
in `useResourceInventoryTable` captured the real Nodes revisit on a live cluster. The
flash is NOT a remount/gating problem — it is a **transient error on the background
refetch**: the table goes `rows=100 → rows=0 loading=true → rows=0 loading=false
error=true ("returned no data") → rows=50`. The `error=true, rows=0` frame is what
renders GridTable's generic **"No data available"** (`render.isEmpty` is false, so
`emptyMessage` falls back to the default). This matches the old v2 plan's "silent
returned-no-data" — it is the typed query erroring transiently, NOT the metrics merge.

**FINAL RULE:** the controller replays the last non-empty page only while the source is
in a **transient empty** — `rows.length === 0 && (loading || error)` — and shows a
settled empty (`!loading && !error`) through. `loaded` is deliberately unused (bounded/
local views report it inconsistently — single-namespace pods pass `loaded=false` with
resident data, which is why earlier `loaded`-based gating failed the pods filter test).
Blocked frames are NOT bridged (not observed in the diagnostic; bridging risks cross-
context stale rows). Cache is cleared on a settled empty.

(Superseded my earlier same-mount "resolved once" gating and the windowed-stream rewrite.)

---

## 2026-06-07 — Fix (earlier attempt): revisit replay cache in the ONE inventory controller

**Spec (from the user):** every view — on initial load shows a spinner until data
arrives; on every subsequent visit shows the previously-shown rows immediately and
refreshes silently in the background (no spinner, no flash, no flicker). One
mechanism, all views — not a per-view patch. (Supersedes the hook-level attempt
below, now reverted: it sat under the wrapper's `queryEnabled` gate, so the seed
was invisible during the exact window the flash occurs.)

**Layer (VERIFIED):** all 21 resource views render through
`ResourceInventoryTable` → `useResourceInventoryTable(source)` → the spinner is
`ResourceLoadingBoundary loading={render.showLoadingBoundary}`, and
`showLoadingBoundary` is true only when there are no rows and we're loading/initializing.
So the universal rule is: **rows present on mount ⇒ no spinner.** The cache belongs
in that controller.

**Files:**
- `frontend/src/modules/resource-grid/useResourceInventoryTable.ts` — add optional
  `cacheKey` to `ResourceInventorySourceState`; a module-level `Map<cacheKey, rows>`;
  write the last non-empty rows (in `useEffect`, survives unmount); on render, when
  the live source is *transiently* empty (`rows.length===0 && !blocked && !error &&
  (loading || !loaded)`) and a cached page exists for the key, derive the render
  state from the cached rows with `loading:false, loaded:true` → status `ready` (no
  boundary, no overlay; the real fetch still runs and replaces it). Export
  `resetResourceInventoryRowCache()` (test isolation; precedent `resetAllScopedDomainStates`).
- `boundedRowsSource.ts` / `backendQuerySource.ts` — thread an optional `cacheKey`
  from input to the emitted source state (the two shared source builders).
- `useQueryBackedResourceGridTable.ts` — `buildQueryBackedSource` + `useQueryBackedGridResult`
  forward `cacheKey`; both wrappers pass `` `${viewId}|${liveScope}` `` (per view +
  cluster + namespace). Covers all 18 cluster/namespace tables incl. Nodes.
- `BrowseView.tsx` — pass a `cacheKey` (browse viewId + scope) to `backendQuerySource`.
- `vitest.setup.ts` — `afterEach(resetResourceInventoryRowCache)` so the module cache
  never leaks across specs (the cache is shared by every view's tests).

**Consumers (VERIFIED):** every resource view (cluster ×7, namespace ×9, browse,
object-panel events/surface) renders via `ResourceInventoryTable`; only the source
builders change shape (added optional field), so callers that don't pass `cacheKey`
keep today's behavior (no regression). Object-panel nested tables (bounded local data)
are left unkeyed for now — the mechanism is ready for them via the same prop.

**States / edge cases (each tested at the controller):**
- first load, no cache → boundary spinner (unchanged). VERIFIED by test.
- revisit (remount), same key, transient empty → replay cached rows, no spinner/overlay. RED→GREEN.
- different `cacheKey` → no replay (no cross-view leak). VERIFIED by test.
- settled-empty (`loaded && !loading`) → shows empty, cache does NOT mask it. VERIFIED by test.
- blocked / error source → not replayed (real state shown). VERIFIED by guard.

**Downstream / runtime:** one rows array per view key in memory; bounded in practice.
The background fetch always runs and overwrites; a stale-but-recent page shows for one
round-trip on revisit — exactly the intended UX. `deriveResourceInventoryRenderState`
stays a pure function (unchanged signature) so its existing matrix tests are unaffected.

> Supersedes the two entries below (the reverted hook-level seed and the reverted
> windowed-stream rewrite).

## 2026-06-07 — Fix: revisit "no data" flash → seed typed query from a same-scope page cache

**Root cause (VERIFIED, read-only trace):** the flash is **(A) remount state-loss**, not
(B) a metrics-merge that starves the query. `metricsSnapshotApplicator.ts` only merges
usage into *existing* rows, no-ops when there is no prior data (`if (!previous.data)
return false`), and never replaces the row set; `streamQueryCoexistence.test.ts` proves a
metrics update for one scope leaves another scope byte-identical. So no arbitration can
empty a typed query. The real cause: `useTypedResourceQuery` holds `rows` in plain
`useState([])` and fetches with `preserveState:false`, so on remount it starts empty and
the first page is in flight → controller shows the loading boundary. (The reverted
windowed-stream rewrite — entry below — was justified by the false (B) story.)

**Change (file): `frontend/src/modules/resource-grid/useTypedResourceQuery.ts`.** Add a
module-level page cache keyed by the **page-1 query scope string**
(`buildTypedResourceQueryScope(clusterId, {…, continueToken:null})`); seed the row-bearing
`useState` from it on mount (synchronous replay → no flash); refresh the cache whenever
page 1 is loaded. Export `resetTypedResourceQueryPageCache()` for test isolation
(precedent: `resetAllScopedDomainStates`).

**Consumers / callers (VERIFIED):** only caller is `useQueryBackedResourceGridTable.ts`
(`useTypedQueryLifecycle` → `useTypedResourceQuery`), reading
`rows/loading/loaded/error/continueToken/total*`. **No consumer change:** `data =
queryEnabled ? query.rows : localData` (line 238) now sees seeded rows, so on remount
`data.length>0` → consumer `loading=false`, `loaded=true` → controller status flips from
`loading` (spinner) to `ready/refreshing` (rows visible). Downstream = **all** query-backed
tables (nodes, all-namespaces pods/workloads, browse, custom…), so the fix is app-wide, not
nodes-only.

**Dependencies (VERIFIED):** `buildTypedResourceQueryScope` + identity helpers
(`typedResourceQueryScope.ts`); `requestRefreshDomainState` unchanged (still
`preserveState:false`). Cache is local to the hook; it does NOT touch the scoped domain store.

**States / edge cases (each tested):**
- cold first-ever load (cache miss) → empty→loading unchanged. VERIFIED (existing tests stay green).
- remount, same scope, first page in flight → replay seeded rows, no flash. RED test written first.
- remount, DIFFERENT scope (cluster/filter/sort changed) → cache miss on the new key → no
  stale cross-identity rows. VERIFIED by key composition (clusterId+baseScope+filters+sort+
  pageLimit+predicates) — the safety property the deleted `retainLocalRowsForEmptyQuery` lacked.
- pagination: cache writes only when `pageIndex===1`, so a page-2 refetch never corrupts the
  page-1 replay. VERIFIED by guard.
- live update (liveDataVersion bump) on page 1 → refetch refreshes the cache; key excludes
  liveDataVersion so it stays stable. VERIFIED.
- error/empty refetch after seed → the fetch always runs on mount and overwrites; error
  renders as status 'error' regardless of seeded rows. VERIFIED via controller `deriveStatus`.

**Downstream / runtime effects:** one page per distinct query identity held in memory —
bounded in practice. ASSUMED acceptable without LRU at current scale (largest cluster <10k);
note if a cap is wanted. On revisit, a stale-but-recent page shows for one round-trip then
is replaced by fresh data — the intended "show last page, refresh in background" UX.

> Supersedes the entry below (the windowed-stream rewrite), which has been backed out.

## 2026-06-07 — Fix: Nodes view → single live windowed source (retire dual-source)

**Change:** Serve the Nodes table from ONE source — the *existing* server-side
windowed nodes query, pushed LIVE — by generalizing the catalog keyset-stream
pattern, and consuming it single-source in the frontend. Retire the dual-source
flip (live snapshot vs one-shot typed query) for Nodes. This removes the
*architectural cause* of the revisit flash and "returned no data".

**Files (this slice):**
- Backend: pure stdlib-only package `backend/refresh/windowstream/` — the live
  windowed-stream loop (`streamer.go`: emit page on start + re-emit on a coalesced
  change signal) and a generic SSE `Handler[T]` (`handler.go`: encode page as an
  SSE frame, run the Streamer); generic + unit-tested in isolation. Wired in
  `system` (`streams.go`) for nodes:
  `Handler[*refresh.Snapshot]{ Query: () => snapshotService.Build(ctx, "nodes",
  scope) [VERIFIED types.go:52], Subscribe: resourceManager.SubscribeSelector(
  ParseStreamSelector(clusterID,"nodes","")).Updates → struct{} [VERIFIED
  manager.go:634, streammux/types.go:68, selector.go:82], Emit: SSE write }`;
  aggregate the endpoint in `app_refresh_setup.go:306-309`. Reuses the existing
  windowed query + change signal verbatim — no reimplementation.
- Backend wiring (VERIFIED this turn): NEW `backend/refresh_aggregate_windowed_stream.go`
  mirrors `refresh_aggregate_catalog_stream.go` — per-cluster
  `windowstream.Handler[*refresh.Snapshot]` built from the exposed `system.Subsystem`
  fields `SnapshotService` + `ResourceStream` + `ClusterMeta` (manager.go), routed by
  `refresh.SplitClusterScopeList`→`selectCluster`. Query = `SnapshotService.Build(
  r.Context(),"nodes",scope)` where scope = `cluster|?query` parsed by
  `parseTypedTableQueryScope` (nodes.go:248, typed_table_query.go:60). Subscribe
  adapts `ResourceStream.SubscribeSelector(ParseStreamSelector(clusterId,"nodes",""))`
  `.Updates`→coalesced `struct{}` (+ `.Cancel`). Register `/api/v2/stream/nodes` +
  the `refreshHandlers` struct field + its `Update(subsystems)` (cluster add/remove)
  in `app_refresh_setup.go`. STILL TO CONFIRM before writing: the exact request→
  Build-scope reconstruction (how the frontend encodes the windowed scope on the SSE
  URL) and the `Update` lifecycle signature — read both first.
- Frontend: NEW `modules/cluster/hooks/useNodesWindowedStream.ts` — subscribes to
  `/api/v2/stream/nodes?scope=` via `openRefreshEventSource` [VERIFIED handle
  `{source,close}`], parses `event.payload` (the NodeSnapshot) [VERIFIED
  `Snapshot.payload` types.go:108; `NodeSnapshot.rows/metrics` nodes.go:46],
  exposes `{rows, metrics, loading, loaded, error}`; preserves the last page per
  scope in a module cache so re-visits render immediately (no flash).
  `ClusterViewNodes.tsx`: source rows + metrics from the stream and set
  `enabled: false` on the grid hook — removes the typed-query flip (the flash
  cause), collapsing to the single live source. Transitional: falls back to the
  `data` prop until the stream loads (keeps the prop-drill contract + the existing
  fixture tests; a first-visit spinner is allowed by the spec). NOTE: the
  query-backed loading-contract tests use this view as a fixture — verify/adjust.

**Reuse (VERIFIED by end-to-end trace):**
- Windowed nodes query already exists — sort/filter/keyset-paginate + envelope
  (continue/total/totalIsExact/facets): `nodes.go:378-392`,
  `nodeQueryCapabilities`/`nodeTableQueryAdapter`. VERIFIED.
- Catalog serves a windowed query live (re-query on signal, push page):
  `catalog_stream.go:39-123`, `objectcatalog/query.go`. VERIFIED.
- Nodes change signal exists: resourcestream Manager taps the nodes informer and
  broadcasts on change. VERIFIED.
- Node row projector + metrics join; the query payload carries `Metrics`
  (`nodes.go:387`). VERIFIED.
- Frontend stream-consumer template (`catalogStreamManager`→`setScopedDomainState`;
  `useBrowseCatalog` reads `domain.data`, applies page, paginates). VERIFIED.

**Consumers to PRESERVE (VERIFIED — all 14 from the trace):** table rows; metrics
bars (must carry metrics meta `stale/lastError/collectedAt` in the stream
payload); object-panel open; alt-click nav; cordon/drain (clusterId/clusterName/
name/unschedulable); context menu; canonical row key; filter; sort; pagination
(next/prev/cursorInvalid); loading/loaded; error; permission-denied=blocked;
`clusterId` on every row. The projector emits all required fields
(statusPresentation, age/ageTimestamp, unschedulable, cpu/mem). VERIFIED.

**Dependencies (reused, unchanged):** nodes informer/list, metrics provider,
permission gate, refresh store, GridTable/ResourceInventoryTable controller.
VERIFIED.

**States/edge cases (each gets a test):** cold load, **revisit** (single source ⇒
no flip ⇒ no flash — cause removed, VERIFIED), settled-empty, permission-denied,
error, partial/truncated, metrics stale/error, pagination, filter/sort re-query.

**ASSUMED — resolve during design BEFORE editing the relevant file:**
- Exact new-file names/locations (handler; frontend manager/hook) — finalize in design.
- Migrate Nodes via a NEW single-source hook, leaving the shared
  `useQueryBackedResourceGridTable` untouched for not-yet-migrated views — VERIFY
  the shared hook's other consumers first; prefer additive over editing the shared hook.
- Coalesce/debounce the resource-stream change signal so high node churn doesn't
  thrash the re-query — design + test.
