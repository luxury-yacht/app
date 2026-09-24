# Multi-Cluster Contract

Every cluster is independent. Auth, refresh state, caches, navigation, runtime
operations, permissions, and object actions for one cluster must not affect
another cluster.

## Agent Contract

- Carry `clusterId` through every cluster-data path: APIs, refresh scopes,
  caches, stores, events, persistence keys, navigation, diagnostics, and object
  actions.
- Do not infer a cluster from the active tab after data has crossed a boundary.
- Treat the active tab as foreground selection only. Open inactive tabs are
  retained workspaces, not disposed views.
- Tab activation and retained/background refresh behavior follows the single
  [data freshness contract](data-freshness.md); cluster selection must not add a
  readiness delay or turn inactive tabs into producer demand.
- Refresh domains are single-cluster. Cross-cluster summaries fan out over
  per-cluster state instead of inventing aggregate refresh scopes.
- Cluster add, close, replace, and clear actions must go through the unified
  kubeconfig selection transition.
- Frontend lifecycle, auth, health, namespace-scope revision, selection, and
  visible-cluster state are projections of one cluster-workspace state plane;
  do not introduce another cluster-keyed cache in a React context or hook.
- Cluster removal must clean refresh subsystems, catalog state, runtime
  operations, stream subscriptions, and cluster-scoped UI state.
- Missing, ambiguous, or stale cluster identity is an error. Do not silently
  fall back to the current cluster.

## Identity And Scopes

`clusterId` is stable app identity for a selected kubeconfig context. The same
context name in two kubeconfig files can be two different clusters.

Refresh scopes are cluster-prefixed:

```text
clusterId|<domain-specific-scope>
clusterId|
clusterId|namespace:default
```

Unsupported multi-cluster scope strings may be parsed only to return clean
validation errors. Frontend refresh code should not produce them.

## Ownership

- `backend.ClusterRuntimeManager` owns kubeconfig discovery and watcher
  retargeting, cluster clients and metadata, authentication and recovery,
  transport-health state, cluster lifecycle, Kubernetes API metrics, mutable
  client rate limits, dependency resolution, and heartbeat probes.
- `backend.ClusterWorkspaceProjection` is the leaf owner of replayable health,
  namespace-scope revisions, and the aggregate workspace revision. Source
  owners write through its narrow methods; it owns no clients, selections, or
  refresh subsystem.
- `backend.WorkspaceCoordinator` owns peer-window selection sets, the
  serialized selection-mutation boundary, supersession generations,
  diagnostics, namespace-scope rebuild coalescing, foreground demand, and
  authoritative workspace-state assembly.
- `backend.RefreshCoordinator` owns per-cluster refresh and catalog lifecycles,
  aggregate routing, streams, governor state, spill state, and publication.
- Cluster Attention rules, persistence transactions, six Ignore/Restore
  commands, and the cluster-indexed live target registry:
  `backend.ClusterAttentionService` in `backend/cluster_attention_service.go`
  and `backend/cluster_attention_rules.go`. The service owns the Attention lock;
  it uses a narrow `PreferencesService` repository for persistence and never
  reaches through the refresh owner.
- Cluster and workspace implementation: `backend/cluster_runtime_clients.go`,
  `backend/cluster_runtime_kubeconfig_discovery.go`,
  `backend/workspace_cluster_clients.go`, `backend/workspace_kubeconfigs.go`,
  and `backend/workspace_state.go`
- Refresh and object-catalog implementation: `backend/refresh_*.go`,
  `backend/refresh_object_catalog.go`
- Frontend cluster-workspace state and runtime-event reconciliation:
  `frontend/src/core/cluster-workspace/clusterWorkspaceStore.ts`
- Frontend selection/navigation UI:
  `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`
- Refresh scope helpers: `frontend/src/core/refresh/clusterScope.ts`
- Cluster tab UI state: `frontend/src/ui/layout/ClusterTabs.tsx`
- Global/per-cluster workspace navigation:
  `frontend/src/core/contexts/ViewStateContext.tsx`

