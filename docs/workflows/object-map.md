# Object Map Contract

The object map visualizes Kubernetes object relationships. Backend data owns
graph identity and relationship facts; frontend code owns visibility, layout,
rendering, and interaction state.

## Agent Contract

- Every map node and edge must preserve full object identity where the object is
  openable.
- Relationship links come from backend resource semantics or catalog-safe
  identity, not frontend kind/name guessing.
- Display-only relationships must stay display-only when identity is partial,
  stale, external, or unsafe to open.
- Map scopes must be single-cluster and cluster-prefixed.
- Frontend filtering, collapse, layout, and viewport state must not rewrite
  backend identity.
- The Kind multiselect distinguishes `all`, `some`, and `none`. `all` includes
  kinds discovered later, while `none` renders an empty visible graph without
  changing the backend graph or its object identities.
- Debug snapshots should describe raw backend graph, frontend-visible graph, and
  renderer state separately.
- Adding support for a kind means updating backend graph facts and frontend
  presentation only where both are needed.

## Ownership

- Backend object-map snapshot builder:
  `backend/refresh/snapshot/object_map.go`
- Shared resource links and facts: `backend/resourcemodel`
- Frontend object-map module: `frontend/src/modules/object-map`
- Object-panel map integration: `frontend/src/modules/object-panel`
- Identity and links:
  [../architecture/shared-resource-model.md](../architecture/shared-resource-model.md)
- Refresh scopes: [../architecture/refresh-system.md](../architecture/refresh-system.md)
- Live age rendering: [../frontend/live-age.md](../frontend/live-age.md)

## Relationship Rules

- Owners, selectors, Gateway API references, service endpoints, routes, PVC/PV,
  HPA targets, Helm-managed objects, and event involved objects should use
  shared resource identity where available.
- Openable relationships require complete refs.
- Display-only labels are acceptable for unresolved external names, partial
  custom refs, deleted objects, and unsupported sources.
- Do not invent links from visual proximity or table row strings.
- Card age text should be derived from backend timestamps through the live-age
  contract. Updating the displayed age must not rewrite backend graph identity,
  relationship data, or layout inputs.

## Table Navigation

- Resource-table **Open Map** actions open an object-scoped map from a validated
  reference containing `clusterId`, group, version, kind, namespace when
  namespaced, and name.
- Map **Go to Table View** actions select the resource's owning namespace and
  table, then issue a cluster-scoped row-focus request from the same complete
  reference. Query-backed tables may use that reference for an anchor query
  when the object is outside the loaded page.
- In the map canvas, Alt-click is the shortcut for **Go to Table View**. The
  context-menu action is the discoverable equivalent.
- Missing or partial graph identity must not be repaired from kind/name guesses;
  such relationships remain display-only.

Graph truncation and permission warnings remain visible below the canvas. A
truncated graph must not present its object or link counts as the whole scope.

## Change Checklist

When changing object-map behavior:

1. Identify whether the change is backend graph data, frontend visibility,
   layout/rendering, or object-panel integration.
2. Preserve cluster/object refs through every node, edge, selection, and open
   action.
3. Add backend tests for new edge semantics.
4. Add frontend tests for filtering, collapse, selection, or renderer behavior
   when those change.
5. Verify large graphs still have bounded layout/render work.

## Validation

Run focused object-map snapshot tests and targeted object-map Vitest tests. For
visual renderer changes, verify in the app.
