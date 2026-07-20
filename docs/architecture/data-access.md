# Data Access Contract

Frontend reads must go through one of the app data brokers. Components and
feature hooks should not call backend read transports directly.

## Agent Contract

- Use `dataAccess` for cluster/resource reads.
- Use `appStateAccess` for bootstrap, app-shell, persisted-state, app logs, and
  runtime inventory reads.
- Do not call generated cluster-data Wails read bindings, `QueryPermissions`,
  `fetchScopedDomain`, or refresh manual-trigger helpers directly from feature
  components.
- Add typed reader wrappers under the owning broker package, then call through
  the broker.
- Commands and mutations may use action-specific bindings, but must carry full
  cluster and object identity.
- `dataAccess` reads must respect paused auto-refresh policy; user-triggered
  reads may still run while passive reads are blocked.
- `appStateAccess` must stay independent of refresh-domain lifecycle policy.

## Broker Choice

| Broker | Use for |
| --- | --- |
| `dataAccess` | Refresh domains, cluster/resource RPC reads, permission/capability reads |
| `appStateAccess` | Settings, kubeconfig inventory, app info, app logs, session lists, persisted UI state |

Request reasons for cluster/resource reads are:

- `background`: scheduler-driven upkeep
- `startup`: first passive scope acquisition
- `foreground`: a retained scope became visible; non-manual and allowed while
  passive automatic refresh is paused
- `user`: explicit user action
- `stream-signal`: doorbell/change-signal-triggered refetch — bypasses the
  skip-while-stream-healthy gate (a doorbell refetch issued as `background`
  is silently swallowed)

Context-wide manual refresh accepts only `user`. Navigation updates orchestrator
context and lets the scheduler issue foreground reconciliation; it never creates
a ManualQueue job.

The owning timing, retention, and background-work rules are in
[data-freshness.md](data-freshness.md).

When auto-refresh is disabled, blocked non-user reads should not show passive
loading spinners.

## Ownership

- Cluster/resource broker: `frontend/src/core/data-access`
- App-state broker: `frontend/src/core/app-state-access`
- Refresh HTTP client: `frontend/src/core/refresh/client.ts`
- Settings metadata cache: `frontend/src/core/settings/appPreferences.ts`
- Wails DTOs and generated bindings: `frontend/wailsjs/go`

## Settings Rule

Backend-owned preferences, defaults, bounds, enum values, validation, and
runtime side effects come from the backend settings schema. Frontend settings UI
may cache metadata for first paint or tests, but the cache is not a second
contract.

Persisted preference mutations should batch through `UpdateAppPreferences` so
validation, persistence, side effects, normalized return values, and optimistic
rollback stay aligned.

## Scope Rules

All cluster/resource reads preserve identity:

- cluster-scoped reads include `clusterId`
- namespace-scoped reads include `clusterId` and namespace
- object-scoped reads include `clusterId`, `group`, `version`, `kind`, and
  concrete object identity

Foreground views read the active cluster. Background or cross-cluster displays
fan out over per-cluster reads; they do not use aggregate refresh scopes.

## Change Checklist

When adding a read:

1. Classify it as cluster/resource data or app-state/runtime data.
2. Add a typed reader wrapper under the owning broker.
3. Include diagnostics labels, adapter type, request reason, and scope.
4. Handle blocked `dataAccess` reads without treating them as errors.
5. Preserve full cluster and object identity across the boundary.

## Validation

Run targeted frontend tests for the broker or consumer and `npm run typecheck
--prefix frontend` for TypeScript changes. For non-documentation work, finish
with `mage qc:prerelease`.
