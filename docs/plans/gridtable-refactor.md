# GridTable Refactor — Consolidated Plan

Synthesized from two independent code reviews and two independent prioritization
reviews. Items are ordered by impact within each tier. Structural refactors that
encompass multiple bug fixes are called out explicitly.

---

## P1 — High Impact (affects users now)

### 1. ✅ Make focus tracking key-based, not index-based

- `hooks/useGridTableFocusNavigation.ts:58,63`
- Focus is now tracked by key (`focusedRowKey` as primary `useState`). Index is
  derived via `useMemo` with `findIndex`. When data reorders, focus follows the
  same logical row. When the focused row disappears, the derived index resolves
  to `null` (rather than clamping to the prior index position).
- **What was fixed:** Previously, focus was tracked by index. Data reorders would
  keep the old index, causing keyboard actions to target a different row — a
  wrong-resource safety risk in multi-cluster views.
- **Scope completed:**
  - `focusedRowKey` stored as source of truth
  - Index re-resolved from key on data changes
  - Derived index clears to `null` when key disappears (deleted resource)
  - Shared `getStableRowId` utility introduced for `aria-activedescendant` (see item 8)
- **Coverage:** Reorder retention, removal clearing, and insertion stability tests added.

### 2. ✅ Fix shortcut scoping so interactive cell content is safe by default

