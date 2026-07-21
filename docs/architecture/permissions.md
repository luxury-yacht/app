# Permissions Contract

Permissions gate refresh domains, UI actions, and backend mutations. These paths
share identity rules, but they are separate evaluators because their cache
shape, failure behavior, and diagnostics differ.

## Agent Contract

- Permission checks for concrete objects must carry `clusterId`, `group`,
  `version`, `kind`, namespace when namespaced, name when concrete, verb, and
  subresource when applicable.
- Backend mutation checks remain the final authority before changing cluster
  state.
- Refresh-domain permission contracts live with the refresh subsystem and must
  align with domain registration, stream requirements, and diagnostics.
- UI action permissions use frontend capability descriptors plus backend
  `QueryPermissions`; do not add ad hoc per-component permission calls.
- Object-action IDs, labels, backend action names, payload requirements,
  permission templates, and kind eligibility are backend-authored. Change the
  catalog/descriptor source and regenerate; do not add a frontend action matrix.
- Cluster-scoped resources must not be authorized from namespace-only SSRR data
  when that can produce false positives.
- Multi-resource refresh domains should degrade to partial data when useful,
  instead of blocking the whole domain because one resource is denied.
- Permission-denied state is data. Surface it clearly; do not hide missing data
  as empty successful results.

## Evaluators

| Evaluator | Purpose |
| --- | --- |
| Refresh-domain permissions | Decide whether backend domains can list/watch/build data |
| UI permission/capability reads | Gate visible actions, controls, and diagnostics |
| Backend mutation checks | Final write/operation authorization |

## Refresh Permission Rules

- Runtime policies live in `backend/refresh/domainpermissions`.
- Startup registration and permission-denied placeholders live in
  `backend/refresh/system` and `backend/refresh/snapshot`.
- Use all-or-nothing mode for single-resource domains.
- Use partial-data mode for multi-resource domains where showing permitted
  resources is useful.
- Some domains are deliberately fail-fast with NO degraded fallback: the
  `namespaces` domain registers permission-denied when the user cannot list
  namespaces (the sidebar shows an explicit permission message; there is no
  catalog-inference fallback, and a permission-denied namespaces build still
  fires the cluster-Ready transition).
- Partial-data builders must guard nil or missing listers before use.
- Resource-stream permissions must join with the corresponding snapshot runtime
  permission contract.

## UI Permission Rules

- `QueryPermissions` is the backend query surface for UI permissions.
- Frontend permission specs and feature labels live under
  `frontend/src/core/capabilities`.
- Visible object action wiring lives in
  `frontend/src/shared/actions/objectActionPolicy.ts`.
- The source catalog lives in `backend/objectaction`, with per-kind eligibility
  contributed by `backend/kind/kindspec.Descriptor`. `go generate ./backend`
  writes `frontend/src/shared/actions/objectActions.generated.ts`; frontend
  contract, policy, and port-forward helpers project that generated data.
- `RunObjectAction` remains the execution chokepoint and backend mutation
  permission checks remain authoritative. The generated manifest coordinates
  presentation and request shape; it does not replace any evaluator.
- Exact GVK/GVR resolution should go through the object catalog resolver.
- Permission cache and diagnostics must remain cluster-scoped.
- Refresh scopes denied by the backend (typed 403,
  `SnapshotPermissionDeniedError`) are checked ONCE per session: the scoped
  state is stamped `permissionDenied` and background refetches stop; only
  manual refresh re-asks and recovery is an app restart.

## Ownership

- Refresh permission checker: `backend/refresh/permissions`
- Refresh runtime policies: `backend/refresh/domainpermissions`
- Refresh registration gates: `backend/refresh/system/registrations.go`
- UI permission endpoint: `backend/app_permissions.go`
- Capability query types and rule matching: `backend/capabilities`
- Frontend permission store/specs/hooks: `frontend/src/core/capabilities`
- Object-action catalog: `backend/objectaction`
- Per-kind action eligibility: `backend/kind/kindspec`, aggregated through
  `backend/kind/kindregistry`
- Generated frontend action contract:
  `frontend/src/shared/actions/objectActions.generated.ts`
- Frontend action policy projection:
  `frontend/src/shared/actions/objectActionPolicy.ts`

## Change Checklist

When changing permissions:

1. Identify whether the change affects refresh, UI action availability, backend
   mutation checks, or more than one.
2. Preserve full cluster and GVK identity in every query.
3. For multi-resource domains, decide all-or-nothing versus partial data.
4. Keep permission-denied diagnostics aligned with user-visible state.
5. Add parity tests when descriptor catalogs, action matrices, and backend
   checks must stay aligned.

## Validation

Run focused permission/capability tests for the changed evaluator and affected
frontend action tests. For non-documentation work, finish with
`mage qc:prerelease`.
