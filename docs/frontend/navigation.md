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

## Favorites

`favoriteRoute.ts` owns persisted route and cluster-target interpretation. A
non-Global favorite is pinned when it carries a `clusterId` or a saved kubeconfig
selection; `clusterId` is authoritative when present. Matching, activation and
menu availability share that interpretation. Cluster filter values retain exact
case across persistence and migration. Empty facet values remain distinct from
literal labels such as `__empty__`.

`FavoritesContext` owns the navigation handoff as waiting/restoring phases. It
waits for the target cluster to be operational and, for namespace routes, for
namespace readiness. Only after applying navigation does it expose
`favoriteToRestore`. Table consumers then wait for the matching route and every
expected pane's persistence to hydrate before restoring state and consuming the
request. A waiting request must remain available for the cluster/navigation work
that makes it ready. Lifecycle progress extends the existing expiry window.

Favorite reorder ignores repeated and unknown IDs, appends omitted favorites in
their current relative order, and assigns contiguous positions. The backend and
frontend cache follow the same rule.

## Cluster Sidebar Organization

Overview, Attention, Browse, Events, and Identities are direct cluster links.
Identities is an observed-subject view, not a Kubernetes resource category; it
remains outside Resources. See [cluster identities](../architecture/cluster-identities.md). The independently
collapsible Resources group contains Config, Namespaces, Nodes, RBAC, and Storage,
in that order.
The Extensions group contains CRDs and Custom Resources, followed by discovered
resource families in this order: Cert Manager, External Secrets, Karpenter.
Both groups start collapsed.

`viewRegistry.ts` owns the ordered view descriptors and their required
`sidebarGroup` placement. Filter resource families using active-cluster discovery
before grouping the available views. Sidebar groups use four persisted app preferences (Resources and Extensions for
each of Cluster and Namespace) and the existing keyboard navigation surface; target parsing accepts only the
registered group IDs. Grouping does not change stable view IDs or the ordering
of route updates before entering the Cluster view. Command-palette and favorite
view choices continue to consume the same ordered descriptors.

## Namespace Sidebar Organization

Each namespace begins with Workloads, Browse, Map, and Events as direct links.
Resources contains Autoscaling, Config, Network, Quotas, RBAC, and Storage,
in that order. Extensions contains Custom Resources, Argo CD,
Cert Manager, External Secrets, Helm, and Prometheus Operator, with resource families
filtered by active-cluster discovery. Apply the existing All Namespaces support
filter before grouping, so Map remains available only for individual namespaces.

Both scopes use `SIDEBAR_VIEW_GROUPS` and the shared `SidebarViewGroup` renderer.
Keep compact row spacing and omit separators. Namespace Resources and Extensions
start collapsed. Namespace group disclosure is shared across namespaces and clusters and survives
collapsing a parent namespace. Keyboard group targets carry that namespace key and group ID.
When a subgroup expands, the namespace scroll owner rechecks the full namespace
group after the expansion animation.

Navigation to a grouped view reveals its Resources or Extensions category and,
for namespace views, its parent namespace. This includes repeated Alt-click
navigation to the same view after manually collapsing its category or namespace.
Both scopes share the disclosure policy and resolve the group from the available
view descriptors, preserving active-cluster discovery gates. Fresh selection
requests reveal the destination, including when discovery arrives later. Mounting
with a restored selection and unrelated data refreshes preserve manual collapse.

## Cluster Attention Routing

Cluster Overview is the cluster-level landing surface for health and capacity.
Cluster Attention is the inventory of objects that currently warrant operator
action. It appears immediately after Overview and is scoped to exactly one
cluster.

Overview pod-health and restart signals open Cluster Attention with `Kind = Pod`
and the corresponding Findings filters staged before navigation. Starting and
terminating select `pod-unhealthy`; failing selects `error-presentation`;
not-ready selects the readiness-derived `pod-not-ready`; restarts select
`restarts`. The ready Pod count continues to open the all-namespaces Workloads
view. Attention rows
combine the active typed causes for one object and carry the object's complete
cluster/GVR identity; their Kind and Name links open that object. Resource views
remain the place for browsing and operating on the full unfiltered inventory.
The Kind set is open rather than workload-specific: any RBAC-visible catalog
object can appear. A deleting object that still has finalizers publishes the
`deletion-blocked-by-finalizer` cause labeled **Deletion blocked by Finalizer**,
including discovered custom resources and the Namespace `spec.finalizers`
exception. Events retain their informer-owned path because they are not catalog
inventory.

The Attention Findings dropdown is a backend-owned typed query facet. One row
can publish several finding type IDs; values are ORed within Findings and ANDed
with Kind, Namespace, Severity, and the other active filters. User-facing labels
come from the centralized Attention finding policy while requests and persisted
filter state use stable finding type IDs.

The backend owns the Attention finding set in a per-cluster maintained query
store. Existing Pod, workload, and Node reflector bundles plus the shared Event
informer update operational health incrementally. The object catalog publishes
a coalesced, backend-only subset of objects whose deletion is waiting on a
finalizer; Attention merges that lifecycle component with health causes for the
same concrete UID. This keeps catalog scans off the render path and preserves
the maintained-store spill/Cold-serving contract. A domain-owned timer advances
grace periods and event expiry. The distinct `attention` stream clock remains
the only change signal: catalog lifecycle changes update the Attention index,
which rings that clock; the frontend refetches the current query page, with
polling only as the stream-down fallback.

Attention severity is a closed `info`, `warning`, or `error` vocabulary. The
ordered status rules, restart/replica signal policies, severity precedence, and
sort order live together in
`backend/refresh/snapshot/cluster_attention_policy.go`; add or revise
classifications there rather than branching in individual evaluators.

Each cause in an Attention row exposes three ignore scopes: that finding for
the exact object, every finding of that type in the current cluster, or every
finding of that type in all clusters. Object-finding rules include the cluster,
full GVK, namespace/name, UID, and stable finding type, so they suppress only
that cause and never transfer to a replacement object. Cluster type rules are
persisted with the cluster; global type rules apply to current and future
clusters. Another active, non-ignored cause can keep the object visible. All
three scopes can be restored from the filter bar's Ignored findings control.
Authoritative reflector delete/replace updates prune object-finding rules when
their UID no longer exists. An unavailable input does not prune rules because
missing permission is not proof that the object was deleted. Type rules remain
until the user restores them.

- `info`: states that are operationally useful to see but do not yet require
  remediation. Deployment and StatefulSet `Scaled to 0`, CronJob `Idle`,
  DaemonSets with no eligible nodes, and transient unhealthy Pods within their
  grace period are info findings.
- `warning`: deletion blocked by a finalizer, restarts, insufficient ready
  replicas, warning Events, and
  non-ready Pod states after their grace period plus workload or Node states
  that are not errors.
- `error`: Pod, workload, or Node states whose canonical status presentation is
  `error`.

When more than one signal applies to an object, the finding uses the highest
severity while retaining all causes. Intentional inactive info findings are
immediate. Restarts and error states are immediate. A transient unhealthy Pod
is visible immediately as `info` under the stable `pod-unhealthy` finding type
and is promoted to `warning` when its grace deadline expires. Transient workload
warnings and replica mismatches remain suppressed until their grace period ends.
Pod container-readiness is independently represented by `pod-not-ready`, using
the same immediate `info` to delayed `warning` transition. Both the Overview
count and that finding exclude Succeeded Pods and Pods with no containers.

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
