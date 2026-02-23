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

### 11. ✅ `ReactDOMServer.renderToString` serialize→parse round-trip in measurement loop

`useGridTableColumnMeasurer.ts` — Replaced `ReactDOMServer.renderToString` + `innerHTML` (serialize React tree to string, parse string back into DOM) with `createRoot` + `flushSync` (render React elements directly into the off-screen measurer node). This eliminates the `react-dom/server` dependency and the per-cell serialization overhead. The measurement loop is still synchronous on the main thread — DOM-based width measurement (`getBoundingClientRect`) requires synchronous rendering by nature. Fully async measurement would need a fundamentally different architecture.

---

## Investigated — Not Confirmed

Items 12–18 were investigated and could not be confirmed with a failing test. Removed.

---

## Low Priority / Speculative Optimizations

### 19. ✅ Module-level `hoverSuppressionCount` not HMR-safe (dev-only)

`useGridTableShortcuts.ts:17` — Module-level mutable counter resets to 0 on HMR while the `gridtable-disable-hover` class may still be on `document.body`. This is a dev ergonomics issue only — HMR does not run in production.

### 20. ✅ `useGridTableRowRenderer` returns unmemoized function

`useGridTableRowRenderer.tsx:75` — Returns a plain arrow function, not `useCallback`-wrapped. Every parent render produces a new reference. However, the current downstream consumers (`GridTable.tsx:719`, `GridTableBody.tsx:94`) do not rely on reference equality via `React.memo` for this prop, so the practical impact is not demonstrated. This is a speculative optimization rather than a current bug.

### 21. ✅ `renderSortIndicator` / `handleHeaderClick` not memoized

`GridTable.tsx:701-717` — Both are plain function declarations recreated every render, passed into `useGridTableHeaderRow`. However, `useGridTableHeaderRow` (`useGridTableHeaderRow.tsx:23`) always rebuilds header JSX on every call regardless — it does not memoize its output. Wrapping these functions in `useCallback` alone would not avoid header recalculation without also memoizing the hook's return value.

---

## Multi-Cluster Awareness Concerns

### 22. ✅ `buildClusterScopedKey` usage is not enforced

`GridTable.utils.ts:77-81` provides a cluster-prefixed key builder, but `keyExtractor` is a user-provided prop with no enforcement requiring cluster-scoped keys. Two callers (`EventsTab.tsx`, `PodsTab.tsx`) were bypassing `buildClusterScopedKey` entirely — fixed to use it. A dev-time heuristic warning was added in `GridTable.tsx:702-711` that samples the first row's key and warns if it lacks a `|` separator. This is a heuristic, not strict enforcement — it will also warn on legitimate non-multi-cluster usage where keys lack `|` (e.g., test harnesses and single-cluster views that don't use `buildClusterScopedKey`). The warning is `warnDevOnce` so it fires at most once per view. See also issue 5 for the unconditional throw when `clusterId` is missing.

### 23. ✅ `isNamespaceScoped` duplicated into `filterOptions`

`useNamespaceGridTablePersistence.ts:69-81` was passing `isNamespaceScoped` both as a top-level param and inside `filterOptions`. Since `useGridTablePersistence` merges the top-level `isNamespaceScoped` into `filterOptions` internally (lines 157-160 and 217-220), the duplication was misleading — the top-level always won. Removed the injection from `filterOptions` and added a regression test verifying `filterOptions` is passed through without `isNamespaceScoped` contamination.

---

## Convention Violations

### 24. ✅ `sortValue` is defined on columns but never used by the sort implementation

`GridTable.types.ts:34` defines `sortValue?: (item: T) => any` on `GridColumnDefinition`, and multiple callsites set it, but `useTableSort` sorted by `row[effectiveSort.key]` — direct property access — ignoring every `sortValue` callback. Fixed by adding an optional `columns` parameter to `UseTableSortOptions`. When provided, `useTableSort` builds a `sortValueExtractors` map from columns that define `sortValue` and uses the extractor in the comparator instead of direct property access. All 20 callsites updated to pass `columns`. Regression tests added in `useTableSort.test.tsx` verifying both the sortValue path and the fallback to row[key].

### 25. ✅ Static inline CSS in header row

Removed `style={{ cursor: column.sortable ? 'pointer' : 'default' }}` from `useGridTableHeaderRow.tsx:63` and added `.grid-cell-header[data-sortable="true"] .header-content > span { cursor: pointer; }` to `gridtables.css`, using the existing `data-sortable` attribute.

---

## Accessibility Issues

### 26. ✅ No ARIA grid semantics

