# Auth Contract

Auth state is per cluster. A failure, retry, or recovery in one cluster never
poisons other selected clusters.

## Agent Contract

- Surface auth failure without clearing unrelated cluster data; pause or block
  only the affected cluster's refresh, streams, actions, and diagnostics.
- Recovery rebuilds the affected cluster's client and dependent subsystems
  before normal refresh resumes.
- Transport errors, missing clusters, and auth failures are distinct states.
- Tests cover failure, retry/progress, recovery, and cluster removal during
  failure, and show unrelated clusters keep refreshing and accepting actions.

## Ownership

- Auth state manager: `backend/internal/authstate`.
- Client auth wiring and error classifier: `backend/cluster_runtime_clients.go`,
  `backend/cluster_client_contract.go`.
- Events and recovery lifecycle: `backend/cluster_runtime_auth.go`,
  `backend/refresh_auth.go`, `backend/workspace_auth.go`.
- Frontend: the cluster-workspace store (`frontend/src/core/cluster-workspace`)
  with `AuthErrorContext.tsx` as its selector facade; refresh pause/recovery in
  `frontend/src/core/refresh`.

## State Model

- Durable state lives in the per-cluster auth manager as explicit states
  (valid, invalid, recovering, unknown), never derived from error strings. Error
  capture may detect auth-like stderr only as input.
- Events: `cluster:auth:failed`, `cluster:auth:recovering`,
  `cluster:auth:recovered`, `cluster:auth:progress`. Payloads and overlays carry
  `clusterId` and enough cluster metadata to identify and update only the
  affected cluster.
- Frontend consumers read auth through the store or its facade; never install
  another set of Wails auth listeners or another cluster-keyed auth map
  ([state plane](multi-cluster.md#cluster-workspace-state-plane)).

### Recovery error classification

One continuous recovery loop owns retry cadence and exits only on a successful
probe or cancellation. Probe failures are classified (`authstate.ErrorClass`):

- **auth**: the cluster rejected credentials (HTTP 401/403) or the exec
  credential plugin failed. The initial burst follows the backoff schedule;
  `MaxAttempts` auth verdicts settle the state to `invalid`, which is not a
  stop: probing continues at `ClusterAuthSteadyRetryInterval`, so externally
  fixed credentials (fresh SSO login) recover without user action.
- **connectivity**: unreachable (refused, timeout, DNS, TLS). Never consumes
  attempts; probes at `ClusterAuthConnectivityRetryInterval` and reconnects when
  the cluster answers. This keeps a cluster upgrade (multi-minute outage, often
  with transient 401s) from stranding the cluster in `invalid`.

Rules:

- Only probe results drive transitions: `ReportFailure` moves valid →
  recovering; the loop settles recovering → invalid and recovers any non-valid
  state → valid. `TriggerRetry` restarts the loop (immediate probe) without
  touching state.
- No public attempt counter. Progress events and the workspace snapshot carry
  `secondsUntilRetry` (live in recovering and invalid) and the sticky
  `errorClass` verdict.
- The blocking auth overlay appears only for confirmed auth verdicts (settled
  `invalid`, or a probe rejected by the cluster), with one message and a
  next-recheck countdown. Connectivity recovery shows as "Reconnecting" in the
  connectivity indicator.
- Recovery probes always build a fresh client from kubeconfig, never through the
  cluster's wrapped transport, which blocks requests while auth is not valid.
- Expected auth and connectivity outcomes stay in the local log and lifecycle
  UI, not Sentry. Suppression uses only positively recognized conditions;
  unrelated errors and client-side `context.DeadlineExceeded` stay reportable
  even though a deadline is a connectivity verdict for recovery.

### Startup and credential-helper diagnostics

- Auth and namespace callbacks queue at both the workspace and per-cluster
  operation boundaries and never cancel the client construction that produced
  them.
- The exec wrapper preserves credential stdout and forwards stderr, keeping a
  bounded tail. Because client-go discards stderr from exec errors, it writes
  only a recognized diagnostic kind to a private cluster-scoped temp file that
  preflight reads to preserve expiry information. File identity is stable per
  process so client-go's authenticator cache does not grow per probe. Auth
  shutdown removes the directory and late helpers cannot recreate it. Storage
  failure keeps ordinary auth, with a local warning and the original diagnostic.
- Restricted exec plugin policies keep client-go's original command check and
  are not rewritten for capture; their errors keep the available client-go
  detail. Process-global stderr never supplies a cluster's diagnosis.
- Installation guidance requires `missing-helper`; an exec command or helper
  exit code alone does not prove the executable is missing. Expiry diagnostics
  keep refresh guidance even with an exec helper. A nonexistent AWS SSO token is
  `missing-credentials` (credential-refresh guidance), distinct from expiry and
  a missing executable.
- Proof: real-helper subprocess/startup tests cover saved-cluster restore while
  ownership commands and auth callbacks arrive, expired and removed SSO tokens,
  a healthy sibling, and recovery after credentials change.

### Rebuild wiring invariant

`rebuildClusterSubsystem` wires rebuilt client transports to the cluster's
EXISTING auth manager (`buildClusterClientsWithManager`). Rejected: building
around a fresh manager and swapping afterwards — transports then report to a
discarded manager, auth failures block all traffic forever while the tracked
manager stays valid, and `RetryClusterAuth` no-ops. Pinned by
`TestRebuildClusterSubsystemPreservesAuthManagerWiring`.

### Refresh runtime invariant

- Recovery order: rebuild clients → establish a never-started refresh runtime →
  schedule the rebuilt manager → update aggregate routing → start catalog state
  and streams.
- An initial auth failure can abort selection before refresh setup creates its
  process-level context; recovery may then establish that shared refresh context
  and heartbeat before scheduling the rebuilt manager.
- A deliberately stopped process runtime is a teardown boundary: recovery aborts
  before publishing the rebuilt subsystem, and only normal selection setup may
  reopen the runtime.
- Failure to schedule the rebuilt manager aborts publication; aggregate routing
  and catalog collection never expose an unscheduled subsystem.
- Informer/ingest startup then runs concurrently with readiness gates; the
  recovered cluster's loading → degraded → ready progression follows
  [refresh-system](refresh-system.md#permission-and-readiness).
- Pinned by `TestClusterSubsystemRebuildStartsMissingRefreshRuntimeBeforeReadiness`,
  `TestClusterSubsystemRebuildDoesNotPublishWhenRefreshRuntimeStopped`, and
  `TestTeardownRefreshSubsystemBlocksRuntimeResurrectionUntilSetup`.
