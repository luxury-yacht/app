---
name: object-map
description: Work on Luxury Yacht object-map data, missing resource kinds, graph relationships, layout, renderer behavior, legend, debug snapshots, and tests
---

# Object Map

Use this when touching object-map backend graph data, supported kinds,
relationship edges, frontend model/layout/rendering, legend/copy, debug
snapshots, or object-map tests.

## Core Model

Object map is a scoped refresh snapshot domain named `object-map`.

It is not a rich detail service and not an SSE/resource-stream path. The backend
snapshot builds graph data; the frontend filters, annotates, lays out, and
renders that graph.

Read:

1. `AGENTS.md`
2. `backend/AGENTS.md` for backend changes
3. `frontend/AGENTS.md` for frontend changes
4. `docs/workflows/object-map.md`
5. `docs/architecture/shared-resource-model.md` when identity, status, facts,
   or relationships are involved
6. `docs/architecture/refresh-system.md` when domain registration, scopes, or
   diagnostics are involved
7. `docs/frontend/live-age.md` when changing card age text

## Backend Entry Points

Start here for graph/data correctness:

- `backend/refresh/snapshot/object_map.go` plus the per-kind collectors/edges in
  `backend/resources/<kind>/objectmap*.go`, dispatched via
  `backend/refresh/snapshot/object_map_collector_registry.go` and
  `object_map_edge_registry.go`
- `backend/refresh/system/registrations.go`
- `backend/resourcemodel` for shared facts, status, identity, and links
- `backend/refresh/snapshot/object_map_test.go` or adjacent object-map tests

Backend object-map work often needs:

- Typed collection for every supported kind.
- Complete object references with `clusterId`, `group`, `version`, `kind`, and
  concrete namespace/name when openable.
- Edges from shared-resource-model facts where possible.
- Permission checks for newly collected resources.
- Test fixtures that prove the graph includes nodes and edges, not just that no
  error occurred.

For Gateway API fake-client tests, explicit list reactors may be required. Use
`gatewayfake.NewClientset()` rather than deprecated constructors.

## Frontend Entry Points

Start here for visible behavior:

- `frontend/src/modules/object-panel/components/ObjectPanel/objectMapSupport.ts`
- `frontend/src/modules/object-map/ObjectMap.tsx`
- `frontend/src/modules/object-map/useObjectMapModel.ts`
- `frontend/src/modules/object-map/objectMapLayout.ts`
- `frontend/src/modules/object-map/objectMapVisibleState.ts`
- `frontend/src/modules/object-map/ObjectMapG6Renderer.tsx`
- `frontend/src/modules/object-map/objectMapEdgeStyle.ts`
- `frontend/src/modules/object-map/objectMapDebugStore.ts`
- `frontend/src/modules/object-map/ObjectMap.css`

Frontend object-map work often needs:

- Supported-kind allowlist updates.
- Payload/type updates if backend graph shape changes.
- Model/filter/collapse updates.
- Layout and visible-state updates.
- Renderer and apply-queue equality updates.
- Legend/palette/status styling updates.
- Targeted Vitest coverage for model/layout/renderer behavior.

Do not fix missing data by frontend-only labels or renderer patches when the
backend graph is missing nodes, refs, or edges.

## Sequencing

For missing kinds or missing links:

1. Prove whether backend snapshot data contains the nodes and edges.
2. If missing, fix backend collection/edge construction and tests first.
3. Then update frontend support lists/types/model/rendering.
4. Update `docs/workflows/object-map.md` if supported kinds, edge semantics, or
   user-facing behavior changed.

For visual-only renderer work:

1. Confirm the data/model is already correct.
2. Change frontend renderer/layout/styles only.
3. Use browser or screenshot validation when visual behavior matters.

## Checklist

- [ ] Backend graph includes the intended nodes.
- [ ] Backend graph includes the intended relationship edges.
- [ ] Openable refs are complete and include cluster/GVK/object identity.
- [ ] Permission checks cover newly listed resource types.
- [ ] Frontend kind support matches backend support.
- [ ] Payload types match backend shape.
- [ ] Model, visible state, layout, and renderer agree on new fields.
- [ ] Card age text is derived from timestamps through the live-age contract and
      does not change backend graph identity or layout inputs.
- [ ] Legend/copy uses user-facing terms such as "Objects" and "Links".
- [ ] Tests cover the changed graph or rendering behavior.
- [ ] Non-doc changes pass `mage qc:prerelease`.

## Validation

Use focused checks while iterating:

```sh
go test ./backend/refresh/snapshot -run ObjectMap
npm run test --prefix frontend -- object-map
npm run typecheck --prefix frontend
```

Then run the final gate for non-documentation work:

```sh
mage qc:prerelease
```
