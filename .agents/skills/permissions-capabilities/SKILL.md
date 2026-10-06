---
name: permissions-capabilities
description: Work on Luxury Yacht RBAC permission checks, capability descriptors, permission-denied diagnostics, object action availability, YAML/edit/delete/scale/restart gating, and capability tests
---

# Permissions And Capabilities

Use this when touching backend RBAC checks, capability services, permission
diagnostics, frontend capability hooks, object action availability, YAML/edit
gating, delete/scale/restart/trigger/suspend actions, or restricted-RBAC tests.

## Task routes

Read only the contracts selected by the change. Follow further links when the
changed path crosses that boundary.

| Change | Read |
| --- | --- |
| RBAC checks, capability policy, object actions, denied actions | [permissions](../../../docs/architecture/permissions.md) |
| Object identity, reference construction or resolution | [shared-resource-model](../../../docs/architecture/shared-resource-model.md#identity) |
| Permission-denied domains, stream gates or readiness | [refresh-system](../../../docs/architecture/refresh-system.md#permission-and-readiness), [fail-fast contract](../../../docs/architecture/namespace-scope.md#fail-fast-contract-for-denied-domains) |
| Namespace-scoped identities, check scope vs source scope | [namespace-scope](../../../docs/architecture/namespace-scope.md#the-source-scope-rule) |
| Permission diagnostic surfaces | [refresh-system](../../../docs/architecture/refresh-system.md#diagnostics-surfaces) |

## Entry Points

- Backend: `backend/capabilities`, `backend/resource_gateway.go`,
  `backend/resource_permission.go`, `backend/runtime_setting_policies.go`
  (`PermissionFetchPolicy`), `backend/refresh/permissions/resource_requirement.go`,
  `backend/refresh/snapshot/permission.go`,
  `backend/refresh/system/registrations.go`,
  `backend/refresh/system/permission_gate.go`,
  `backend/refresh/resourcestream/projection_descriptors.go`.
- Backend action/operation services: `backend/resources`,
  `backend/object_yaml*.go`, `backend/portforward*.go`,
  `backend/shell_sessions.go`.
- Frontend: `frontend/src/core/capabilities` (incl. `permissionFeatures.ts`),
  `frontend/src/shared/actions/objectActionPolicy.ts`,
  `frontend/src/shared/hooks/useObjectActions.tsx`,
  `frontend/src/shared/components/kubernetes/ActionsMenu.tsx`,
  `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts`,
  `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts`,
  `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts`.

## Procedure

- Name which evaluator the change touches (refresh domain, UI capability,
  backend mutation, or several) before editing; each has its own cache and
  failure behavior.
- For multi-resource domains, decide all-or-nothing versus partial data
  explicitly.
- Restricted-RBAC behavior degrades visibly, never silently hiding domains or
  actions; a restricted kind cluster is in
  [kind-clusters](../../../docs/workflows/kind-clusters.md#restricted-access).

## Validation

Use focused checks while iterating:

```sh
mise exec -- go test ./backend/capabilities ./backend/refresh/snapshot ./backend/refresh/system ./backend
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- capabilities ObjectPanel ActionsMenu diagnostics
```
