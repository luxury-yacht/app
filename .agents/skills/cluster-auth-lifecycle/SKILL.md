---
name: cluster-auth-lifecycle
description: Work on Luxury Yacht kubeconfig selection, multi-cluster client lifecycle, auth failure/recovery, selected/background clusters, cluster tabs, refresh subsystem rebuilds, and object catalog lifecycle
---

# Cluster Auth Lifecycle

Use this when touching kubeconfig selection, cluster client setup, auth failure
overlays, retry/recovery, selected/background cluster state, cluster tabs,
refresh subsystem rebuilds, object catalog start/stop, or tests for cluster
add/remove behavior.

## Task routes

Read only the contracts selected by the change. Follow further links when the
changed path crosses that boundary.

| Change | Read |
| --- | --- |
| Kubeconfig selection, cluster tabs, open/close, selected/background state | [multi-cluster](../../../docs/architecture/multi-cluster.md#cluster-workspace-state-plane) |
| Isolation rules, cluster identity, scopes | [multi-cluster](../../../docs/architecture/multi-cluster.md#agent-contract) |
| Auth failure, retry, recovery, credential helpers | [auth](../../../docs/architecture/auth.md) |
| Refresh construction, replacement, readiness, teardown | [refresh-system](../../../docs/architecture/refresh-system.md#ownership), [auth](../../../docs/architecture/auth.md#rebuild-wiring-invariant) for auth recovery |
| Retained data, foreground/background work, leases | [data-freshness](../../../docs/architecture/data-freshness.md#retention-and-leases) |
| Namespace scope edits and rebuilds | [namespace-scope](../../../docs/architecture/namespace-scope.md) |
| Object catalog start, stop, discovery or replacement | [catalog](../../../docs/architecture/catalog.md) |
| Operation cleanup when clusters close or fail | [operation-lifecycle](../../../docs/workflows/operation-lifecycle.md) |

## Entry Points

- Owners: `backend/cluster_runtime_manager.go`,
  `cluster_workspace_projection.go`, `workspace_coordinator.go`,
  `refresh_coordinator.go`, `cluster_runtime_intent.go`.
- Clients and auth: `backend/cluster_runtime_clients.go`,
  `cluster_runtime_kubeconfig_discovery.go`, `cluster_runtime_auth.go`,
  `workspace_auth.go`, `workspace_cluster_clients.go`,
  `workspace_kubeconfigs.go`, `workspace_state.go`, `backend/internal/authstate`.
- Refresh lifecycle: `backend/refresh_setup.go`, `refresh_update.go`,
  `refresh_subsystems.go`, `refresh_recovery.go`, `refresh_object_catalog.go`.
- Frontend: `frontend/src/core/cluster-workspace`,
  `frontend/src/modules/kubernetes/config`, `frontend/src/modules/cluster`,
  `frontend/src/ui/layout/ClusterTabs.tsx`,
  `frontend/src/ui/overlays/AuthFailureOverlay.tsx`, `frontend/src/core/refresh`,
  `frontend/src/core/data-access`.

## Procedure

- Exercise at least one multi-cluster or auth-failure transition alongside an
  unrelated healthy cluster that must keep working.
- Confirm selection changes rebuild or clear the affected refresh scopes, and
  retry/recovery rebuilds transport, refresh, object catalog, and frontend
  diagnostics together.

## Validation

Use focused checks while iterating:

```sh
mise exec -- go test ./backend ./backend/internal/authstate
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- cluster kubeconfig auth refresh
```
