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

- Backend cluster clients and metadata: `backend/cluster_clients.go`,
  `backend/kubeconfig_selection.go`
- Backend cluster-workspace snapshot and combined selection/visibility command:
  `backend/cluster_workspace.go`
- Cluster lifecycle and refresh subsystem setup: `backend/app_refresh_*.go`
- Object catalog lifecycle: `backend/app_object_catalog.go`
- Frontend cluster-workspace state and runtime-event reconciliation:
  `frontend/src/core/cluster-workspace/clusterWorkspaceStore.ts`
- Frontend selection/navigation UI:
  `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`
- Refresh scope helpers: `frontend/src/core/refresh/clusterScope.ts`
- Cluster tab UI state: `frontend/src/ui/layout/ClusterTabs.tsx`
- Global/per-cluster workspace navigation:
  `frontend/src/core/contexts/ViewStateContext.tsx`

## Cluster Workspace State Plane

`GetClusterWorkspaceState` returns selected kubeconfig contexts, foreground
cluster intent, and cluster-indexed lifecycle, auth, health, and namespace-scope
revision state. `ApplyClusterWorkspace` applies a requested selection mutation
before visible-cluster activation and returns the resulting authoritative
snapshot. Selection UI must use that response instead of chaining separate
selection, auth, lifecycle, and visible-cluster reads.

The backend snapshot is revision-consistent: every owning state writer advances
the workspace revision while holding its own lock, and the aggregate retries if
that revision changes during capture. Public reads wait for the serialized
selection boundary; `ApplyClusterWorkspace` captures an applied command's
snapshot before releasing that boundary. Do not add a workspace-visible state
writer without advancing the revision in the same locked commit.

The React-free `clusterWorkspaceStore` subscribes to runtime events before its
initial hydration. Live fields win only over hydration responses that were
already in flight when the event arrived; later authoritative snapshots can
heal missed state. It owns the
foreground activation/serviceability boundary and exposes immutable snapshots;
`AuthErrorContext`, `ClusterLifecycleContext`, health hooks, and refresh
readiness are selector/facade layers, not additional state owners. Existing
internal event-bus emissions are downstream wake-up notifications for refresh
consumers and must not become a second state cache.

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
non-documentation work, finish with `mage qc:prerelease`.
