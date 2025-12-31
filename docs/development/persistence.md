# Persistence storage

This document summarizes how Luxury Yacht stores durable settings and UI state
after the persistence refactor. The backend is the source of truth; the
frontend reads and writes via Wails APIs.

## Storage locations

Persistence files live under the user config directory with a fixed folder
name:

- Base directory: `os.UserConfigDir()` + `luxury-yacht`
- Examples:
  - macOS: `~/Library/Application Support/luxury-yacht`
  - Windows: `%APPDATA%\\luxury-yacht`
  - Linux: `~/.config/luxury-yacht`

## Files and schemas

### settings.json

Lower-churn preferences and core UI state.

- `schemaVersion`: current schema version.
- `updatedAt`: last write timestamp (UTC).
- `preferences`:
  - `theme`: `light`, `dark`, or `system`
  - `useShortResourceNames`: boolean
  - `refresh`: `{ auto, background }`
  - `gridTablePersistenceMode`: `shared` or `namespaced`
- `kubeconfig`:
  - `selected`: array of `path:context`
  - `active`: `path:context`
- `ui`:
  - `window`: `{ x, y, width, height, maximized }`
  - `lastView`: string or null

### persistence.json

Higher-churn UI state.

- `schemaVersion`: current schema version.
- `updatedAt`: last write timestamp (UTC).
- `clusterTabs.order`: ordered list of `path:context`.
- `tables.gridtable.v1`: map keyed by GridTable storage keys
  (`gridtable:v1:<clusterHash>:<viewId>[:namespace]`) with versioned payloads.

## Backend behavior

- Reads and writes are atomic (temp file + rename). On Windows, the existing
  target is removed before rename to avoid replace errors.
- Load helpers normalize missing fields to defaults.
- The backend persists settings via Wails methods (theme, refresh toggles, grid
  table mode, kubeconfig selection, window metrics).
- UI persistence is stored via Wails methods:
  - Cluster tab order: `GetClusterTabOrder`/`SetClusterTabOrder`
  - GridTable state: `GetGridTablePersistence`, `SetGridTablePersistence`,
    `DeleteGridTablePersistence`, `DeleteGridTablePersistenceEntries`,
    `ClearGridTablePersistence`

## Frontend behavior

- `frontend/src/core/settings/appPreferences.ts` maintains the in-memory
  preference cache and syncs updates to the backend.
- GridTable persistence and cluster tab order are hydrated from the backend and
  cached in memory.
- Legacy localStorage reads remain only for migration hydration, not for
  durable writes.

## Legacy migration

Migration happens on startup when legacy stores exist.

### Legacy sources

- Backend files:
  - `window-settings.json`
  - `app-preferences.json`
- Frontend localStorage keys:
  - `app-theme-preference`
  - `useShortResourceNames`
  - `autoRefreshEnabled`
  - `refreshBackgroundClustersEnabled`
  - `gridtable:persistenceMode`
  - `clusterTabs:order`
  - `gridtable:v1:*`

### Rules

- Backend values from `app-preferences.json` win when present.
- localStorage values are only applied if backend values are still defaults.
- `clusterTabs.order` is converted to full `path:context` entries and skips
  ambiguous or missing matches.
- Legacy stores are deleted only after a successful migration.

### Logging

All migration activity is written to Application Logs under the `Migration`
source, including:

- Which legacy files were detected.
- Which fields were applied.
- GridTable persistence import counts.
- Which legacy files were deleted.

## Reset App State

The Settings UI includes a "Clear All State" action that deletes:

- `settings.json` and `persistence.json`
- Legacy `window-settings.json` and `app-preferences.json`
- App-specific browser storage (localStorage/sessionStorage and GridTable keys)

The app then reloads to start from a clean state.
