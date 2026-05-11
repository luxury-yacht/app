# Object Map

The object map shows Kubernetes relationship graphs. It is opened from the
object panel map tab, from object/action menus that expose the `Map` action, and
from the namespace `Map` view.

The feature is intentionally split into a backend graph builder and a frontend
renderer:

- Backend: builds cluster-scoped object or namespace relationship snapshots.
- Frontend: requests the snapshot, computes the visual layout, and renders the
  interactive map with G6.

All map data is multi-cluster aware. Every object reference used by the map must
include `clusterId`, `group`, `version`, `kind`, and `name`; `namespace` is
included for namespaced objects.

## Data Flow

1. The object panel decides whether the selected object supports maps using
   `frontend/src/modules/object-panel/components/ObjectPanel/objectMapSupport.ts`.
2. Object-panel `MapTab` builds a scoped object-map request using
   `frontend/src/modules/object-map/objectMapScope.ts`.
3. Namespace `Map` builds a namespace-scoped object-map request using the same
   scope helpers.
4. The frontend refresh orchestrator enables the scoped `object-map` domain only
   while the map view is active.
5. The backend `object-map` snapshot domain builds a graph in
   `backend/refresh/snapshot/object_map.go`.
6. The frontend object-map model filters, collapses, lays out, and annotates the
   returned graph.
7. `ObjectMapG6Renderer` renders the graph, handles pan/zoom, drag, hit testing,
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

| Setting       | Value |
| ------------- | ----: |
| Default depth |     4 |
| Default nodes |   250 |
| Max depth     |    12 |
| Max nodes     |  1000 |

The frontend scope builder can request `maxDepth` and `maxNodes`, but both are
clamped to the same backend caps.

## Scope Modes

Object maps support two scope shapes:

- Object scope: `clusterId|<namespace>:<group>/<version>:<Kind>:<name>`
- Namespace scope: `clusterId|namespace:<name>`

Object scope returns the recursive graph around one seed object. Namespace scope
returns supported namespace-scoped objects in that namespace plus directly
related cluster-scoped objects, such as Nodes, PersistentVolumes, StorageClasses,
IngressClasses, ClusterRoleBindings, and ClusterRoles.

Namespace maps do not add a synthetic Namespace card to the graph. The namespace
is carried as the payload seed so the payload remains compatible with the shared
object-map renderer, but the visible nodes are the related objects themselves.
Because the namespace seed is not rendered as a node, namespace maps commonly
show `seed node: none` in debug output. That is expected and means viewport
preservation must fall back to visible object anchors rather than a rendered
seed card.

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
- PodDisruptionBudgets
- NetworkPolicies
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

| Type             | Backend label | Legend label   | Reverse traversal |
| ---------------- | ------------- | -------------- | ----------------- |
| `owner`          | owns          | Ownership      | Any depth         |
| `selector`       | selects       | Selector       | Any depth         |
| `endpoint`       | has endpoints | Endpoint       | Any depth         |
| `routes`         | routes to     | Ingress Route  | Any depth         |
| `scales`         | scales        | Scaling        | Any depth         |
| `schedules`      | scheduled on  | Scheduled On   | Seed only         |
| `grants`         | grants        | Grants         | Any depth         |
| `binds`          | binds         | Binds          | Any depth         |
| `aggregates`     | aggregates    | Aggregates     | Any depth         |
| `uses`           | uses          | Used By        | Seed only         |
| `mounts`         | mounts        | Mounts         | Seed only         |
| `volume-binding` | binds volume  | Volume Binding | Depth one         |
| `storage-class`  | uses class    | Storage Class  | Seed only         |

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
- PodDisruptionBudget
- NetworkPolicy
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
- `frontend/src/modules/object-map/objectMapVisibleState.ts`: visible layout
  derivation for relationship filters, kind filters, focus mode, and search.
- `frontend/src/modules/object-map/ObjectMapG6Renderer.tsx`: G6 integration,
  viewport controls, event handling, tooltips, debug grid, and CSS variable
  palette loading.
- `frontend/src/modules/object-map/objectMapDebugStore.ts`: debug snapshots and
  map-debug overlay visibility shared between `AppLayout` and mounted maps.
- `frontend/src/modules/object-map/ObjectMap.css`: visual styling and CSS
  variables consumed by the renderer.

Layout ownership is frontend-side. The backend returns nodes, edges, and graph
depths; the frontend decides visual columns, card positions, edge routes, focus
filtering, and viewport behavior.

The layout coordinate origin is an internal graph coordinate, not a viewport
landmark. `0,0` is not the top-left of the viewport, the center of the viewport,
or necessarily the center of the rendered objects. In the layered layout, x
coordinates are anchored around the seed column when a rendered seed exists; y
coordinates are the layout baseline for stacked columns. Namespace maps have no
rendered namespace seed, so `0,0` is useful for debugging coordinate shifts but
is not a user-meaningful map center.

Focus mode deliberately redraws a smaller graph around the selected object, but
it must not change the global layout coordinate frame. When focus mode computes
the focused sub-layout, it translates that result so the active object keeps the
same x/y coordinate it had in the full visible layout. While focus mode is
active, `ObjectMap.tsx` also passes no `preserveViewportNodeId` to the renderer;
otherwise selecting object B while object A is already focused can make G6 pan
to preserve B's previous screen position from A's focused layout. That was the
cause of the focus-mode "map jumps across the viewport" bug. If it comes back,
check these invariants first:

