---
name: object-panel
description: Work on Luxury Yacht object-panel details, YAML, actions, logs, shell/debug tabs, docked panels, related objects, and tests
---

# Object Panel

Use this when touching object detail panels, overview/detail tabs, YAML
read/apply/edit flows, related objects, logs, shell/debug tabs, Helm content,
object actions, panel docking, or object-panel tests.

## Task routes

Read only the contracts selected by the change. Follow further links when the
changed path crosses that boundary.

| Change | Read |
| --- | --- |
| Docking, placement, close, handoffs or panel lifetime | [dockable-panels](../../../docs/frontend/dockable-panels.md) |
| Overview descriptors or derived detail sections | [component-structure](../../../docs/frontend/component-structure.md#object-panel-overview-rendering-descriptor-driven) |
| Adding a kind's typed detail fetcher, Overview, or capabilities | [add-resource skill](../add-resource/SKILL.md) |
| YAML editor mechanics | [yaml-editor](../../../docs/frontend/yaml-editor.md) |
| YAML read, save, merge or field ownership | [yaml-editing](../../../docs/architecture/yaml-editing.md) |
| Object refs, status, facts, links, finalizer removal | [shared-resource-model](../../../docs/architecture/shared-resource-model.md); panel ref types under Frontend Reference Types |
| Frontend data reads | [data-access](../../../docs/architecture/data-access.md) |
| Resource Utilization | [resource-metrics](../../../docs/architecture/resource-metrics.md) |
| Object/header/table age display | [live-age](../../../docs/frontend/live-age.md) |
| Logs, shell/debug or map tab behavior | [logs overview](../../../docs/workflows/logs/overview.md) (shared viewer shell), [shell-debug](../../../docs/workflows/shell-debug.md), or [object-map](../../../docs/workflows/object-map.md) |

## Entry Points

- Backend: `backend/object_detail_provider.go`, `backend/resources`,
  `backend/resources/types`, `backend/object_yaml*.go`,
  `backend/resources/pods/{logs,debug}.go`, `backend/resources/nodes/logs.go`,
  `backend/shell_sessions.go`.
- Frontend: `frontend/src/modules/object-panel` (`components/ObjectPanel`, its
  `Logs` and `NodeLogs`, and `hooks`), `frontend/src/shared/components/yaml`,
  `frontend/src/core/resource-metrics`, `frontend/src/ui/dockable`,
  `frontend/src/shared/components/modals`, and
  `frontend/bindings/github.com/luxury-yacht/app/backend/models.ts` when Go DTOs
  change.

## Panel contracts

- Past `useObjectPanel.openWithObject`, panel-internal types (`openPanels`,
  `CurrentObjectPanelContext`, detail/utilization props) carry the
  cluster-complete `ObjectPanelRef` (`objectPanelRef.ts`); never re-widen them
  to the nullable shape.
- Object actions (delete, restart, scale, rollback, trigger, suspend,
  port-forward) run through the shared `useObjectActionController`
  (`frontend/src/shared/hooks`) rendered by `ActionsMenu`, the same controller
  the cluster/namespace tables and object map use. It owns execution,
  permission gating, and every action modal (confirm, scale, scale-to-zero,
  rollback, port-forward). The panel wrapper supplies only lifecycle callbacks
  (`onAfterDelete` closes the panel, `onAfterAction` refetches) plus the Node
  cordon/drain openers. Rejected: a panel-local action reducer, per-action prop
  drilling through `DetailsTab`, or bespoke action modals — they duplicate the
  shared controller.
- Single-document YAML viewing/editing uses
  `frontend/src/shared/components/yaml/YamlEditor`; never add another
  CodeMirror/search/context-menu stack inside a tab. Workflow state (refresh,
  object identity, permissions, save/cancel, reload/merge, drift, managedFields
  policy, post-save notices) stays in the object-panel wrapper.
- Container and node log viewers keep transport-specific wiring in their own
  shell and share everything else through the
  [shared viewer shell](../../../docs/workflows/logs/overview.md#shared-viewer-shell).
- Resource Utilization leases the base domain per
  [resource-metrics](../../../docs/architecture/resource-metrics.md);
  object-detail DTO values are fallback only while that domain loads, is
  unavailable, or is permission denied. ReplicaSets get no panel metrics until
  pod rows expose both direct and resolved owner identity. Embedded Pods tables
  use the same single base-domain query as main Pods tables (usage joined at
  serve; freshness from the query payload's `metrics`).
- Actions and tabs respect permissions/capabilities and surface denial reasons
  where applicable.

## Validation

Focused checks while iterating:

```sh
mise exec -- go test ./backend ./backend/resources/...
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- object-panel
```
