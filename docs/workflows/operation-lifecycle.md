# Runtime Operation Lifecycle Contract

Runtime operations — shell exec sessions, port-forward sessions, and active node
drain jobs — are live cluster-scoped workflows that appear in the app shell and
are cleaned up when their cluster goes away.

## Ownership

- `backend.OperationsCoordinator` (`backend/operations_coordinator.go`) owns the
  runtime registry, shell-session map, port-forward map, their locks, the Wails
  command implementations, executor factories, typed list/status publication,
  drain-operation registration, and all per-cluster/process cleanup.
  - `backend/runtime_operations.go`: active-operation envelope and the
    `runtime-operations:list` event.
  - `backend/shell_sessions*.go`: shell lifecycle and backlog.
  - `backend/portforward*.go`: forwarding lifecycle and status.
- `DesktopService` delegates live-operation commands directly to the
  coordinator, whose collaborators stay narrow (cluster dependency/retry
  access, permissions, events, logging, app context, drain store, shell
  executor). Production cluster access is `ClusterRuntimeManager` plus the
  refresh-owned retry-telemetry projection; Operations never retains the
  composition root or calls back into Workspace or Refresh
  ([backend-services.md](../architecture/backend-services.md)).
- The single process-composed `backend/nodemaintenance.Store` owns cluster-keyed
  drain jobs, cancellation handles, bounded history, and its lock. Node resource
  actions write it, Operations cancels through it, and
  `backend/refresh/snapshot/node_maintenance.go` reads it for live snapshots.
- Frontend status rows: `frontend/src/ui/status`. Cluster selection transition:
  [multi-cluster.md](../architecture/multi-cluster.md).

## Registry And Cleanup Ordering

- The runtime registry is authoritative for whether an operation is active and
  owns only global presence and cleanup. Shell backlog, port-forward details,
  and drain history stay in their workflow stores, which may add row details
  but cannot create an operation or resurrect one the registry removed.
- Every live workflow registers one registry entry with its idempotent cleanup
  callback; user stop and cancel paths must be idempotent too.
- `StopCluster(clusterId)` advances that cluster's operation epoch, removes its
  registry entries, then invokes their callbacks, and publishes at most one
  final shell list, port-forward list, and runtime-operation list. It affects
  only that cluster. A late shell start, port-forward activation, or drain
  registration from an older epoch is rejected. Repeating it is a no-op apart
  from the empty authoritative list publication.
- Cluster close, kubeconfig clear, selection pruning, and removed-client
  cleanup all call `StopCluster`; they never call shell-, port-forward-, or
  drain-specific cleanup paths. UI surfaces do not run per-workflow cleanup:
  frontend cluster-tab close delegates to `KubeconfigContext`'s unified
  selection transition.
- `Shutdown()` first closes registration for the process, then applies the same
  cleanup to every cluster still in the registry. Repeating it does not rerun
  callbacks, and work completing afterwards cannot add an entry. Frontend events
  are already gated once the application context is cancelled, but workflow
  resources are still closed. Shutdown order (auth managers, then
  `OperationsCoordinator.Shutdown`, then kubeconfig watcher and refresh) is
  owned by [application-lifecycle.md](../architecture/application-lifecycle.md).

## Status And Drain UI

- Sessions status (`frontend/src/ui/status/SessionsStatus.tsx`) renders shell
  sessions and port forwards only; active drains may appear in cluster-close
  warnings but not as Sessions detail rows.
- Drain progress and history render in
  `frontend/src/shared/components/modals/DrainNodeModal.tsx`; the active or most
  recent drain attempt stays visible after a drain starts or completes.

## Drain Refresh Rule

`object-maintenance` is live app-managed state, not a normal Kubernetes list
snapshot, and must never be satisfied from a stale snapshot cache.

- It may have several active scopes at once, such as an aggregate cluster scope
  and a node-specific drain modal scope. Enabling one must not disable or reset
  another.
- The backend snapshot service (`backend/refresh/snapshot/service.go`) bypasses
  cache and singleflight for it, so modal refreshes after the `startDrain`
  object action see the new operation.

## Validation

Run focused backend operation tests plus affected frontend status/workflow
tests covering startup read, live update, cleanup, repeated cleanup, and
epoch rejection of starts racing cluster removal or shutdown.
