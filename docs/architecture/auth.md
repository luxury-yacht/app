# Auth Contract

Auth state is per cluster. An auth failure, retry, or recovery in one cluster
must not poison other selected clusters.

## Agent Contract

- Track auth state by `clusterId`.
- Surface auth failure without clearing unrelated cluster data.
- Pause or block only the affected cluster's refresh, streams, actions, and
  diagnostics.
- Recovery rebuilds the affected cluster client and dependent subsystems before
  normal refresh resumes.
- Do not treat transport errors, missing clusters, and auth failures as the
  same state.
- UI overlays and events must include enough cluster metadata to identify the
  affected cluster.

## Ownership

- Backend auth state manager: `backend/authstate`
- Cluster client auth wiring: `backend/cluster_clients.go`
- Auth events and recovery lifecycle: backend app lifecycle/refresh setup paths
- Frontend cluster/auth context: `frontend/src/modules/kubernetes/config`
- Refresh pause/recovery behavior: `frontend/src/core/refresh`

## State Model

Use explicit states such as valid, failed, recovering, and unknown instead of
deriving behavior from error strings alone. Error capture may detect auth-like
stderr, but durable state belongs to the per-cluster auth manager.

Recovery must prove both sides of the gate:

- invalid early state is blocked for the affected cluster
- the operation required to recover can still run

## Change Checklist

When changing auth behavior:

1. Trace the failing cluster from backend detection to frontend presentation.
2. Confirm unrelated clusters continue refreshing and accepting actions.
3. Confirm recovery rebuilds clients, refresh subsystems, catalog state, and
   streams in the right order.
4. Test failure, retry/progress, recovery, and cluster removal during failure.

## Validation

Run targeted auth, cluster lifecycle, and refresh recovery tests. For
non-documentation work, finish with `mage qc:prerelease`.
