# Object map: renderer replacement plan

## Goal

Replace the current React/SVG object-map renderer with a higher-performance renderer while
preserving the exact current user-facing behavior.

This is not a redesign. The backend payload, object-map refresh flow, layout semantics, toolbar,
selection behavior, node dragging, and object-panel integration should remain compatible unless a
later plan explicitly changes them.

## Why

The current renderer creates one SVG/React element tree for every visible node and edge. That is
acceptable for small maps, but it makes pan, zoom, drag, selection highlighting, and hover behavior
expensive when the graph grows into many hundreds or thousands of objects.

The desired outcome is that large maps remain interactive after the initial data preparation and
layout work completes.

## Preserve exactly

- Map tab visibility rules: only supported object types with complete object references get a map.
- Full object identity: every object reference must include `clusterId`, `group`, `kind`, and
  `version`.
- `MapTab` refresh/orchestrator ownership.
- Backend `ObjectMapSnapshotPayload` contract.
- Seed resolution.
- Service edge dedupe.
- Directional reachability filtering.
- ReplicaSet collapse/expand behavior.
- Current seeded layered layout semantics.
- Pan and zoom.
- Fit-to-view.
- Auto-fit.
- Non-persistent node dragging.
- Reset layout button.
- Node click selection and relationship highlighting.
- Background click clearing selection.
- Edge hover tooltip.
- Edge color legend.
- Refresh button.
- Truncated banner.
- Snapshot warnings.
- Empty/loading/error handling.
- Cmd/Ctrl-click opens the object panel for the clicked object.
- Alt-click navigates to the clicked object's normal view.

## Non-goals for the first replacement

- Do not redesign the map visual language.
- Do not change backend traversal semantics.
- Do not persist manual node positions.
- Do not introduce grouping/collapse beyond the existing ReplicaSet collapse behavior.
- Do not change object-panel tab behavior.
- Do not remove current tests without replacing their coverage.

## Renderer candidates

### AntV G6

Best first spike candidate.

Reasons:

- Canvas rendering by default.
- Built-in graph hit testing and interaction behaviors.
- Existing graph concepts map naturally to nodes, edges, combos, states, and behaviors.
- Has enough styling control to approximate the current Kubernetes object cards.
- Lower implementation cost than a fully custom canvas renderer.

Risks:

- Need to verify Wails/WebKit behavior.
- Need to verify custom node/card rendering quality at high zoom levels.
- Bundle size and dependency surface need review before committing.

### Custom canvas renderer

Most control, highest implementation cost.

Reasons:

- Can preserve behavior exactly because all drawing, hit testing, drag, hover, and selection are
  owned locally.
- Avoids fighting a graph library's state model.

Risks:

- Must implement hit testing, tooltips, keyboard/accessibility hooks, pointer capture, text
  measurement/truncation, edge interaction, export/debug affordances, and redraw scheduling.
- More code to maintain.

### Sigma.js / WebGL renderers

Potential later option if G6 cannot hit performance targets.

Reasons:

- Strong for very large graphs.

Risks:

- Less natural fit for rich card-like Kubernetes nodes.
- More likely to require a level-of-detail redesign to feel good.

## Recommended approach

Spike AntV G6 first, but only after extracting the current map behavior behind a renderer
boundary. Keep the SVG renderer working until the replacement proves behavior parity and
performance.

## Work plan

### Phase 1: Extract renderer-independent behavior

- [x] Split current `ObjectMap.tsx` into renderer-independent graph preparation and rendering.
- [x] Extract seed resolution.
- [x] Extract edge dedupe and directional filtering orchestration.
- [x] Extract ReplicaSet collapse state and visible graph filtering.
- [x] Extract layout plus node position overrides.
- [x] Extract selection adjacency and connected path computation.
- [x] Extract edge tooltip state.
- [x] Extract toolbar state and handlers where practical.
- [x] Keep the existing SVG renderer passing against the extracted contract.

Expected result: the SVG map looks and behaves the same, but rendering is now replaceable.

### Phase 2: Add behavior parity tests

- [x] Selection from a node highlights the same connected nodes and edges as today.
- [x] Clicking the selected node clears selection.
- [x] Background click clears selection.
- [x] ReplicaSet collapse hides older ReplicaSets and preserves the badge behavior.
- [x] Expanding a ReplicaSet group restores the hidden ReplicaSets.
- [x] Dragging a node changes only its non-persistent position override.
- [x] Dragging a node reroutes connected edge paths.
- [x] Reset layout clears node position overrides.
- [x] Cmd/Ctrl-click calls `onOpenPanel` with the full object reference.
- [x] Alt-click calls `onNavigateView` with the full object reference.
- [x] Hovering an edge exposes the same tooltip data.
- [x] Empty, truncated, and warning states remain covered.
- [x] Loading and error states remain covered at the `MapTab` boundary.