Added ARIA roles and attributes across the GridTable component tree:
- `GridTableBody.tsx`: `role="grid"`, `aria-busy`, and `aria-activedescendant` on the body wrapper — the same element that has `tabIndex={0}` and receives DOM focus, co-locating the ARIA composite state with the keyboard focus host per the active-descendant pattern. Also `role="rowgroup"` on the inner body table div.
- `useGridTableHeaderRow.tsx`: `role="row"` on the header, `role="columnheader"` and `aria-sort` (`ascending`/`descending`/`none`) on each header cell (requires new `sortConfig` param)
- `useGridTableRowRenderer.tsx`: `role="row"` and `aria-selected` on data rows, `role="gridcell"` on cells, `id` attribute (sanitized from row key) for `aria-activedescendant` references
- `GridTable.tsx`: `role="status"` and `aria-live="polite"` on the loading overlay, threads `focusedRowKey` and `loading` to `GridTableBody`

Trade-off: The header row (`useGridTableHeaderRow`) renders outside the `role="grid"` element since it sits above the body wrapper in the DOM. The header cells still carry `role="columnheader"` and `aria-sort` for screen reader column identification, but they are not nested inside the grid landmark. Moving the header inside the body wrapper would require a layout restructure. This is a known deviation from the strict ARIA grid tree structure.

### 27. ✅ Sort trigger has no keyboard activation

`useGridTableHeaderRow.tsx:72-85` — Added `role="button"`, `tabIndex={0}`, `aria-label` (e.g., "Sort by Name"), and an `onKeyDown` handler (Enter/Space) to the sort trigger `<span>` on sortable headers. Non-sortable headers are left as plain text with no button semantics. Regression tests cover Enter activation, Space activation, and absence of button semantics on non-sortable columns.

---

## Test Coverage Gaps

| Gap                                                                                                                                      | Confidence | Status  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- |
| **No registry contract test** — no test that all `viewId` values used in persistence hooks exist in `gridTableViewRegistry`               | 95         | ✅ Added `gridTableViewRegistry.contract.test.ts` |
| **No test file** for `useGridTableFocusNavigation` — pointer vs keyboard activation, shortcut suppression, data-shrink clamping untested | 90         | ✅ Added `useGridTableFocusNavigation.test.tsx` — 7 tests: selector regression, CSS.escape, pointer vs keyboard activation (onRowClick gating), shortcut suppression on opt-out targets, data-shrink clamping (index clamp + null on empty) |
| **No test file** for `useGridTableContextMenuWiring` — `openFocusedRowContextMenu` DOM traversal, focus restoration untested             | 88         | ✅ Added `useGridTableContextMenuWiring.test.tsx` — 9 tests: DOM traversal, disabled/null/range guards, cell and wrapper handlers, contextMenuActiveRef tracking, focus restoration via onClose (mocked ContextMenu captures onClose callback, verifies closeContextMenu called and activeRef cleared) |
| **No multi-cluster persistence tests** — switching `clusterIdentity` never tested to load independent state                              | 88         | ✅ Added `useGridTablePersistence.multicluster.test.tsx` — 4 tests: independent sort, visibility, reset-to-defaults on unknown cluster, different storage keys |
| **`buildGridTableStorageKey`** has a single test case — no test that two clusters produce different keys                                 | 88         | ✅ Added two-cluster key test in `gridTablePersistence.test.ts` |
| **`useGridTableShortcuts` tests** mock out `useShortcuts` entirely — tests lifecycle, not actual shortcut behavior                       | 87         | ✅ Updated mock to capture args; 3 new tests verify registered keys, handler wiring (ArrowDown/Up/PageDown/Home/End), and F10 disabled state |
| **No test file** for `useGridTableColumnsDropdown` — Show All / Hide All actions, locked columns untested                                | 85         | ✅ Added `useGridTableColumnsDropdown.test.tsx` — 8 tests: disabled, all-locked, options content, locked exclusion, value tracking, show/hide all, individual toggle, non-array guard |
| **No column resizing integration test** in `GridTable.test.tsx`                                                                          | 83         | ✅ Added 3 integration tests: handles rendered when enabled, hidden when disabled, col-resize cursor during drag |
| **No test file** for `useGridTableAutoWidthMeasurementQueue` — debounce, retry, and shrink-permission gating untested                    | 80         | ✅ Added `useGridTableAutoWidthMeasurementQueue.test.tsx` — 10 tests: autoSize re-enable, data-driven post-autoSize, debounce accumulation, disabled/manual-active/manually-resized guards, allowShrink tracking, dragStart/dragEnd lifecycle, reset re-enable + mark-all-dirty |

### Recommended new test files (priority order)

1. ~~`gridTableViewRegistry.contract.test.ts`~~ — done
2. ~~`useGridTableFocusNavigation.test.ts`~~ — done
3. ~~`useGridTableContextMenuWiring.test.tsx`~~ — done
4. ~~`useGridTablePersistence.multicluster.test.tsx`~~ — done
5. ~~`useGridTableColumnsDropdown.test.tsx`~~ — done
