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

- Runtime registry and list event: `backend/runtime_operations.go`
- Shell lifecycle and backlog: `backend/shell_sessions*.go`
- Port-forward lifecycle and status: `backend/portforward*.go`
- Node maintenance and drain state: `backend/nodemaintenance`,
  `backend/refresh/snapshot/node_maintenance.go`
- Frontend status rows: `frontend/src/ui/status`
- Cluster selection transition:
  [../architecture/multi-cluster.md](../architecture/multi-cluster.md)

## Drain Refresh Rule

`object-maintenance` is live app-managed state, not a normal Kubernetes list
snapshot. It may have multiple active scopes at once, such as an aggregate
cluster scope and a node-specific drain modal scope. Enabling one must not
disable or reset the other.

The backend snapshot path should bypass normal cache and singleflight behavior
for this state so modal refreshes after `StartDrainNode` see the new operation.

## Change Checklist

When changing runtime operations:

1. Preserve `clusterId` and full target refs.
2. Trace registration, list events, workflow detail events, and cleanup hooks.
3. Confirm removed operations cannot reappear from stale workflow events.
4. Confirm cluster close/clear/removal cleans only the affected cluster.
5. Test startup read, live update, cleanup, and repeated cleanup.

## Validation

Run focused backend operation tests plus affected frontend status/workflow tests.
For non-documentation work, finish with `mage qc:prerelease`.
