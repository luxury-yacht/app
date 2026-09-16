---
name: app-shell
description: Work on settings, command palette, sidebar, shortcuts, modals, dockable panels, favorites, global navigation, persistence, and visual shell tests
---

# App Shell

Use this when touching settings, preferences, command palette, sidebar,
shortcuts, global navigation, modals, overlays, dockable panels, favorites,
saved views, app-shell persistence, or visual shell tests.

## Route context

Read only the contracts selected by the change. Follow further links when the
changed path crosses that boundary.

| Change | Read |
| --- | --- |
| Settings schema, preferences, persistence, rollback, runtime effects | [app-preferences](../../../docs/architecture/app-preferences.md) |
| Command palette, shortcuts, focus | [keyboard](../../../docs/frontend/keyboard.md) |
| Sidebar or global/per-cluster navigation | [navigation](../../../docs/frontend/navigation.md) |
| Blocking modals | [modals](../../../docs/frontend/modals.md) |
| Tabs or tab dragging | [tabs](../../../docs/frontend/tabs.md) |
| Docked/floating panels or handoffs | [dockable-panels](../../../docs/frontend/dockable-panels.md) |
| Favorites or saved table state | [gridtable-filtering](../../../docs/frontend/gridtable-filtering.md#favorite-snapshots) |
| App-state reads or backend-call ownership | [data-access](../../../docs/architecture/data-access.md) |
| Native windows, process UI, startup or shutdown | [application-lifecycle](../../../docs/architecture/application-lifecycle.md) |
| File placement or shared popup infrastructure | [component-structure](../../../docs/frontend/component-structure.md) |

## Entry Points

- `frontend/src/ui/settings`
- `frontend/src/core/settings`
- `frontend/src/core/app-state-access`
- `backend/preferences_service.go`
- `backend/preferences_settings.go`
- `backend/runtime_setting_policies.go`
- `backend/data_management_coordinator.go`
- `backend/desktop_shell.go`
- `backend/favorites_service.go`
- `backend/ui_state_store.go`
- `frontend/src/ui/command-palette`
- `frontend/src/ui/shortcuts`
- `frontend/src/ui/navigation`
- `frontend/src/ui/layout`
- `frontend/src/ui/dockable`
- `frontend/src/ui/modals`
- `frontend/src/ui/favorites`
- `frontend/src/shared/components/modals`
- `frontend/src/shared/components/tabs`

## Checklist

Apply the checks for the changed surface:

- Keep labels, icons, categories, and command-palette entries aligned where
  they represent the same action.
- Preserve cluster/namespace identity in state and persistence keys where the
  state represents cluster data.
- For settings, use the schema, mutation, rollback, and binding checks in
  `docs/architecture/app-preferences.md`.
- For shortcuts, modals, and panels, exercise the affected focus, dismissal,
  selection, close, drag/drop, and identity contracts.
- Reuse shared CSS/tokens and test the changed interaction or persistence path.

## Validation

Select focused checks for the changed surface while iterating:

```sh
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- settings command-palette shortcuts modals dockable favorites
```

Use browser or Storybook validation for visual behavior, then follow the root
final validation gate.
