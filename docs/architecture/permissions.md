# Permissions Contract

Permissions gate refresh domains, UI actions, and backend mutations through
three separate evaluators; they share identity rules but differ in cache shape,
failure behavior, and diagnostics.

| Evaluator | Purpose |
| --- | --- |
| Refresh-domain permissions | Whether backend domains can list/watch/build data |
| UI permission/capability reads | Gate visible actions, controls, and diagnostics |
| Backend mutation checks | Final write/operation authorization |

## Agent Contract

- Concrete-object checks carry full object identity plus verb and, when
  applicable, subresource.
- Backend mutation checks stay the final authority before changing cluster
  state; backend write/action paths check before mutating.
- Never authorize cluster-scoped resources from namespace-only SSRR data when
  that can produce false positives.
- Permission-denied state is data: surface it, keep denied domains visible in
  diagnostics aligned with user-visible state, and never present missing data as
  an empty success.
- Changes that keep descriptor catalogs, action matrices, and backend checks
  aligned need parity tests; cover allowed, denied, and resolution-error cases.

## Refresh Permission Rules

- Runtime policies: `backend/refresh/domainpermissions`. Startup registration
  gates and permission-denied placeholders: `backend/refresh/system`
  (`registrations.go`, `permission_gate.go`) and `backend/refresh/snapshot`.
  Checker: `backend/refresh/permissions`. Scope matching:
  [namespace scope](namespace-scope.md#the-source-scope-rule).
- Single-resource domains are all-or-nothing. Multi-resource domains degrade to
  partial data when showing permitted resources is useful; partial builders
  guard nil or missing listers.
- `namespaces` is deliberately fail-fast with no degraded fallback: the sidebar
  shows an explicit permission message, and a permission-denied build still
  fires the cluster-Ready transition.
- Resource-stream permissions (`backend/refresh/resourcestream/projection_descriptors.go`,
  primary/related resources per descriptor) match the snapshot runtime
  permission contract.
- Discovery-backed custom-resource streams check list and watch at each exact
  informer namespace; denied namespaces start no informer while permitted ones
  keep providing partial change signals.
- Frontend handling of typed denials (stamp, settle, stream block, latch
  release): [fail-fast contract](namespace-scope.md#fail-fast-contract-for-denied-domains).

### Revalidation

- Revalidation compares both allowed and denied decisions against the exact
  scopes used to build the generation. Denied decisions share the normal cache
  so restored grants are detected.
- Revocation and restoration delegate replacement to `RefreshCoordinator`; the
  revalidator never stops a still-routed subsystem. A failed replacement leaves
  the old generation serving and revalidating.
- Background revalidation skips a busy cluster instead of canceling its
  foreground operation; client reconstruction receives the operation
  cancellation context.
- An unchanged construction error is logged and captured once per failing stage
  per generation; recovery rearms that stage, and a changed error reports
  immediately. Report suppression never suppresses rebuild attempts.
- After successful publication, `cluster:permissions:changed` clears only that
  cluster's frontend denial and stream latches; it does not change
  namespace-scope revisions.

## UI Permission Rules

- `QueryPermissions` is the backend query surface. UI action permissions use
  frontend capability descriptors plus `QueryPermissions`; no ad hoc
  per-component permission calls.
- `ResourceGateway` (`backend/resource_gateway_permissions.go`,
  `backend/response_cache_permissions.go`) owns UI permission evaluation, its
  cluster-scoped SSRR caches, and permission-aware validation of cached
  responses. It reads the injected `PermissionFetchPolicy` and never reads
  settings or acquires a refresh/subsystem lock.
- `PermissionFetchPolicy` (`backend/runtime_setting_policies.go`) owns
  process-wide SSRR fan-out concurrency: backend default at start, then one-way
  pushes from successful preference load, startup fallback, update, and import.
  Permission code never reaches back into `PreferencesService`.
- Permission and mutation checks resolve exact GVK/GVR through the object
  catalog in the request's cluster-scoped dependencies (injected
  `ResourceResolver`); never guess `resource` from kind. Refresh permission
  state is not a shortcut for request-time mutation checks.
- Capability query types and rule matching: `backend/capabilities`. Frontend
  permission store, specs, hooks, and feature labels:
  `frontend/src/core/capabilities`. Specs and diagnostics filters use stable
  `PERMISSION_FEATURES` keys, never display labels.
- Permission caches and diagnostics stay cluster-scoped. A cached permission
  may serve several features. Diagnostics matches static permission-spec
  membership at the same scope as well as the last query's feature, so one
  feature's query cannot hide a shared grant from another. The
  row takes the matching view feature's label without changing the cached
  query's provenance; unfiltered views keep the cached feature.
- Telemetry-bound capability summaries and breadcrumbs may include structural
  group/version, resource, verb, and scope type, never the caller-supplied
  permission key, raw namespace, or object name; timing metrics aggregate by
  scope type.

## Object Actions

- Action IDs, labels, backend action names, payload requirements, permission
  templates, and kind eligibility are backend-authored: catalog in
  `backend/objectaction`, per-kind eligibility from
  `backend/kind/kindspec.Descriptor` aggregated through `backend/kind/kindregistry`.
  `go generate ./backend` writes
  `frontend/src/shared/actions/objectActions.generated.ts`. Change the source
  and regenerate; never add a frontend action matrix.
- `frontend/src/shared/actions/objectActionPolicy.ts`
  (`resolveObjectActionPolicy`) projects the generated data for contract,
  policy, and port-forward helpers. Every UI-visible mutating action appears
  there, including derived ids that reuse one backend mutation (fixed-replica
  scale variants), and exposes denied/pending reasons.
- `RunObjectAction` is the execution chokepoint. The generated manifest
  coordinates presentation and request shape; it replaces no evaluator.
