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

- Backend auth state manager: `backend/internal/authstate`
- Cluster client auth wiring: `backend/cluster_clients.go`
- Auth events and recovery lifecycle: `backend/cluster_auth.go`, backend app
  lifecycle/refresh setup paths
- Frontend cluster/auth context: `frontend/src/core/contexts/AuthErrorContext.tsx`
- Refresh pause/recovery behavior: `frontend/src/core/refresh`

## State Model

Use explicit states such as valid, invalid, recovering, and unknown instead of
deriving behavior from error strings alone. Error capture may detect auth-like
stderr, but durable state belongs to the per-cluster auth manager.

Backend auth events are `cluster:auth:failed`, `cluster:auth:recovering`,
`cluster:auth:recovered`, and `cluster:auth:progress`. Payloads must include
`clusterId` and enough cluster metadata for the frontend to update only the
affected cluster.

Recovery must prove both sides of the gate:

- invalid early state is blocked for the affected cluster
- the operation required to recover can still run

### Recovery error classification

Recovery probes classify failures (`authstate.ErrorClass`, classifier in
`backend/cluster_clients.go`):

- **auth** — the cluster rejected the credentials (HTTP 401/403) or the exec
  credential plugin failed. Only these consume the bounded recovery attempts;
  exhausting them yields the terminal `invalid` state.
- **connectivity** — the cluster could not be reached (refused, timeout, DNS,
  TLS). These say nothing about credential validity, so the recovery loop keeps
  probing at `ClusterAuthConnectivityRetryInterval` without consuming attempts;
  the cluster reconnects on its own when it answers. This is what keeps a
  cluster upgrade (multi-minute outage, often with transient 401s) from
  stranding the cluster in `invalid`.

The latest probe verdict travels on `cluster:auth:progress` events and the auth
state RPCs as `errorClass`, and is sticky across retries. The frontend shows
the blocking auth overlay only for confirmed auth verdicts (terminal `invalid`,
or a probe rejected by the cluster); connectivity-class recovery presents as
"Reconnecting" in the connectivity indicator instead.

### Invalid is not terminal for the app

The heartbeat auto-retries clusters parked in `invalid` at
`ClusterAuthAutoRetryInterval` (`maybeAutoRetryClusterAuth`), so externally
fixed credentials (fresh SSO login) or a recovered cluster are noticed without
user action. Recovery probes always build a fresh client from kubeconfig — they
must never run through the cluster's wrapped transport, which blocks requests
while auth is not valid.

### Rebuild wiring invariant

`rebuildClusterSubsystem` must wire rebuilt client transports to the cluster's
EXISTING auth manager (`buildClusterClientsWithManager`). Building around a
fresh manager and swapping afterwards leaves the transports reporting to a
discarded manager — auth failures then block all traffic forever while the
tracked manager stays valid and `RetryClusterAuth` no-ops. Pinned by
`TestRebuildClusterSubsystemPreservesAuthManagerWiring`.

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