- The active object has the same x/y in focused layout that it had in the
  pre-focus visible layout.
- Focus mode does not pass a selected-node viewport preservation anchor.
- The debug grid's `0,0` stays fixed when changing selection in focus mode.
- Viewport `position`, `zoom`, and `size` are not enough to diagnose this class
  of bug; the layout coordinate frame can move while the viewport transform
  stays unchanged.

Card rendering uses zoom-based detail levels to keep larger maps responsive.
The thresholds are:

|      Zoom | Card detail                                                      |
| --------: | ---------------------------------------------------------------- |
| `>= 0.75` | Full: kind badge, name, namespace, age, status, collapse badge.  |
| `>= 0.45` | Compact: kind badge, name, status, collapse badge.               |
| `>= 0.20` | Minimal: card outline, kind color strip, status, collapse badge. |
|  `< 0.20` | Dot: kind-colored dot only.                                      |

The renderer only changes detail level when crossing a threshold. Plain panning
at the same zoom must not reapply graph data.

Link rendering has a separate large-map detail mode. Maps with at least `300`
visible objects or `600` visible links use `simple` links: one straight segment
from object center to object center, with dashed styling disabled. Smaller maps
use the fully routed `routed` paths. This is intentionally based on visible map
size instead of zoom, because dense maps can be slow at every zoom level when
the renderer has to redraw many cubic paths.

## User Interaction

The current map supports:

- Node click selection with recursive relationship highlighting.
- Focus mode, which hides unrelated objects and redraws the selected recursive
  relationship graph.
- Dragging nodes with non-persistent layout overrides.
- Reset layout, which clears drag overrides and focus state.
- Zoom in, zoom out, reset zoom, fit, and auto-fit viewport controls.
- Mouse wheel panning by default, with modifier-wheel zoom.
- Search by kind, namespace, or name.
- Connection hover highlighting and tooltips.
- Node context menus through the centralized object action controller.
- Cmd-click on macOS, or Ctrl-click elsewhere, to open object details.
- Shift-click to open a new map for the object.
- Alt-click to open the object's primary table view.

Drag positions are intentionally not persisted. Reset returns the graph to the
computed default layout.

Object context menus should stay consistent across map and table surfaces. The
default object menu is:

| Action           | Shortcut                                 | Notes                                                  |
| ---------------- | ---------------------------------------- | ------------------------------------------------------ |
| Open Details     | Cmd-click on macOS, Ctrl-click elsewhere | Opens the object panel.                                |
| Open Map         | Shift-click                              | Opens a map for the object.                            |
| Go to Table View | Alt-click                                | Omitted when the object already lives in a table view. |

Do not put shortcut help in the map legend. The legend explains relationship
types and object/link counts only.

## Debugging

Press `Ctrl+Alt+M` to open the map debug overlay. The overlay uses
`frontend/src/ui/layout/DebugOverlay.tsx` and the object-map debug store in
`frontend/src/modules/object-map/objectMapDebugStore.ts`.

The debug overlay reports:

- Map id, cluster, seed reference, and resolved seed node id.
- Focus mode, auto-fit, active node, and viewport preservation anchor.
- Payload, layout, visible layout, and rendered object/link counts.
- Renderer readiness, zoom, viewport position, and viewport size.
- Active card and link detail levels.
- Timing samples for model derivation, visible-state derivation, G6 data
  conversion, G6 graph-data apply, and G6 selection-state apply.
- Kind filters, relationship filters, search state, layout bounds, and backend
  snapshot limits.

When the map debug overlay is open, the renderer also draws an x/y grid over the
map. The grid is computed with G6's own `getCanvasByViewport` and
`getViewportByCanvas` conversions, so the orange axes mark the current graph
coordinate origin in viewport space. Use this grid to diagnose whether a
problem is a viewport transform, a layout-coordinate shift, or both.

Important debug distinctions:

- `payload` counts are the raw backend snapshot counts.
- `layout` counts are after frontend dedupe, directional filtering, collapse,
  and layout preparation.
- `visible` counts are after relationship filters, kind filters, and focus mode.
- `rendered` counts are what G6 currently received.

Those counts are allowed to differ. For example, namespace payloads can include
objects that frontend directional filtering or collapse removes before
rendering, and kind filtering can replace hidden paths with a synthetic
`filtered-path` edge.

Timing samples are last-observed durations from the mounted map, not rolling
averages. `model` and `visible` measure frontend derivation during React render;
`g6 data` measures conversion to G6 node/edge data; `g6 apply` measures the last
G6 data render/update; `selection` measures the last `setElementState` pass.
Use them to locate the slow stage before optimizing.

## Refresh Behavior

The object map is a scoped snapshot domain. It is enabled only while a map tab is
active.

Frontend polling for `object-map` is set in
`frontend/src/core/refresh/refresherConfig.ts`:

| Domain       | Interval | Cooldown | Timeout |
| ------------ | -------: | -------: | ------: |
| `object-map` |  2000 ms |  1000 ms |    10 s |

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

Run `mage qc:prerelease` and `mage qc:knip` before presenting code changes as
complete. Documentation-only changes can skip those checks under the repository
rules.
