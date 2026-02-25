# Kubeconfig Directory Watcher Design

## Overview

Add a directory watcher to all kubeconfig search paths so kubeconfigs are refreshed without restarting the app. When files change in watched directories, the app re-discovers available kubeconfigs and reconnects affected clusters.

## Requirements

1. Watch all kubeconfig search path directories for file changes
2. On change: re-discover available kubeconfigs AND reconnect only the already-selected clusters whose kubeconfig files actually changed
3. New kubeconfig files appear in the available list only (not auto-connected)
4. Frontend gets notified via Wails event when available kubeconfigs change
5. If a selected kubeconfig file is deleted/renamed, deselect that cluster cleanly

## Approach

Use `github.com/fsnotify/fsnotify` for OS-level file system notifications with event debouncing.

## Architecture

### New File: `backend/kubeconfig_watcher.go`

**`watchedPath` struct:**
- `dir string` — directory to watch via fsnotify
- `filterFiles map[string]struct{}` — if non-empty, only these filenames within dir trigger events

**`kubeconfigWatcher` struct:**
- `watcher *fsnotify.Watcher` — the OS file system watcher
- `onChange func(changedPaths []string)` — callback with accumulated changed file paths
- `stopCh chan struct{}` — signals the event loop to exit
- `mu sync.Mutex` — protects watched paths list and file filters
- `watched []watchedPath` — currently watched paths
- `fileFilters map[string]map[string]struct{}` — maps dir to set of target filenames (supports multiple files per dir)

**Methods:**
- `newKubeconfigWatcher(app *App, onChange func([]string)) (*kubeconfigWatcher, error)` — creates and starts the watcher
- `updateWatchedPaths(paths []watchedPath) error` — replaces the watched path set, merging filter sets for duplicate dirs
- `stop()` — shuts down cleanly

### Concurrency Strategy

Three new mutexes on the `App` struct:

1. **`kubeconfigsMu sync.RWMutex`** — guards `availableKubeconfigs` and `selectedKubeconfigs` access:
   - Write lock: `discoverKubeconfigs()` (via `discoverKubeconfigsLocked()`), `SetSelectedKubeconfigs()` (selection write), `clearKubeconfigSelection()` (selection write), `deselectClusters()` (selection write)
   - Read lock: `GetKubeconfigs()`, `GetSelectedKubeconfigs()`, `normalizeKubeconfigSelection()`, `validateKubeconfigSelection()`, `clusterMetaForSelection()`

2. **`kubeconfigChangeMu sync.Mutex`** — serializes all operations that mutate cluster/subsystem state:
   - `handleKubeconfigChange()` (watcher callback)
   - `SetSelectedKubeconfigs()` (Wails RPC handler)
   - `SetKubeconfig("")` (legacy single-selection entry point that calls `clearKubeconfigSelection`)
   - `ClearAppState()` (reset entry point that calls `clearKubeconfigSelection`)
   - Auth recovery in `handleClusterAuthStateChange()` (wraps `rebuildClusterSubsystem` and `teardownClusterSubsystem` goroutines)
   - Transport recovery in `runClusterTransportRebuild()` (wraps `rebuildClusterSubsystem` call)
   - `Shutdown()` is not covered by this mutex; it is a separate lifecycle path that stops the watcher/auth managers before teardown.

