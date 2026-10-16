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
2. *Replaced 2026-10-16 by decision 5.* Originally, other workloads' Pods
   reached through a shared Service stayed in the map.
3. Namespace truncation keeps objects that take part in any relationship first,
   then isolated objects, each group ordered by kind, namespace, and name.
4. Selection highlight and focus mode keep pure-direction lineage from the
   active node, and the workflow doc says so. Focusing the seed Deployment
   therefore hides its Service; that is intended.
5. (John, 2026-10-16, after seeing an HPA map with a RoleBinding and a Service.)
   Every object map shows only what starts from its seed. That means the
   objects the seed leads to, plus what leads into the seed or into the objects
   it owns through owner links. Paths never turn around anywhere else. The
   namespace map is for everything in a namespace.
   - Deployment maps keep decision 1, but lose other workloads' Pods and the
     RBAC on dependencies.
   - HPA maps are their scaling chain.
   - Role maps show granting bindings, but not their subjects.
   - Gateway maps show routes, but not their backends.

   This replaced mixed traversal and the `DirectionalTraversal` graph role.
6. (John, 2026-10-16, "I want map behavior to be predictable … I don't want
   special rules.") Replaces decision 5. Maps follow one rule, with Option B.
   - **The rule:** an object is on a map if and only if links that all point
     the same way connect it to the seed: all away from the seed (what it uses
     or contains), or all toward it (what uses or contains it). The same rule
     drives map membership, click highlight, focus mode, and the namespace
     map's cluster-scoped neighbors.
   - **Removed, as special rules:**
     - the ownership exception;
     - the per-link reverse policies;
     - the IngressClass special case;
     - the `StopsReverseExpansion` role;
     - the depth limit;
     - link canonicalization.
   - **Option B:** Services, PodDisruptionBudgets, and NetworkPolicies get a
     visible `selector` link to every workload whose pod template their
     selector matches. A Deployment map then shows them through the one rule.
     An HPA map doesn't, because reaching them would mean turning around at
     the Deployment.
7. (John, 2026-10-16, "the map needs to reflect how k8s actually behaves.")
   Replaces Option B in decision 6 and reverses decision 1. Links are only
   real Kubernetes relationships:
   - Service → EndpointSlice → Pod. The EndpointSlice controller turns the
     selector into slices, and kube-proxy routes to their endpoints.
   - PDB → Pod and NetworkPolicy → Pod. They are enforced against Pod labels
     directly.
   - No Service → Pod selector link and no inferred workload links.

   Under the one rule, Deployment maps no longer show Services, PDBs,
   NetworkPolicies, or Ingresses; they show on Pod and Service maps.

## Target Model

- The backend snapshot is the only owner of map membership and relationship
  edges. The payload's nodes and edges are exactly what the map shows before
  the user's view controls: Kind filter, link-type legend toggles, focus mode,
  ReplicaSet collapse, and search.
- One rule (decision 6). An object is on a map if and only if same-direction
  links connect it to the seed, nearest first, until the node cap.
- Every link between two objects on a map is drawn. Nothing is hidden because
  another path implies it.
- A namespace map holds the namespace's objects, plus the cluster-scoped
  objects the same rule reaches from them.
- The only bound is the node cap, and the banner always says when it's hit.
  No frontend step discards nodes the backend counted against the cap.
- What stays, all visible and user-driven: the Kind filter, legend link
  toggles, focus mode, search, and ReplicaSet collapse with its +N badge.

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

Status (2026-10-16): Phases 1-5 done on branch `object-map-fixes`, plus decision 5 (seed-and-owned traversal). Phases 6-10 (decision 6) and Phase 11 (decision 7) are done. After Phase 11, `qc:prerelease` passed on 2026-10-16: 106 Go packages under `-race`, 5,439 frontend tests, staticcheck and Trivy clean. `BenchmarkObjectMapBuild` measured about 57 ms at 10k Pods. John's app check is pending.

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

### Lineage inventory (2026-10-16)

- **Rules to remove:**
  - the ownership exception, `ownedBy`
    ([object_map.go:825](../../backend/refresh/snapshot/object_map.go));
  - reverse policies: 8 AnyDepth, 4 SeedOnly (uses, mounts, schedules,
    storage-class), and 1 DepthOne (volume-binding), in
    `objectMapRelationships`, enforced by `canTraverseObjectMapReverse`
    (object_map.go:1128);
  - the IngressClass special case, `canUseObjectMapEdgeForSeed`
    (object_map.go:1119);
  - `StopsReverseExpansion` (object_map.go:1152, the kindspec field, and 3
    descriptors);
  - the depth limit, `defaultObjectMapDepth = 4` (object_map.go:46), which
    cuts silently;
  - `canonicalObjectMapEdges`
    ([object_map_relationships.go:49](../../backend/refresh/snapshot/object_map_relationships.go)).
- **Links drawn today are only the traversed ones** (`includedEdges`). Two
  objects can sit on a map with their link hidden: on a Pod map, the
  Deployment and the ConfigMap its template uses.
- **Selector resolution:** today it matches only Pods (`matchingPods` and
  `matchingPodsByLabelSelector`, in `resolveEdgeTargets` at object_map.go:1396).
  Only three producers exist:
  - service/objectmapedges.go:19 (map selector; empty means none);
  - poddisruptionbudget/objectmapedges.go:15 (LabelSelector);
  - networkpolicy/objectmapedges.go:15 (LabelSelector; `{}` means every Pod).
- **Pod-template labels aren't captured anywhere in the map.**
  - `objectmapnode.Node` and `objectMapRecord` keep only metadata labels.
  - Workload nodes come from `NewNodeProjector`, which has 10 production call
    sites (workload_ingest_projector.go ×5, network ×2, node, pod,
    system/ingest_projectors.go).
  - ReplicaSet records come from the shared-informer collector.
- **Depth plumbing:**
  - the scope `maxDepth` parameter (`parseObjectMapScope`);
  - the payload `MaxDepth`, through types.generated.ts;
  - the AppDebugOverlays.tsx and objectMapDebugStore.ts debug views;
  - objectMapScope.ts (`OBJECT_MAP_MAX_DEPTH`, plus the unused
    `buildObjectMapScope`);
  - objectMapPerformanceFixtures.ts;
  - the contract `acceptedEncodings`;
  - 27 test scopes in object_map_test.go.
- **Tests that encode "no turning around"** keep their assertions; only their
  scopes change:
  - `DoesNotFanOutThroughSharedHubResources`;
  - `NodeSeedDoesNotTraversePodForwardDependencies`;
  - `DoesNotFanOutThroughSharedStorageClass`;
  - `BuildsFromIngressClass` (no special case needed);
  - `DoesNotFanOutThroughSharedIngressClass`;
  - `ReverseTraversesHubEdgesFromSeed`.
- **Tests that encode removed rules:**
  - `TestObjectMapReverseTraversalPolicies` (deleted);
  - `TestObjectMapCanonicalizesServiceEndpointEdges` (inverted).
- **Frontend:** the post-collapse prune is undirected
  (`objectMapSeedConnectivity.ts`). Selection and focus already use lineage
  (`objectMapTraversal.ts`).

### Phase 6: Selects links to workloads (backend)

Superseded by decision 7; Phase 11 removed these links and their plumbing.

Done before Phase 7, so Deployment maps never lose their Services in between.

- [x] Red: Service, PDB, and NetworkPolicy maps link to every workload whose
      pod template their selector matches:
      - Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, and CronJob (via
        `jobTemplate`);
      - a Service with an empty selector links to nothing;
      - an empty LabelSelector links to every workload in the namespace;
      - nothing crosses namespaces.

      Each link is a `selector` link ("selects").
- [x] Green, data plumbing:
      - add an optional `PodTemplateLabels` facet to `objectmapnode.Collector`,
        declared in each workload kind's package;
      - add a `PodTemplateLabels` field to `objectmapnode.Node`;
      - `NewNodeProjector` takes the collector (status, action facts,
        template labels) plus edges; update its 10 call sites and the test
        and benchmark projectors;
      - give `objectMapRecord` a `podTemplateLabels` field, filled from
        ingest nodes or the collector.
- [x] Green, resolution:
      - rename `PodsSelector` / `PodsLabelSelector` to
        `Selector` / `LabelSelector`, since they select Pods and pod
        templates;
      - resolve them against Pods' labels and workloads' template labels,
        with workloads indexed by namespace in `objectMapSelectorTargets`.
- [x] Re-run the benchmark against the 100 ms budget at 10k Pods.

### Phase 7: One rule for object maps (backend)

- [x] Red tests:
      - **No depth limit:** a Deployment map includes the StorageClass at
        distance 5 (Deployment → RS → Pod → PVC → PV → StorageClass).
      - **No reverse policies:** a PersistentVolume map includes the Pods
        that mount its PVC, and their owners.
      - **All links drawn:** a Pod map draws the Deployment → ConfigMap
        template link.
      - **Nothing hidden:** the canonicalization test inverts. A Service map
        draws the Service → Pod `selector` links and the
        Service → EndpointSlice `owner` link alongside the `endpoint` links.
      - **Selects links in maps:** a Deployment map shows
        Service → Deployment, PDB → Deployment, and
        NetworkPolicy → Deployment `selector` links. An HPA map still shows
        none of them.
      - **Nearest first:** at a cap, objects at distance 1 in either
        direction are kept before distance 2.
- [x] Green:
      - membership is one breadth-first walk whose queue items carry a
        direction (forward or backward) and a distance, starting from the
        seed in both directions, nearest first;
      - keep a visited set per direction; set `truncated` when the cap stops
        a new object;
      - the map's links are every link between its objects
        (`edgesBetween`);
      - `Depth` stays on nodes as the shortest distance.
- [x] Remove: `ownedBy`, reverse policies, `canTraverseObjectMapReverse`,
      `canUseObjectMapEdgeForSeed`, `canonicalObjectMapEdges`,
      `defaultObjectMapDepth` / `maxObjectMapDepth`, the `maxDepth` scope
      parameter (other query parameters stay ignored), and the payload
      `MaxDepth` field (regenerate types).
- [x] Update the depth-only test scopes. Delete
      `TestObjectMapReverseTraversalPolicies`.

### Phase 8: Namespace maps use the same rule (backend)

- [x] Red: a namespace map with only bound PVCs includes the StorageClass
      through PVC → PV → StorageClass, and a RoleBinding's ClusterRole. It
      excludes a ClusterRoleBinding's ClusterRole when the binding was
      reached backward from a ServiceAccount (a turn), and other PVs of the
      shared StorageClass.
- [x] Green: candidates are the namespace's objects, plus cluster-scoped
      objects reached from them by the one rule. The walk never enters
      another namespace's objects. Connected-first truncation stays.
- [x] Remove `StopsReverseExpansion` (the kindspec field, 3 descriptors,
      `stopsNamespaceMapReverseExpansion`, the drift assertion).

### Phase 9: Frontend

- [x] The post-collapse prune applies the one rule from the seed over the
      remaining links, reusing `objectMapTraversal`. Delete
      `objectMapSeedConnectivity.ts` and its test. The collapse-remnant test
      must stay green.
- [x] Remove `maxDepth` from the debug overlay and debug store, the
      performance fixtures, `objectMapScope.ts`, and the unused
      `buildObjectMapScope`.
- [x] Verify the legend still toggles `selector` links, which is the user's
      control for the extra lines.

### Phase 10: Docs and validation

- [x] Workflow Membership section: the one rule, links drawn as facts, the
      namespace rule, no depth limit.
- [x] Update the add-resource skill: new pod-template workload kinds declare
      `PodTemplateLabels`.
- [x] Resource-kind-registry doc: it never named the removed graph roles
      (grep finds none), so it needs no change.
- [x] Update the release notes.
- [x] Benchmark at 10k Pods: about 75 ms for both scopes, within the 100 ms
      budget. The benchmark fixture's workloads now carry pod-template
      labels.
- [x] `qc:prerelease`: see Status.
- [ ] John's app check.

### Phase 11: Faithful links (decision 7)

- [x] Red tests (failed on the Service selector link and on workloads reached
      through selectors):
      - a Service links only to its EndpointSlices, which link to the endpoint
        Pods. A selected Pod that isn't an endpoint has no link from the
        Service (`TestObjectMapSelectorsRelateToPodsOnly`,
        `TestObjectMapServiceReachesPodsThroughItsEndpointSlices`).
      - PDBs and NetworkPolicies link to Pods and never to workloads.
      - a Deployment map holds its chain and HPA only.
      - a Pod map shows the Service (through the slice), the PDB, the
        NetworkPolicy, and the Ingress
        (`TestObjectMapShowsOnlyWhatStartsFromTheSeed`).
- [x] Remove:
      - the Service `selector` edge;
      - workload matching in selector resolution;
      - the `PodTemplateLabels` facet, its Node and record fields, the
        workload index, `NonNilLabels`, and the six workload facets.
      - `Edge.Selector` (no producer once the Service edge is gone),
        `matchingSelector`, and `labelsMatch`. `LabelSelector` is
        `PodsLabelSelector` again, as at HEAD.
      - `NewNodeProjector(collector, edges)` is back to HEAD's
        `(status, actionFacts, edges)`: the collector form only carried
        `PodTemplateLabels`. Its caller files match HEAD again.
- [x] Update the tests and fixtures that modelled workload links, and the
      docs, skill, and release notes.
      - Backend: the core-relationships test seeds the Pod; the node-cap and
        namespace-truncation tests use a PDB's selector; the two-workloads
        test seeds a Pod behind a shared EndpointSlice; the bench checks the
        seed's ReplicaSet.
      - Frontend: a Pod-seeded neighborhood payload; the collapse remnant
        keeps the new Pod's ConfigMap and the HPA; the layout test's
        same-column triangle is Deployment → ReplicaSet → ConfigMap.
- [x] Checks and benchmark: see Status.
- [ ] John's app check.

## Open Questions

Questions 1-4 were answered by John on 2026-10-16, taking the recommendation
in each case.

1. **Links drawn:** every link between two objects on a map (recommended; no
   hidden links), or only links on a same-direction path from the seed
   (today's behavior; hides some links between visible objects)?
2. **Service ↔ EndpointSlice:** draw both the `owner` link (from the slice's
   ownerReference) and the `endpoint` link (from the service-name label)? The
   recommendation is yes: they are two facts, and the legend can hide either
   type. Dropping one would be a special rule.
3. **ReplicaSets get selects links too?** The recommendation is yes: every
   workload with a matching pod template gets one, and old ReplicaSets stay
   collapsed behind +N. Limiting the links to top-level workloads would be a
   special rule. Moot after decision 7: no selector links to workloads.
4. **Remove the `maxDepth` scope parameter entirely?** The recommendation is
   yes. The node cap is the only bound.
5. **Namespace truncation splitting chains:** still open, separate from
   decision 6.

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
