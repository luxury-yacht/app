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
- Refresh domains are single-cluster. Cross-cluster summaries fan out over
  per-cluster state instead of inventing aggregate refresh scopes.
- Cluster add, close, replace, and clear actions must go through the unified
  kubeconfig selection transition.
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
- Cluster lifecycle and refresh subsystem setup: `backend/app_refresh_*.go`
- Object catalog lifecycle: `backend/app_object_catalog.go`
- Frontend cluster selection: `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`
- Refresh scope helpers: `frontend/src/core/refresh/clusterScope.ts`
- Cluster tab UI state: `frontend/src/ui/layout/ClusterTabs.tsx`

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
