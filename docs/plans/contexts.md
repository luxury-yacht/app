# Contexts Review Findings

Review of `frontend/src/core/contexts/` — 10 context files total.

## Strong Findings

### 1. `ObjectCatalogContext.tsx:58-70` — Infinite polling when catalog is disabled

When `diagnostics.enabled === false`, the effect retries every 1 second indefinitely with no max retries or backoff. If the catalog is intentionally disabled this loops forever. Also violates the project convention in `frontend/AGENTS.md`: no ad-hoc polling loops — data should flow through the refresh orchestrator.

### 2. `AuthErrorContext.tsx:277-281` — `EventsOff` removes all listeners globally

Wails v2's `EventsOff` removes **all** listeners for the named event, not just the one registered in this provider. If any other component subscribes to `cluster:auth:*` events, those listeners would be silently unregistered when this provider unmounts. The generated Wails runtime typing (`frontend/wailsjs/runtime/runtime.d.ts:53`) only exposes `EventsOff(eventName, ...)` with no callback-specific unsubscribe, so this is a platform limitation to work around.

### 3. `ErrorContext.tsx:62-64,142-145` — Untracked animation `setTimeout` on unmount

`dismissError` and `dismissAllErrors` use raw `setTimeout` for 300ms animation delays but never store or clear those timer handles on unmount. The `dismissTimers` ref correctly tracks auto-dismiss timers, but these animation timers are completely untracked. Can schedule state updates after unmount.

## Valid but Lower Impact

### 4. `ErrorContext.tsx:116-132` — Error history replay tied to `addError` identity

`addError` is in the `useEffect` dependency array. Its identity changes when provider config props (e.g. `maxErrors`, auto-dismiss timeouts) change, which re-runs the effect and replays the entire error history via `errorHandler.getHistory()`, creating duplicates. Impact is conditional on whether those props actually change at runtime.

### 5. `ViewStateContext.tsx:152-158,277-289` — Partial context updates to refresh orchestrator

The `refreshOrchestrator.updateContext` calls omit cluster fields, but `clusterId` is already synced into refresh context from `KubeconfigContext` (`frontend/src/modules/kubernetes/config/KubeconfigContext.tsx:189`) and namespace context from `NamespaceContext` (`frontend/src/modules/namespace/contexts/NamespaceContext.tsx:320`). The real risk is transient mixed context due to partial updates from multiple providers — `RefreshManager` merges partial context (`frontend/src/core/refresh/RefreshManager.ts:258`).

**Status: Race confirmed by code path analysis (see Phase 4).** Mixed-context window exists during cluster tab switches when the two tabs are on different views. No repro test or instrumented log yet demonstrates end-to-end incorrect behavior. Needs a repro artifact before driving a fix.

## Low Priority / Style

### 6. `SidebarStateContext.tsx:111-115` / `ObjectPanelStateContext.tsx:187-190` — Inline functions in `useMemo`

Not ideal style but functionally equivalent to `useCallback` — both would produce a new reference when `clusterKey` changes, and the entire context value object changes anyway. No practical impact.

### 7. `AuthErrorContext.tsx:96-101,107-108` — Dynamic imports use relative paths

Uses `'../../../wailsjs/go/backend/App'` instead of the `@wailsjs/go/backend/App` alias used consistently elsewhere. Style/consistency nit, not a correctness issue.

## Fix Checklist

Ordered by recommended execution sequence. Risk/payoff assessed per item.

### Phase 1 — Low risk, immediate cleanup

