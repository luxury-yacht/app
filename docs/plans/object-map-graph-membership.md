# Object Map Graph Membership

Temporary plan from the 2026-10-15 object-map review. Order: land this plan
first. [object-map-build-cost](object-map-build-cost.md),
[object-map-view-state](object-map-view-state.md), and
[object-map-kind-identity](object-map-kind-identity.md) touch the same files
and follow it.

## Decisions

All decided by John on 2026-10-15.

1. A Deployment's map shows the Services, EndpointSlices, PodDisruptionBudgets,
   NetworkPolicies, and Ingresses around its Pods.
2. Other workloads' Pods reached through a shared Service stay in the map. In
   mixed traversal they appear at depth 4 (deploy0→rs1→pod2←svc3→pod4). They
   show what else the Service routes to, and depth bounds them. There is no
   rule against turning from backward back to forward; such a rule would also
   hide Gateways behind HTTPRoutes.
3. Namespace truncation keeps objects that take part in any relationship first,
   then isolated objects, each group ordered by kind, namespace, and name.
4. Selection highlight and focus mode keep pure-direction lineage from the
   active node, and the workflow doc says so. Focusing the seed Deployment
   therefore hides its Service; that is intended.

## Target Model

- The backend snapshot is the only owner of map membership and relationship
  edges. The payload's nodes and edges are exactly what the map shows before
  the user's view controls: Kind filter, link-type legend toggles, focus mode,
  ReplicaSet collapse, and search.
- Seeds whose kind has the `DirectionalTraversal` graph role keep the
  backend's directional traversal. All other seeds keep the backend's mixed
  traversal and its reverse-traversal policies.
- The node cap and `truncated` apply to that final graph. No frontend step
  discards nodes the backend counted against the cap.

## Non-goals

- Depth or node-limit controls in the UI. That needs a design pick first.
- Changing reverse-traversal policies, edge types, or directional traversal
  for hub kinds.
- Changing selection highlight or focus-mode semantics (decision 4).

## Inventory

- **Backend traversal:**
  - Directional or mixed traversal is chosen per seed kind in `buildGraph`
    ([object_map.go:790](../../backend/refresh/snapshot/object_map.go)), using
    `usesDirectionalObjectMapTraversal` at `:1156`.
  - The mixed walk is at
    [object_map.go:971](../../backend/refresh/snapshot/object_map.go).
  - Reverse policies are in
    [object_map_relationships.go](../../backend/refresh/snapshot/object_map_relationships.go).
- **Frontend membership rules to remove:**
  - `filterByDirectionalReachability` is called twice:
    [useObjectMapModel.ts:89](../../frontend/src/modules/object-map/useObjectMapModel.ts),
    and again after collapse at `:118`.
  - `dedupeServiceEdges` is called at `:84`.
  - I ran the filter on a Deployment-seeded graph. It drops the Service,
    EndpointSlice, PDB, NetworkPolicy, and Ingress (esbuild + node run of
    `objectMapDirectionalFilter.ts`, 2026-10-15).
- **Tests that encode the split:**
  - Backend:
    [TestObjectMapBuildsRecursiveCoreRelationships](../../backend/refresh/snapshot/object_map_test.go)
    asserts the edges the frontend drops.
  - Frontend: `objectMapDirectionalFilter.test.ts`, `objectMapDedupe.test.ts`,
    and `ObjectMap.test.tsx`.
- **Selection and focus:**
  [objectMapSelection.ts](../../frontend/src/modules/object-map/objectMapSelection.ts)
  uses pure-direction traversal from the active node through
  `objectMapTraversal.ts`. This file stays.
- **Truncation:**
  - Namespace maps keep records sorted alphabetically by kind
    ([object_map.go:869](../../backend/refresh/snapshot/object_map.go)), so
    Services, StatefulSets, and Secrets are cut first.
  - `buildNamespaceGraph` (`:855`) fills slots with namespaced records first.
    It then adds cluster-scoped neighbors such as Nodes and PVs, but that loop
    stops once the graph is truncated (`:907`). So cluster-scoped objects never
    compete for slots. At a cap of 2, a Pod plus an isolated ConfigMap shut out
    the Pod's Node.
  - The banner
    ([ObjectMap.tsx:421](../../frontend/src/modules/object-map/ObjectMap.tsx))
    asks the user to raise limits that no UI exposes.
- **Docs:** [object-map workflow](../workflows/object-map.md) has no membership
  section.

## Phases

Status (2026-10-15): Phases 1-5 done on branch `object-map-fixes`.

- Backend: `go test ./backend/refresh/snapshot -run ObjectMap` passes.
- Backend: `go test ./backend/refresh/snapshot ./backend/refresh/system` passes.
- Frontend: Vitest for object-map, namespace, and object-panel passes 145
  files and 1,323 tests.
