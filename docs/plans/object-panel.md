# Object Panel Review Findings

Review of `frontend/src/modules/object-panel/`.

## Critical Issues (Must Fix)

### 1. PodsTab uses global `selectedClusterId` instead of panel-specific clusterId

`ObjectPanel/Pods/PodsTab.tsx:62` — `useKubeconfig().selectedClusterId` reflects whichever cluster the user last clicked in the sidebar, not the cluster of the object panel. This is passed to `useGridTablePersistence` as `clusterIdentity` (line 229), meaning persistence keys resolve against the wrong cluster when the user switches sidebar context.

**Fix:** PodsTab already calls `useObjectPanel()` on line 61, which returns `objectData`. Use `objectData?.clusterId` for `clusterIdentity` instead of `selectedClusterId`, and remove the `useKubeconfig()` import.

**Verify:** Write a test confirming that when `selectedClusterId` differs from the panel's `objectData.clusterId`, the persistence key uses the panel-scoped value.

- [x] ✅ Fix — replaced `useKubeconfig().selectedClusterId` with `useObjectPanel().objectData?.clusterId`, removed unused import. Test in `PodsTab.test.tsx` confirms panel-scoped identity is used.

### 2. EventsTab drops cluster metadata when mapping events, then falls back to parent cluster

`ObjectPanel/Events/EventsTab.tsx:172-195` — `ObjectEventSummary` extends `ClusterMeta` (which includes `clusterId` and `clusterName`), so per-event cluster identity is available from the backend. However, the mapping into `EventDisplay` (line 172) drops these fields entirely. Then `openRelatedObject` (line 214-234) falls back to the parent panel's `objectData?.clusterId`.

**Fix:** Add `clusterId` and `clusterName` to the `EventDisplay` interface. Carry `event.clusterId`/`event.clusterName` through in the mapping at line 172. In `openRelatedObject`, prefer the event's cluster fields over the parent panel fallback.

**Verify:** Write a test confirming that when an event has its own `clusterId`, `openRelatedObject` uses the event's cluster identity rather than the parent panel's.

- [x] ✅ Fix — Added `clusterId`/`clusterName` to `EventDisplay`, carried through from `ObjectEventSummary` in the mapping, and `openRelatedObject` now prefers per-event cluster over parent fallback. Test in `EventsTab.test.tsx` covers both cases.

## Important Issues (Should Fix)

### 3. Log stream recovery uses raw timers as a local retry scheduler

`Logs/LogViewer.tsx:550-561` — The `setTimeout`/`setInterval` loop is a local retry scheduler for stream recovery. The recovery function itself correctly routes through `refreshOrchestrator.restartStreamingDomain()` (line 521) and manages scoped domain state (lines 510-518, 534). The timers are not a direct-fetch bypass of the orchestrator — they schedule retries of orchestrator-mediated recovery.

The pattern is functional but has no backoff, no max-retry cap, and is not visible to the orchestrator's diagnostics. Consider whether the retry scheduling itself should be managed by a dedicated mechanism (e.g., the `objectLogFallbackManager`) rather than raw timers, to get backoff and observability.

- [x] ✅ Fix — Replaced fixed `setInterval` with `setTimeout`-based retry using exponential backoff (3s, 6s, 12s, ... capped at 30s) and a max of 8 attempts. Recovery still routes through `refreshOrchestrator.restartStreamingDomain()`. On success, `fallbackActive=false` tears down the effect; on max retries exhausted, stops retrying.

### 4. 100ms `setTimeout` after `CreateDebugContainer` is a race condition

`Shell/ShellTab.tsx:802-804` — No guarantee the container will be ready after 100ms. On a slow cluster, this could fail intermittently.

**Fix:** Replace with a retry loop that polls for container readiness, or handle connection failure gracefully with automatic retry.

- [x] ✅ Fix — Removed the 100ms `setTimeout`. The backend's `CreateDebugContainer` already polls via `waitForEphemeralContainer` until the container is Running before returning, so the frontend can call `initiateConnection()` immediately. If the connection still fails, the existing error handling + reconnect button covers it.

### 5. Static inline styles violate "never use inline CSS" convention

