# Application Storage

## Goal

- Consolidate settings and persistence data into a cross-platform, backup-friendly store.

## Proposed Direction

- Move durable preferences and UI persistence into the backend using `os.UserConfigDir()` for cross-platform storage.
- Keep only truly disposable items in `os.UserCacheDir()` (or keep them in-memory) to avoid polluting backups.
- Use a schema-versioned JSON store (split files) with clear sections:
  - preferences (theme, refresh toggles, short names)
  - ui (window size/position, last view)
  - tables (GridTable column/filters)
  - clusterTabs (ordering)
- Treat the backend store as the source of truth. Frontend should stop using `localStorage` for durable data.
- Expose Wails APIs: `GetSettings`, `UpdateSettings`, `ExportSettings`, `ImportSettings`.
- Write settings atomically (temp file + rename) and include migration helpers for schema upgrades.
  - On Windows, ensure atomic replacement handles existing files (remove target before rename or equivalent).

## Persistence Storage Proposal

### Location

- Base directory: `os.UserConfigDir()` + `luxury-yacht`
- Example paths:
  - macOS: `~/Library/Application Support/luxury-yacht`
  - Windows: `%APPDATA%\\luxury-yacht`
  - Linux: `~/.config/luxury-yacht`
- Config directory name is fixed as `luxury-yacht`.

### Files

- `settings.json` for lower-churn preferences and core UI state.
- `persistence.json` for higher-churn view state (GridTable, tab order).
- Backup/export uses a single JSON payload; internal storage stays split.

### Organization

- `settings.json`
  - `preferences`: theme, short names, refresh toggles, GridTable persistence mode
  - `kubeconfig`: selected list + active selection
  - `ui`: window position/size/maximized and `lastView`
- `persistence.json`
  - `clusterTabs`: ordering
  - `tables.gridtable.v1`: map keyed by the current GridTable storage key

### Backup/Restore Handling (Split Files)

- Backup: read `settings.json` and `persistence.json`, embed as separate top-level sections (`settings`, `persistence`) in a single JSON backup payload.
- Restore: parse the backup payload and fully overwrite each file when its section is present.

### Schema (draft)

```json
{
  "schemaVersion": 1,
  "updatedAt": "2024-01-01T12:34:56Z",
  "preferences": {
    "theme": "system",
    "useShortResourceNames": false,
    "refresh": { "auto": true, "background": true },
    "gridTablePersistenceMode": "shared"
  },
  "kubeconfig": {
    "selected": ["path:context"],
    "active": "path:context"
  },
  "ui": {
    "window": { "x": 0, "y": 0, "width": 1200, "height": 800, "maximized": false },
    "lastView": null
  }
}
```

```json
{
  "schemaVersion": 1,
  "updatedAt": "2024-01-01T12:34:56Z",
  "clusterTabs": {
    "order": ["/path/to/config:prod", "/path/to/other:dev"]
  },
  "tables": {
    "gridtable": {
      "v1": {
        "gridtable:v1:abc123:cluster-nodes": {
          "version": 1,
          "columnVisibility": {},
          "columnWidths": {},
          "sort": { "key": "name", "direction": "asc" },
          "filters": {}
        }
      }
    }
  }
}
```

## Phased Implementation Plan

### Phase 0: Reset App State (Failsafe)
- Add a Settings button labeled "Reset App State" that clears all app persistence.
- Backend should delete new config files (`settings.json`, `persistence.json`) and legacy files (`window-settings.json`, `app-preferences.json`).
- Frontend should clear app-specific browser storage (localStorage, sessionStorage, GridTable persistence keys).
- This must run before migration work so users can recover from failed or partial migrations.

### Phase 1: Storage & Schema Foundation
- Add backend settings store in `os.UserConfigDir()/luxury-yacht` with atomic read/write helpers.
- Define `settings.json` and `persistence.json` structs with `schemaVersion` and `updatedAt`.
- Wire load/save for window settings + core preferences into the new store.

### Phase 2: Migration (Legacy -> New)
- Execute the one-time migration plan to import legacy backend files and frontend `localStorage`.
- Delete legacy stores only after successful migration.

### Phase 3: Frontend Settings Migration
- Replace `localStorage` usage for theme, short names, refresh toggles, and GridTable persistence mode with backend APIs.
- Keep in-memory caching where needed, but treat backend as source of truth.

### Phase 4: UI Persistence Migration
- Move GridTable persistence and cluster tab ordering into `persistence.json`.
- Ensure `clusterTabs.order` uses full `path:context` selections.
- Keep cleanup logic to prune stale entries after restore or config changes.

### Phase 5: Backup/Restore (Secondary)
- Implement export/import to/from a single JSON payload containing `settings` + `persistence`.
- Restore overwrites each file section when present.
- Default filename: `luxury-yacht-backup-yyyymmddhhmmss.json` (local time).

### Phase 6: Hardening & Tests
- Add tests for store read/write, schema validation, and overwrite semantics.
- Verify frontend settings hydration and persistence round-trips.

## Migration Plan (Old Stores -> New Stores)

### Source Stores
- Backend files: `window-settings.json`, `app-preferences.json` (current location under `~/.config/luxury-yacht`).
- Frontend `localStorage` keys:
  - `app-theme-preference`
  - `useShortResourceNames`
  - `autoRefreshEnabled`
  - `refreshBackgroundClustersEnabled`
  - `gridtable:persistenceMode`
  - `clusterTabs:order`
  - `gridtable:v1:*` (all GridTable persisted view keys)

### One-Time Migration Trigger
- Run on startup when legacy stores exist.
- Backend migrates old backend files directly.
- Frontend reads `localStorage` and sends a single migration payload to the backend via a new Wails API (e.g., `MigrateLegacyStorage`).
  - Legacy lookup should include the previous `~/.config/luxury-yacht` path on all OSes (Windows included).

### Conflict Resolution
- Prefer `app-preferences.json` values when present.
- Fall back to `localStorage` when backend values are missing.
- Defaults apply when neither store provides a value.

### Mapping (Legacy -> New)
- `app-preferences.json`:
  - `theme` -> `settings.json.preferences.theme`
  - `useShortResourceNames` -> `settings.json.preferences.useShortResourceNames`
  - `selectedKubeconfig` / `selectedKubeconfigs` -> `settings.json.kubeconfig`
- `window-settings.json` -> `settings.json.ui.window`
- `localStorage`:
  - `app-theme-preference` -> `settings.json.preferences.theme` (only if backend value missing)
  - `autoRefreshEnabled` -> `settings.json.preferences.refresh.auto`
  - `refreshBackgroundClustersEnabled` -> `settings.json.preferences.refresh.background`
  - `gridtable:persistenceMode` -> `settings.json.preferences.gridTablePersistenceMode`
  - `useShortResourceNames` -> `settings.json.preferences.useShortResourceNames` (only if backend value missing)
  - `clusterTabs:order` -> `persistence.json.clusterTabs.order` by resolving legacy `filename:context` IDs to full `path:context` selections; skip entries that do not resolve uniquely
  - `gridtable:v1:*` -> `persistence.json.tables.gridtable.v1`

### Deleting Old Stores (After Successful Migration)
- Remove `window-settings.json` and `app-preferences.json`.
- Clear legacy `localStorage` keys listed above.

### Failure Handling
- If migration fails, leave old stores intact and retry on next startup.