3. **`settingsMu sync.Mutex`** — guards `a.appSettings` access in the watcher/selection/settings flows touched by this work, plus theme-library settings.json read-modify-write paths that can clobber `appSettings`-backed fields:
   - **Caller-locking rule:** `loadAppSettings()` and `saveAppSettings()` never acquire `settingsMu` themselves — their callers always hold the lock.
   - `GetAppSettings()` — acquires lock, returns a **deep copy** of the `AppSettings` struct (copies `SelectedKubeconfigs` and `Themes` slices) so callers and Wails JSON marshalling never hold a reference to the shared mutable struct.
   - All settings RPC methods (`SetTheme`, `SetAutoRefreshEnabled`, etc.) — acquire lock, mutate field, call `saveAppSettings()`, release lock.
   - `SetSelectedKubeconfigs()`, `clearKubeconfigSelection()` — acquire lock around `appSettings.SelectedKubeconfigs` write + `saveAppSettings()`.
   - `deselectClusters()` — acquire lock around `appSettings.SelectedKubeconfigs` write + `saveAppSettings()` (from watcher background goroutine).
   - `ClearAppState()` — acquire lock around `a.appSettings = nil`.
   - `syncThemesCache()`, `ApplyTheme()` — acquire lock around `a.appSettings` field mutations.
   - `SaveTheme()`, `DeleteTheme()`, `ReorderThemes()` — acquire lock around loadSettingsFile → mutate → saveSettingsFile → `syncThemesCache()` so concurrent watcher selection saves do not overwrite theme changes (or vice versa).

**Lock ordering** (for paths that use these locks, always acquire in this order): `kubeconfigChangeMu` → `kubeconfigsMu` → `clusterClientsMu` → `settingsMu`

### Integration Points

- `App` struct gets `kubeconfigsMu`, `kubeconfigChangeMu`, `settingsMu`, and `kubeconfigWatcher` fields
- Started in `Startup()` AFTER `initKubernetesClient()` completes (prevents racing app startup)
- Updated in `SetKubeconfigSearchPaths()` when paths change
- Stopped in `Shutdown()` BEFORE `teardownRefreshSubsystem()`

### Data Flow

```
File change in ~/.kube/config
  → fsnotify event
  → filename filter check (for file-based search paths)
  → heuristic skip check (for directory-based search paths)
  → accumulate changed path in set
  → 500ms debounce timer resets
  → debounce fires
  → handleKubeconfigChange(changedPaths)
    → acquire kubeconfigChangeMu
    → match changedPaths against clusterClients[*].kubeconfigPath
    → identify only affected selected clusters
    → discoverKubeconfigs() (acquires kubeconfigsMu write lock)
    → for each affected cluster:
        → if path:context still in rediscovered availableKubeconfigs: teardown + rebuild
        → if missing from rediscovered list: directly inspect the file to confirm:
            → file missing: deselectClusters
            → file parses and context missing: deselectClusters
            → file temporarily unreadable/invalid: keep selection, wait for next event
            → file parses and context still exists: teardown + rebuild
    → (on successful rediscovery) emitEvent("kubeconfig:available-changed")
    → frontend cancel-handle listener calls loadKubeconfigs()
```

### Frontend Changes

`KubeconfigContext.tsx`: Add a Wails event listener for `kubeconfig:available-changed` that calls `loadKubeconfigs()`. Use only the cancel handle returned by `EventsOn` for cleanup — do NOT call `EventsOff` which would remove listeners from other components.

## Key Design Decisions

