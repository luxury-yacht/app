---
name: permissions-capabilities
description: Work on Luxury Yacht RBAC permission checks, capability descriptors, permission-denied diagnostics, object action availability, YAML/edit/delete/scale/restart gating, and capability tests
---

# Permissions And Capabilities

Use this when touching backend RBAC checks, capability services, permission
diagnostics, frontend capability hooks, object action availability, YAML/edit
gating, delete/scale/restart/trigger/suspend actions, or restricted-RBAC tests.

## Read First

1. `AGENTS.md`
2. `backend/AGENTS.md`
3. `frontend/AGENTS.md`
4. `docs/architecture/permissions.md`
5. `docs/architecture/shared-resource-model.md` for object identity and refs
6. `docs/architecture/refresh-system.md` for permission-denied domains and
   diagnostics

## Backend Entry Points

- `backend/capabilities`
- `backend/resource_permission.go`
- `backend/refresh/permissions/resource_requirement.go`
- `backend/refresh/snapshot/permission_checks.go`
- `backend/refresh/snapshot/permission.go`
- `backend/refresh/resourcestream/permission_contract.go`
- `backend/refresh/system/registrations.go`
- `backend/refresh/system/permission_gate.go`
- Backend operation/action services under `backend/resources`, `backend/object_yaml*.go`,
  `backend/portforward*.go`, and `backend/shell_sessions.go`

## Frontend Entry Points

- `frontend/src/core/capabilities`
- `frontend/src/core/capabilities/permissionFeatures.ts`
- `frontend/src/shared/actions/objectActionPermissionMatrix.ts`
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
- [ ] Resource-stream permission contracts stay aligned with snapshot runtime
      permission requirements.
- [ ] Permission specs and diagnostics filters use stable
      `PERMISSION_FEATURES` keys, not display labels.
- [ ] Frontend action availability mirrors backend capability rules and exposes
      denied/pending reasons.
- [ ] UI-visible mutating actions are represented in
      `OBJECT_ACTION_PERMISSION_MATRIX`.
      Include derived action ids that reuse the same backend mutation, such as
      fixed-replica scale variants.
- [ ] Permission-denied refresh domains remain visible in diagnostics.
- [ ] Restricted-RBAC behavior degrades visibly instead of silently hiding
      broken domains or actions.
- [ ] Tests cover allowed, denied, and resolution-error cases.
- [ ] Non-doc changes pass `mage qc:prerelease`.

## Validation

Use focused checks while iterating:

```sh
go test ./backend/capabilities ./backend/refresh/snapshot ./backend/refresh/system ./backend
npm run typecheck --prefix frontend
npm run test --prefix frontend -- capabilities ObjectPanel ActionsMenu diagnostics
```

Then run `mage qc:prerelease` for non-documentation changes.
