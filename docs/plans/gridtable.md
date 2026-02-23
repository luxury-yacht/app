# GridTable Code Review

## Critical Issues

### 1. ✅ Three view IDs missing from registry — GC deletes their persisted state

`persistence/gridTableViewRegistry.ts` hard-codes 18 view IDs. The GC in `gridTablePersistenceGC.ts:88-91` deletes any persisted key whose `viewId` isn't in the registry. Three viewIds are used in persistence but not registered:

- `object-panel-pods` — used in `PodsTab.tsx:223`
- `cluster-custom` — used in `ClusterViewCustom.tsx:142`
- `namespace-browse` — used in `BrowseView.tsx:98` (namespace-scope fallback)

Every cluster change runs GC and wipes the saved state (sort, column visibility, widths) for all three views. A registry-vs-usage contract test should be added to prevent future drift (see Test Coverage Gaps).

### 2. ✅ Sort Desc / Clear Sort uses stale-closure double-`onSort` hack

`useGridTableContextMenuItems.tsx:75-98` — "Sort Desc" calls `onSort` twice (once sync, once via `setTimeout`) assuming the parent toggles asc→desc. The second call uses a stale `sortConfig` closure. If the parent's state machine doesn't match this assumption, the sort direction is wrong.

### 3. ✅ Broken keyboard selector — filter search is never tab-navigable

`GridTableKeys.ts:63` queries for `[data-gridtable-filter-role="search"]`, but `GridTableFiltersBar.tsx:142` uses `data-gridtable-filter-role="search-wrapper"`. The selector never matches, so keyboard tab-cycling permanently skips the search input.

### 4. ✅ DOM selector for focused row returns `null` — hover-sync silently fails

`useGridTableFocusNavigation.ts:189-193` and `GridTable.tsx:583` both use `[data-row-key="..."] .gridtable-row` (descendant selector), but in `useGridTableRowRenderer.tsx:98-103` both `data-row-key` and `.gridtable-row` are on the **same** element. The descendant selector never matches, so `updateHoverForElement` is never called via keyboard navigation — the hover overlay does not track the focused row. In virtualized mode, scroll-into-view falls through to a fallback (`GridTable.tsx:593-614`, gated by `shouldVirtualize`) that partially compensates for scrolling but without hover highlight. In non-virtualized mode, there is no fallback — keyboard scroll-into-view fails entirely. Fix both selector sites: use `.gridtable-row[data-row-key="${escapedKey}"]`.

### 5. ✅ `buildClusterScopedKey` silently drops cluster scoping when `clusterId` is missing

`GridTable.utils.ts:77-81` — When a row has no `clusterId`, the function returns the bare `baseKey` with no cluster prefix. A dev-mode warning is logged when `clusterName` exists but `clusterId` is missing (`GridTable.utils.ts:69`), but rows that lack cluster identity entirely produce no warning. In a multi-cluster view, two rows with the same name from different clusters (e.g., a Pod named "app" in cluster-a and cluster-b) will produce identical keys, causing React to reuse the same DOM node, the focus tracker to navigate to the wrong item, and the context menu to act on the wrong resource. This extends issue 22 (usage not enforced) with a concrete collision path.

---

## Important Issues

### 6. ✅ Direct mutation of `hoverRowRef` owned by another hook

`useGridTableVirtualization.ts:357` writes `hoverRowRef.current = null` directly, followed by `updateHoverForElement(null)` on line 358. This appears to violate the ownership boundary (only `useGridTableHoverSync` should write to its ref), but is likely intentional: `updateHoverForElement` early-returns without clearing the ref when hover is suppressed (`useGridTableHoverSync.ts:61-63`). The direct mutation ensures a detached DOM node (`!current.isConnected`) is cleared from `hoverRowRef` even during suppression. Fix: add a force-clear path to `updateHoverForElement` (e.g., an `options.force` parameter) so the virtualizer doesn't need to reach into the ref directly.

### 7. ✅ `filters?.initial` object in useEffect deps resets search state

`useGridTableFilters.ts:103-108` — If the parent passes `filters={{ initial: { search: '' }, enabled: true }}` as a literal, `filters.initial` is a new reference every render, resetting user-typed search text.

### 8. ✅ DOM node leak in `measureColumnWidth` on exception

`useGridTableColumnMeasurer.ts:109-197` — Both `headerMeasurer` (appended at line 117, removed at line 124) and `cellMeasurer` (appended at line 139, removed at line 197) are attached to `document.body` without `try/finally`. If code between append and remove throws (e.g., `column.render()` or `renderToString()`), the nodes leak. Wrap both in `try/finally`.

### 9. ✅ `setTimeout` in context menu sort logic is never cancelled

`useGridTableContextMenuItems.tsx:76-92` — The `setTimeout` calls in "Sort Desc" and "Clear Sort" have no corresponding `clearTimeout`. If the component unmounts between the sync and deferred `onSort` calls, the timeout fires on a stale closure against an unmounted component. Related to issue 2 but a distinct leak/correctness concern.

### 10. ✅ `autoSize` event permanently disables auto-sizing

