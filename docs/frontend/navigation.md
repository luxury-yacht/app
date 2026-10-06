# Navigation Workspace Contract

The app shell has two workspace owners: one independent Global workspace and
one retained workspace per open cluster.

## Workspaces

- `ViewStateContext` owns the active workspace. Global state is never stored in
  the selected cluster's navigation entry.
- Per-cluster navigation is keyed by `clusterId` and stores only Cluster,
  Namespace, and Overview routes.
- `GlobalViewType` and `ClusterViewType` are disjoint. Legacy persisted
  `cluster:fleet` and `cluster:global-namespaces` favorites are normalized at
  the favorite navigation boundary, never in the live route union.
- The synthetic Global tab (`__global__`) shows only while more than one cluster
  is open and is neither closeable nor draggable.
- Entering Global keeps the foreground kubeconfig. Clicking a real cluster tab
  exits Global before activating that cluster.
- A link from Global to cluster data stages the target cluster's route and
  sidebar selection, exits Global, then activates the target kubeconfig.
- Below two open clusters, the shell exits Global and restores the foreground
  cluster's retained route.
- Global views fan out over per-cluster refresh scopes; never create an
  aggregate multi-cluster scope.
- Foreground-cluster blocking overlays never cover Global views; each Global
  row presents its own cluster's lifecycle/auth state.

## Active View Title

`core/navigation/activeViewTitle.ts` builds the header title `scope - view`
(cluster tabs already name the cluster). Scope is the namespace on namespace
views (All Namespaces by display name) and `Cluster` on cluster views,
including Overview. Global views show only the view; no title shows without an
open cluster. Default favorite names add the cluster name (except on Global
views) and join parts with ` / `. Panel windows show their cluster name in the
same slot.

## Favorites

- `favoriteRoute.ts` owns persisted route and cluster-target interpretation,
  shared by matching, activation, and menu availability. A non-Global favorite
  is pinned when it carries a `clusterId` or saved kubeconfig selection;
  `clusterId` wins when present.
- Cluster filter values keep exact case across persistence and migration.
  Empty facet values stay distinct from literal labels such as `__empty__`.
- `FavoritesContext` runs the handoff as waiting/restoring phases: it waits for
  the target cluster to be operational (and namespace readiness for namespace
  routes), applies navigation, and only then exposes `favoriteToRestore`. Table
  consumers wait for the matching route and every expected pane's persistence
  to hydrate before restoring and consuming the request. A waiting request
  stays available to the cluster/navigation work that makes it ready;
  lifecycle progress extends its expiry window.
- Reorder ignores repeated and unknown IDs, appends omitted favorites in their
  current relative order, and assigns contiguous positions; backend and
  frontend cache follow the same rule.

## Sidebar Organization

| Scope | Direct links | Resources (in order) | Extensions |
| --- | --- | --- | --- |
| Cluster | Overview, Attention, Browse, Events, Identities | Config, Namespaces, Nodes, RBAC, Storage | CRDs, Custom Resources, then Cert Manager, External Secrets, Karpenter |
| Namespace | Workloads, Browse, Map, Events | Autoscaling, Config, Network, Quotas, RBAC, Storage | Custom Resources, Argo CD, Cert Manager, External Secrets, Helm, Prometheus Operator |

- Identities is an observed-subject view, not a resource category, so it stays
  outside Resources ([cluster identities](../architecture/cluster-identities.md)).
- `viewRegistry.ts` owns ordered view descriptors and their required
  `sidebarGroup`. Filter resource families by active-cluster discovery (and,
  for namespaces, the All Namespaces support filter, so Map appears only for
  individual namespaces) before grouping. Command-palette and favorite view
  choices consume the same ordered descriptors. Grouping changes neither
  stable view IDs nor route-update ordering before entering the Cluster view.
- Both scopes use `SIDEBAR_VIEW_GROUPS` and the shared `SidebarViewGroup`
  renderer with compact rows and no separators. All groups start collapsed.
- Disclosure state uses four persisted app preferences (Resources and
  Extensions × Cluster and Namespace) and the existing keyboard navigation
  surface; target parsing accepts only registered group IDs. Namespace group
  disclosure is shared across namespaces and clusters and survives collapsing
  the parent namespace; keyboard targets carry the namespace key and group ID.
  When a subgroup expands, the namespace scroll owner rechecks the whole
  namespace group after the animation.
- Navigating to a grouped view reveals its category and, for namespace views,
  its parent namespace, including repeated Alt-click navigation after a manual
  collapse. Both scopes share this policy and resolve the group from available
  descriptors (keeping discovery gates). Fresh selection requests reveal the
  destination even when discovery arrives later; mounting with a restored
  selection and unrelated refreshes preserve manual collapse.

## Cluster Attention

Overview is the cluster health/capacity landing surface. Attention, right after
it, is the single-cluster inventory of objects needing operator action;
resource views remain the place to browse and operate on full inventories.