The dependency direction is one-way: Workspace sequences Cluster Runtime and
Refresh; Refresh reads Cluster Runtime and invalidates `ResourceGateway`; the
cluster and refresh owners never call back into Workspace. Watcher, auth, and
transport producers instead publish typed `ClusterRuntimeIntent` values to an
owner-local queue. Publication is non-blocking and pending work is coalesced by
intent kind plus `clusterId`. Workspace is the single consumer: it rejects
stale generations per kind/cluster and routes accepted work through the same
serialized selection boundary as frontend commands. Shutdown stops that
consumer before auth recovery and the watcher can publish more work.

Preferences pushes initial and live Kubernetes QPS/burst values through the
write-only cluster-runtime settings sink. `ClusterRuntimeManager` stores those
values for future clients and retimes existing mutable limiters and API-metrics
entries; it never reads Preferences.

## Cluster Workspace State Plane

`GetClusterWorkspaceStateForWindow` returns the requesting peer's selected
kubeconfig contexts and foreground cluster intent together with process-wide,
cluster-indexed lifecycle, auth, health, and namespace-scope revision state.
`ApplyClusterWorkspace` updates that peer's complete tab set before visible-
cluster activation and returns the resulting authoritative per-window
snapshot. Selection UI must use that response instead of chaining separate
selection, auth, lifecycle, and visible-cluster reads.

Selection acknowledgement follows the membership and restart-selection commit,
before connecting to the selected clusters. The renderer serializes membership
RPCs in user order, while tab identity paints immediately and foreground commands
use an independent ordered lane. A later tab switch remains authoritative when
an earlier membership acknowledgement arrives. Reopens wait for close guards and
accepted removal to settle. Discovery hydration and delayed command snapshots
cannot overwrite newer selection intent or lifecycle events. Discovery reads deferred
by a membership change or close must run again after those operations settle, so
discovered removals are reconciled against the latest backend selection.

A close click removes the visible tab and selects its neighbor immediately,
including when the tab's open acknowledgement or native close is still pending.
`selectedKubeconfigs` and `selectedClusterIds` describe these visible tabs;
`managedKubeconfigs` and `managedClusterIds` retain closing clusters until native
removal is accepted. Persisted tab ordering uses the managed selection so denial
restores the original tab position.
Panel publication, panel/layout ownership, navigation, sidebar, and namespace
retention use the managed set. Local close guards run before switching away can
unmount their controls; native removal waits for the prior tab admission.
Each close captures its registered preflight participants before awaiting them.
Foreground changes may replace those registrations, but cannot add a second native
close to the transaction already in progress. Native close is the sole membership
mutation for that close. The provider requires a participant to report a native
commit for the requested cluster; missing or uncommitted participants fail the
close and restore the tab. After acceptance, the renderer adopts the confirmed
removal and releases its guard without sending another full-set membership write.
A sibling close may already be committed while its response is still in flight;
a renderer snapshot cannot establish that ordering. No persistent exclusion set
survives the close, so transfer hydration can readmit that cluster normally.
Panel directory reads, object opens,
and docked publication also require confirmed membership from the workspace state
plane; optimistic tab visibility does not authorize native panel access. This gate
does not wait for cluster connection readiness or block the membership command.
A denied or failed preflight restores the tab and retained state without
overwriting a newer foreground choice. Only accepted removal disposes that
cluster's retained state. Global navigation likewise remains retained until the
close is accepted even while its tab is temporarily hidden.