- [x] ✅ **#3 + #4 — ErrorContext cleanup** (risk: very low | payoff: low-medium)
  - **#3**: Track 300ms animation `setTimeout` handles in a ref and clear on unmount. Same pattern already used for `dismissTimers` in the same file. Test: no state updates after provider unmount.
  - **#4**: Split the mount effect so history replay runs once, separate from the subscription effect. Test: changing provider config props does not duplicate errors.
  - Both are mechanical changes in the same file with near-zero regression surface. Payoff is modest — prevents a minor React warning (#3) and a latent duplicate-replay trap (#4). Worth doing together, not worth standalone PRs.

### ~~Phase 2 — Stop the bleeding~~ (skipped)

Skipped — not worth two rounds of changes. The infinite loop is wasteful but not destructive (polls a local backend call). Will be fixed properly in Phase 5 (orchestrator migration).

### Phase 3 — Correctness fix, scope depends on investigation

- [x] ✅ **#2 — AuthErrorContext EventsOff** (risk: low-medium | payoff: low in practice)
  - `EventsOn` returns a per-listener disposer (`frontend/wailsjs/runtime/runtime.d.ts:41`). Replaced `EventsOff` calls with per-listener disposers returned by `EventsOn`, invoked in the effect cleanup. This avoids the global listener removal problem and is StrictMode-safe (cleanup runs on remount, preventing duplicate handlers).
  - [x] ✅ **#7 — AuthErrorContext relative imports**: Replaced dynamic `import('../../../wailsjs/go/backend/App')` with static `import { RetryClusterAuth, GetAllClusterAuthStates } from '@wailsjs/go/backend/App'`.

### Phase 4 — Timeboxed investigation

- [x] ✅ **#5 — ViewStateContext partial updates** (investigation complete — race confirmed)

  **Finding: The race is real but narrow.** During a cluster tab switch, React effect ordering creates a window where the orchestrator holds mixed state: the old cluster's `selectedClusterId` combined with the new cluster's `currentView`/`activeNamespaceView`.

  **Mechanism:** React runs child effects before parent effects. `RefreshSyncProvider` (child, `ViewStateContext.tsx:277`) fires before `KubeconfigContext`'s effect (parent, `KubeconfigContext.tsx:206`). The first write updates view state without a `clusterId`; the second write updates `clusterId`. Between the two, `RefreshManager.updateContext` (`RefreshManager.ts:258`) performs a raw `{ ...this.context, ...context }` merge with no consistency validation.

  **Impact:** When `getManualRefreshTargets` (`RefreshManager.ts:480`) runs during the first write, it can select the wrong refresher — the one matching the new cluster's tab type, while `selectedClusterId` still points to the old cluster. `RefreshManager.updateContext` triggers manual refreshes immediately (`RefreshManager.ts:277`), `triggerManualRefreshMany` starts `refreshSingle` synchronously (`RefreshManager.ts:333`, `:625`), and refresh callbacks are invoked synchronously before awaiting (`RefreshManager.ts:818`). There is no guaranteed defer between the mixed-state write and refresh callback execution, so the refresh may execute against the mixed context — not just select the wrong refresher but also encode the wrong cluster scope.

  **Conditions:** Only triggers when two cluster tabs are on different views (different `viewType` or `activeNamespaceView`) at the time of switching. Same-view tabs produce no diff and no targets.

  **Mitigating factors (hypotheses, not verified by instrumentation):**
  - `normalizeNamespaceScope` (`orchestrator.ts:1072`) reads `this.context` at call time — if any async boundary exists before the actual HTTP call, Effect B may have corrected `selectedClusterId` by then. This has not been measured.
  - `contextVersion` guard exists (captured at `orchestrator.ts:1207`, checked at `orchestrator.ts:1287`, `:1329`) but is **not incremented** by the local tab-switch path via `setActiveKubeconfig`. Other kubeconfig event paths do bump it (`orchestrator.ts:1928`), but not this one.

  **Severity: Low-medium.** The race is confirmed by code path analysis. No repro test or instrumented log exists yet to demonstrate end-to-end incorrect behavior. The mixed-state window is real and refreshes may execute against it; the actual downstream impact (wrong cluster data fetched/displayed) has not been observed but cannot be ruled out.

  **Status: Needs a repro test or instrumented log before driving a fix.** If promoting to a fix, candidate directions:

  **Potential fix directions** (not yet scoped):
  1. Batch view state + clusterId into a single atomic `updateContext` call during tab switches
  2. Add a `contextVersion` bump to `setActiveKubeconfig` so stale refreshes are aborted
  3. Defer `triggerManualRefreshMany` behind a microtask so all synchronous effects settle first

### Phase 5 — Architectural alignment (larger effort)

- [ ] **#1 full — ObjectCatalogContext orchestrator migration** (risk: medium-high | payoff: high)
  - Migrate catalog readiness check to the refresh orchestrator flow per `frontend/AGENTS.md`. Removes the ad-hoc polling loop entirely. Touches the refresh pipeline — a core system — so needs understanding of how catalog readiness fits into the orchestrator's domain model and could affect startup sequencing. Test: catalog readiness is driven by orchestrator; no ad-hoc polling remains.
