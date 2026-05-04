# Object Map

The object map shows the relationship graph around a Kubernetes object. It is
opened from the object panel map tab or from object/action menus that expose the
`Map` action.

The feature is intentionally split into a backend graph builder and a frontend
renderer:

- Backend: builds a cluster-scoped object relationship snapshot.
- Frontend: requests the snapshot, computes the visual layout, and renders the
  interactive map with G6.

All map data is multi-cluster aware. Every object reference used by the map must
include `clusterId`, `group`, `version`, `kind`, and `name`; `namespace` is
included for namespaced objects.

## Data Flow

1. The object panel decides whether the selected object supports maps using
   `frontend/src/modules/object-panel/components/ObjectPanel/objectMapSupport.ts`.
2. `MapTab` builds a scoped object-map request using
   `frontend/src/modules/object-map/objectMapScope.ts`.
3. The frontend refresh orchestrator enables the scoped `object-map` domain only
   while the map tab is active.
4. The backend `object-map` snapshot domain builds a graph in
   `backend/refresh/snapshot/object_map.go`.
5. The frontend object-map model filters, collapses, lays out, and annotates the
   returned graph.
6. `ObjectMapG6Renderer` renders the graph, handles pan/zoom, drag, hit testing,
   connection hover, node selection, and context menu events.

The map uses snapshots, not the resource stream. The snapshot response is still
fed by live backend data sources where available, including the object catalog
and typed Kubernetes clients.

## Backend Domain

The backend domain name is `object-map`. It is registered with the refresh
registry in `backend/refresh/system/registrations.go` and implemented by
`RegisterObjectMapDomain` in `backend/refresh/snapshot/object_map.go`.

The snapshot payload is `ObjectMapSnapshotPayload`:

- `seed`: the object the map was opened from.
- `nodes`: objects included in the relationship graph.
- `edges`: directed relationships between nodes.
- `maxDepth`: traversal depth used for the snapshot.
- `maxNodes`: node cap used for the snapshot.
- `truncated`: true when the node cap stopped traversal.
- `warnings`: non-fatal graph-building warnings.

Default backend limits:

| Setting | Value |
| --- | ---: |
| Default depth | 4 |
| Default nodes | 250 |
| Max depth | 12 |
| Max nodes | 1000 |

The frontend scope builder can request `maxDepth` and `maxNodes`, but both are
clamped to the same backend caps.

## Backend Sources

The graph builder starts with the object catalog so every cataloged object can be
represented consistently. It also adds typed records from Kubernetes resources
that provide richer relationship data:

- Pods
- Services
- EndpointSlices
- PersistentVolumeClaims
- PersistentVolumes
- StorageClasses
- ConfigMaps
- Secrets
- ServiceAccounts
- Nodes
- Deployments
- ReplicaSets
- StatefulSets
- DaemonSets
- Jobs
- CronJobs
- HorizontalPodAutoscalers
- Ingresses
- IngressClasses
- ClusterRoles
- ClusterRoleBindings

If a new relationship depends on fields not present in the catalog, add typed
collection for that resource before adding the edge builder.

## Relationships

Backend relationship types are the source of truth for graph semantics. The
frontend keeps a matching relationship registry in
`frontend/src/modules/object-map/objectMapEdgeStyle.ts` for legend ordering and
edge styling.

| Type | Backend label | Legend label | Reverse traversal |
| --- | --- | --- | --- |
| `owner` | owns | Ownership | Any depth |
| `selector` | selects | Selector | Any depth |
| `endpoint` | has endpoints | Endpoint | Any depth |
| `routes` | routes to | Ingress Route | Any depth |
| `scales` | scales | Scaling | Any depth |
| `schedules` | scheduled on | Scheduled On | Seed only |
| `grants` | grants | Grants | Any depth |
| `binds` | binds | Binds | Any depth |
| `aggregates` | aggregates | Aggregates | Any depth |
| `uses` | uses | Used By | Seed only |
| `mounts` | mounts | Mounts | Seed only |
| `volume-binding` | binds volume | Volume Binding | Depth one |
| `storage-class` | uses class | Storage Class | Seed only |

Reverse traversal matters because shared infrastructure objects can otherwise
pull unrelated parts of the cluster into a map. For example, many pods can share
the same node, service account, config map, secret, persistent volume, or storage
class. Those objects may appear when directly related to the seed, but traversal
does not fan out indefinitely through them.

Some seed kinds use directional traversal. For these maps, backend traversal
runs forward and backward passes from the seed instead of one mixed pass:

- Pod
- Service
- EndpointSlice
- PersistentVolumeClaim
- PersistentVolume
- StorageClass
- ConfigMap
- Secret
- ServiceAccount
- Node
- IngressClass