A process-selection change can cancel obsolete connection work before waiting
for the selection mutation. Peer ownership changes that leave the process union
unchanged preserve in-flight authentication. Runtime work retains the serialized
mutation and shutdown drain; admitted tabs report subsequent connection failure
through lifecycle state and selection diagnostics. Client construction records
failure for its own cluster and collects batch errors without cancelling healthy
siblings. Open, close, release, pruning, and startup use that same failure owner.
Refresh publication proceeds with installed clients even when another build
fails; when none remain, it retires the previous refresh runtime. Failed tabs
stay admitted and unavailable; their recovery guidance is to close and reopen
the tab, because refreshing data cannot rebuild missing clients. Discovery and
preflight must propagate the connection context so cancellation drains their HTTP
requests.
Closing a canceled connection also removes lifecycle and API-diagnostics entries
that never acquired installed clients. API diagnostics retire with shared cluster
workspace state on deselection, pruning, and final-tab clearing; peer-owned
clusters retain their diagnostics and request history.
Frontend stream and snapshot continuations belong to the runtime instance that
started them. Once removal retires that instance, queued work cannot recreate it;
late subscriptions are disposed and late failures cannot republish scoped state.
An explicit reopen creates a new runtime with independent work.

The backend retains one cluster-tab set per app window plus cluster-scoped
panel references. Their deterministic union owns process-wide selected
kubeconfigs, clients, refresh subsystems, catalogs, and runtime operations.
Closing a tab releases only that app view while another app window displays the
cluster. Explicitly closing its final app tab first guards and closes its native
panel windows and discards its shared panels. Closing an app window instead
retains docked panels and leaves floating panels open. Teardown requires that
neither app views nor panel references retain the cluster. The native close
command records a view's removal before another close decides whether it is the
final view; renderer selection updates then reconcile that authoritative result.
Close acknowledgement follows the membership and restart-selection commit,
before client, refresh, and catalog cleanup finishes. Cleanup remains inside
the existing serialized selection mutation and shutdown drain. Reopens and later
selection mutations wait for that cleanup; background cleanup failures are
reported in selection diagnostics and cluster-scoped application logs without
restoring an accepted tab close. Panel guards and publication flushes still
finish before the close is accepted.
The renderer holds that cluster's request gate before native close preflight,
aborts its requests and streams, and prunes its refresh runtime on acceptance.
A denied close releases the hold and resumes retained work. Selection changes
retain catalogs for surviving clusters; catalog teardown belongs to removal or
replacement of the owning refresh generation.
Cluster-tab movement stages the target
before removing the source, preserving the process selection throughout.
A panel-only renderer projects its fixed cluster without creating an app-view
tab set. See [application lifecycle](application-lifecycle.md#cluster-owned-panel-workspaces).

The backend snapshot is revision-consistent: every owning state writer advances
the workspace revision while holding its own lock, and the aggregate retries if
that revision changes during capture. Public reads use the peer-selection lock,
not the serialized selection-work boundary, so slow or unreachable clusters
cannot prevent the frontend from hydrating tabs and lifecycle state.
Visibility-only `ApplyClusterWorkspace` commands bypass that selection boundary
and do not advance or cancel its generation; commands that change a peer's tab
set remain ordered so one window cannot supersede another window's mutation and
capture their applied snapshot before releasing the boundary. Ordered mutations
replace the connection generation only when the process-wide cluster selection
actually changes. Retaining or releasing panels, moving a cluster view, and
opening or closing duplicate views must preserve an unchanged selection's
in-flight clients and authentication results. Do not add a
workspace-visible state writer without advancing the revision in the same locked
commit.

Startup calls `PreferencesService.EnsureLoadedForStartup` before entering the
selection mutation, then restores the immutable selected-kubeconfig snapshot
inside that boundary. Client preflight then reuses the restored selection
generation's cancellation context outside the mutation lock. A later mutation
that changes the process selection can acquire the lock, cancel stale startup connection work,
and reconcile its newer selection without waiting for an unreachable API
server. Successful startup preflight re-enters the selection boundary before it
publishes refresh and catalog state, preventing stale startup work from racing a
newer selection. Startup connection work never holds the native runtime-ready
callback. Search-path changes persist first, ask Cluster Runtime to rediscover
and retarget the watcher, classify removed selections, and only then reconcile
refresh, selections, clients/auth, operations, projection state, and the
persisted remaining selection.

The React-free `clusterWorkspaceStore` subscribes to runtime events before its
initial hydration. Live fields win only over hydration responses that were
already in flight when the event arrived; later authoritative snapshots can
heal missed state. It owns the
foreground activation/serviceability boundary and exposes immutable snapshots;
`AuthErrorContext`, `ClusterLifecycleContext`, health hooks, and refresh
readiness are selector/facade layers, not additional state owners. Existing
internal event-bus emissions are downstream wake-up notifications for refresh
consumers and must not become a second state cache.

Initial frontend hydration publishes discovered kubeconfigs and the restored tab
set before awaiting foreground activation. The workspace store's foreground
activation hold gates cluster-data refresh until that independent activation
settles; activation failure cannot erase the app-global discovery result or tab
selection.

The `no-direct-cluster-workspace` Biome plugin enforces this ownership boundary:
only `frontend/src/core/cluster-workspace` may call the combined workspace RPC
or subscribe directly to lifecycle, auth, health, and namespace-scope Wails
events.

## Global Clusters View

Global is an independent app workspace, not a route owned by the foreground
cluster. It retains its last Global view while every open cluster independently
retains its last Cluster/Namespace/Overview route. The foreground kubeconfig is
still used for backend foreground priority, but its tab is not visually active
while Global is selected. When fewer than two clusters remain, the app restores
the remaining foreground cluster's retained route.

Clusters is a Global-scope view that compares only open clusters. The frontend
fans out the existing `cluster-overview` domain over one `clusterId|` scope per
eligible cluster; it does not introduce a cross-cluster refresh scope or cache
entry. Each row keeps the originating `clusterId` as its identity and uses
overview-owned readiness, capacity, workload, metrics, and
unavailable-resource projections.

Each eligible cluster has its own keyed refresh lease owner. Adding or removing
one cluster must acquire or release only that cluster's lease; it must not cycle
the leases or startup fetches of surviving clusters. Global table persistence,
pagination, and replay-cache identities are fixed per Global view and must never
be derived from the changing open-cluster membership.

Lifecycle and confirmed authentication failures remain per cluster. Clusters may
show ready, loading, reconnecting, disconnected, and authentication-required
rows together, and it does not start overview refresh for a cluster whose
lifecycle cannot activate that domain.

The Cluster link in a Clusters row prepares the destination cluster's navigation
and sidebar state before activating its kubeconfig selection and opening that
cluster's Overview. The rest of the row is non-interactive. The Needs Attention
cell summarizes not-ready nodes and failing pods without becoming a separate
navigation target.

The user-facing scope and label are **Global → Clusters**. The internal `fleet`
Global route and `cluster-fleet` table-persistence id remain compatibility
identities. Legacy favorites that encoded `fleet` or `global-namespaces` as a
cluster route are normalized at the favorite navigation boundary.

**Global → Namespaces** reads the existing per-cluster `namespaces` refresh
entries for every open cluster; it does not introduce an aggregate refresh
scope. Its columns match **Cluster → Namespaces** and add the originating
cluster name. Each row retains the namespace object's full canonical identity,
including `clusterId`, and navigating a row stages that cluster's namespace,
namespace Browse view, and sidebar selection before activating the cluster.
When one or more open clusters have no namespace snapshot (including permission
denial or an unavailable lifecycle), the table labels the union as partial.

## Change Checklist

When touching multi-cluster behavior:

1. Trace producer and consumers of `clusterId`.
2. Check whether foreground, background-open, and removed-cluster states differ.
3. Confirm refresh scopes and persistence keys cannot collide across clusters.
4. Confirm object actions and links use the originating object's cluster.
5. Add or update tests for both add/open and close/remove/clear paths.

## Validation

Use targeted backend/frontend tests for the touched lifecycle path. For
non-documentation work, finish with `wails3 task qc:prerelease`.