`DetailsTab.tsx:239,273,289`, `LogViewer.tsx:1000,1064-1069,1268-1271,1346,1352` — Static layout styles and spacing should be CSS classes. Dynamic values like pod colors can use CSS custom properties.

- [x] ✅ Fix — DetailsTab: replaced 3 inline `marginTop` with `.details-section-spaced` class. LogViewer: removed redundant inline styles on `.parsed-log-cell` (already in CSS), replaced static dropdown layout with `.log-option-row`/`.log-option-check`/`.log-option-label` classes, replaced dynamic pod colors with `--pod-color` CSS custom property + `.pod-color-text`/`.pod-log-metadata--bold` classes.

### 6. `objectData` prop typed as `any`

`Events/EventsTab.tsx:31` — Should be `PanelObjectData | null` from the module's own `types.ts`.

- [x] ✅ Fix — Changed `objectData?: any` to `objectData?: PanelObjectData | null`, added import from `../types`.

### 7. `useObjectPanelKind` is not a React hook

`components/ObjectPanel/hooks/useObjectPanelKind.ts:28-63` — Named as a hook but contains zero React hooks; it's a pure function. Either rename to `getObjectPanelKind`/`computeObjectPanelKind`, or wrap the return in `useMemo`.

- [x] ✅ Fix — Renamed to `getObjectPanelKind` (file and export). Simplified test to call the function directly without a React rendering harness. Updated import in `ObjectPanel.tsx`.

### 8. Module-level mutable `closeCallback` in useObjectPanel (test-only, low risk)

`hooks/useObjectPanel.ts:44` — Module-level mutable variable set by `useEffect`. In a multi-panel scenario only the last-mounted panel sets the callback. However, `closeObjectPanelGlobal()` is explicitly documented as test-only (`@lintignore`, line 123) and the callback is sourced from shared context (line 76). Practical runtime risk is low unless non-test usage is planned.

- [x] ✅ Documented and deferred — Added comments documenting the "last mount wins" limitation and test-only scope. The module-level mutable callback pattern is unchanged; practical risk is low since `closeObjectPanelGlobal` is only called from tests. A behavioral fix (e.g., replacing with a context-based approach) is not warranted unless non-test usage is planned.

### 9. `Record<string, any>` throughout ValuesTab helpers

`Helm/ValuesTab.tsx:33+` — All helper functions accept `any` parameters. Consider a recursive value type for better type safety.

- [ ] Fix

## Suggestions (Nice to Have)

### 10. Duplicate `CLUSTER_SCOPE` constant across files

`EventsTab.tsx:36`, `LogViewer.tsx:39` duplicate the constant already in `constants.ts`. Import from `constants.ts` instead.

- [ ] Fix

### 11. Keyboard shortcuts are hardcoded to tab identities, not indices

`components/ObjectPanel/hooks/useObjectPanelTabs.ts:119+` — Shortcuts map `1` to `details`, `2` to `logs`, etc. by tab identity, not array index. Some shortcuts are capability-gated (e.g., `2`/logs checks `capabilities.hasLogs`, line 146), but others are not — for example, `3`/events and `4`/yaml (line 151+) are always registered even though Helm releases filter out the events and yaml tabs (line 62-63). This means user-visible shortcut numbers can mismatch the rendered tab bar for Helm/Event objects.

**Fix:** Derive shortcut labels/bindings from the `availableTabs` array so numbering reflects only visible tabs.

- [ ] Fix

### 12. LogViewer at 1410 lines

Already well-structured with extracted hooks and a reducer, but fallback/recovery logic could be extracted into its own hook (e.g., `useLogStreamFallback`).

- [ ] Refactor

### 13. Generic boilerplate file comments add no value

Several files have comments like "UI component for EventsTab. Handles rendering and interactions for the object panel feature." — no information beyond the filename.

- [ ] Fix

### 14. 33-dependency `useMemo` in `useOverviewData`

`Details/useOverviewData.ts:648-682` — The main `useMemo` has 33 dependencies. Hard to verify correctness. Consider breaking into smaller memos per resource kind.

- [ ] Refactor

### 15. Inverted `isManual` flag in EventsTab `onRefresh`

`EventsTab.tsx:156-159` — `isManual` is inverted before passing to `fetchEvents`. The double-negation is confusing; at minimum needs a comment explaining the reasoning.

- [ ] Fix
