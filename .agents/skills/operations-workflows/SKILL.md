---
name: operations-workflows
description: Work on logs, shell exec, debug containers, port-forward, node drain/maintenance, long-running operations, permissions, lifecycle, and cleanup tests
---

# Operations Workflows

Use this when touching logs, shell exec, debug containers, port-forward, node
drain/maintenance, session lifecycle, operation cancellation, permission-gated
actions, or related tests.

## Task routes

Read only the contracts selected by the change. Follow further links when the
changed path crosses that boundary.

| Change | Read |
| --- | --- |
| Application, container or node logs | [overview](../../../docs/workflows/logs/overview.md); select the affected log surface |
| Shell exec or debug containers | [shell-debug](../../../docs/workflows/shell-debug.md) |
| Port-forward, drain, session registry, cancellation or cleanup | [operation-lifecycle](../../../docs/workflows/operation-lifecycle.md) |
| Permission checks, action availability or denial | [permissions](../../../docs/architecture/permissions.md) |
| Cluster selection, removal or per-cluster lifetime | [multi-cluster](../../../docs/architecture/multi-cluster.md) |
| Auth failure or recovery | [auth](../../../docs/architecture/auth.md) |

## Backend Entry Points

- `backend/operations_coordinator.go`
- `backend/runtime_operations.go`
- `backend/refresh/containerlogsstream`
- `backend/resources/pods/logs.go`
- `backend/resources/nodes/logs.go`
- `backend/app_log_service_commands.go`
- `backend/shell_sessions.go`
- `backend/resources/pods/debug.go`
- `backend/portforward*.go`
- `backend/nodemaintenance`
- `backend/refresh/snapshot/node_maintenance.go`
- `backend/refresh/snapshot/service.go`
- cluster lifecycle cleanup orchestrated by `WorkspaceCoordinator` and
  `ApplicationLifecycle` in `backend/cluster_runtime_clients.go`,
  `backend/workspace_kubeconfigs.go`, and `backend/application_lifecycle.go`

## Frontend Entry Points

- `frontend/src/modules/object-panel/components/ObjectPanel/Logs`
- `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs`
- `frontend/src/modules/object-panel/components/ObjectPanel/Shell`
- `frontend/src/modules/port-forward`
- `frontend/src/core/refresh/orchestrator.ts`
- `frontend/src/ui/status/SessionsStatus.tsx`
- `frontend/src/ui/layout/ClusterTabs.tsx`
- `frontend/src/shared/components/modals/DrainNodeModal.tsx`
- shared drain/maintenance components
- settings or modals that configure these workflows

## Checklist

- [ ] Requests and events carry `clusterId` and full target identity.
- [ ] Runtime operation entries that target Kubernetes objects carry
      `clusterId`, `group`, `version`, `kind`, and concrete `namespace`/`name`
      where applicable.
- [ ] Permission checks and capability reasons are visible in the UI.
- [ ] Streams, sessions, and long-running operations clean up on close,
      disconnect, cluster removal, auth failure, and app shutdown.
- [ ] Cancellation/stop paths are idempotent.
- [ ] Frontend cluster-tab close delegates to `KubeconfigContext`'s unified
      selection transition; backend selection cleanup handles removed-cluster
      runtime operations instead of per-workflow cleanup in UI surfaces.
- [ ] Shell backlog, port-forward details, and drain history remain owned by
      their workflow stores; the runtime registry only owns global presence and
      cleanup.
- [ ] Sessions status renders shell sessions and port forwards only; active
      drains may appear in cluster-close warnings but not as Sessions panel
      detail rows.
- [ ] `object-maintenance` keeps aggregate and node-specific scopes active
      concurrently so node drain indicators and an open drain modal do not reset
      each other.
- [ ] `object-maintenance` remains uncached and singleflight-bypassed in the
      backend snapshot service because it represents live app-managed drain
      state.
- [ ] Drain progress and history render in `DrainNodeModal`; keep the active or
      most recent drain attempt visible after a drain starts or completes.
- [ ] Frontend state resets on cluster/namespace/object changes.
- [ ] Logs preserve transport-specific behavior documented in the logs docs.
- [ ] Tests cover lifecycle, permission-denied, and cleanup behavior.

## Validation

Use focused checks while iterating:

```sh
mise exec -- go test ./backend ./backend/resources/pods ./backend/resources/nodes ./backend/nodemaintenance
mise exec -- go test ./backend/refresh/snapshot
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- Logs Shell port-forward drain orchestrator
```

Then follow the root final validation gate.