- **Reuse `rebuildClusterSubsystem`:** The existing auth recovery path already handles rebuilding clients from kubeconfig with fresh credentials. Avoids duplicating complex teardown/rebuild logic.
- **Debouncing (500ms):** Editors like vim write a temp file then rename, generating multiple events. Debounce collapses these into a single re-discovery.
- **Accumulated changed paths:** The debounce window collects specific file paths that changed, enabling precise cluster-to-file matching so only affected clusters are rebuilt.
- **Watch directories + file-based paths:** Directory search paths watch the entire directory. File-based search paths watch the parent directory with a filename filter. Multiple file filters per directory are supported via `map[string]map[string]struct{}`.
- **Non-existent file paths still watched:** If a file-based search path doesn't exist yet but its parent dir does, we watch the parent dir with a filename filter so creating the file later triggers discovery.
- **Skip heuristic files:** Reuse `shouldSkipKubeconfigName()` for unfiltered directory watches. Filtered watches bypass heuristics since the user explicitly configured the file path.
- **Watcher starts after initKubernetesClient:** Prevents races where the watcher fires teardown/rebuild while startup is still building cluster state.
- **Deselect requires confirmed absence, not just a rediscovered miss:** Rediscovered `availableKubeconfigs` is the fast path for rebuilds, but a missing path:context must be confirmed before deselecting. The watcher directly inspects/parses the affected kubeconfig file to distinguish (a) file deleted/renamed, (b) context removed/renamed, and (c) temporary editor/intermediate invalid content. Case (c) must not deselect.
- **`deselectClusters` uses proper reconciliation with abort-on-failure:** `deselectClusters` matches selections by `kubeconfigPath:kubeconfigContext` from the `clusterClients` struct (not `clusterMetaForSelection`, which depends on `availableKubeconfigs` and can produce mismatched IDs after rediscovery). It routes through `updateRefreshSubsystemSelections` to properly reconcile aggregates, object catalog, and subsystem lifecycle. If reconciliation fails, it aborts without committing partial state.
- **Auth managers are shut down outside `clusterClientsMu`:** `authManager.Shutdown()` waits for auth goroutines. Auth state callbacks can read cluster clients (`clusterClientsForID()`), so shutting down managers while holding `clusterClientsMu` risks a lock/wait cycle.
- **kubeconfigChangeMu serializes all cluster state mutations:** Prevents races between the watcher callback, `SetSelectedKubeconfigs`, `SetKubeconfig("")`, `ClearAppState`, auth recovery (`handleClusterAuthStateChange`), and transport recovery (`runClusterTransportRebuild`). All code paths that call `rebuildClusterSubsystem` or `teardownClusterSubsystem` acquire this mutex.
- **deselectClusters aborts on reconciliation failure:** If `updateRefreshSubsystemSelections` fails, `deselectClusters` returns without modifying `selectedKubeconfigs` or `clusterClients`, preventing partial state where selection/client state diverges from refresh/aggregate/catalog state.

## Reconnect Logic

When file changes are detected:
1. Acquire `kubeconfigChangeMu` to serialize against `SetSelectedKubeconfigs`
2. Build a set of changed file paths from the debounce window
3. Match each selected cluster's `kubeconfigPath` against the changed set
4. Run `discoverKubeconfigs()` to refresh the available list
5. If rediscovery fails, log and stop (no reconnect/deselect, no `kubeconfig:available-changed` emit on the failed pass)
6. For each affected cluster, check whether its `kubeconfigPath:kubeconfigContext` is still present in the rediscovered `availableKubeconfigs`:
   - If still discoverable: `teardownClusterSubsystem` + `rebuildClusterSubsystem`
   - If not discoverable: directly inspect the on-disk file and confirm:
     - File missing/renamed: `deselectClusters`
     - File parses but context missing/renamed: `deselectClusters`
     - File temporarily unreadable/invalid: keep selection unchanged and wait for next event
     - File parses and context exists: `teardownClusterSubsystem` + `rebuildClusterSubsystem`
7. Emit `kubeconfig:available-changed` event after successful rediscovery (the available list may have changed)

## Error Handling

- If `fsnotify.NewWatcher()` fails, log a warning and continue without watching
- If re-discovery fails during a file change, log the error, skip reconnect/deselect for that pass, and wait for the next event (safety over false deselection)
- If an affected kubeconfig file is temporarily unreadable/invalid during a write, log and defer action until a subsequent event confirms the final file contents
- If rebuild fails for a specific cluster, the per-cluster auth manager handles the failure state independently

## Testing

- Unit tests for debounce logic, path accumulation, and directory add/remove
- Unit tests for filename filter (single and multiple files per directory)
- Unit tests for heuristic file skipping
- Integration test: write a file to a temp dir, verify watcher triggers re-discovery
- Integration test: remove a context from an existing kubeconfig file, verify the cluster is deselected (not left torn down in a half-state)
- Integration test: two selected contexts from the same kubeconfig file, remove/rename only one context, verify only that cluster is deselected while the other remains selected/rebuilds correctly
- Integration test: temporary invalid/truncated write to a selected kubeconfig file does not deselect; a later valid write triggers the correct reconnect/deselect outcome
- Unit test: `deselectClusters` aborts without partial state changes when `updateRefreshSubsystemSelections` fails
- All backend tests run with `-race` to verify concurrency safety
