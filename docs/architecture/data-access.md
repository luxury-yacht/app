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

Every executed `dataAccess` read receives a `broker-read-N` request id. Refresh
domain reads forward that id as `X-Correlation-ID` on manual-refresh, job-status,
and snapshot requests through the same-origin Wails service. The backend reuses
it as the operation identity for snapshot builds
and carries it through queued manual-refresh execution, so frontend diagnostics,
structured errors, and breadcrumbs refer to the same request instance.
Because the refresh orchestrator presents handled failures before the broker
call completes, it must pass the live `broker-read-N` id into the shared error
boundary. The telemetry owner resolves only ids that are still registered as
active broker requests; it does not trust an arbitrary caller-supplied id.

The owning timing, retention, and background-work rules are in
[data-freshness.md](data-freshness.md).

When auto-refresh is disabled, blocked non-user reads should not show passive
loading spinners.

## Ownership

- Cluster/resource broker: `frontend/src/core/data-access`
- App-state broker: `frontend/src/core/app-state-access`
- Refresh HTTP client: `frontend/src/core/refresh/client.ts`
- Settings metadata cache: `frontend/src/core/settings/appPreferences.ts`
- Wails DTOs and generated bindings: `frontend/bindings`; the only callable
  backend module is `github.com/luxury-yacht/app/backend/desktopservice`

## Wails command boundary

`backend.DesktopService` is the sole registered backend service. It declares
the stable frontend command signatures and delegates each command to exactly
one owner-shaped interface: Favorites, UI state, Preferences, Data Management,
Cluster Attention, Workspace, Cluster Runtime, Resources, Operations, Updates,
App Logs, or Desktop Shell. Lifecycle and `/api/v2` HTTP handling are separate
collaborators. Do not replace these seams with one interface containing every
command, and do not give `DesktopService` an `*App` back-pointer.

Frontend code imports generated commands only through
`frontend/src/core/backend-api/index.ts`. Higher-level consumers must not import
`desktopservice.ts` directly. The implementation type `backend.App` is not a
registered service, so its exported implementation and test methods need no
`//wails:ignore` directives.

`ResourceGateway` owns request-shaped Kubernetes resource work: exact catalog
resolution, capability queries, typed details, YAML, object actions, Helm and
node-log operations, response caching, and permission-aware cache validation.
It receives narrow cluster-client, context, transport-health, event, logging,
catalog, and telemetry collaborators; it never stores `*App`. The current
cluster-client and transport implementations are composed from `App` only until
`ClusterRuntimeManager` replaces them.

The object catalog is the only production GVK-to-GVR and object-existence
resolver used by `ResourceGateway`. The generated resource-kind registry remains
the per-kind vocabulary. Resource requests do not fall back to kind-only
discovery, infer a cluster, or read preferences.

Response and SSRR caches live inside `ResourceGateway`. Refresh construction
registers gateway-owned invalidation callbacks, so the dependency points from
refresh to resources. Resource code does not acquire refresh/subsystem state or
call back through the composition root. `ResourceGateway` reads the shared
`ContainerLogsSelectionPolicy` and `PermissionFetchPolicy`; successful settings
operations push new values into those policies in the opposite direction.

The generated internal `BindingModelAnchor` method belongs to
`*DesktopService`. Its type-level `wails:inject` directive keeps every resource
detail DTO reachable even though the implementation-only
`ResourceGateway.Get<Kind>` wrappers are not commands. `genappbindings.Render`
emits the anchor and those wrappers in package `backend`, so `DesktopService`,
`ResourceGateway`, and the generated file must remain there. Moving either type
requires first adding and testing a target-package option in that generator.

## Settings Rule

Backend-owned preferences, defaults, bounds, enum values, validation, and
runtime side effects come from the backend settings schema. Frontend settings UI
may cache metadata for first paint or tests, but the cache is not a second
contract.

Persisted preference mutations should batch through `UpdateAppPreferences` so
validation, persistence, side effects, normalized return values, and optimistic
rollback stay aligned.

`PreferencesService` owns one coalesced lazy-load attempt. `EnsureLoaded`
surfaces a load error without installing state or dispatching effects;
`EnsureLoadedForStartup` joins that same attempt and may atomically install a
snapshot marked `startup-default`. Callers receive copied snapshots and never
hold the preferences mutex or invoke a raw settings loader.

Runtime effects cross one stateless six-route dispatcher: error-reporting
enablement, Kubernetes client QPS/burst, SSRR fetch concurrency, per-scope
container-log target limit, global container-log target limit, and metrics
refresh interval. A mutation captures its immutable snapshot and effect flags,
persists under the preferences lock, releases the lock, then dispatches to
owner-shaped write-only sinks. Persistence failure dispatches nothing. Sinks
must not read preferences, call another effect owner, or acquire a refresh lock
while holding a leaf-policy lock.

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
3. Include diagnostics labels, adapter type, request reason, and scope; let the
   broker supply the request id rather than creating a second correlation id.
4. Handle blocked `dataAccess` reads without treating them as errors.
5. Preserve full cluster and object identity across the boundary.

## Validation

Run targeted frontend tests for the broker or consumer and `npm run typecheck
--prefix frontend` for TypeScript changes. For non-documentation work, finish
with `wails3 task qc:prerelease`.
