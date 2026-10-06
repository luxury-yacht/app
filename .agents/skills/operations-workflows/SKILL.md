---
name: operations-workflows
description: Work on logs, shell exec, debug containers, port-forward, node drain/maintenance, long-running operations, permissions, lifecycle, and cleanup tests
---

# Operations Workflows

Use this when touching logs, shell exec, debug containers, port-forward, node
drain/maintenance, session lifecycle, operation cancellation, permission-gated
actions, or related tests. The linked docs own the contracts: read only those
the change selects, and follow their links when the changed path crosses that
boundary.

## Task routes

| Change | Read |
| --- | --- |
| Application, container or node logs | [overview](../../../docs/workflows/logs/overview.md), then the affected log surface |
| Shell exec or debug containers | [shell-debug](../../../docs/workflows/shell-debug.md) |
| Port-forward, drain, session registry, status rows, cancellation or cleanup | [operation-lifecycle](../../../docs/workflows/operation-lifecycle.md) |
| Permission checks, action availability or denial | [permissions](../../../docs/architecture/permissions.md) |
| Cluster selection, removal or per-cluster lifetime | [multi-cluster](../../../docs/architecture/multi-cluster.md) |
| Auth failure or recovery | [auth](../../../docs/architecture/auth.md) |
| Local Kind or restricted-permission test clusters | [kind-clusters](../../../docs/workflows/kind-clusters.md) |

## Entry points

- Backend: `backend/operations_coordinator.go`,
  `backend/runtime_operations.go`, `backend/shell_sessions.go`,
  `backend/portforward*.go`, `backend/resources/pods/logs.go`,
  `backend/resources/pods/debug.go`, `backend/resources/nodes/logs.go`,
  `backend/internal/containerlogs`, `backend/refresh/containerlogsstream`,
  `backend/app_log_service_commands.go`, `backend/nodemaintenance`,
  `backend/refresh/snapshot/node_maintenance.go`,
  `backend/refresh/snapshot/service.go`.
- Cluster cleanup orchestration (`WorkspaceCoordinator`,
  `ApplicationLifecycle`): `backend/cluster_runtime_clients.go`,
  `backend/workspace_kubeconfigs.go`,
  `backend/workspace_cluster_client_pool.go`, `backend/application_lifecycle.go`.
- Frontend: `frontend/src/modules/object-panel/components/ObjectPanel/` (`Logs`,
  `NodeLogs`, `Shell`), `frontend/src/modules/port-forward`,
  `frontend/src/core/refresh/orchestrator.ts`,
  `frontend/src/ui/status/SessionsStatus.tsx`,
  `frontend/src/ui/layout/ClusterTabs.tsx`,
  `frontend/src/shared/components/modals/DrainNodeModal.tsx`, shared
  drain/maintenance components, and settings or modals that configure these
  workflows.

## Focused checks

Workflow UI state resets on cluster, namespace, or object change; tests cover
lifecycle, permission-denied, and cleanup behavior.

```sh
mise exec -- go test ./backend ./backend/resources/pods ./backend/resources/nodes ./backend/nodemaintenance
mise exec -- go test ./backend/refresh/snapshot
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- Logs Shell port-forward drain orchestrator
```
