---
name: object-panel
description: Work on Luxury Yacht object-panel details, YAML, actions, logs, shell/debug tabs, docked panels, related objects, and tests
---

# Object Panel

Use this when touching object detail panels, overview/detail tabs, YAML
read/apply/edit flows, related objects, logs, shell/debug tabs, Helm content,
object actions, panel docking, or object-panel tests.

## Core Contracts

Read:

1. `AGENTS.md`
2. `backend/AGENTS.md` for backend detail/action changes
3. `frontend/AGENTS.md` for frontend panel changes
4. `docs/frontend/dockable-panels.md`
5. `docs/architecture/shared-resource-model.md` for identity, status, links,
   facts, or lifecycle
6. `docs/architecture/data-access.md` for frontend reads
7. Workflow docs for the specific tab: `docs/workflows/logs/overview.md`,
   `docs/workflows/shell-debug.md`, or `docs/workflows/object-map.md`

## Backend Entry Points

- `backend/object_detail_provider.go`
- `backend/resources`
- `backend/resources/types`
- `backend/object_yaml*.go`
- `backend/resources/pods/logs.go`
- `backend/resources/nodes/logs.go`
- `backend/resources/pods/debug.go`
- `backend/shell_sessions.go`

Backend object-panel work must keep requests cluster-scoped and use complete
GVK/object identity. Rich detail and imperative operations belong in
`backend/resources`; list/table snapshot payloads belong in
`backend/refresh/snapshot`.

## Frontend Entry Points

- `frontend/src/modules/object-panel`
- `frontend/src/modules/object-panel/components/ObjectPanel`
- `frontend/src/modules/object-panel/components/ObjectPanel/Logs`
- `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs`
- `frontend/src/modules/object-panel/hooks`
- `frontend/src/ui/dockable`
- `frontend/src/shared/components/modals`
- `frontend/wailsjs/go/models.ts` when Go DTOs change

Frontend object-panel work must use backend-provided `statusPresentation` and
`ResourceLink.ref` where available. Do not reconstruct object identity from kind
and name when a full backend reference should be carried.

Log viewer presentation shared by container logs and node logs lives under
`frontend/src/modules/object-panel/components/ObjectPanel/Logs`. Keep
transport-specific wiring in the container or node shell, and put shared search,
CSV export, parsed JSON, ANSI rendering, scroll restoration, and terminal theme
behavior in the shared log viewer utilities/components.

## Checklist

- [ ] Object references include `clusterId`, `group`, `version`, `kind`, and
      namespace/name for concrete objects.
- [ ] Backend DTO changes are reflected in frontend bindings/types.
- [ ] Status rendering uses backend presentation fields.
- [ ] Actions and tabs respect permissions/capabilities and surface denial
      reasons where applicable.
- [ ] Docked panel state, refresh behavior, and cluster/namespace changes remain
      consistent.
- [ ] Tests cover the changed tab, action, or identity flow.
- [ ] Non-doc changes pass `mage qc:prerelease`.

## Validation

Use focused checks while iterating:

```sh
go test ./backend ./backend/resources/...
npm run typecheck --prefix frontend
npm run test --prefix frontend -- object-panel
```

Then run `mage qc:prerelease` for non-documentation changes.