IngressClass has an additional seed filter: an IngressClass map only includes
IngressClass and Ingress relationships, so it does not fan out through unrelated
resources.

## Frontend Support

The map tab is allowlisted by kind. Unsupported objects do not show the map tab
or map action by default.

Supported kinds:

- Pod
- Service
- EndpointSlice
- PersistentVolumeClaim
- PersistentVolume
- StorageClass
- ConfigMap
- Secret
- ServiceAccount
- Node
- ClusterRole
- ClusterRoleBinding
- Deployment
- ReplicaSet
- StatefulSet
- DaemonSet
- Job
- CronJob
- HorizontalPodAutoscaler
- Ingress
- IngressClass

The allowlist lives in
`frontend/src/modules/object-panel/components/ObjectPanel/objectMapSupport.ts`.
The same check also requires a complete object reference before the map is made
available.

## Rendering

The frontend renderer is G6-only. The earlier SVG renderer was removed after G6
became the production path.

Important frontend files:

- `frontend/src/modules/object-map/ObjectMap.tsx`: shell, toolbar, legend,
  search, focus mode, context menu wiring.
- `frontend/src/modules/object-map/useObjectMapModel.ts`: graph filtering,
  ReplicaSet collapse/expand state, selection state, hover state, drag
  overrides, and reset behavior.
- `frontend/src/modules/object-map/objectMapLayout.ts`: seed-anchored layered
  layout and edge routing.
- `frontend/src/modules/object-map/ObjectMapG6Renderer.tsx`: G6 integration,
  viewport controls, event handling, tooltips, and CSS variable palette loading.
- `frontend/src/modules/object-map/ObjectMap.css`: visual styling and CSS
  variables consumed by the renderer.

Layout ownership is frontend-side. The backend returns nodes, edges, and graph
depths; the frontend decides visual columns, card positions, edge routes, focus
filtering, and viewport behavior.

## User Interaction

The current map supports:

- Node click selection with recursive relationship highlighting.
- Focus mode, which hides unrelated objects and redraws the selected recursive
  relationship graph.
- Dragging nodes with non-persistent layout overrides.
- Reset layout, which clears drag overrides and focus state.
- Fit and auto-fit viewport controls.
- Mouse wheel panning by default, with modifier-wheel zoom.
- Search by kind, namespace, or name.
- Connection hover highlighting and tooltips.
- Node context menus through the centralized object action controller.
- Cmd-click on macOS, or Ctrl-click elsewhere, to open the object panel.
- Alt-click to open the object's primary view.

Drag positions are intentionally not persisted. Reset returns the graph to the
computed default layout.

## Refresh Behavior

The object map is a scoped snapshot domain. It is enabled only while a map tab is
active.

Frontend polling for `object-map` is set in
`frontend/src/core/refresh/refresherConfig.ts`:

| Domain | Interval | Cooldown | Timeout |
| --- | ---: | ---: | ---: |
| `object-map` | 2000 ms | 1000 ms | 10 s |

The backend snapshot cache is global and remains `SnapshotCacheTTL = 5s` in
`backend/internal/config/config.go`. There is no object-map-specific backend TTL.

Manual refresh uses the same snapshot path as the timer-driven refresh. It does
not subscribe to resource streams.

## Adding Map Support

To add map support for another kind:

1. Confirm the object can be represented with a complete reference:
   `clusterId`, `group`, `version`, `kind`, `namespace` when namespaced, and
   `name`.
2. Add typed backend collection if the relationship data is not already
   available from the object catalog or existing typed records.
3. Add backend edge construction in
   `backend/refresh/snapshot/object_map.go`.
4. Choose a relationship type and reverse traversal policy. Reuse an existing
   type when the semantics match.
5. Add or update backend tests in
   `backend/refresh/snapshot/object_map_test.go`.
6. Add the kind to the frontend allowlist in `objectMapSupport.ts`.
7. Update frontend edge styling only if a new edge type was introduced.
8. Add or update frontend tests for tab/action visibility and map behavior.

Do not add a kind to the frontend allowlist until the backend can build a useful
map for that kind. The map tab should stay hidden by default for unsupported
objects.

## Testing

Backend coverage lives primarily in
`backend/refresh/snapshot/object_map_test.go`. These tests cover seed scope
validation, node caps, shared hub traversal, storage relationships, IngressClass
filtering, and cluster RBAC relationships.

Frontend coverage lives under `frontend/src/modules/object-map/` and the object
panel map/action tests. These tests cover layout, collapse behavior, edge
dedupe, directional filtering, selection, toolbar behavior, context menus, and
renderer data conversion.

Run `mage qc:prerelease` before presenting code changes as complete.
Documentation-only changes can skip prerelease under the repository rules.
