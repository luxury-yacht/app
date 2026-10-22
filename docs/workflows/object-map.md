# Object Map Contract

The object map visualizes Kubernetes object relationships. It is the scoped
refresh snapshot domain `object-map`, not a rich detail service or a
resource-stream path. Backend data owns graph identity and relationship facts;
frontend code owns visibility, layout, rendering, and interaction state.

## Agent Contract

- Map scopes are single-cluster and cluster-prefixed.
- Openable nodes and edges keep complete object refs through selection and
  every open action.
- Relationships come from backend resource semantics or catalog-safe identity
  ([shared-resource-model](../architecture/shared-resource-model.md#links)),
  never from frontend kind/name guesses, visual proximity, or table row
  strings. Partial, stale, external, deleted, or unsupported identity stays
  display-only and is never repaired from kind/name guesses.
- Fix missing nodes, refs, or edges in the backend graph, not with
  frontend-only labels or renderer patches. Adding a kind changes backend graph
  facts and frontend presentation only where both are needed.
- Frontend filtering, collapse, layout, viewport state, and age text never
  rewrite backend identity, relationship data, or layout inputs. Card age text
  derives from backend timestamps through [live-age](../frontend/live-age.md).
- The Kind multiselect distinguishes `all`, `some`, and `none`. `all` includes
  kinds discovered later; `none` renders an empty visible graph without
  changing the backend graph or its identities.
- Debug snapshots describe the raw backend graph, frontend-visible graph, and
  renderer state separately.
- Graph truncation and permission warnings stay visible below the canvas, also
  on an empty map; a truncated graph never presents its object or link counts
  as the whole scope.
- Large graphs keep bounded layout and render work.
- Legend and copy use user-facing terms such as "Objects" and "Links".

## Ownership

- Backend snapshot builder: `backend/refresh/snapshot/object_map.go`; shared
  links and facts: `backend/resourcemodel`.
- Frontend: `frontend/src/modules/object-map`; object-panel Map tab integration
  in `frontend/src/modules/object-panel`.
- Map support is per group, version, and kind, declared once by the kind
  registry's collectors (`kindregistry.ObjectMapIdentities`). The identity
  contract's `objectMap` facet carries it to the frontend gate
  (`isObjectMapSupportedRef`), and the `object-map` permission list derives
  from it. A custom resource that shares a built-in kind name gets no map.
  The one other map seed is the app's synthetic Helm release identity
  (`helm.sh/v3` `HelmRelease`, `resourcemodel.HelmReleaseGVK`); its scope is
  the release's object scope, and its builder is
  `backend/refresh/snapshot/object_map_helm.go`. A Flux `HelmRelease` custom
  resource gets no map.
- Declare map collectors and relationship builders in the owning kind's
  registry descriptor. Shared edge projections belong in
  `backend/kind/objectmapspec`, avoiding imports between kind packages or back
  into the snapshot package.
- Ingest-owned kinds register node projectors before reflectors start so the
  initial intake includes map data.
- Collected records (ingest projections) are the only source of their
  fields. The object catalog supplies objects the map doesn't
  collect, such as a custom resource that owns a ReplicaSet. Those are looked
  up by UID or complete identity when a relationship needs them; a build
  never copies the whole catalog. A UID names one object whatever its served
  version, so a catalog row whose UID matches a collected record resolves to
  that record.
- Selector targets (Pods, EndpointSlices, ClusterRoles) are indexed once per
  build. Traversal sorts each object's links
  only when it visits the object.
  Measure build changes with `BenchmarkObjectMapBuild` (`wails3 task
  qc:benchmark`); the budget is under 100 ms per build at 10k Pods.

## Relationship Rules

- RBAC maps support Role, RoleBinding, ClusterRole, ClusterRoleBinding, and
  ServiceAccount nodes. Both binding kinds use the same `grants`/`binds` edge
  projection from canonical RBAC facts. RoleBindings resolve Roles in their own
  namespace, ClusterRoles at cluster scope, and ServiceAccounts in the subject's
  namespace (defaulting to the binding namespace when omitted). User and Group
  subjects stay display-only facts without fabricated object nodes.
- Owners, selectors, Gateway API references, service endpoints, routes, PVC/PV,
  HPA targets, Helm-managed objects, and event involved objects use shared
  resource identity where available.

## Membership

One rule decides what a map contains, and nothing else changes it.

- **The rule:** an object is on a map if and only if links that all point the
  same way connect it to the seed. They point either away from the seed (what
  it uses or contains) or toward it (what uses or contains it). Paths never
  turn around.
- The same rule drives click highlight and the frontend's prune after
  ReplicaSet collapse (`collectLineage` in `objectMapTraversal.ts`). Each
  keeps every link between the objects it keeps, as the map does.
- The backend walks breadth-first in both directions at once, so nearer
  objects come first. The node cap is the only bound, and the banner says
  when it was reached. There is no depth limit and there are no per-kind or
  per-link exceptions.
- Every link between two objects on a map is drawn. Links are facts; none is
  hidden because another path implies it. For example, a Service shows its
  `owner` and `endpoint` links to its EndpointSlice side by side.
- Links are only relationships Kubernetes itself keeps; none is inferred. A
  Service has its EndpointSlices and reaches Pods only through them, as
  traffic does: each slice links to the Pods it lists as endpoints. A Pod the
  Service's selector matches but that isn't an endpoint has no link from it.
  PodDisruptionBudgets and NetworkPolicies select Pods. Nothing links any of
  them to a workload.
- So a Deployment's map is its owner chain, what its Pods use, and the HPA
  that scales it. A Pod's map adds what acts on the Pod: the EndpointSlice
  that lists it, with the Service and Ingress in front, and the PDB and
  NetworkPolicy that select it.
- A map leaves out what is only reached by turning around:
  - Services, EndpointSlices, Ingresses, PDBs, and NetworkPolicies on a
    Deployment's map (they act on its Pods);
  - an EndpointSlice's other endpoints, and their workloads, on a Pod's map;
  - RBAC that binds a dependency;
  - a binding's subjects on a Role's map;
  - a route's backends on a Gateway's map.

  Open that object's own map instead.
- A namespace map holds every object in the namespace, plus the cluster-scoped
  objects the same rule reaches from them through cluster-scoped objects.
- When a namespace map exceeds the cap, objects with a link to another
  candidate rank before isolated ones, each ordered by kind, namespace, and
  name.
- A Helm release map holds exactly the objects the release's rendered
  manifest names, with the links between them. Objects controllers create from
  them (ReplicaSets, Pods, EndpointSlices) are not part of the release and stay
  off. There is no release card; the cap ranks objects as a namespace map does.
- Manifest objects are matched by group, kind, namespace, and name, so an
  object the chart names by an older served version (`autoscaling/v1`) is the
  live object the map collects under another version. Kinds the map does not
  collect come from the object catalog (`LookupObject`).
- A manifest object the cluster confirms it does not have is a display-only
  missing node (`missing: true`): the manifest's identity, no live state, a
  dashed card of the same shape with "Not found" in place of its age, and no
  object actions. Absence is confirmed only when the build read the object's
  kind completely: a collected kind this build listed whose readiness is ready,
  or a catalog kind the catalog has fully listed. An object of a denied kind,
  of a kind still loading, in a namespace outside the cluster's namespace
  scope, or whose API version the cluster does not serve is reported in the
  warnings instead and never drawn as missing.
- The payload is what the map shows before the view controls: the Kind
  filter, the legend's link toggles, ReplicaSet collapse (with its +N badge),
  and search. The frontend applies no relationship rules of its own.

## Layout

- Objects with a link to another object on the map are laid out in columns
  that follow their links, with the seed in column 0.
- Objects with no such link, common on namespace and Helm release maps and
  under a Kind filter, form their own block of lanes ordered by kind. It sits
  right of or below the linked layout, whichever lets the whole map fit a
  16:10 view at the largest zoom, and never moves the linked objects.

## Map Interactions

- Every wheel gesture zooms around the pointer: a mouse wheel, a trackpad
  scroll, and a pinch. Dragging the background pans. Both turn off auto-fit.
  The map registers no G6 wheel behavior, so a wheel never pans as well.
- Dragging an object pins it. A pin applies under every Kind filter and
  survives refreshes while its object stays on the map.
  **Reset layout** clears all pins. Pins last only while the map is open.
- Tab reaches the search field and toolbar controls. Enter in the search field
  centers a matching visible object; repeated presses cycle through matches.
- Right-clicking an object opens its canvas menu, which uses the shared
  resource-action controller and complete object reference. Partial references
  and missing objects offer no object actions, and modifier clicks on a missing
  object only select it. A removed or filtered object closes its menu; an
  empty map has no object actions.

## Table Navigation

- Resource-table **Open Map** opens an object-scoped map from a validated
  complete reference.
- Map **Go to Table View** selects the resource's owning namespace and table,
  then issues a cluster-scoped row-focus request from the same complete
  reference. Query-backed tables may use it for an anchor query when the object
  is outside the loaded page.
- In the canvas, Alt-click is the shortcut for **Go to Table View**; the
  context-menu action is the discoverable equivalent.

## Validation

- New edge semantics need backend tests; filtering, collapse, selection, or
  renderer changes need targeted object-map Vitest tests.
- RBAC regressions live in
  [`object_map_rbac_test.go`](../../backend/refresh/snapshot/object_map_rbac_test.go)
  and [`ingest_projectors_test.go`](../../backend/refresh/system/ingest_projectors_test.go).
  Cover namespace and object scopes, same-name objects in different namespaces,
  both RoleBinding role-reference kinds, cross-namespace ServiceAccount
  subjects, and permission denial with permitted resources still available.
  Exercise the namespace RBAC table's Open Map action and the object-panel Map
  tab as separate frontend consumers.
- When measuring per-kind projection coverage through snapshot or ingest tests,
  include those kind packages with `-coverpkg` so consumer execution counts.
- Visual renderer changes are verified in the app; keep mocked API/navigation
  evidence separate from native app checks.
