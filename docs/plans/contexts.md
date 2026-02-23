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

The `refreshOrchestrator.updateContext` calls omit cluster fields, but `clusterId` is already synced into refresh context from `KubeconfigContext` (`frontend/src/modules/kubernetes/config/KubeconfigContext.tsx:189`) and namespace context from `NamespaceContext` (`frontend/src/modules/namespace/contexts/NamespaceContext.tsx:320`). The real risk is transient mixed context due to partial updates from multiple providers — `RefreshManager` merges partial context (`frontend/src/core/refresh/RefreshManager.ts:258`). Lower confidence without a concrete repro.

**Status: Needs investigation.** Before this drives a fix, a concrete scenario or test must prove that mixed refresh context can actually occur (e.g. rapid cluster tab switching producing a refresh call with mismatched clusterId and view state).

## Low Priority / Style

### 6. `SidebarStateContext.tsx:111-115` / `ObjectPanelStateContext.tsx:187-190` — Inline functions in `useMemo`

Not ideal style but functionally equivalent to `useCallback` — both would produce a new reference when `clusterKey` changes, and the entire context value object changes anyway. No practical impact.

### 7. `AuthErrorContext.tsx:96-101,107-108` — Dynamic imports use relative paths

Uses `'../../../wailsjs/go/backend/App'` instead of the `@wailsjs/go/backend/App` alias used consistently elsewhere. Style/consistency nit, not a correctness issue.

## Fix Checklist

Ordered by recommended execution sequence. Risk/payoff assessed per item.

### Phase 1 — Low risk, immediate cleanup

- [ ] **#3 + #4 — ErrorContext cleanup** (risk: very low | payoff: low-medium)
  - **#3**: Track 300ms animation `setTimeout` handles in a ref and clear on unmount. Same pattern already used for `dismissTimers` in the same file. Test: no state updates after provider unmount.
  - **#4**: Split the mount effect so history replay runs once, separate from the subscription effect. Test: changing provider config props does not duplicate errors.
  - Both are mechanical changes in the same file with near-zero regression surface. Payoff is modest — prevents a minor React warning (#3) and a latent duplicate-replay trap (#4). Worth doing together, not worth standalone PRs.

### Phase 2 — Stop the bleeding

- [ ] **#1 interim — ObjectCatalogContext cap the retry loop** (risk: low | payoff: medium)
  - Add a max retry count and/or exponential backoff to the existing 1s polling loop. This is a temporary mitigation only — the final fix is orchestrator migration (Phase 5). Test: verify retry stops after limit when catalog is disabled.
  - Low risk because it only constrains existing behavior. Payoff stops a loop that runs indefinitely in a valid app state.

### Phase 3 — Correctness fix, scope depends on investigation

- [ ] **#2 — AuthErrorContext EventsOff** (risk: low-medium | payoff: low in practice)
  - First: verify whether `AuthErrorProvider` is app-lifetime (mounted at root, never unmounts). If yes, remove the `EventsOff` cleanup entirely and document the constraint — 5-minute fix. If no, or if a second subscriber exists/is planned, introduce a singleton listener per `cluster:auth:*` event with local fanout/ref-counting so no component calls `EventsOff` directly.
  - The bug is real but dormant — it only fires on provider unmount. Operational frequency is likely near zero if the provider is app-lifetime. Don't build fanout infrastructure unless needed.
  - Test (if fanout): multiple subscribers survive a single consumer unmount. Test (if removal): assert provider is mounted at app root only.
  - **#7 — AuthErrorContext relative imports**: ride-along fix if editing this file. Replace dynamic relative imports with static `@wailsjs` alias imports. No test needed. (risk: near zero | payoff: near zero)

### Phase 4 — Timeboxed investigation

- [ ] **#5 — ViewStateContext partial updates** (risk: investigation only | payoff: unknown)
  - Write a test that proves or disproves mixed refresh context during rapid cluster switching (e.g. a refresh call fires with mismatched clusterId and view state). Timebox to 1-2 hours. If no repro, deprioritize. If confirmed, promote to a fix — but note that touching the orchestrator's context merge path (`RefreshManager.ts:258`) is high-traffic and needs careful scoping.

### Phase 5 — Architectural alignment (larger effort)

- [ ] **#1 full — ObjectCatalogContext orchestrator migration** (risk: medium-high | payoff: high)
  - Migrate catalog readiness check to the refresh orchestrator flow per `frontend/AGENTS.md`. Removes the ad-hoc polling loop entirely. Touches the refresh pipeline — a core system — so needs understanding of how catalog readiness fits into the orchestrator's domain model and could affect startup sequencing. Test: catalog readiness is driven by orchestrator; no ad-hoc polling remains.