Expected result: renderer-independent behavior is locked down before changing the drawing backend.

### Phase 3: Add the canvas renderer behind a local switch

- [x] Add the renderer dependency for the spike while keeping SVG as the production default.
- [x] Create a renderer boundary, for example `ObjectMapRenderer`.
- [x] Keep `svg` as the default while the canvas renderer is incomplete.
- [x] Extract G6 data/state/style mapping behind a testable helper.
- [x] Keep one G6 graph instance mounted across selection/data/callback changes.
- [x] Register a custom G6 card node instead of using the generic one-line label.
- [x] Implement canvas/G6 nodes matching current card content: kind, name, namespace, seed styling,
  selection state, dimmed state, connected state, and ReplicaSet badge.
- [x] Implement edges matching current type colors and selected/dimmed states.
- [x] Implement edge hover tooltip.
- [x] Implement node click selection.
- [x] Implement background click clearing.
- [x] Implement pan and zoom.
- [x] Implement fit-to-view and auto-fit.
- [x] Implement non-persistent node dragging.
- [x] Implement reset layout.
- [x] Implement Cmd/Ctrl-click open-panel behavior.
- [x] Implement Alt-click navigate behavior.
- [x] Preserve toolbar and legend DOM outside the renderer where possible.

Expected result: developers can switch between SVG and canvas renderers while comparing behavior.

### Phase 4: Performance fixtures and acceptance tests

- [x] Add synthetic object-map fixtures for approximately 500 nodes / 1,000 edges.
- [x] Add synthetic object-map fixtures for approximately 1,000 nodes / 2,000 edges.
- [x] Measure initial graph preparation time separately from renderer interaction smoothness.
- [ ] Measure pan/zoom while the graph is already rendered.
- [x] Measure dragging one node while connected edge lines update.
- [x] Measure node selection and highlight update time.
- [x] Add Storybook stories for manual SVG/G6 large-map comparison.
- [ ] Run the measurements in the desktop/Wails environment, not only the browser.

Dependency review:

- `@antv/g6@5.1.0` is MIT licensed.
- Runtime dependency surface includes the AntV canvas/rendering/layout packages used by G6:
  `@antv/g`, `@antv/g-canvas`, `@antv/layout`, `@antv/graphlib`, and related AntV utilities.
- Local installed package sizes are approximately 13 MB for `@antv/g6`, 3.2 MB for `@antv/g`,
  14 MB for `@antv/layout`, and 408 KB for `@antv/graphlib`. The package's own published
  `limit-size` metadata targets a 400 KB gzipped / 1.5 MB minified UMD bundle.
- `npm run build` keeps the G6 renderer lazy-loaded in a separate
  `ObjectMapG6Renderer-*.js` chunk. Current output is approximately 1.41 MB minified / 406 KB gzip
  for that chunk.

Acceptance targets:

- 500 nodes / 1,000 edges: pan, zoom, selection, and node drag should feel smooth.
- 1,000 nodes / 2,000 edges: interaction should remain usable without multi-second stalls.
- Dragging one node should redraw the affected visual state without forcing a full React render of
  every visible node and edge.
- Selection highlighting should complete within a near-frame interaction budget for the 500-node
  fixture.
- Initial layout cost may be measurable, but should not block later pan/zoom/drag interactions once
  rendered.

## Level-of-detail follow-up

Renderer replacement alone may not be enough if thousands of rich, labeled cards are always drawn.
After parity is reached, plan a separate level-of-detail pass:

- Zoomed out: compact nodes, fewer labels, simpler edge rendering.
- Zoomed in: full card detail.
- Hovered/selected nodes: full detail regardless of zoom.
- Optional grouping/collapse beyond ReplicaSets.
- Search/focus controls for dense graphs.

This should be a separate feature. It is not required for first renderer parity.

## Rollout criteria

- [ ] SVG and canvas renderers have behavior parity for the preserved feature list.
- [ ] Performance fixtures show a significant improvement over the SVG renderer.
- [ ] Wails/WebKit testing shows no ghosting or stale-frame artifacts.
- [x] New dependency review is complete, if a dependency is added.
- [x] `npm test` passes for object-map and object-panel map tests.
- [x] `npm run typecheck` passes.
- [x] `mage qc:prerelease` passes before presenting implementation work as complete.
