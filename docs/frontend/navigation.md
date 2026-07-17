# Navigation Workspace Contract

The app shell has two workspace owners: one independent Global workspace and
one retained workspace per open cluster.

## Agent Contract

- `ViewStateContext` owns the active workspace. Global state is not stored in
  the selected cluster's navigation entry.
- Per-cluster navigation remains keyed by `clusterId` and stores only Cluster,
  Namespace, and Overview routes.
- `GlobalViewType` and `ClusterViewType` are disjoint. Compatibility for legacy
  persisted `cluster:fleet` and `cluster:global-namespaces` favorites belongs at
  the favorite navigation boundary, not in the live route union.
- The synthetic Global tab is visible only when more than one cluster is open,
  has the stable id `__global__`, and is neither closeable nor draggable.
- Entering Global does not change the foreground kubeconfig. Clicking a real
  cluster tab exits Global before activating that cluster.
- A link from Global to cluster data must stage the target cluster's route and
  sidebar selection, exit Global, and then activate the target kubeconfig.
- If fewer than two clusters remain open, the shell exits Global and restores
  the foreground cluster's retained route.
- Global views fan out over per-cluster refresh scopes. Do not create an
  aggregate multi-cluster refresh scope.
- Foreground-cluster blocking overlays must not cover Global views. Each Global
  row owns and presents its originating cluster's lifecycle/auth state.

## Cluster Attention Routing

Cluster Overview is the cluster-level landing surface for health and capacity.
Cluster Attention is the inventory of objects that currently warrant operator
action. It appears between Overview and Resources and is scoped to exactly one
cluster.

Overview pod-health and restart signals open Cluster Attention. Attention rows
combine the active reasons for one object and carry the object's complete
cluster/GVR identity; their Kind and Name links open that object. Resource views
remain the place for browsing and operating on the full unfiltered inventory.

The backend owns the Attention finding set in a per-cluster maintained query
store. Existing Pod, workload, and Node reflector bundles plus the shared Event
informer update it incrementally. A domain-owned timer advances grace periods
and event expiry. The distinct `attention` stream clock is a change signal: the
frontend refetches the current query page, with polling only as the stream-down
fallback.

Global Clusters summarizes not-ready nodes and failing pods, and its Cluster
link opens the originating cluster's Overview. Namespace-level warning,
utilization, and quota comparisons remain in Cluster Namespaces.

Overview warning events can involve both cluster-scoped and namespaced objects.
Do not link the whole warning section to Cluster Events: that view intentionally
contains only events involving cluster-scoped objects.

Permission restrictions and unavailable inputs are data-availability states,
not resource-health or access-comparison columns.

## Ownership

- Route vocabulary: `frontend/src/core/navigation/viewRegistry.ts`,
  `frontend/src/types/navigation/views.ts`
- Workspace state and transitions:
  `frontend/src/core/contexts/ViewStateContext.tsx`
- Tab and sidebar shell: `frontend/src/ui/layout/ClusterTabs.tsx`,
  `frontend/src/ui/layout/Sidebar.tsx`
- Global routing and views: `frontend/src/modules/global/components`
- Legacy favorite normalization:
  `frontend/src/core/navigation/favoriteRoute.ts`

## Validation

Run the focused navigation, tab, sidebar, command, favorite, Global view, and
refresh diagnostics tests; then run frontend typecheck and a rendered UI pass.