- Overview pod signals open Attention with `Kind = Pod` and Findings staged
  before navigation: starting/terminating → `pod-unhealthy`, failing →
  `error-presentation`, not-ready → `pod-not-ready`, restarts → `restarts`.
  The ready Pod count still opens all-namespaces Workloads.
- Never link Overview's whole warning-event section to Cluster Events: it
  mixes namespaced objects, while Cluster Events holds only events about
  cluster-scoped objects.
- A row combines one object's active typed causes and carries its complete
  cluster/GVR identity; Kind and Name links open it. Any RBAC-visible catalog
  object can appear; Events keep their informer-owned path.
- Findings is a backend-owned typed query facet. A row may publish several
  finding type IDs; values OR within Findings and AND with Kind, Namespace,
  Severity, and other filters. Labels come from the centralized finding
  policy; requests and persisted filters use stable type IDs.
- A per-cluster maintained query store holds findings, updated incrementally
  from existing Pod, workload, and Node reflector bundles and the shared Event
  informer; a domain-owned timer advances grace periods and event expiry. The
  `attention` stream clock is the only change signal (catalog subset changes
  update the index, which rings it); the frontend refetches the current page
  and polls only as the stream-down fallback.
- The catalog publishes two coalesced backend-only subsets, keeping scans off
  the render path and preserving the maintained-store spill/Cold-serving
  contract:
  - Objects deleting behind finalizers → `deletion-blocked-by-finalizer`
    (**Deletion blocked by Finalizer**), merged with health causes for the same
    UID; includes discovered custom resources and Namespace `spec.finalizers`.
  - Objects reporting their own status: Argo CD Applications (sync, health,
    last sync operation phase, active conditions), ApplicationSets (health,
    True conditions), Karpenter NodePools (resources over the limit threshold)
    → `argocd-application-out-of-sync`, `argocd-application-degraded`,
    `argocd-application-missing`, `argocd-application-sync-failed`,
    `argocd-application-error`, `argocd-applicationset-error`,
    `karpenter-nodepool-near-limit`. An aspect may hold several values; a rule
    matches when any does, and each matching rule adds a cause. Reported
    statuses lack transition times, so these findings have no grace period.
    The NodePool threshold lives with the Karpenter facts, so the Karpenter
    table, NodePool details, and Attention flag the same pools.
- Neither subset publishes before the catalog's first full sync (a partial view
  would read as deletions). Catalog absence never proves deletion (failed or
  denied listing, removed CRD), so catalog findings never prune per-object
  ignores. A recreated object (same name, new UID) drops the old object's
  ignores once any source sees it, even if the index never saw the old object,
  since Kubernetes allows one object per name.
- Severity is closed (`info`, `warning`, `error`). Status rules,
  restart/replica policies, precedence, and sort order live together in
  `backend/refresh/snapshot/cluster_attention_policy.go`; classify there, not
  in individual evaluators.
  - `info`: Deployment/StatefulSet `Scaled to 0`, CronJob `Idle`, DaemonSets
    with no eligible nodes, transient unhealthy Pods within grace.
  - `warning`: finalizer-blocked deletion, restarts, insufficient ready
    replicas, warning Events, non-ready Pods past grace, non-error workload or
    Node states.
  - `error`: Pod, workload, or Node states whose canonical status presentation
    is `error`.
- Multiple signals take the highest severity and keep all causes. Inactive
  info findings, restarts, and errors are immediate. Transient unhealthy Pods
  show immediately as `info` (`pod-unhealthy`) and become `warning` at their
  grace deadline; `pod-not-ready` (container readiness) transitions the same
  way. Transient workload warnings and replica mismatches stay hidden until
  grace ends. The Overview count and `pod-not-ready` exclude Succeeded Pods
  and Pods without containers.
- Ignore scopes per cause: this finding on this object, this type in this
  cluster (persisted with that cluster), or this type in all clusters (current
  and future). Object rules key
  on cluster, full GVK, namespace/name, UID, and finding type, so they never
  transfer to a replacement. Another active cause can keep the object visible.
  The filter bar's Ignored findings control restores all three. Authoritative
  reflector delete/replace prunes object rules whose UID is gone; unavailable
  inputs never prune (missing permission is not deletion). Type rules persist
  until restored.
- Namespace-level warning, utilization, and quota comparisons stay in Cluster
  Namespaces; the Global Clusters summary is in
  [multi-cluster](../architecture/multi-cluster.md). Permission restrictions
  and unavailable inputs are data-availability states, not resource-health or
  access-comparison columns.

## Ownership

- Route vocabulary: `frontend/src/core/navigation/viewRegistry.ts`,
  `frontend/src/types/navigation/views.ts`
- Workspace state: `frontend/src/core/contexts/ViewStateContext.tsx`
- Tab and sidebar shell: `frontend/src/ui/layout/ClusterTabs.tsx`,
  `frontend/src/ui/layout/Sidebar.tsx`
- Global views: `frontend/src/modules/global/components`
- Favorite normalization: `frontend/src/core/navigation/favoriteRoute.ts`
