---
name: permissions-capabilities
description: Work on Luxury Yacht RBAC permission checks, capability descriptors, permission-denied diagnostics, object action availability, YAML/edit/delete/scale/restart gating, and capability tests
---

# Permissions And Capabilities

Use this when touching backend RBAC checks, capability services, permission
diagnostics, frontend capability hooks, object action availability, YAML/edit
gating, delete/scale/restart/trigger/suspend actions, or restricted-RBAC tests.

## Route context

Read only the contracts selected by the change. Follow further links when the
changed path crosses that boundary.

| Change | Read |
| --- | --- |
| RBAC checks, capability policy or denied actions | [permissions](../../../docs/architecture/permissions.md) |
| Object identity, reference construction or resolution | [shared-resource-model](../../../docs/architecture/shared-resource-model.md#identity) |
| Permission-denied domains, stream gates or readiness | [refresh-system](../../../docs/architecture/refresh-system.md#permission-and-readiness) |
| Permission diagnostic surfaces | [refresh-system](../../../docs/architecture/refresh-system.md#diagnostics-surfaces) |

## Backend Entry Points

- `backend/capabilities`
- `backend/resource_gateway.go`
- `backend/runtime_setting_policies.go` (`PermissionFetchPolicy`)
- `backend/resource_permission.go`
- `backend/refresh/permissions/resource_requirement.go`
- `backend/refresh/snapshot/permission.go`
- `backend/refresh/resourcestream/projection_descriptors.go` for stream
  permission resources (primary/related resources per descriptor)
- `backend/refresh/system/registrations.go`
- `backend/refresh/system/permission_gate.go`
- Backend operation/action services under `backend/resources`, `backend/object_yaml*.go`,
  `backend/portforward*.go`, and `backend/shell_sessions.go`

## Frontend Entry Points

- `frontend/src/core/capabilities`
- `frontend/src/core/capabilities/permissionFeatures.ts`
- `frontend/src/shared/actions/objectActionPolicy.ts`
- `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts`
- `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts`
- `frontend/src/shared/hooks/useObjectActions.tsx`
- `frontend/src/shared/components/kubernetes/ActionsMenu.tsx`
- `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts`

## Checklist

- [ ] Capability descriptors include `clusterId`, group, version, kind,
      namespace, and name when checking a concrete object.
- [ ] Do not guess `resource` from kind; use the injected catalog-backed
      `ResourceResolver` for GVK/GVR/scope resolution.
- [ ] Backend write/action paths check permission before mutating cluster state.
- [ ] `ResourceGateway` owns the cluster-scoped SSRR cache and reads only the
      injected `PermissionFetchPolicy`; permission code does not read
      Preferences or refresh state.
- [ ] Resource-stream permission contracts stay aligned with snapshot runtime
      permission requirements.
- [ ] Permission specs and diagnostics filters use stable
      `PERMISSION_FEATURES` keys, not display labels.
- [ ] Frontend action availability mirrors backend capability rules and exposes
      denied/pending reasons.
- [ ] UI-visible mutating actions are represented in
      `resolveObjectActionPolicy` / `ObjectActionPolicy`
      (`frontend/src/shared/actions/objectActionPolicy.ts`).
      Include derived action ids that reuse the same backend mutation, such as
      fixed-replica scale variants.
- [ ] Permission-denied refresh domains remain visible in diagnostics.
- [ ] Restricted-RBAC behavior degrades visibly instead of silently hiding
      broken domains or actions.
- [ ] Tests cover allowed, denied, and resolution-error cases.

## Validation

Use focused checks while iterating:

```sh
mise exec -- go test ./backend/capabilities ./backend/refresh/snapshot ./backend/refresh/system ./backend
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- capabilities ObjectPanel ActionsMenu diagnostics
```

Then follow the root final validation gate.
