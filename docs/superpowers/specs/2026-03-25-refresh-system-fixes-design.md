# Refresh System Fixes

## Problem

Five bugs in the refresh system, ordered by severity:

1. **Catalog has no reactive update path** — The catalog only reads from informer caches when `sync()` runs every 60 seconds (`defaultResyncInterval` in `objectcatalog/service.go`). The shared informer caches update in real-time from Kubernetes watches, but the catalog doesn't re-read them between syncs. The browse view can be up to 60 seconds stale. Every other view gets sub-second updates because the resource stream manager hooks `AddEventHandler` directly onto informers.

2. **`upsertByUID` never handles deletions** — `browseUtils.ts:103-147`. The function iterates `incoming` items and adds/updates into `current`, but never removes items from `current` that are absent in `incoming`. Any caller using it for auto-refresh will accumulate phantom resources. We already fixed the browse view's `mode === null` path to use full replacement, but the function itself is a trap for future callers.

3. **Manual fetch hijacked by stalled streams** — `orchestrator.ts:1173-1181`. When `isStreamingActive` returns true (meaning `streamingCleanup` has an entry), `fetchScopedDomain({ isManual: true })` is redirected to `refreshStreamingDomainOnce` instead of a snapshot fetch. If the SSE connection is established but stalled, manual refresh silently does nothing.

4. **No SSE health tracking** — `orchestrator.ts:822-826`. `isStreamingHealthy` only returns true for resource-stream (WebSocket) domains. SSE domains (catalog, events) always return false. The orchestrator cannot detect a broken SSE stream and has no recovery signal beyond EventSource's built-in reconnect.

5. **`DEFAULT_AUTO_START = false` footgun** — `orchestrator.ts:89`. Refreshers are disabled at registration by default. Any new domain added without `autoStart: true` and without a view hook that explicitly triggers fetches will silently never poll. This is undocumented and has already caused bugs (the catalog browse refresher was disabled, preventing auto-refresh).

## Solution

Two independent work items:

### Item A: Catalog reactive updates (fixes #1)

Add informer event handlers to the catalog service that incrementally update `s.items` on Add/Update/Delete events, rebuild the query cache, and broadcast to SSE subscribers. The existing `sync()` continues as a consistency safety net on a longer interval.

**Approach:** Same pattern the resource stream uses. Register `cache.ResourceEventHandlerFuncs` on each shared informer in the catalog's resource set. On each event, build a `Summary` via `buildSummary()`, upsert/remove from `s.items`, rebuild `sortedChunks` via `rebuildCacheFromItems()`, and call `broadcastStreaming(true)`.

**Key details:**

