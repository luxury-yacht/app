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