`useGridTableAutoWidthMeasurementQueue.ts:165-176` — The `autoSize` event type is grouped with `dragStart` in the disabling block, which sets `isAutoSizingEnabledRef.current = false` before control reaches `markColumnsDirty(keys)` at line 212. But `markColumnsDirty` has an early-return guard at line 117 that checks `isAutoSizingEnabledRef.current`, so the call is always a no-op. The `reset` event correctly re-enables the flag at line 207 before calling `markColumnsDirty`, but `autoSize` has no equivalent re-enable step. After calling autoSizeColumn, all subsequent data-driven auto-width updates are also suppressed because the flag stays `false` permanently until a `reset` event arrives.

### 11. `ReactDOMServer.renderToString` called synchronously on the main thread

`useGridTableColumnMeasurer.ts:185-188` — `ReactDOMServer.renderToString` is called synchronously for every non-kind column cell during width measurement, up to 400 samples per column (capped at line 144). This blocks the main thread during every auto-width remeasurement pass. Consider `renderToStaticMarkup` or DOM-based measurement instead.

---

## Needs Investigation

These issues describe plausible concerns in complex code paths but have not been confirmed with a failing test. They should be validated before acting on them.

### 12. `persistenceCache` singleton and `force: true` race hazard

`gridTablePersistence.ts:119-121` — `persistenceCache`, `hydrated`, and `hydrationPromise` are module-level singletons. `GetGridTablePersistence` returns the full persisted map for all clusters (`backend/app_persistence.go:194`), and keys are already cluster-scoped, so reads are correct under normal operation. The current codebase only calls `hydrateGridTablePersistence()` without `force: true` (`useGridTablePersistence.ts:148`, `gridTablePersistenceGC.ts:61`), so the forced-hydration scenarios described below are not currently exercised.

Two related API-design concerns exist if `force: true` is ever used:
1. The shared `hydrated` flag means a `force: true` caller would replace the cache for all clusters, and the API does not prevent this.
2. Two concurrent `force: true` callers (`gridTablePersistence.ts:162-186`) would each create their own hydration promise. The `finally` block only nulls out `hydrationPromise` for the caller that finishes last, and the two `fetchGridTablePersistence()` calls assign to `persistenceCache` in an uncontrolled order — the later-resolving call wins silently.

These are API-design hazards rather than current production bugs. Requires a scenario where `force: true` is actually called to confirm impact.

### 13. Ref mutation during render in `useGridTablePagination`

`useGridTablePagination.ts:45-48` mutates `inFlightRef.current` in the render body. This technically violates React's rules and could behave unexpectedly with StrictMode double-invocation or concurrent features, but no incorrect behavior has been reproduced. The pattern is a code smell worth fixing (move to `useEffect`), but severity depends on whether the app enables StrictMode or concurrent rendering. Requires a failing test to confirm impact.

### 14. Render-time ref mutation in `GridTableBody` stretch decision

`GridTableBody.tsx:88-126` — `stretchDecisionRef.current` is written during render via an IIFE. Same concern as issue 13: technically a side-effect that violates React's render purity rules, but no incorrect behavior has been reproduced under the current rendering mode. Requires a failing test to confirm impact.

### 15. Save effect may race with load after `storageKey` change

`useGridTablePersistence.ts:129-137` — When `storageKey` changes (namespace/cluster switch), the reset effect sets all state to null. In theory, if `setHydrated(true)` from the load resolves before the null-state save effect evaluates its guard, the save effect could call `clearPersistedState` on the **new** key. However, the current effect ordering and closures may prevent this in practice. Requires a failing test to confirm.

### 16. `lastHydratedPayloadRef` not reset on `storageKey` change

`useGridTablePersistence.ts:129-137` — `lastSavePayloadRef` is reset but `lastHydratedPayloadRef` is not. This could in theory cause a spurious `clearPersistedState` call on the **new** key when the previous key had persisted state, but the actual race window depends on effect ordering that may prevent it. Requires a failing test to confirm.

### 17. `didChange` read after async rAF boundary

`useGridTableColumnWidths.helpers.ts:271-316` — A `let didChange` variable is set inside a `setColumnWidths` updater (async batched) but read in a `requestAnimationFrame` callback. If React batches the update after rAF fires, `didChange` could be `false` when checked. This is a plausible concurrency hazard but has not been confirmed with a repro or failing test.

### 18. `columnWidths` in effect deps may cause extra effect runs

`useGridTableColumnWidths.helpers.ts:671` — The `useInitialMeasurementAndReconcile` effect lists `columnWidths` (state) as a dependency. The effect calls `setColumnWidths`, which updates `columnWidths`, re-triggering the effect. However, explicit guards at lines 447-453 (checking signatures and flags) prevent an unbounded loop. This may cause unnecessary extra effect runs but is not a runaway loop.

---

## Low Priority / Speculative Optimizations

### 19. Module-level `hoverSuppressionCount` not HMR-safe (dev-only)

`useGridTableShortcuts.ts:17` — Module-level mutable counter resets to 0 on HMR while the `gridtable-disable-hover` class may still be on `document.body`. This is a dev ergonomics issue only — HMR does not run in production.

