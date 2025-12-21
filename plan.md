# Frontend memoization + update-depth scan

## Redundant memoization candidates

- ✅ Completed: inlined viewState-bound callbacks in `frontend/src/App.tsx` (kept `handleToggleAppLogsPanel` intact).

- ✅ Completed: removed redundant `useMemo` in `frontend/src/shared/components/tables/hooks/useGridTableHeaderRow.tsx`.

- ✅ Completed: removed redundant `useCallback` in `frontend/src/shared/components/tables/hooks/useGridTableRowRenderer.tsx`.

- ✅ Completed: removed memoization for `shouldShowSpinner` (cheap boolean) in `frontend/src/shared/components/ResourceLoadingBoundary.tsx`.

- Reviewed: keep — `frontend/src/shared/components/tables/hooks/useFrameSampler.ts:36`: not redundant; the `useMemo` fallbacks stabilize function references used by `start`/`stop` so `useEffect([stop])` doesn’t churn on every render.

- ✅ Completed: inlined `handleAboutClose` in `frontend/src/ui/layout/AppLayout.tsx`.

- ✅ Completed: moved `resourceViews` to a module constant in `frontend/src/ui/layout/Sidebar.tsx`.

- ✅ Completed: moved `namespaceViews` to a module constant in `frontend/src/ui/layout/Sidebar.tsx`.

- ✅ Completed: moved log-level option arrays/defaults to module constants in `frontend/src/components/content/AppLogsPanel/AppLogsPanel.tsx`.

- ✅ Completed: removed redundant memos in `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelKind.ts`.

- ✅ Completed: inlined `hasUtilization` calculation in `frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts`.

- ✅ Completed: inlined `activeYaml` calculation in `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx`.

## Potential maximum update depth risks

- ✅ User report: error triggers immediately when opening the object panel on the Details tab (Logs/Events tabs not mounted yet). Focus investigation on panel open/close synchronization, refresh context updates, and GridTable resize/column width feedback loops triggered by layout changes.

- `frontend/src/shared/components/tables/useGridTableFilters.ts:92`: low risk in current call sites. A repo-wide scan shows no production usage of `filters.initial` outside tests; all GridTable consumers pass controlled `filters.value` from persistence state. The effect only runs for uncontrolled filters with `filters.initial`, so the update-depth risk is theoretical unless a caller starts passing a freshly created `initial` object each render.

- ✅ `frontend/src/shared/components/tables/hooks/useColumnVisibilityController.ts:34`: low risk in current call sites. `columnVisibility` only comes through `frontend/src/shared/components/tables/GridTable.tsx:167` and is sourced from `useGridTablePersistence`/`useNamespaceGridTablePersistence` state (stable by reference). The effect only mirrors props into local state and does not call `onColumnVisibilityChange`, so it cannot form a feedback loop by itself. It could still cause extra renders if a parent supplies a freshly created object every render, but that pattern is not present in current GridTable consumers.

- `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:790`: the `parsedCandidates` → `parsedLogs` syncing effect dispatches on every `parsedCandidates` change, with no guard against re-setting the same array. Because `parsedCandidates` is derived from `logEntries` and can be a fresh array each refresh tick, this can drive repeated state updates while the parsed GridTable is mounted. If `logEntries` is churned by streaming updates or store refreshes, this is a plausible update-depth hotspot. Consider an equality guard (e.g., compare lengths/keys or a memoized signature) before dispatching.

- `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:669`: workload-mode effect rebuilds `availablePods`/`availableContainers` and dispatches on every `logEntries` reference change. If the refresh store emits new `entries` arrays per tick (even with identical content), this can repeatedly update reducer state and compound render churn while GridTable is active. A shallow equality check before dispatching would help avoid cascading updates.

- ✅ `frontend/src/shared/components/tables/GridTable.tsx:106`: defaulting `nonHideableColumns` to a new `[]` each render makes `useColumnVisibilityController` rebuild `lockedColumns` every render, which in turn makes `renderedColumns` a fresh array each render. That cascades into `useGridTableColumnWidths` (`useSyncRenderedColumns`) marking columns dirty every render, which can trigger repeated width updates when column auto-sizing is enabled. In object-panel GridTables (pods/events/logs parsed view), this is a potential feedback loop if widths are recomputed on every render.

- `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:165`: LogViewer subscribes to the refresh store via `useRefreshScopedDomain` and also writes to the same scoped domain via `setScopedDomainState` (mapEntriesToSnapshot). This mirrors the BrowseView warning about `useSyncExternalStore` + nested store updates; with log streaming enabled, these synchronous store writes can cause nested renders if triggered frequently.