- `ui/shortcuts/utils.ts:65-76,98-106`
- The `isInputElement` guard now checks whether the event target is an interactive
  element (button, input, link, contenteditable, etc.) before allowing the
  `data-allow-shortcuts="true"` ancestor bypass. Interactive elements inside the
  grid wrapper are protected from bare-key interception by default. The direct
  attribute opt-in (element itself carries `data-allow-shortcuts="true"`, e.g.
  Dropdown's search input) is preserved.
- **What was fixed:** Previously, the grid wrapper's `data-allow-shortcuts="true"`
  caused `isInputElement` to return `false` for all descendants, including real
  interactive elements. Buttons, links, and inputs embedded in cells had Enter,
  Space, and arrow keys intercepted by GridTable shortcuts.
- **Scope completed:**
  - Root cause fixed in shared `isInputElement` (not per-handler guards)
  - `INTERACTIVE_ELEMENT_SELECTOR` covers input, textarea, select, button,
    summary, a[href], contenteditable, role="textbox", role="button"
  - `data-gridtable-shortcut-optout` remains for non-interactive opt-out
  - Column authors no longer need to know about the opt-out mechanism
- **Coverage:** 8 unit tests for `isInputElement` with interactive elements
  inside `data-allow-shortcuts` containers.

### 3. Fix auto-sizing permanently disabled after manual column resize

- `hooks/useGridTableAutoWidthMeasurementQueue.ts:197-203`
- `dragStart` sets `isAutoSizingEnabledRef = false`. `dragEnd` checks the ref before
  scheduling a dirty flush — but it's always `false`. Auto-sizing never re-enables
  until an explicit `autoSize` or `reset` event.
- **Impact:** After any manual column resize, all auto-width columns stop responding
  to data changes for the lifetime of the component.
- **Scope:**
  - Re-enable `isAutoSizingEnabledRef` on `dragEnd`
  - Add regression test for full drag cycle (dragStart -> dragEnd -> data change)
  - Verify no regressions in width persistence flows
- **Coverage gap:** Existing tests cover dragStart/dragEnd flag behavior but not
  re-enabling auto-sizing after the cycle.
- **Note:** If doing the column width state machine refactor (item 13), this fix is
  subsumed — include it there instead of patching the current code twice.

### 4. Hover overlay has no z-index, gets occluded by rows

- `styles/components/gridtables.css:322-333`
- The overlay sits before `.gridtable` in DOM order with no `z-index`. Rows have
  `z-index: 1`, so any row with an opaque background fully hides the hover highlight.
- **Impact:** Hover feedback is invisible — a core visual interaction is broken.
- **Fix:** Add `z-index: 2` to `.gridtable-hover-overlay`.

### 5. Undefined CSS variable `--grid-spacing-md` — zero padding on pagination

- `styles/components/gridtables.css:479`
- `:root` defines `--grid-spacing-xs` and `--grid-spacing-sm` but never
  `--grid-spacing-md`. No fallback, so it resolves to `0`.
- **Impact:** Pagination footer has zero vertical padding — visually crushed.
- **Fix:** Add `--grid-spacing-md: var(--spacing-md);` to the `:root` block.

---

## P2 — Medium Impact (affects users in specific scenarios)

### 6. Virtualization row-height cache broken (wrong DOM node for key lookup)

- `hooks/useGridTableRowRenderer.tsx:93`, `hooks/useGridTableVirtualization.ts:323,345`
- The measurement ref is on the row node, but virtualization reads `data-row-key` from
  `node.parentElement`. Cache lookup uses the actual key, so it always misses.
- `virtualRowHeight` itself still updates correctly from direct measurement of the
  first rendered row (`:324`, `:334`). The bug is limited to cache-assisted reuse.
- **Impact:** Cache-assisted row-height reuse is broken, degrading estimation stability
  and scrollbar accuracy for variable-height rows. Base virtualization still functions.
- **Fix:** Read `data-row-key` from the correct node, or attach the attribute at the
  right DOM level.
- **Coverage gap:** Cache-specific path is untested.

### 7. `useGridTableFilters` memo depends on entire `filters` object

- `useGridTableFilters.ts:122-127`
- The `activeFilters` memo depends on the full `filters` config object (new reference
  every render). This causes the entire table to re-filter on every parent render.
- **Impact:** Unnecessary re-filtering and re-rendering on every parent update.
- **Fix:** Narrow dependency to `filters?.value` (the only field the memo actually
  reads when controlled).

### 8. ✅ Lossy ID sanitizer creates duplicate `aria-activedescendant` IDs

- `GridTable.utils.ts:96`, `hooks/useGridTableRowRenderer.tsx:101`, `GridTableBody.tsx:174`
- Row IDs now use `getStableRowId()`, which hex-encodes non-safe characters
  (e.g. `/` → `_x2f_`) to preserve uniqueness. Both the row `id` attribute and
  `aria-activedescendant` use the same utility.
- **What was fixed:** Previously, row IDs replaced all non-`[a-zA-Z0-9_-]` chars
  with `_`, collapsing distinct keys differing only by `/`, `|`, `:` to the same
  DOM id. This broke ARIA targeting and `getElementById` assumptions.
- **Coverage:** Uniqueness tests for slash/colon/pipe keys added in
  `GridTable.utils.test.tsx`.

### 9. Dock panel transitions clobber each other when both panels are open

- `styles/components/gridtables.css:149-156`
- The `dock-bottom-open` transition rule overrides `dock-right-open` via cascade, so
  `margin-right` snaps instantly when both panels are open.
- **Fix:** Add a combined `body.dock-right-open.dock-bottom-open` selector with both
  transitions.

### 10. Focus outline removed with no `:focus-visible` replacement (WCAG 2.4.7)

- `styles/components/gridtables.css:107-109`
- The wrapper has `tabIndex={0}` and `role="grid"` but `outline: none` on `:focus`
  with no `focus-visible` fallback.
- **Impact:** Keyboard users have no visual indicator that the grid has focus.
- **Fix:** Add `.gridtable-wrapper:focus-visible` with an accent outline.

### 11. Resize handle hover invisible in dark mode

- `styles/components/gridtables.css:279-281`
- Hardcoded `rgba(0, 0, 0, 0.05)` — nearly invisible on dark backgrounds.
- **Fix:** Use a theme-aware variable with a dark-mode override.

---

## Structural Refactors

These are larger changes that improve maintainability and subsume multiple bug fixes.
They can be done alongside or instead of the individual fixes they encompass.

### 12. Introduce a `useGridTableController` reducer

- `GridTable.tsx` (~865 lines)
- The main component is purely wiring — it calls 25+ hooks and threads their outputs
  into sub-components. A top-level `useReducer` could consolidate the coordination
  between focus, sort, filter, and pagination state into a single dispatch-based model,
  reducing the number of independent state variables and making the interaction between
  subsystems more auditable.
- **Encompasses:** General orchestration complexity. Would make future changes less
  error-prone.
- **Risk:** Large surface area. Should be done as a dedicated refactor pass, not mixed
  with bug fixes.

### 13. Refactor column widths into an explicit state machine

- `useGridTableColumnWidths.ts`, `useGridTableColumnWidths.helpers.ts`,
  `useGridTableAutoWidthMeasurementQueue.ts`, `useGridTableColumnMeasurer.ts`,
  `useGridTableAutoGrow.ts`, `useGridTableExternalWidths.ts`
- The width system generated the most bugs in the review (items 3, 14, 15). The root
  cause is implicit state transitions spread across refs in 6+ files.
- Replace ref flags (`isAutoSizingEnabledRef`, `isManualResizeActiveRef`,
  `isApplyingExternalUpdateRef`, `initializedColumnsRef`) with a `useReducer` with
  named states: `idle`, `measuring`, `dragging`, `syncing-external`, `initializing`.
  Each action (`DRAG_START`, `DRAG_END`, `DATA_CHANGED`, `EXTERNAL_UPDATE`,
  `MEASUREMENT_COMPLETE`) produces a deterministic next state.
- **Encompasses:** Items 3 (auto-sizing disabled), 14 (isInitialized ref), 15 (stale
  closure in external sync).
- **Risk:** Complex subsystem. Needs thorough testing of width persistence round-trips,
  auto-size → manual resize → auto-size cycles, and external width sync.

---

## P3 — Lower Impact (future-proofing, edge cases, cleanup)

### 14. `isInitialized` read from ref never triggers re-render — speculative

- `hooks/useGridTableColumnWidths.ts:494`
- Set in a rAF callback (ref, not state), so in theory consumers gating on this value
  could show uninitialized content. However, initialization paths also set column widths
  in the same rAF (`:helpers.ts:456,508,638`), which normally triggers a re-render.
- **Status:** Speculative — no stale UI case demonstrated. Subsumed by item 13 if the
  state machine refactor happens.

### 15. Stale closure in `useExternalWidthsSync` — speculative

- `hooks/useGridTableColumnWidths.helpers.ts:271-316`
- `didChange` captured by closure may be stale if React batches the state updater,
  causing redundant change notifications. Self-settling but wasteful. Concurrency-timing
  hypothesis, not a verified bug.
- **Fix:** Use a ref for the `didChange` flag. Subsumed by item 13 if the state machine
  refactor happens.

### 16. Render-phase ref mutations in `GridTableBody`

- `GridTableBody.tsx:106-112`
- `renderRows()` mutates `rowControllerPoolRef` and `firstVirtualRowRef` during render.
  Pool growth is bounded by virtual window size, so not an unbounded leak — but it is a
  concurrency/Strict Mode correctness smell.
- **Fix:** Move pool growth to `useLayoutEffect`.

### 17. Leaked `requestAnimationFrame` in filter-change effect

- `hooks/useGridTableVirtualization.ts:252-273`
- rAF scheduled on `filterSignature` change is never cancelled in effect cleanup.
  Can fire after unmount.
- **Fix:** Store handle, cancel in cleanup.

### 18. Render-phase ref mutation in pagination hook

- `hooks/useGridTablePagination.ts:45-48`
- `inFlightRef.current = false` in the render body. Violates concurrent mode rules.
- **Fix:** Move to `useEffect`.

### 19. `overflow: visible` on embedded wrapper — conditional

- `styles/components/gridtables.css:523-526`
- If virtualization is enabled on an embedded table, virtual rows would overflow the
  container. Whether this is real depends on whether any embedded table uses
  virtualization.
- **Fix:** Use `overflow: clip`, or document/enforce the invariant.

### 20. Global hover suppression counter can desync on HMR

- `hooks/useGridTableShortcuts.ts:20-43`
- Module-level integer counter; HMR recovery assumes at most 1 active suppressor. The
  refcount logic is sound at normal runtime, but HMR with multiple instances can desync.
- **Fix:** Use a `Set` of instance IDs instead of an integer counter.

### 21. Dev-mode cluster key check only validates first data batch

- `GridTable.tsx:704-715`
- `clusterKeyCheckRef` set once, never reset. If `keyExtractor` changes, validation
  won't re-run.
- **Fix:** Reset the ref when `keyExtractor` identity changes.

### 22. Duplicate CSS rule

- `styles/components/gridtables.css:47` and `:350`
- `.gridtable-row:last-child { border-bottom: none; }` appears twice.
- **Fix:** Remove the first instance (line 47).

### 23. `hydrateGridTablePersistence` with `force: true` can race

- `persistence/gridTablePersistence.ts:162-186`
- `force: true` bypasses the in-flight promise guard, allowing concurrent fetches where
  the last to resolve wins. Not currently called in production.
- **Fix:** Await existing in-flight promise before starting a forced re-fetch.

---

## Coverage Gaps

Test gaps corresponding to the highest-impact findings. Should be addressed alongside
their respective fixes:

- [x] Focus retention across data reorder/sort/filter refresh (item 1)
- [x] Shortcut behavior while focus is inside interactive descendants (item 2)
- [ ] Auto-sizing re-enabled after manual drag-resize cycle (item 3)
- [ ] Row-height cache lookup path in virtualization (item 6)
- [x] Duplicate ARIA ID generation with similar keys (item 8)
