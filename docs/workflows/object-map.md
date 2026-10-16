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
- Graph truncation and permission warnings stay visible below the canvas; a
  truncated graph never presents its object or link counts as the whole scope.
- Large graphs keep bounded layout and render work.
- Legend and copy use user-facing terms such as "Objects" and "Links".

## Ownership

- Backend snapshot builder: `backend/refresh/snapshot/object_map.go`; shared
  links and facts: `backend/resourcemodel`.
- Frontend: `frontend/src/modules/object-map`; object-panel Map tab integration
  in `frontend/src/modules/object-panel`.
- Declare map collectors and relationship builders in the owning kind's
  registry descriptor. Shared edge projections belong in
  `backend/kind/objectmapspec`, avoiding imports between kind packages or back
  into the snapshot package.
- Ingest-owned kinds register node projectors before reflectors start so the
  initial intake includes map data.
- Collected records (shared informers and ingest projections) are the only
  source of their fields. The object catalog supplies objects the map doesn't
  collect, such as a custom resource that owns a ReplicaSet. Those are looked
  up by UID or complete identity when a relationship needs them; a build
  never copies the whole catalog. A UID names one object whatever its served
  version, so a catalog row whose UID matches a collected record resolves to
  that record.
- Selector targets (Pods, EndpointSlices, ClusterRoles) are indexed once per
  build. Traversal sorts each object's links only when it visits the object.
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

- The backend snapshot decides which objects and links a map contains. The
  payload is what the map shows before the view controls: the Kind filter, the
  legend's link toggles, focus mode, ReplicaSet collapse, and search. The
  frontend applies no relationship rules of its own. After collapse, it only
  drops objects no longer connected to the seed.
- Seeds whose kind has the `DirectionalTraversal` graph role (hubs such as
  Node, PersistentVolume, and ServiceAccount) expand only purely forward or
  purely backward.
- Other seeds use mixed traversal, bounded by each link type's reverse
  policy. A workload's map therefore includes the Services, EndpointSlices,
  PodDisruptionBudgets, NetworkPolicies, Ingresses, and HPAs around it. It also
  includes other workloads' Pods behind a shared Service, up to the depth
  limit.
- Links are canonical, and canonicalization never changes which objects are
  in the map:
  - an `owner` link is dropped when an `endpoint` link joins the same pair;
  - a `selector` link is dropped when an endpoint chain reaches the same
    target. A selected Pod that the endpoints leave out keeps its `selector`
    link.
- Namespace maps rank every eligible object before applying the node cap:
  - eligible means the namespace's objects plus the cluster-scoped neighbors
    the expansion rules admit;
  - objects with a link to another candidate come first, then isolated ones,
    each ordered by kind, namespace, and name.
- Selection highlight and focus mode show the active object's lineage: the
  objects reached by following links purely forward or purely backward. They
  do not use the membership rules.

## Map Interactions

- Every wheel gesture zooms around the pointer: a mouse wheel, a trackpad
  scroll, and a pinch. Dragging the background pans. Both turn off auto-fit.
  The map registers no G6 wheel behavior, so a wheel never pans as well.
- Tab reaches the search field and toolbar controls. Enter in the search field
  centers a matching visible object; repeated presses cycle through matches.
- Right-clicking an object opens its canvas menu, which uses the shared
  resource-action controller and complete object reference. Partial references
  offer no object actions. A removed or filtered object closes its menu; an
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
