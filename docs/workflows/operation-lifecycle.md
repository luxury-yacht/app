# Runtime Operation Lifecycle

Runtime operations are live or long-running cluster-scoped workflows that must
be visible in the app shell and cleaned up when their cluster goes away.

Current runtime operation types:

- Shell exec sessions.
- Port-forward sessions.
- Active node drain jobs.

## Backend Contract

- `backend/runtime_operations.go` owns the runtime operation registry and the
  `runtime-operations:list` event.
- `ListRuntimeOperations()` is the Wails runtime-read command for the current
  operation list.
- Every concrete Kubernetes target must include the full object reference:
  `clusterId`, `group`, `version`, `kind`, `namespace` when namespaced, and
  `name`.
- The registry is runtime state only. It is not refresh state, settings state,
  or the source of workflow-specific details.

Workflow-owned details stay in their existing stores:

- Shell backlog, terminal IO, and reattach data stay in `backend/shell_sessions.go`.
- Port-forward local port and reconnect status stay in `backend/portforward.go`.
- Drain history and event details stay in `backend/nodemaintenance` and the
  `object-maintenance` refresh domain.
- `DrainNodeModal` owns drain result presentation. The active or most recent
  drain attempt remains pinned in the modal, and older attempts render as
  history.

## Drain Maintenance Refresh

`object-maintenance` is live app-managed maintenance state, not a Kubernetes
list snapshot. It has two concurrent consumer shapes:

- aggregate cluster scopes used by node-table/object-panel drain indicators;
- node-specific scopes used by an open `DrainNodeModal`.

The frontend refresh orchestrator must allow multiple active
`object-maintenance` scopes at the same time. Enabling an aggregate scope must
not disable or reset an open modal's node-specific scope, and enabling a modal
scope must not disable aggregate drain indicators.

The backend snapshot service also treats `object-maintenance` specially:

- it bypasses the normal short snapshot cache;
- it bypasses snapshot singleflight coalescing.

This prevents a modal refresh after `StartDrainNode` from being satisfied by an
older in-flight empty snapshot that started before the drain job was recorded.

## Cleanup Contract

Cluster removal, kubeconfig clearing, explicit cluster-tab close, client-pool
teardown, and app shutdown all go through the backend cluster runtime cleanup
path.

Cleanup behavior:

- Shell sessions are closed and removed from `object-shell:list` and
  `runtime-operations:list`.
- Port forwards are stopped and removed from `portforward:list` and
  `runtime-operations:list`.
- Active drain jobs are cancelled through an internal lifecycle path that does
  not require a live selected cluster client or user RBAC check.
- Completed drain history remains in `object-maintenance` until the bounded
  drain history expires.
- Cleanup is idempotent; repeated close/remove paths must not resurrect or
  double-report operations.

## Frontend Contract

- `frontend/src/ui/status/SessionsStatus.tsx` reads
  `runtime-operations:list` for shell and port-forward presence plus
  removed-cluster cleanup. It does not render drain detail rows.
- Shell and port-forward rows may still use workflow-specific list events for
  details such as container, command, pod name, local port, and status reason.
- Active drains stay visible to lifecycle cleanup and close-cluster warnings,
  but drain progress, history, and detail presentation remain owned by the node
  maintenance workflow.
- `frontend/src/ui/layout/ClusterTabs.tsx` calls `CloseCluster(...)` instead of
  directly stopping shell sessions or port forwards.
- Cluster close confirmation may use the runtime operation list for total
  active-operation counts and type breakdowns, including active drain jobs.

## Validation

Focused checks:

```sh
go test ./backend ./backend/resources/nodes ./backend/nodemaintenance
go test ./backend/refresh/snapshot
npm run test --prefix frontend -- SessionsStatus ClusterTabs port-forward drain
npm run test --prefix frontend -- orchestrator
npm run typecheck --prefix frontend
```

Run `mage qc:prerelease` before presenting non-documentation changes as
complete.

When changing drain-modal refresh behavior, also manually smoke test starting a
drain from an already-open `DrainNodeModal` and confirm the result appears and
remains visible after completion.
