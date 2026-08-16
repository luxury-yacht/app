# Runtime Operation Lifecycle Contract

Runtime operations are live or long-running cluster-scoped workflows that must
be visible in the app shell and cleaned up when their cluster goes away.

## Agent Contract

- Runtime operations are keyed by `clusterId`.
- Concrete Kubernetes targets must carry full object refs.
- The runtime operation registry is the active-operation envelope for shell,
  port-forward, and active drain cleanup.
- Workflow detail stores may add row details; they must not resurrect an
  operation removed by the registry.
- Cluster removal, tab close, kubeconfig clear, client teardown, and app
  shutdown must all clean operations through backend lifecycle cleanup.
- Cleanup must be idempotent.
- Active node maintenance state must remain current and must not be satisfied by
  stale snapshot cache.

## Operation Types

- Shell exec sessions.
- Port-forward sessions.
- Active node drain jobs.

## Ownership

- `backend.OperationsCoordinator` owns the runtime registry, shell-session map,
  port-forward map, their locks, Wails command implementations, executor
  factories, typed list/status publication, and all per-cluster/process cleanup.
- `backend/runtime_operations.go` implements the coordinator's active-operation
  envelope and the `runtime-operations:list` event.
- `backend/shell_sessions*.go` implements coordinator-owned shell lifecycle and
  backlog behavior.
- `backend/portforward*.go` implements coordinator-owned forwarding lifecycle
  and status behavior.
- Node maintenance and drain state: `backend/nodemaintenance`,
  `backend/refresh/snapshot/node_maintenance.go`
- Frontend status rows: `frontend/src/ui/status`
- Cluster selection transition:
  [../architecture/multi-cluster.md](../architecture/multi-cluster.md)

`DesktopService` delegates all ten live-operation commands directly to the
coordinator. The coordinator has no `*App` back-pointer. It receives narrow
cluster dependency/retry access, permission evaluation, event publication,
logging, application context, drain-store, and shell-executor dependencies.
The cluster-access implementation is temporarily App-backed; Phase 5A replaces
that implementation with `ClusterRuntimeManager` without changing operation
ownership or Wails commands.

## Registry And Cleanup Ordering

The runtime registry is authoritative for whether an operation is active.
Shell and port-forward detail maps provide workflow state but cannot create an
active operation on their own. Every live workflow registers one registry
entry with its idempotent cleanup callback.

`StopCluster(clusterId)` advances that cluster's operation epoch and removes
its registry entries before invoking callbacks. It then publishes at most one
final shell list, one final port-forward list, and one final runtime-operation
list. A late shell start, port-forward activation, or drain registration from
an older epoch is rejected, so detail activity cannot resurrect an operation
after cluster removal. Repeating `StopCluster` is a no-op apart from the empty
authoritative list publication.

`Shutdown()` first closes registration for the process, then applies the same
cleanup to every cluster still represented in the registry. Repeating shutdown
does not run callbacks again, and work completing after shutdown cannot add a
new entry. `ApplicationLifecycle.ServiceShutdown` stops auth managers first,
calls `OperationsCoordinator.Shutdown`, then stops the kubeconfig watcher and
refresh runtime. Frontend events are already gated once the application context
is cancelled, but workflow resources are still closed.

Cluster close, kubeconfig clear, selection pruning, and removed-client cleanup
all call the same `StopCluster` entry point. They must not call shell-,
port-forward-, or drain-specific cleanup paths.

## Drain Refresh Rule

`object-maintenance` is live app-managed state, not a normal Kubernetes list
snapshot. It may have multiple active scopes at once, such as an aggregate
cluster scope and a node-specific drain modal scope. Enabling one must not
disable or reset the other.

The backend snapshot path should bypass normal cache and singleflight behavior
for this state so modal refreshes after the `startDrain` object action see the
new operation.

## Change Checklist

When changing runtime operations:

1. Preserve `clusterId` and full target refs.
2. Trace registration, list events, workflow detail events, and cleanup hooks.
3. Confirm removed operations cannot reappear from stale workflow events.
4. Confirm cluster close/clear/removal cleans only the affected cluster.
5. Test startup read, live update, cleanup, and repeated cleanup.
6. Preserve operation-epoch rejection for starts or activations racing with
   cluster removal or process shutdown.

## Validation

Run focused backend operation tests plus affected frontend status/workflow tests.
For non-documentation work, finish with `wails3 task qc:prerelease`.
