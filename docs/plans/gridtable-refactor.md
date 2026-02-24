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

### 3. ✅ Fix auto-sizing permanently disabled after manual column resize

- `hooks/useGridTableAutoWidthMeasurementQueue.ts:197-204`
- `dragEnd` now re-enables `isAutoSizingEnabledRef` and unconditionally schedules
  a dirty flush, so auto-width columns resume responding to data changes after a
  manual resize.
- **What was fixed:** `dragStart` set `isAutoSizingEnabledRef = false` but `dragEnd`
  never re-enabled it. The dirty flush guard was permanently dead after any drag.
  All auto-width columns stopped responding to data changes for the lifetime of
  the component.
- **Coverage:** Regression test for full drag cycle (dragStart → dragEnd →
  markColumnsDirty) added.
- **Note:** If doing the column width state machine refactor (item 13), this area
  would be replaced entirely.

### 4. ✅ Hover overlay has no z-index, gets occluded by rows

- `styles/components/gridtables.css:322-333`
- Added `z-index: 2` to `.gridtable-hover-overlay` so it sits above
  `.gridtable-row` (`z-index: 1`).
- **What was fixed:** The overlay had no `z-index` and sat before `.gridtable` in
  DOM order. Rows with opaque backgrounds fully hid the hover highlight.

### 5. ✅ Undefined CSS variable `--grid-spacing-md` — zero padding on pagination

- `styles/components/gridtables.css:72`
- Added `--grid-spacing-md: var(--spacing-md);` to the `:root` block alongside
  the existing `xs` and `sm` definitions.
- **What was fixed:** `--grid-spacing-md` was used in the pagination footer
  padding but never defined, resolving to `0` and visually crushing the footer.

---

## P2 — Medium Impact (affects users in specific scenarios)

### 6. ✅ Virtualization row-height cache broken (wrong DOM node for key lookup)

- `hooks/useGridTableVirtualization.ts:323`
- Changed `node.parentElement?.getAttribute('data-row-key')` to
  `node.getAttribute('data-row-key')`. The measurement ref points to the row
  node itself, which carries the `data-row-key` attribute.
- **What was fixed:** Virtualization read `data-row-key` from `node.parentElement`
  but the ref was on the row node. Cache lookup always missed, degrading
  estimation stability and scrollbar accuracy for variable-height rows.
- **Coverage gap:** Cache-specific path remains untested (no behavioral test
  possible without a full virtualization integration harness).

### 7. ✅ `useGridTableFilters` memo depends on entire `filters` object

- `useGridTableFilters.ts:127`
- Narrowed `activeFilters` memo dependency from `filters` to `filters?.value`
  (the only field the memo reads when controlled).
- **What was fixed:** The memo depended on the full `filters` config object,
  which is a new reference every render. This caused unnecessary re-filtering
  and re-rendering on every parent update.

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

### 9. ✅ Dock panel transitions clobber each other when both panels are open

- `styles/components/gridtables.css`
- Added combined `body.dock-right-open.dock-bottom-open` selector that transitions
  both `margin-right` and `margin-bottom`.
- **What was fixed:** The `dock-bottom-open` transition rule overrode
  `dock-right-open` via cascade, so `margin-right` snapped instantly when both
  panels were open.

### 10. ✅ Focus outline removed with no `:focus-visible` replacement (WCAG 2.4.7)

- `styles/components/gridtables.css`
- Added `.gridtable-wrapper:focus-visible` with a 2px accent outline
  (`outline-offset: -2px` to stay inside the container).
- **What was fixed:** The wrapper had `outline: none` on `:focus` with no
  `:focus-visible` fallback. Keyboard users had no visual indicator that the
  grid had focus.

### 11. ✅ Resize handle hover invisible in dark mode

- `styles/components/gridtables.css`, `styles/themes/dark.css`
- Changed hardcoded `rgba(0, 0, 0, 0.05)` to
  `var(--grid-resize-handle-hover-color, rgba(0, 0, 0, 0.05))`. Added
  `--grid-resize-handle-hover-color: rgba(255, 255, 255, 0.08)` in the dark
  theme alongside the existing resize handle variables.
- **What was fixed:** The hover background was hardcoded black-alpha, nearly
  invisible on dark backgrounds.

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

### 14. ✅ `isInitialized` read from ref never triggers re-render — speculative

- `hooks/useGridTableColumnWidths.ts:460-470`
- Added `isInitializedState` alongside the ref. A no-deps `useEffect` syncs the
  ref to state so consumers get a re-render when initialization completes.
  The ref is kept for synchronous reads in helpers.
- **What was fixed:** `isInitialized` was returned as `initializedColumnsRef.current`,
  which doesn't trigger re-renders. Initialization paths also call `setColumnWidths`
  in the same rAF, so this was largely mitigated — but the state sync makes it correct.

### 15. ✅ Stale closure in `useExternalWidthsSync` — speculative

- `hooks/useGridTableColumnWidths.helpers.ts:251,275-312`
- Converted `didChange` local variable to `didChangeRef` (a `useRef`). The ref
  is read in the rAF `resetFlag` callback, avoiding any potential stale-closure
  issue if React defers state updater execution.
- **What was fixed:** `didChange` was a local `let` variable captured by closure.
  If React batched the state updater, the rAF callback could theoretically read
  stale `false`. In practice React 18 runs functional updaters synchronously, so
  this was speculative — but the ref is strictly more correct.

### 16. ✅ Render-phase ref mutations in `GridTableBody` — fixed

- `GridTableBody.tsx`, `GridTable.tsx`
- Eliminated `rowControllerPoolRef` entirely. The pool generated deterministic
  IDs (`slot-${idx}`), and `data-grid-slot` was a write-only DOM attribute
  (never read back by JS). Virtual row slot IDs are now computed inline as
  `` `slot-${idx}` `` in the `.map()` call, removing the render-phase ref
  mutation completely.
- **What was fixed:** `rowControllerPoolRef` was mutated during render (pool
  growth via `push()`). The prior `useMemo` mitigation still ran during render.
  The pool was unnecessary since IDs were deterministic.
- **Remaining:** `firstVirtualRowRef.current = null` remains in the render
  body. This is an intentional "clear before ref callbacks" pattern — the ref
  callback sets it during commit, and it must be cleared before those callbacks
  fire. Moving it to an effect would create a stale-ref race. This is safe in
  concurrent mode (idempotent, worst case the ref stays null if React discards
  the render). Subsumed by item 13 if the state machine refactor happens.

### 17. ✅ Leaked `requestAnimationFrame` in filter-change effect

- `hooks/useGridTableVirtualization.ts:252-280`
- Stored the rAF handle in a local variable and added a cleanup function that
  calls `cancelAnimationFrame` when the effect re-runs or the component unmounts.
- **What was fixed:** The rAF scheduled on `filterSignature` change was never
  cancelled in effect cleanup, so it could fire after unmount.

### 18. ✅ Render-phase ref mutation in pagination hook

- `hooks/useGridTablePagination.ts:45-49`
- Moved `inFlightRef.current = false` from the render body into a `useEffect`
  that depends on `isRequestingMore`.
- **What was fixed:** The ref mutation in the render body violated concurrent
  mode rules. Now runs as a side effect after render.

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
- [x] Auto-sizing re-enabled after manual drag-resize cycle (item 3)
- [x] Row-height cache lookup path in virtualization (item 6) — fix applied; no integration test added
- [x] Duplicate ARIA ID generation with similar keys (item 8)