- `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:338`: the active-pod filtering effect rewrites the `object-logs` scoped domain when `normalizedActivePods` and `logEntries` diverge. Because `normalizedActivePods` is derived from `activePodNames` and is a new array each render, the effect re-runs on every parent render; if log streaming keeps introducing inactive pod entries, this can become a rapid update loop in the same store the component subscribes to.

- `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:455`: fallback recovery writes `object-logs` scoped state inside a retry loop while the component is still subscribed. If recovery toggles quickly (e.g., intermittent stream failures) this can chain store updates and re-renders without a stabilizing guard.

- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx:48`: `detailTabProps` is rebuilt every render, so `activePodNames` is recomputed every render and passed into LogViewer. This makes `normalizedActivePods` unstable even when pods haven't changed, increasing the odds that the log filtering effect re-runs and rewrites the refresh store on each render.

- `frontend/src/modules/object-panel/hooks/useObjectPanel.ts:31`: `openWithObject` depends on `panelState` and `onRowClick` (which changes with `navigationIndex`). In PodsTab, columns are memoized with `openWithObject` as a dependency, so navigation history updates can force column definitions to churn and trigger GridTable re-measurement/state updates while the panel is open.

- `frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx:81`: the scoped-domain enable/disable effect depends on `objectData`. If `objectData` is re-created by callers (or re-selected from fresh row objects) while the panel is open, the cleanup will reset the `object-events` scope on every render and immediately re-enable it. Because the tab uses `useRefreshScopedDomain`, this can create nested store updates and render loops. Prefer depending on stable keys (`eventsScope`, `isActive`) and avoid resetting the scope when the value has not truly changed.

- ✅ `frontend/src/core/contexts/ObjectPanelStateContext.tsx:46`, `frontend/src/core/contexts/ViewStateContext.tsx:186`, `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.ts:116`: object panel open/close updates were pushed to `refreshOrchestrator.updateContext` in three separate places. Consolidated to a single writer (`RefreshSyncProvider`) to reduce update-depth risk.

- `frontend/src/components/dockable/DockablePanel.tsx:406` + `frontend/src/modules/object-panel/hooks/useObjectPanel.ts:37`: controlled-panel sync and object-panel sync both call `setOpen` in effects. In combination with dock conflicts or open-state transitions, this can cause repeated open/close updates. When a GridTable is mounted, the resulting re-renders can cascade through column sizing/persistence and contribute to update-depth errors.

- `frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabData.tsx:21`: effect unconditionally calls `setShowDecoded(false)` whenever the `data` prop identity changes. If `data` is recreated each render (e.g., details payload mappings or refresh snapshots that allocate new objects even with identical content), this can drive a render/update loop while the Details tab is active.

- `frontend/src/shared/components/tables/hooks/useGridTableVirtualization.ts:96` and `frontend/src/shared/components/tables/GridTableBody.tsx:89`: opening the docked panel can change the wrapper dimensions, which updates virtual viewport height + scrollbar width. If `contentWidth` toggles scrollbars on/off while column widths are auto-measured, `ResizeObserver` → `setVirtualViewportHeight`/`setScrollbarWidth` → layout shift can loop. This is a layout-driven update chain that only appears when the panel changes width.

- `frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.helpers.ts:120` and `frontend/src/shared/components/tables/GridTable.tsx:615`: container width changes trigger `recalculateForContainerWidth`, which can update column widths and notify persistence. If persisted widths re-enter via `controlledColumnWidths` with tiny deltas, it can bounce between `setColumnWidths` and `onColumnWidthsChange` on every layout resize (open panel is a trigger). This is more likely if column widths are near min/max limits.

- `frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.helpers.ts:420`: the initial measurement/reconcile effect runs in rAF whenever `renderedColumns`, `columnWidths`, `useShortNames`, or `tableData` change. If any of those churn per render (e.g., columns rebuilt due to object panel open, or data arrays recreated each refresh), the effect can call `setColumnWidths` on every frame. Combined with docked-panel width changes, this can become a feedback loop.

- `frontend/src/shared/components/tables/hooks/useGridTableAutoGrow.ts:27`: auto-grow re-measures kind/type columns and calls `setColumnWidths` if widths are below measured values. With unstable `renderedColumns`/`externalColumnWidths` references, it will run every render and can repeatedly update widths when the panel open changes text wrapping or font metrics.

- `frontend/src/shared/components/tables/hooks/useContainerWidthObserver.ts:38` + `frontend/src/shared/components/tables/GridTable.tsx:603`: the resize observer calls `recalculateForContainerWidth` on every width change and unconditionally re-applies column widths. If opening the docked panel causes scrollbar appearance/disappearance (clientWidth bouncing), this can create an update loop even without user interaction.

- `frontend/src/shared/components/tables/hooks/useGridTableVirtualization.ts:120` + `frontend/src/shared/components/tables/hooks/useGridTableVirtualization.ts:315`: `setVirtualViewportHeight` (resize observer) and `setVirtualRowHeight` (first-row measurement) can oscillate if row height depends on column widths that are being auto-measured/fit while the panel is open. This can create repeated state updates tied to layout changes.

- `frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.helpers.ts:64`: `useWatchTableData` marks auto-width columns dirty on any `tableData` ref change, scheduling width recalculation. If list data is re-created each refresh (common when object panel opens and triggers refresh context updates), the auto-width queue can keep mutating widths and re-rendering.

- `frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.ts:101`: the focus/hover sync effect clamps focus on any `tableData` change and calls `updateHoverForElement`. If refresh churn keeps changing `tableData` refs while focus is active, this can repeatedly update hover state and contribute to update-depth churn.

- `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods.ts:47`: even on Details tab, the hook subscribes to `pods` scoped state via `useRefreshScopedDomain`. If `objectData` churns (new object each render), the effect tears down and re-enables scoped pods repeatedly, which can cause nested refresh store updates (similar to the BrowseView warning) while the panel opens.

- ✅ `frontend/src/ui/shortcuts/context.tsx:167` + `frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx:33`: opening the object panel always calls `setContext`, causing a full keyboard-context state update. This re-renders the tree and can amplify any GridTable layout/column width loops that are already firing due to the panel width change.

- ✅ Stack trace corroboration (reported from any view when opening the object panel):
  - ✅ `frontend/src/shared/components/tables/hooks/useGridTableShortcuts.ts:61` cleanup runs `popShortcutContext`, which calls `setContextStack` in `frontend/src/ui/shortcuts/context.tsx:202`. The error shows `context.tsx` + `useGridTableShortcuts` in the same loop, implying `shortcutsActive` is flapping (effect cleanup + re-run) during panel open. This is a concrete update-depth loop candidate.
  - `frontend/src/shared/components/tables/hooks/useGridTableHoverSync.ts:52` and `frontend/src/shared/components/tables/hooks/useGridTableHoverSync.ts:83` (`setHoverState`) appear in the stack trace, indicating hover sync is re-setting state repeatedly during the panel-open cycle.
  - `frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.ts:74`-`frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.ts:96` (`setFocusedRowIndex`/focus state) appears in the stack trace, suggesting focus events or refocus logic are firing repeatedly while the panel is open.
  - ✅ `frontend/src/core/refresh/RefreshManager.ts:398`-`frontend/src/core/refresh/RefreshManager.ts:411` (`abortRefresher` → `emitStateChange`) shows in the stack trace via `frontend/src/core/events/eventBus.ts:49`, confirming refresh-context churn during panel open. This aligns with the multiple `updateContext` writers identified earlier.

- ✅ `frontend/src/core/contexts/ObjectPanelStateContext.tsx:46` + `frontend/src/core/contexts/ViewStateContext.tsx:186` + `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.ts:116`: multiple `updateContext` writers may report different `objectKind` casing (`Pod` vs `pod`). `RefreshManager.didObjectPanelTargetChange` treats casing as a change, which can cause `abortRefresher` loops (matching the eventBus stack trace).

## Remaining work (prioritized)

- ✅ P1: consolidate object-panel context updates to a single `refreshOrchestrator.updateContext` writer (`frontend/src/core/contexts/ObjectPanelStateContext.tsx`, `frontend/src/core/contexts/ViewStateContext.tsx`, `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.ts`).
- ✅ P1: add guards for resize-driven loops across docked panel layout + GridTable width reconciliation (`frontend/src/components/dockable/DockablePanel.tsx`, `frontend/src/shared/components/tables/GridTable.tsx`, `frontend/src/shared/components/tables/hooks/useContainerWidthObserver.ts`).
- ✅ P1: investigated focus/hover re-entry risk; current guards in `useGridTableFocusNavigation` + `useGridTableHoverSync` already de-dupe state updates, so no change needed unless errors persist (`frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.ts`, `frontend/src/shared/components/tables/hooks/useGridTableHoverSync.ts`).
- P2: stabilize object-panel scoped-domain effects (details/events/pods) so they only toggle when scopes truly change (`frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx`, `frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx`, `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods.ts`, `frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabData.tsx`, `frontend/src/modules/object-panel/hooks/useObjectPanel.ts`).
- P2: guard GridTable sizing/virtualization loops (auto-grow, initial measurement, row height changes) against render churn (`frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.helpers.ts`, `frontend/src/shared/components/tables/hooks/useGridTableAutoGrow.ts`, `frontend/src/shared/components/tables/hooks/useGridTableVirtualization.ts`).
- P3: address logs-tab state churn/refresh store writes (`frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx`).
- P4: low-risk filter-init loop and redundant memoization cleanup (`frontend/src/shared/components/tables/useGridTableFilters.ts`, memoization list above).
