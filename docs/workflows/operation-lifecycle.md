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
- Cluster lifecycle cleanup uses the registry as the active-operation envelope:
  it removes registered operations for the cluster and invokes their cleanup
  hooks. It does not separately scan workflow detail stores to discover active
  shell sessions, port forwards, or drains.
- Every concrete Kubernetes target must include the full object reference:
  `clusterId`, `group`, `version`, `kind`, `namespace` when namespaced, and
  `name`.
- The registry is runtime state only. It is not refresh state, settings state,
  or the source of workflow-specific details.

Workflow-owned details stay in their existing stores:

- Shell backlog, terminal IO, and reattach data stay in `backend/shell_sessions.go`;
  shell registration, list/status emission, and runtime cleanup hooks stay in
  `backend/shell_sessions_lifecycle.go`.
- Port-forward local port and reconnect status stay in `backend/portforward.go`;
  port-forward registration, list/status emission, and runtime cleanup hooks
  stay in `backend/portforward_lifecycle.go`.
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
teardown, and app shutdown all go through backend cluster runtime cleanup.
Frontend-initiated cluster tab opens, closes, replacements, and clears must
first go through the unified kubeconfig selection transition described in
[`docs/architecture/multi-cluster.md#unified-selection-transitions`](../architecture/multi-cluster.md#unified-selection-transitions).

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
- `frontend/src/ui/status/runtimeOperationStatus.ts` reduces
  Wails startup reads and live events into status state.
- `frontend/src/ui/status/runtimeOperationStatusAdapter.ts` owns the pure
  reducer and row selector for
  `runtime-operations:list`, `object-shell:list`, `portforward:list`, and
  `portforward:status` events into the shell/port-forward rows shown by the
  status UI.
- Before the initial runtime-operation list loads, workflow list events may
  supply visible shell and port-forward rows for the selected cluster so the
  Sessions indicator is not blank during startup. After
  `runtime-operations:list` loads, runtime operations become the authoritative
  active-operation envelope; workflow events only add row details and cannot
  resurrect operations that the registry has removed.
- Shell and port-forward rows may still use workflow-specific list events for
  details such as container, command, pod name, local port, and status reason.
- Active drains stay visible to lifecycle cleanup, but drain progress, history,
  and detail presentation remain owned by the node maintenance workflow.
- `frontend/src/ui/layout/ClusterTabs.tsx` delegates close intent to
  `closeKubeconfig(...)` instead of directly stopping shell sessions, port
  forwards, drains, or calling generated backend commands.

## Validation

Focused checks:

```sh
go test ./backend ./backend/resources/nodes ./backend/nodemaintenance
go test ./backend/refresh/snapshot
npm run test --prefix frontend -- runtimeOperationStatus SessionsStatus ClusterTabs port-forward drain
npm run test --prefix frontend -- orchestrator
npm run typecheck --prefix frontend
```

Run `mage qc:prerelease` before presenting non-documentation changes as
complete.

When changing drain-modal refresh behavior, also manually smoke test starting a
drain from an already-open `DrainNodeModal` and confirm the result appears and
remains visible after completion.