- New file `backend/objectcatalog/watch.go` containing all new code.
- `watchNotifier` struct with a buffered channel (8192), 200ms debounce, and a `run()` goroutine.
- `flush()` checks `syncInProgress` atomic flag and skips if a sync is in progress (sync's parallel goroutines write to the aliased `s.items`/`newItems` map without holding the lock).
- `flush()` holds `s.mu` while mutating `s.items`, snapshots the items map, releases `s.mu`, then calls `s.Descriptors()` (acquires `s.mu.RLock`) and `rebuildCacheFromItems(itemsCopy, descriptors)` (acquires `s.mu.Lock` internally via `publishStreamingState`). This lock ordering prevents deadlocks and ensures `sortedChunks` is consistent with `s.items`.
- Filter no-op UPDATE events by comparing old/new `ResourceVersion` — the informer resync fires UPDATE for every cached object every 15 seconds even when nothing changed.
- `registerWatchHandlers()` uses a `watchInformerAccessor` map (parallel to `sharedInformerListers` in `informer_registry.go`) that maps `schema.GroupResource` to informer accessor functions.
- `resolveGRToDescriptor()` looks up the `resourceDescriptor` in `s.resources` by matching `Group` and `Resource`.
- Handle `cache.DeletedFinalStateUnknown` in delete handlers.
- `EnableReactiveUpdates` option on `Options` (default true) for feature flag / rollback.
- `syncInProgress atomic.Bool` on `Service` — set at top of `sync()` with deferred reset.
- When reactive updates are enabled, extend resync interval to 5 minutes (safety net, not primary update path).
- Wire into `runLoop()` after the initial sync completes.

**Files:**

| Action | File |
|--------|------|
| Create | `backend/objectcatalog/watch.go` |
| Create | `backend/objectcatalog/watch_test.go` |
| Modify | `backend/objectcatalog/service.go` — add `syncInProgress atomic.Bool` field |
| Modify | `backend/objectcatalog/types.go` — add `EnableReactiveUpdates` to `Options` |
| Modify | `backend/objectcatalog/sync.go` — set `syncInProgress` flag, start notifier in `runLoop()` |

**No frontend changes required** — the catalog SSE stream and snapshot endpoints already read from `sortedChunks`, which `flush()` updates. The browse view fix we already made (accepting `'updating'` status, full replace on refresh) ensures the frontend applies incoming data correctly.

### Item B: Frontend refresh robustness (fixes #2, #3, #4, #5)

Four targeted frontend fixes. No backend changes.

#### Fix #2: Mark `upsertByUID` as pagination-only

Add a JSDoc comment to `upsertByUID` in `browseUtils.ts` clearly documenting that it only handles additions and updates — never deletions — and must only be used for append/pagination, not for refresh. This is a documentation fix; the behavioral fix is already in place (`useBrowseCatalog.ts` uses full replacement for `mode === null`).

**Files:**

| Action | File |
|--------|------|
| Modify | `frontend/src/modules/browse/utils/browseUtils.ts` — add JSDoc warning |

#### Fix #3: Fallback to snapshot fetch when manual refresh via stream fails

In `fetchScopedDomain`, when `isManual: true` and `isStreamingActive` is true, attempt `refreshStreamingDomainOnce` but fall back to `performFetch` if the stream refresh doesn't produce a state update within a short timeout. This ensures clicking "refresh" always delivers data even if the stream is stalled.

Simpler alternative: when `isManual: true`, always do a `performFetch` regardless of streaming state. The snapshot fetch is cheap (local HTTP request) and guarantees data delivery. The streaming path can still deliver updates in parallel.

**Recommended: the simpler alternative.** Manual refresh should always hit the snapshot endpoint. The stream is for live updates between manual refreshes.

**Files:**

| Action | File |
|--------|------|
| Modify | `frontend/src/core/refresh/orchestrator.ts` — change `fetchScopedDomain` manual path |

#### Fix #4: SSE stream health tracking

Add a health signal to `catalogStreamManager` that the orchestrator can query. The simplest approach: track a `lastEventAt` timestamp in the manager. The orchestrator's `isStreamingHealthy` checks whether `lastEventAt` is recent (within 2x the expected delivery interval). If it's stale, the stream is considered unhealthy and the orchestrator falls back to snapshot polling.

**Files:**

| Action | File |
|--------|------|
| Modify | `frontend/src/core/refresh/streaming/catalogStreamManager.ts` — add `lastEventAt` tracking, expose `isHealthy(scope)` method |
| Modify | `frontend/src/core/refresh/orchestrator.ts` — extend `isStreamingHealthy` to query catalog/event stream managers |

#### Fix #5: Document `DEFAULT_AUTO_START = false` behavior

`DEFAULT_AUTO_START` cannot be changed to `true` — nearly every streaming domain (nodes, workloads, config, network, RBAC, storage, events, etc.) omits `autoStart` and relies on view hooks or `ClusterResourcesContext` to enable scopes on demand. Changing the default would cause all these domains to start polling at app startup regardless of which view is active.

Instead, add a comment at the `DEFAULT_AUTO_START` declaration explaining the behavior and the requirement for view hooks to enable scopes. Also add a note in `docs/development/data-refresh-system.md` (already done in recent update to that doc).

**Files:**

| Action | File |
|--------|------|
| Modify | `frontend/src/core/refresh/orchestrator.ts` — add explanatory comment at `DEFAULT_AUTO_START` |

## Edge Cases

### Item A

**Events before first sync completes:** `flush()` looks up descriptors in `s.resources`, which is empty before the first sync. Events are silently skipped. After sync populates `s.resources`, subsequent events are processed. No data loss — the first sync captures current state.

**Race between sync and watch events:** `sync()` assigns a clone of `s.items` to `s.items` at line 267 under a brief lock, then releases the lock. After that, `s.items` and the local `newItems` variable are aliased — they point to the same map. Parallel collection goroutines and post-collection cleanup write into `newItems` (and therefore `s.items`) without holding `s.mu`. If `flush()` also wrote to `s.items` during this window, it would be a concurrent map write.

The `syncInProgress` flag (set at the top of `sync()` with deferred reset) prevents this: `flush()` checks the flag and skips entirely if true. Events during sync are discarded — the sync itself reads from the same informer caches and captures current state.

**High event volume:** The 8192-element buffered channel with ResourceVersion filtering (skip no-op updates from informer resync) handles typical cluster loads. If the buffer overflows, events are dropped with a log warning. The next full resync (every 5 minutes) corrects any drift.

**CRDs and dynamic resources:** CRDs with promoted informers (`maybePromote()` in `collect.go`) have `SharedIndexInformer` instances that can receive event handlers. CRDs without promoted informers rely on the 5-minute resync.

### Item B

**Fix #3 — duplicate data delivery:** If the stream delivers data AND the snapshot fetch delivers data for the same manual refresh, the store gets two updates. This is harmless — the second update overwrites the first with identical or slightly newer data.

**Fix #3 — sequence counter divergence:** For the catalog domain, `performFetch` sets store state via the snapshot response path (with `version`/`etag` fields), while the SSE stream sets state via `catalogStreamManager.applyMergedState` (with `sequence` field). These two paths can coexist — `applyMergedState` checks `result.sequence <= this.lastAppliedSequence` to avoid applying stale SSE events, and `performFetch` does not touch `lastAppliedSequence`. However, if the manual `performFetch` writes newer data than the stream's last sequence, subsequent stream events with a higher sequence will overwrite it — this is correct behavior (stream data is newer).

**Fix #5 — documentation only:** No behavioral change. No risk.

## Testing Strategy

### Item A

- Unit tests in `watch_test.go`: add/update/delete for known/unknown GVRs, syncInProgress guard, cluster-scoped resources, broadcast to subscribers, debounce batching, context cancellation, ResourceVersion filter for no-op updates, feature flag off.
- All existing `objectcatalog/*_test.go` tests must pass unchanged.
- Full backend test suite must pass.

### Item B

- Existing frontend tests must pass.
- Manual verification: navigate to browse view, scale a replica set, confirm the table updates within seconds.
- Manual verification: stall an SSE stream (e.g., suspend the backend), click refresh, confirm data still loads via snapshot fallback.

## Rollback

**Item A:** Set `EnableReactiveUpdates: false` in catalog options. Zero code changes to revert.

**Item B:** Each fix is independent. Revert individual changes as needed.