- Go complexity on the changed functions is 6 or lower. The TS complexity
  check flags `moveNodeDrag` at 13. That's pre-existing (unchanged lines) and
  is handled by the view-state plan, which reworks drag.
- The app check in Validation is still pending.
- Typecheck and Biome on the changed files are clean.

### Phase 1: Lock the decision with failing tests

- [x] Red: add an `ObjectMap` test with a Deployment-seeded payload containing a
      Service, EndpointSlice, PDB, NetworkPolicy, Ingress, and HPA. Assert that
      every object renders. It fails today because of the directional filter.
- [x] Add a backend test for decision 2: one Service selects the Pods of two
      Deployments. At the default depth, the other Deployment's Pods appear in
      the first Deployment's map, and its ReplicaSet and Deployment do not.

### Phase 2: Move edge canonicalization to the backend

- [x] Red: add backend tests that the payload has:
      - no Service→EndpointSlice `owner` edge when an `endpoint` edge joins the
        same pair;
      - no Service→Pod `selector` edge when the Pod is reached through
        Service→EndpointSlice→Pod;
      - a kept `selector` edge when the Pod is missing from the slices (a Pod
        that isn't ready).
- [x] Green: canonicalize the final edge set after traversal, not before.
      Removing the direct `selector` edge before traversal would push Ingress
      from depth 4 to depth 5 for a Deployment seed (deploy→rs→pod←slice←svc),
      so it would drop out at the default depth. Express the rules by edge type
      only, without kind names.
- [x] Delete `objectMapDedupe.ts` and its test. Update the backend tests that
      assert the removed edges.

### Phase 3: Remove frontend membership filtering

- [x] Remove the `filterByDirectionalReachability` call at
      `useObjectMapModel.ts:89`.
- [x] Red: add a collapse test. Hiding old ReplicaSets must leave no
      disconnected remnants, and must still keep the Service that selects
      visible Pods. Collapse only hides zero-Pod ReplicaSets, so the realistic
      remnant is an object an old pod template references (for example the
      previous ConfigMap).
- [x] Green: replace the post-collapse prune at `:118` with undirected
      reachability from the seed (`objectMapSeedConnectivity.ts`). Namespace maps have no seed and stay
      unpruned, as today.
- [x] Delete `objectMapDirectionalFilter.ts` and its test.
      `objectMapTraversal.ts` stays because selection uses it.
- [x] The Phase 1 frontend test passes.

### Phase 4: Truncation semantics

- [x] Banner copy: state the fact, for example "Showing N objects; this map is
      limited to M." Remove the advice to raise limits. Copy changes are exempt
      from TDD and need no copy test.
- [x] Red: add namespace-map tests above `maxNodes` for decision 3. Both fail
      today:
      - At a cap of 2, a namespace with a Pod scheduled on a Node and an
        isolated ConfigMap keeps the Pod and the Node, drops the ConfigMap, and
        reports `truncated`.
      - A Service and its Pods are kept before an unreferenced ConfigMap,
        whatever their kind names.
- [x] Green: rank only after the candidate set is complete.
      - First build every eligible candidate with no cap: the namespace's
        supported records, plus the cluster-scoped objects the current
        expansion admits. The expansion keeps its rules: forward targets, and
        reverse sources except through `StopsReverseExpansion` targets, run to
        a fixpoint.
      - Then rank the candidates: objects with an edge to another candidate
        first, then isolated ones, each ordered by kind, namespace, and name.
        Keep the first `maxNodes`.
      - `truncated` means more candidates exist than the cap. Edges are the
        edges between the kept nodes.
- [x] Keep the existing expansion-policy tests green, such as
      `TestObjectMapNamespaceGraphDoesNotReverseExpandFromStorageClass`.

### Phase 5: Docs

- [x] Add a Membership section to the
      [object-map workflow](../workflows/object-map.md): the backend owns
      membership and edge canonicalization, the frontend applies view controls
      only, the truncation order (decision 3), and lineage semantics for
      selection and focus (decision 4).
- [x] Remove comments that describe frontend-only membership, including the
      header of `objectMapCollapse.ts` if its wording no longer holds.

## Open Questions

None. See Decisions.

## Validation

- `mise exec -- go test ./backend/refresh/snapshot -run ObjectMap`
- `mise exec -- npm run test --prefix frontend -- object-map`
- `mise exec -- npm run typecheck --prefix frontend`
- Coverage with `wails3 task test:backend-coverage` and
  `wails3 task test:frontend-coverage`. Check complexity at 12 or lower.
- `mise exec -- wails3 task qc:prerelease`
- App check (`wails3 dev`, dev-stg kubeconfig): open the Map tab for a
  Deployment that has a Service, Ingress, and PDB, a Node map, and a namespace
  map.