### 20. `useGridTableRowRenderer` returns unmemoized function

`useGridTableRowRenderer.tsx:75` — Returns a plain arrow function, not `useCallback`-wrapped. Every parent render produces a new reference. However, the current downstream consumers (`GridTable.tsx:719`, `GridTableBody.tsx:94`) do not rely on reference equality via `React.memo` for this prop, so the practical impact is not demonstrated. This is a speculative optimization rather than a current bug.

### 21. `renderSortIndicator` / `handleHeaderClick` not memoized

`GridTable.tsx:701-717` — Both are plain function declarations recreated every render, passed into `useGridTableHeaderRow`. However, `useGridTableHeaderRow` (`useGridTableHeaderRow.tsx:23`) always rebuilds header JSX on every call regardless — it does not memoize its output. Wrapping these functions in `useCallback` alone would not avoid header recalculation without also memoizing the hook's return value.

---

## Multi-Cluster Awareness Concerns

### 22. `buildClusterScopedKey` usage is not enforced

`GridTable.utils.ts:77-81` provides a cluster-prefixed key builder, but `keyExtractor` is a user-provided prop with no documentation, warnings, or dev-time validation requiring cluster-scoped keys. Two rows from different clusters with the same name will silently collide. See also issue 5 for the silent fallback when `clusterId` is missing.

### 23. `isNamespaceScoped` duplicated into `filterOptions`

`useNamespaceGridTablePersistence.ts:69-81` passes `isNamespaceScoped` both as a top-level param and inside `filterOptions`. The top-level always wins, making the duplication misleading.

---

## Convention Violations

### 24. `sortValue` is defined on columns but never used by the sort implementation

`GridTable.types.ts:34` defines `sortValue?: (item: T) => any` on `GridColumnDefinition`, and multiple callsites set it (e.g., `EventsTab.tsx:270`, `useWorkloadTableColumns.tsx:91-127`, `NsViewEvents.tsx:176`). However, the sorting pipeline never calls it: `handleHeaderClick` (`GridTable.tsx:713`) passes only `column.key` to `onSort`, and `useTableSort` (`useTableSort.ts:99`) sorts by `row[effectiveSort.key]` — direct property access with no reference to column definitions at all. Every `sortValue` callback is silently ignored. This is a functional gap, not just a typing issue. Beyond tightening the type, `sortValue` needs to be wired into `useTableSort` or removed.

### 25. Static inline CSS in header row

`useGridTableHeaderRow.tsx:63` uses `style={{ cursor: column.sortable ? 'pointer' : 'default' }}`. The `cursor` style is static and should be in CSS via the existing `data-sortable` attribute.

---

## Accessibility Issues

### 26. No ARIA grid semantics

The entire table is `<div>`-based with no `role="grid"`, `role="row"`, `role="gridcell"`, or `role="columnheader"` attributes. Sort state is expressed purely visually (`↑`/`↓` text) with no `aria-sort` on header cells. The focused row (`gridtable-row--focused`) has no `aria-activedescendant` or `aria-selected`. The loading overlay has no `aria-busy` or `role="status"`. Screen readers cannot identify this as a table, cannot identify column headers, and cannot hear which row is focused.

### 27. Sort trigger has no keyboard activation

`useGridTableHeaderRow.tsx:60-67` — The sort `<span>` has only an `onClick` handler. It has no `tabIndex`, no `onKeyDown`, no `role="button"`, and no `aria-label`. Keyboard-only users cannot sort columns.

---

## Test Coverage Gaps

| Gap                                                                                                                                      | Confidence |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **No registry contract test** — no test that all `viewId` values used in persistence hooks exist in `gridTableViewRegistry`               | 95         |
| **No test file** for `useGridTableFocusNavigation` — pointer vs keyboard activation, shortcut suppression, data-shrink clamping untested | 90         |
| **No test file** for `useGridTableContextMenuWiring` — `openFocusedRowContextMenu` DOM traversal, focus restoration untested             | 88         |
| **No multi-cluster persistence tests** — switching `clusterIdentity` never tested to load independent state                              | 88         |
| **`buildGridTableStorageKey`** has a single test case — no test that two clusters produce different keys                                 | 88         |
| **`useGridTableShortcuts` tests** mock out `useShortcuts` entirely — tests lifecycle, not actual shortcut behavior                       | 87         |
| **No test file** for `useGridTableColumnsDropdown` — Show All / Hide All actions, locked columns untested                                | 85         |
| **No column resizing integration test** in `GridTable.test.tsx`                                                                          | 83         |
| **No test file** for `useGridTableAutoWidthMeasurementQueue` — debounce, retry, and shrink-permission gating untested                    | 80         |

### Recommended new test files (priority order)

1. `gridTableViewRegistry.contract.test.ts` — scan all `viewId:` literals passed to `useGridTablePersistence` and `useNamespaceGridTablePersistence` and assert each is in the registry
2. `useGridTableFocusNavigation.test.ts`
3. `useGridTableContextMenuWiring.test.tsx`
4. `useGridTablePersistence.multicluster.test.tsx`
5. `useGridTableColumnsDropdown.test.ts`
