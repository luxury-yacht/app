# Plan: View-owned live-window fetch (collapse parallel resource data paths)

**Status:** Planned, NOT started. Deferred deliberately to a focused, well-rested pass — this
is a ~20–40-file refresh-layer re-architecture across two surfaces (namespace + cluster), and
it is the highest-risk change in the large-table effort.

**One-liner:** Make each query-backed resource view fetch its own live "window" (through its
wrapper) so the central resource-manager window-fetch machinery can be deleted on BOTH the
namespace and cluster surfaces — collapsing two parallel data-management stacks into one
per-view data path.

## Why

After the query-backed migration, every query-backed view runs two parallel data stacks:

1. The wrapper's typed **query** (the page you see), which fetches independently.
2. A central manager's **window** fetch, whose rows are no longer displayed but whose snapshot
   drives the `liveDataVersion` that makes the query refetch on live changes — plus auto-load
   and cancel.

Symptoms of the redundancy:

- **Dead code:** `resourceStates.<tab>.data` is built but never read — the auto-load reads only
  `loading`/`error`/`hasLoaded`. [VERIFIED]
- A full window snapshot is fetched per active resource purely to derive a version + loading /
  refresh / cancel signals that the per-view wrapper could own itself.

This is the **difficult-but-correct** fix (vs. the simple-but-incomplete dead-field trim):
collapse to one data path per view.

## Current architecture (traced — `[VERIFIED]` = read in source; `[ASSUMED]` = re-verify first)

- [VERIFIED] Shared wrapper `frontend/src/modules/resource-grid/useQueryBackedResourceGridTable.ts`
  subscribes to the live domain with
  `useScopedRefreshDomainLifecycle({ enabled: true, preserveState: true, fetchOnEnable: false })`
  (~L208–213). It **reads** the window for `liveDataVersion`; it does **not** fetch it. Its
  returned `source` already exposes `rows`/`loading`/`loaded`/`error`.
- [VERIFIED] The window is **fetched by central managers**:
  - Namespace: `NsResourcesManager.tsx` via `useNamespaceResource(type)` hooks → `resourceStates`
    (loading/error/hasLoaded; `.data` is dead), `manualLoaders` (consumed ONLY by the auto-load
    `useEffect` — NOT a refresh button), `cancelAll` (`.cancel()` on unmount), and an auto-load
    `useEffect` that triggers the active tab's `.load()`.
  - Cluster: `ClusterResourcesManager.tsx` + `ClusterResourcesContext.tsx` — the analog.
    [ASSUMED same pattern — confirm.]
- [VERIFIED] The typed **query** fetches its page independently (`useTypedResourceQuery.ts` →
  `requestRefreshDomainState` with query params). The page loads regardless of the window; the
  window only drives live-refetch.
- [VERIFIED] Namespace views are **mounted-on-active** (`NsResourcesViews.tsx` is a
  `switch (activeTab)` that renders only the active view). [ASSUMED cluster is the same — confirm.]
- [VERIFIED] Manual refresh is the **global** `refreshManager.triggerManualRefresh`, independent
  of these managers. [ASSUMED it refetches query-backed views via window → `liveDataVersion` →
  query — confirm the exact path.]

## Target architecture

- The per-view wrapper fetches its **own** window: flip `fetchOnEnable: false → true`. Safe
  *because* views are mounted-on-active — only the active view's subscription runs, so only the
  active window fetches.
- Delete the central window-fetch machinery on **both** surfaces: `useNamespaceResource` /
  `useClusterResource` for query-backed resources, `resourceStates`, `manualLoaders`, `cancelAll`,
  the auto-load `useEffect`.
- Keep whatever Custom / Map / non-query-backed tabs still need from the managers.
- Preserve all of: page load, live-refetch, active-only fetch, cancel-on-leave, global manual
  refresh, smooth tab-switch (replay cache).

## Open questions to resolve FIRST (unverified — these carry the risk)

1. **Cluster surface** — confirm it is the same pattern and mounted-on-active.
2. **`fetchOnEnable: true` safety** — *why* is it `false` today? If the wrapper fetches the same
   domain+scope the central manager already fetches, is it **deduped** (same cache key) or a
   **double-fetch**? This determines rollout ordering (flip-then-delete vs. atomic flip+delete
   per surface).
3. **Custom / Map** (and any non-query-backed tab) dependence on the managers / `resourceStates` /
   `manualLoaders` / `cancelAll` — enumerate every consumer; specify exactly what must survive.
4. **Live-stream behavior** — does the central long-lived subscription stream differently than a
   mount-scoped per-view subscription? (Does removing it change when the SSE stream pauses /
   resumes?) Check the interaction with the replay cache on tab-switch.
5. **Exact global-manual-refresh path** for query-backed views.

## Test-first behavior matrix (pin BEFORE refactoring — BOTH surfaces)

| Behavior | Coverage today |
|---|---|
| Opening a tab loads its page | likely covered (`NsView*` / `ClusterView*` tests) — confirm |
| A live window change refetches the page | **the load-bearing one** — likely a GAP, add |
| Only the active tab fetches its window | likely a GAP, add |
| Leaving / unmount cancels + disables the domain | confirm / add |
| Global manual refresh refetches the active view | confirm / add |
| Switch-away-and-back is smooth (replay cache) | prior work exists — confirm |

For every behavior-changing step: write the failing test first (red), then make it green.

## Phased sequence (each phase independently gate-green: `mage qc:prerelease`)

1. **Characterization tests** — land all the behavior tests above (both surfaces) against
   *current* behavior. This is the safety net the whole refactor leans on.
2. **Resolve the `fetchOnEnable` ordering question** — small spike: confirm dedup vs. double-fetch.
3. **One surface end-to-end as the template** — namespace first (most-traced): flip
   `fetchOnEnable` (per the ordering finding), delete the namespace central window machinery,
   keep Custom/Map. Green.
4. **Second surface** — cluster, mirroring the template. Green.
5. **Cleanup** — remove now-dead helpers (the `resourceStates.data` field falls out naturally),
   update `docs/architecture/large-data.md`.

## Risks

- **Silent loss of live-refetch** (page loads but never updates) if the window stops being
  fetched — the #1 behavior to pin.
- **Over-fetch of inactive tabs** if the mounted-on-active assumption is wrong on either surface.
- **Double-fetch during rollout** if `fetchOnEnable` is flipped while the central fetch still
  runs and the scopes aren't deduped.
- **Breaking Custom/Map** by deleting manager internals they still use.

## Interim / alternative (NOT the chosen fix)

The simple-but-incomplete stopgap is to just remove the dead `resourceStates.<tab>.data` field
(built-but-unread) — a safe ~10-line cut that removes the literal dead code but leaves the
redundant window fetch + parallel machinery intact. Use only if the full refactor is deferred
indefinitely.

## Key files

- `frontend/src/modules/resource-grid/useQueryBackedResourceGridTable.ts` — the wrapper;
  `fetchOnEnable`
- `frontend/src/modules/namespace/components/NsResourcesManager.tsx`, `NsResourcesViews.tsx`, and
  the `useNamespaceResource` hook
- `frontend/src/modules/cluster/components/ClusterResourcesManager.tsx`,
  `frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx`
- `frontend/src/modules/resource-grid/useTypedResourceQuery.ts` — the page fetch
- Tests: `NsView*.test.tsx`, `ClusterView*.test.tsx`, `queryBackedLeafFirstLoad.test.tsx`,
  manager/context tests
