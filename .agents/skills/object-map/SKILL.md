---
name: object-map
description: Work on Luxury Yacht object-map data, missing resource kinds, graph relationships, layout, renderer behavior, legend, debug snapshots, and tests
---

# Object Map

Use this when touching object-map backend graph data, supported kinds,
relationship edges, frontend model/layout/rendering, legend/copy, debug
snapshots, or object-map tests.

## Task routes

Read only the contracts selected by the change. Follow further links when the
changed path crosses that boundary.

| Change | Read |
| --- | --- |
| Graph data, relationships, layout or rendering | [object-map](../../../docs/workflows/object-map.md) |
| Identity, status, facts or shared relationships | [shared-resource-model](../../../docs/architecture/shared-resource-model.md) |
| Domain registration, scope or diagnostics | [refresh-system](../../../docs/architecture/refresh-system.md) |
| Card age text | [live-age](../../../docs/frontend/live-age.md) |

## Entry Points

- Backend: `backend/refresh/snapshot/object_map.go`; per-kind
  `backend/resources/<kind>/objectmap*.go`, dispatched via
  `backend/refresh/snapshot/object_map_collector_registry.go` and
  `object_map_edge_registry.go`; `backend/refresh/system/registrations.go`;
  `backend/refresh/snapshot/object_map_test.go` and adjacent object-map tests.
- Frontend support gate: `frontend/src/modules/object-panel/objectPanelRef.ts`
  (`MAP_SUPPORTED_KINDS`, `isObjectMapSupportedKind`,
  `hasCompleteObjectMapReference`).
- Frontend module `frontend/src/modules/object-map/`: `ObjectMap.tsx`,
  `useObjectMapModel.ts`, `objectMapLayout.ts`, `objectMapVisibleState.ts`,
  `ObjectMapG6Renderer.tsx`, `objectMapEdgeStyle.ts`, `objectMapDebugStore.ts`,
  `ObjectMap.css`.

## Sequencing

For missing kinds or links:

1. Prove whether the backend snapshot contains the nodes and edges.
2. If not, fix backend collection and edge construction with tests first:
   typed collection for each supported kind, complete openable refs, edges from
   shared-resource-model facts, permission checks for newly collected
   resources, and fixtures asserting the nodes and edges (not just no error).
   Gateway API fake-client tests may need explicit list reactors; use
   `gatewayfake.NewClientset()`, not deprecated constructors.
3. Then update the frontend together: supported-kind allowlist, payload types,
   model/filter/collapse, visible state and layout, renderer and apply-queue
   equality, legend/palette/status styling, and targeted Vitest coverage.
4. Update `docs/workflows/object-map.md` when supported kinds, edge semantics,
   or user-facing behavior change.

For visual-only renderer work, confirm the data/model is already correct,
change only renderer/layout/styles, and validate in a browser or screenshot.

## Validation

Focused checks while iterating:

```sh
mise exec -- go test ./backend/refresh/snapshot -run ObjectMap
mise exec -- npm run test --prefix frontend -- object-map
mise exec -- npm run typecheck --prefix frontend
```
