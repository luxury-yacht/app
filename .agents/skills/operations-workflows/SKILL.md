---
name: operations-workflows
description: Work on logs, shell exec, debug containers, port-forward, node drain/maintenance, long-running operations, permissions, lifecycle, and cleanup tests
---

# Operations Workflows

Use this when touching logs, shell exec, debug containers, port-forward, node
drain/maintenance, session lifecycle, operation cancellation, permission-gated
actions, or related tests.

## Core Contracts

Read:

1. `AGENTS.md`
2. `backend/AGENTS.md`
3. `frontend/AGENTS.md`
4. `docs/workflows/logs/overview.md`
5. `docs/workflows/shell-debug.md`
6. `docs/architecture/permissions.md`
7. `docs/architecture/multi-cluster.md`
8. `docs/architecture/auth.md` when cluster auth or recovery is involved
9. `docs/workflows/operation-lifecycle.md` when touching live operation
   registry, cleanup, or status behavior

## Backend Entry Points

- `backend/runtime_operations.go`
- `backend/refresh/containerlogsstream`
- `backend/resources/pods/logs.go`
- `backend/resources/nodes/logs.go`
- `backend/app_logs.go`
- `backend/shell_sessions.go`
- `backend/resources/pods/debug.go`
- `backend/portforward*.go`
- `backend/nodemaintenance`
- `backend/refresh/snapshot/node_maintenance.go`
- `backend/refresh/snapshot/service.go`
- cluster lifecycle cleanup callers in `backend/cluster_clients.go`,
  `backend/kubeconfigs.go`, and `backend/app_lifecycle.go`

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
- [ ] Cluster-tab close uses the backend close-cluster lifecycle path instead
      of directly orchestrating per-workflow cleanup from the frontend.
- [ ] Shell backlog, port-forward details, and drain history remain owned by
      their workflow stores; the runtime registry only owns global presence and
      cleanup.
- [ ] Sessions status renders shell sessions and port forwards only; active
      drains may appear in close-cluster warnings but not as Sessions panel
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
- [ ] Non-doc changes pass `mage qc:prerelease`.

## Validation

Use focused checks while iterating:

```sh
go test ./backend ./backend/resources/pods ./backend/resources/nodes ./backend/nodemaintenance
go test ./backend/refresh/snapshot
npm run typecheck --prefix frontend
npm run test --prefix frontend -- Logs Shell port-forward drain orchestrator
```

Then run `mage qc:prerelease` for non-documentation changes.
