# Object Map View State

Temporary plan from the 2026-10-15 object-map review. This is frontend only.

- **Order:** it edits `useObjectMapModel.ts`, so it follows Phase 3 of
  [object-map-graph-membership](object-map-graph-membership.md).
- **Scope:** refresh errors over retained maps are out of scope. The
  orchestrator already raises the shared, deduplicated refresh-error toast for
  every domain
  ([orchestrator.ts:269](../../frontend/src/core/refresh/orchestrator.ts)),
  the same pattern tables use with retained rows
  ([useResourceInventoryTable.ts:245](../../frontend/src/modules/resource-grid/useResourceInventoryTable.ts)).

## Decisions

Both decided by John on 2026-10-15.

1. Pins persist when the Kind filter changes and when focus mode turns on or
   off. They are not reset when the view changes.
2. Pins persist through topology changes, such as new Pods during a rollout.
   Only pins on nodes that leave the graph are removed.

## Target Model

- A node the user drags is pinned. The pin is keyed by node id and applies in
  every view: any Kind filter selection and focus mode.
- A pin survives data refreshes while its node exists. Only **Reset layout**,
  or the node leaving the graph, clears it.
- An empty map still shows the backend's permission warnings.

## Non-goals

- Keeping positions after the panel closes or the app restarts.
- New controls or layout changes.
- Inline banners for refresh errors.

## Inventory

- **Pins are applied too early.** Overrides go into the base layout in
  [useObjectMapModel.ts:143](../../frontend/src/modules/object-map/useObjectMapModel.ts).
  `deriveObjectMapVisibleState` then recomputes layout for the Kind filter
  ([objectMapVisibleState.ts:132](../../frontend/src/modules/object-map/objectMapVisibleState.ts))
  and focus mode (`:153`), which drops the pins. In a test run, a Pod dragged
  to x=1140 rendered at x=640 in both modes (esbuild + node, 2026-10-15).
- **Drag coordinates don't match.** Drag start takes the node from the
  renderer's visible layout, but overrides apply to the unfiltered base layout.
- **Every payload change resets all pins.** The effect at
  `useObjectMapModel.ts:137-141` resets on any change to filtered nodes or
  edges, including a status-only change on one node.
- **Empty maps hide warnings.** The empty state returns early
  ([ObjectMap.tsx:848](../../frontend/src/modules/object-map/ObjectMap.tsx))
  before `ObjectMapMessages` (`:934`). A namespace map left empty by skipped
  permissions shows no warnings.
- **The Reset button depends on pins.** `hasNodePositionOverrides` drives
  **Reset layout** and its canvas-menu item.

## Phases

Status (2026-10-15): Phases 1-3 done on branch `object-map-fixes`.

- Object-map Vitest passes 22 files and 178 tests.
- Typecheck, Biome, and the complexity check are clean. `moveNodeDrag` was
  split into a helper.
- The empty state now sits warnings full-width under a centered message.
- The app check in Validation is still pending.

### Phase 1: Warnings on empty maps

- [x] Red: an `ObjectMap` test with an empty payload plus warnings renders the
      warnings list. It fails today.
- [x] Green: render `ObjectMapMessages` in the empty state too.

### Phase 2: Pins apply in every view

- [x] Red: a visible-state test shows a pinned node keeping its position under
      a `some` Kind filter, under focus mode, and after both are turned off
      again (decision 1).
- [x] Green: apply pins at the end of `deriveObjectMapVisibleState`, after the
      Kind filter and focus, rerouting edges with `routeObjectMapEdges` and
      recomputing bounds. `model.layout` becomes the unpinned base layout.
- [x] Red, then green: an `ObjectMap` test with the mock renderer: dragging
      while a Kind filter is active moves the node.

### Phase 3: Pins survive refreshes

- [x] Red: re-rendering with a payload whose only change is a node status
      keeps the dragged position. A payload that adds a Pod keeps the existing
      pins, and a payload that removes the pinned node drops its pin
      (decision 2).
- [x] Green: remove the reset effect. Prune pins whose node ids left the
      graph. **Reset layout** stays the explicit clear.
- [x] Check that focus mode's active-node anchoring still lines up when the
      active node is pinned.

## Open Questions

None. See Decisions.

## Validation

- `mise exec -- npm run test --prefix frontend -- object-map`
- `mise exec -- npm run typecheck --prefix frontend`
- Frontend coverage. Complexity checks on `deriveObjectMapVisibleState` and
  `useObjectMapModel`.
- `mise exec -- wails3 task qc:prerelease`
- App check in WebKit (`wails3 dev`):
  - drag a node, then toggle the Kind filter and focus mode;
  - drag a node while a live Pod status changes;
  - open a namespace map with denied kinds and confirm the warnings show.
