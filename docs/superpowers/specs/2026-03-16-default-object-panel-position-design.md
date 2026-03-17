# Default Object Panel Position Setting

## Summary

Add a user-configurable setting for the default position of the Object Panel. The setting appears in Settings > Display as a dropdown with three options: Docked Right (default), Docked Bottom, and Floating. This applies only to the Object Panel — App Logs, Diagnostics, and other panels are unaffected.

## Motivation

The Object Panel currently defaults to the right sidebar, with runtime behavior that follows the last-focused panel group. Users who prefer a different default layout must manually reposition the panel each session. A persistent setting removes that friction.

## Design

### Backend

**Types** (`backend/resources/types/types.go`):
- Add `DefaultObjectPanelPosition string` to `AppSettings`. Valid values: `"right"`, `"bottom"`, `"floating"`. Default: `"right"`.

**Settings storage** (`backend/app_settings.go`):
- Add `DefaultObjectPanelPosition string` to `settingsPreferences`.
- Add setter `SetDefaultObjectPanelPosition(position string) error` with validation.
- Set default to `"right"` in both `defaultSettingsFile()` and `normalizeSettingsFile()`.
- Wire the field through `loadAppSettings()` (read from file into `a.appSettings`), `saveAppSettings()` (write back from `a.appSettings` to file), and `GetAppSettings()` (return to frontend).

### Frontend — Preferences Layer

**`frontend/src/core/settings/appPreferences.ts`**:
- Add `defaultObjectPanelPosition: 'right' | 'bottom' | 'floating'` to `AppPreferences`, `AppSettingsPayload`, and `DEFAULT_PREFERENCES` (default `'right'`).
- Add hydration mapping in `hydrateAppPreferences()`.
- Add `getDefaultObjectPanelPosition()` getter and `setDefaultObjectPanelPosition()` synchronous setter with fire-and-forget persistence (matching `setGridTablePersistenceMode` pattern).

### Frontend — Settings UI

**`frontend/src/ui/settings/Settings.tsx`**:
- Add a dropdown to the Display section with label "Default Object Panel position" and options: Docked Right, Docked Bottom, Floating.
- Follow the same styling pattern as the Grid Table persistence mode selector.

### Frontend — ObjectPanel Consumer

**`frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx`**:
- Replace the hardcoded `'right'` fallback in `getPreferredOpenGroupKey('right')` with `getDefaultObjectPanelPosition()`.
- Behavior: if the user hasn't interacted with any panel group yet, object panels open at the configured default. Once they move a panel during the session, the last-focused group takes priority (existing behavior preserved).

### Scope Exclusion

App Logs and Diagnostics panels keep their current default positioning logic and are not affected by this setting.

## Files Changed

| File | Change |
|------|--------|
| `backend/resources/types/types.go` | Add field to `AppSettings` |
| `backend/app_settings.go` | Add to `settingsPreferences`, setter, `defaultSettingsFile()`, `normalizeSettingsFile()`, `loadAppSettings()`, `saveAppSettings()` |
| `frontend/src/core/settings/appPreferences.ts` | Add to `AppPreferences`, `AppSettingsPayload`, `DEFAULT_PREFERENCES`, hydration, getter, setter |
| `frontend/src/ui/settings/Settings.tsx` | Add dropdown in Display section |
| `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx` | Use preference as fallback position |
| `frontend/wailsjs/go/backend/App.{d.ts,js}` | Auto-generated Wails bindings (after `wails generate module`) |

## Testing

- Backend: unit test for `SetDefaultObjectPanelPosition` validation (rejects invalid values, accepts valid ones).
- Frontend: test that the Settings UI renders the dropdown and calls the setter on change.
- Frontend: test that ObjectPanel passes the preference value as the fallback to `getPreferredOpenGroupKey`.
