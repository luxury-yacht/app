---
name: app-shell
description: Work on settings, command palette, sidebar, shortcuts, modals, dockable panels, favorites, global navigation, persistence, and visual shell tests
---

# App Shell

Read only the contracts the change selects; follow further links when the
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
| Native windows, chrome, menus, startup, quit, or Factory Reset | [application-lifecycle](../../../docs/architecture/application-lifecycle.md) |
| File placement or shared popup infrastructure | [component-structure](../../../docs/frontend/component-structure.md) |

## Entry points

- Frontend: `frontend/src/ui/{settings,command-palette,shortcuts,navigation,layout,dockable,modals,favorites}`,
  `frontend/src/core/{settings,app-state-access}`,
  `frontend/src/shared/components/{modals,tabs}`
- Backend: `backend/{preferences_service,preferences_settings,runtime_setting_policies,data_management_coordinator,desktop_shell,favorites_service,ui_state_store}.go`

## Checks

- Keep labels, icons, categories, and command-palette entries aligned where
  they represent the same action.
- Shortcuts, modals, and panels: exercise the affected focus, dismissal,
  selection, close, drag/drop, and identity contracts.
- Reuse shared CSS/tokens.

Focused checks while iterating; use browser or Storybook validation for visual
behavior:

```sh
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- settings command-palette shortcuts modals dockable favorites
```
