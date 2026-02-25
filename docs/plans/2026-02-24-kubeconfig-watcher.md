# Kubeconfig Directory Watcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Watch kubeconfig search path directories for file changes and automatically re-discover available kubeconfigs + reconnect affected clusters without restarting the app.

**Architecture:** A `kubeconfigWatcher` component uses `fsnotify` to watch directories (including parent dirs of file-based search paths). File events are debounced (500ms), accumulating changed file paths during the debounce window. On trigger: acquire locks, re-discover kubeconfigs, identify only the selected clusters whose kubeconfig file was in the changed set, reconnect affected clusters, and deselect only when deletion or context removal is confirmed (never on uncertain/temporary parse failures). Then emit a Wails event so the frontend refreshes.

**Tech Stack:** Go (`github.com/fsnotify/fsnotify`), Wails v2 events, React (TypeScript)

**Concurrency strategy:**
- `kubeconfigsMu sync.RWMutex` guards both `availableKubeconfigs` and `selectedKubeconfigs` access (reads AND writes).
- `kubeconfigChangeMu sync.Mutex` serializes runtime cluster/subsystem mutation paths (watcher callback, selection changes, auth recovery, transport recovery). `Shutdown()` remains a separate lifecycle path that first stops the watcher and auth managers before teardown.
- `settingsMu sync.Mutex` guards `a.appSettings` access in the watcher/selection/settings flows touched by this plan, and also serializes settings.json read-modify-write paths that can overwrite `appSettings`-backed fields (`SaveTheme`, `DeleteTheme`, `ReorderThemes`, `ApplyTheme`). Caller-locking: `loadAppSettings()` and `saveAppSettings()` never acquire `settingsMu` — their callers hold it. `GetAppSettings()` returns a deep copy (not the shared pointer). The watcher introduces a background writer to `appSettings.SelectedKubeconfigs` via `deselectClusters`, while Wails RPC handlers (`SetTheme`, etc.) concurrently mutate other fields. (One pre-existing `resolveMetricsInterval()` read remains a documented follow-up.)

**Lock ordering** (for paths that use these locks, always acquire in this order to prevent deadlock):
`kubeconfigChangeMu` → `kubeconfigsMu` → `clusterClientsMu` → `settingsMu`

---

### Task 1: Add fsnotify dependency

**Files:**
- Modify: `go.mod`
- Modify: `go.sum` (auto-updated)

**Step 1: Add the fsnotify dependency**

Run: `cd /Volumes/git/luxury-yacht/app && go get github.com/fsnotify/fsnotify@latest`

Expected: `go.mod` gains `github.com/fsnotify/fsnotify` in the require block.

**Step 2: Verify it builds**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./...`

Expected: Clean build with no errors.

---

### Task 2: Add kubeconfigsMu, kubeconfigChangeMu, and settingsMu to guard shared state

**Files:**
- Modify: `backend/app.go` (add mutex fields)
- Modify: `backend/kubeconfigs.go` (add locking around `availableKubeconfigs` AND `selectedKubeconfigs` access, add `kubeconfigChangeMu` to `SetSelectedKubeconfigs` and `SetKubeconfig("")`, add `settingsMu` to `appSettings` writes in `SetSelectedKubeconfigs` and `clearKubeconfigSelection`)
- Modify: `backend/kubeconfig_selection.go` (add read locks around ALL `availableKubeconfigs` readers, including `clusterMetaForSelection`)
- Modify: `backend/app_settings.go` (add `kubeconfigChangeMu` to `ClearAppState`, add `settingsMu` to ALL settings RPC methods, `GetAppSettings` deep copy, `syncThemesCache`, `ApplyTheme`, `ClearAppState`; `loadAppSettings`/`saveAppSettings` unchanged — caller-locking)
- Modify: `backend/app_lifecycle.go` (add comment documenting that `Startup()` calls `loadAppSettings()` without `settingsMu` because it runs single-threaded before the watcher or any Wails RPCs start)
- Modify: `backend/cluster_auth.go` (add `kubeconfigChangeMu` to auth recovery goroutines in `handleClusterAuthStateChange`)
- Modify: `backend/app_refresh_recovery.go` (add `kubeconfigChangeMu` to `runClusterTransportRebuild`)
- Test: existing tests must still pass with `-race`

This task introduces all three mutexes BEFORE the watcher, so existing code is thread-safe by the time the background goroutine arrives.

**Step 1: Add fields to App struct**

In `backend/app.go`, add to the `App` struct (after the `listenLoopback` field on line 82):

```go
	// kubeconfigsMu guards availableKubeconfigs and selectedKubeconfigs
	// reads/writes. The watcher's background goroutine writes to these via
	// discoverKubeconfigs() and deselectClusters(), while Wails RPC handlers
	// (GetKubeconfigs, GetSelectedKubeconfigs) read from them.
	kubeconfigsMu sync.RWMutex

	// kubeconfigChangeMu serializes all operations that mutate cluster/subsystem
	// state: watcher callback, SetSelectedKubeconfigs, SetKubeconfig(""),
	// ClearAppState, auth recovery, and transport recovery goroutines.
	kubeconfigChangeMu sync.Mutex

	// settingsMu guards all a.appSettings reads and writes. The watcher's
	// deselectClusters writes appSettings.SelectedKubeconfigs from a background
	// goroutine, while Wails RPC handlers (SetTheme, etc.) mutate other fields.
	// saveAppSettings() reads ALL fields to serialize, so any concurrent field
	// write is a data race without this lock.
	settingsMu sync.Mutex

	kubeconfigWatcher *kubeconfigWatcher
```

**Step 2: Add write lock to discoverKubeconfigs**

In `backend/kubeconfigs.go`, split `discoverKubeconfigs` into a locking wrapper and an internal `discoverKubeconfigsLocked` method. The locking wrapper:

```go
func (a *App) discoverKubeconfigs() error {
	a.kubeconfigsMu.Lock()
	defer a.kubeconfigsMu.Unlock()
	return a.discoverKubeconfigsLocked()
}
```

Rename the current `discoverKubeconfigs` body to `discoverKubeconfigsLocked()`. No behavior change.

**Step 3: Add read locks to ALL availableKubeconfigs readers**

In `backend/kubeconfigs.go`, refactor `GetKubeconfigs()` to use read lock for the cached check, then call `discoverKubeconfigs()` (which acquires write lock) if empty:

```go
func (a *App) GetKubeconfigs() ([]KubeconfigInfo, error) {
	a.kubeconfigsMu.RLock()
	if len(a.availableKubeconfigs) > 0 {
		result := append([]KubeconfigInfo(nil), a.availableKubeconfigs...)
		a.kubeconfigsMu.RUnlock()
		return result, nil
	}
	a.kubeconfigsMu.RUnlock()

	if err := a.discoverKubeconfigs(); err != nil {
		return nil, err
	}

	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
	return append([]KubeconfigInfo(nil), a.availableKubeconfigs...), nil
}
```

In `backend/kubeconfig_selection.go`, add `a.kubeconfigsMu.RLock()` / `a.kubeconfigsMu.RUnlock()` around the `a.availableKubeconfigs` iterations in ALL four methods:
- `normalizeKubeconfigSelection` (line 86 loop)
- `validateKubeconfigSelection` (line 98 loop)
- `clusterMetaForSelection` (line 113 loop)
- `selectedKubeconfigSelections` calls the above via normalize/validate, so those are covered transitively

For `clusterMetaForSelection`, wrap the section from line 112–121 that iterates `a.availableKubeconfigs`:
```go
func (a *App) clusterMetaForSelection(selection kubeconfigSelection) ClusterMeta {
	if selection.Path == "" {
		return ClusterMeta{}
	}

	if selection.Context != "" {
		a.kubeconfigsMu.RLock()
		for _, kc := range a.availableKubeconfigs {
			if kc.Path == selection.Path && kc.Context == selection.Context {
				a.kubeconfigsMu.RUnlock()
				return ClusterMeta{
					ID:   fmt.Sprintf("%s:%s", kc.Name, kc.Context),
					Name: kc.Context,
				}
			}
		}
		a.kubeconfigsMu.RUnlock()
	}
	// ... rest of fallback logic unchanged
```

**Step 4: Add read lock to GetSelectedKubeconfigs**

In `backend/kubeconfigs.go`, the watcher's `deselectClusters` writes `a.selectedKubeconfigs` from a background goroutine, while `GetSelectedKubeconfigs` (line 325) reads it from Wails RPC. The frontend's `loadKubeconfigs` calls `GetSelectedKubeconfigs()` after watcher events, making this a real concurrent read/write. Add `kubeconfigsMu.RLock`:

```go
func (a *App) GetSelectedKubeconfigs() []string {
	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
	if len(a.selectedKubeconfigs) > 0 {
		return append([]string(nil), a.selectedKubeconfigs...)
	}
	return []string{}
}
```

**Step 5: Add write locks around selectedKubeconfigs writes**

All writes to `a.selectedKubeconfigs` must hold `kubeconfigsMu` write lock. Add `kubeconfigsMu.Lock()`/`Unlock()` around the assignment in:

- `SetSelectedKubeconfigs` (kubeconfigs.go:463, `a.selectedKubeconfigs = normalizedStrings`):
```go
	a.kubeconfigsMu.Lock()
	a.selectedKubeconfigs = normalizedStrings
	a.kubeconfigsMu.Unlock()
```

- `clearKubeconfigSelection` (kubeconfigs.go:546, `a.selectedKubeconfigs = nil`):
```go
	a.kubeconfigsMu.Lock()
	a.selectedKubeconfigs = nil
	a.kubeconfigsMu.Unlock()
```

Note: `deselectClusters` (new code in Task 4) also writes `a.selectedKubeconfigs` — it will include the write lock in its implementation.

Note: The startup writes in `app_kubernetes_client.go` (lines 39, 54) run before the watcher starts and before the Wails RPC server is accepting requests, so no concurrent reader exists. No lock needed there.

**Step 6: Add kubeconfigChangeMu to SetSelectedKubeconfigs**

In `backend/kubeconfigs.go`, wrap the body of `SetSelectedKubeconfigs` with `kubeconfigChangeMu`:

```go
func (a *App) SetSelectedKubeconfigs(selections []string) error {
	a.kubeconfigChangeMu.Lock()
	defer a.kubeconfigChangeMu.Unlock()
	// ... existing body unchanged
}
```

Note: `clearKubeconfigSelection` is called from multiple entry points that all acquire `kubeconfigChangeMu` at their top level. It does NOT acquire the mutex itself — its callers do.

**Step 7: Add kubeconfigChangeMu to SetKubeconfig("")**

In `backend/kubeconfigs.go`, the `SetKubeconfig` method's empty-string path calls `clearKubeconfigSelection` directly (line 338). Wrap only this branch with the mutex — the non-empty branch delegates to `SetSelectedKubeconfigs` which already acquires it:

```go
func (a *App) SetKubeconfig(selection string) error {
	a.logger.Info(fmt.Sprintf("Switching kubeconfig to: %s", selection), "KubeconfigManager")

	if strings.TrimSpace(selection) == "" {
		a.kubeconfigChangeMu.Lock()
		defer a.kubeconfigChangeMu.Unlock()
		return a.clearKubeconfigSelection()
	}

	// Delegate to the multi-cluster selection flow to avoid implicit base routing.
	// SetSelectedKubeconfigs acquires kubeconfigChangeMu internally.
	if err := a.SetSelectedKubeconfigs([]string{selection}); err != nil {
		return err
	}
	// ... rest unchanged
```

**Step 8: Add kubeconfigChangeMu to ClearAppState**

In `backend/app_settings.go`, wrap the `ClearAppState` method body with the mutex (line 349):

```go
func (a *App) ClearAppState() error {
	a.kubeconfigChangeMu.Lock()
	defer a.kubeconfigChangeMu.Unlock()

	if err := a.clearKubeconfigSelection(); err != nil {
		return err
	}
	// ... rest unchanged
```

**Step 9: Add kubeconfigChangeMu to auth recovery goroutines**

In `backend/cluster_auth.go`, the `handleClusterAuthStateChange` method spawns goroutines for `rebuildClusterSubsystem` (line 48) and `teardownClusterSubsystem` (line 61) that mutate cluster/subsystem state. Wrap the goroutine bodies with the mutex:

```go
	case authstate.StateValid:
		// ... logging and event emit unchanged ...
		// Rebuild only this cluster's subsystem
		go func() {
			a.kubeconfigChangeMu.Lock()
			defer a.kubeconfigChangeMu.Unlock()
			a.rebuildClusterSubsystem(clusterID)
		}()

	case authstate.StateRecovering:
		// ... logging and event emit unchanged ...
		// Teardown only this cluster's subsystem
		go func() {
			a.kubeconfigChangeMu.Lock()
			defer a.kubeconfigChangeMu.Unlock()
			a.teardownClusterSubsystem(clusterID)
		}()
```

**Step 10: Add kubeconfigChangeMu to transport recovery**

In `backend/app_refresh_recovery.go`, `runClusterTransportRebuild` (line 276) calls `rebuildClusterSubsystem` directly and is launched as a goroutine (line 258). Wrap the entire method body with the mutex:

```go
func (a *App) runClusterTransportRebuild(clusterID, reason string, cause error) {
	a.kubeconfigChangeMu.Lock()
	defer a.kubeconfigChangeMu.Unlock()

	state := a.getTransportState(clusterID)
	// ... rest of existing body unchanged
```

**Step 11: Add settingsMu to appSettings access and theme-library settings file RMW paths**

The watcher introduces a background writer to `a.appSettings.SelectedKubeconfigs` via `deselectClusters`. `saveAppSettings()` (app_settings.go:313) reads ALL `a.appSettings` fields to serialize to disk. Settings RPCs (`SetTheme`, `SetAutoRefreshEnabled`, etc.) write individual fields. Theme-library RPCs (`SaveTheme`, `DeleteTheme`, `ReorderThemes`, `ApplyTheme`) also perform settings.json read-modify-write cycles and can otherwise clobber a concurrent watcher selection save. Without a lock, the watcher's background write races with concurrent settings work.

Add `a.settingsMu.Lock()`/`Unlock()` wrapping:
- every method that mutates or reads `a.appSettings`
- theme-library settings.json read-modify-write methods that call `syncThemesCache` or persist theme changes (`SaveTheme`, `DeleteTheme`, `ReorderThemes`, `ApplyTheme`)

**Caller-locking rule:** `loadAppSettings()` and `saveAppSettings()` NEVER acquire `settingsMu` themselves. Their callers always hold the lock. This avoids recursive locking since every call site already holds `settingsMu` for the check-then-mutate-then-save sequence.

**Exception:** `Startup()` in `app_lifecycle.go:119` calls `loadAppSettings()` without `settingsMu` because it runs single-threaded before the watcher starts or any Wails RPCs are dispatched. Add a comment at the call site documenting this.

Methods that acquire `settingsMu`:
- `GetAppSettings()` (app_settings.go:392) — acquires lock, returns a **deep copy** of the struct (see copy pattern below)
- `SetTheme()` (app_settings.go:416–417) — wraps `a.appSettings.Theme = theme` + `saveAppSettings()`
- `SetUseShortResourceNames()` (app_settings.go:428) — wraps mutation + save
- `SetAutoRefreshEnabled()` (app_settings.go:441) — wraps mutation + save
- `SetBackgroundRefreshEnabled()` (app_settings.go:454) — wraps mutation + save
- `SetGridTablePersistenceMode()` (app_settings.go:471) — wraps mutation + save
- `SetPaletteTint()` (app_settings.go:588–594) — wraps mutation + save
- `SetAccentColor()` (app_settings.go:622–624) — wraps mutation + save
- `syncThemesCache()` (app_settings.go:635) — wraps `a.appSettings.Themes = themes`
- `SaveTheme()` (app_settings.go:653) — wraps loadSettingsFile → mutate → saveSettingsFile → `syncThemesCache()`
- `DeleteTheme()` (app_settings.go:686) — wraps loadSettingsFile → mutate → saveSettingsFile → `syncThemesCache()`
- `ReorderThemes()` (app_settings.go:717) — wraps loadSettingsFile → mutate → saveSettingsFile → `syncThemesCache()`
- `ApplyTheme()` (app_settings.go:752) — wraps the entire loadSettingsFile → apply/sync → saveSettingsFile path, plus `a.appSettings` palette mutations
- `ClearAppState()` (app_settings.go:374) — wraps `a.appSettings = nil`

Pattern for `GetAppSettings` (deep copy):
```go
func (a *App) GetAppSettings() (*AppSettings, error) {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return getDefaultAppSettings(), nil
		}
	}
	// Return a deep copy so callers (including Wails JSON marshalling)
	// never hold a reference to the shared mutable struct.
	cp := *a.appSettings
	cp.SelectedKubeconfigs = append([]string(nil), a.appSettings.SelectedKubeconfigs...)
	cp.Themes = append([]Theme(nil), a.appSettings.Themes...)
	return &cp, nil
}
```

Pattern for each settings RPC:
```go
func (a *App) SetTheme(theme string) error {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return err
		}
	}
	a.logger.Info(fmt.Sprintf("Theme changed to: %s", theme), "Settings")
	a.appSettings.Theme = theme
	return a.saveAppSettings()
}
```

For the kubeconfig selection paths, `settingsMu` wraps only the `appSettings` mutation + save portion:
- In `SetSelectedKubeconfigs` (kubeconfigs.go:477–481):
```go
	a.settingsMu.Lock()
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = normalizedStrings
	_ = a.saveAppSettings() // best-effort persist
	a.settingsMu.Unlock()
```
- In `clearKubeconfigSelection` (kubeconfigs.go:553–557):
```go
	a.settingsMu.Lock()
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = nil
	_ = a.saveAppSettings()
	a.settingsMu.Unlock()
```

Note: `deselectClusters` (new code in Task 4) also writes `appSettings` — it will include `settingsMu` in its implementation.

> **Pre-existing race (out of scope):** `resolveMetricsInterval()` (app_refresh_setup.go:21) reads `a.appSettings.MetricsRefreshIntervalMs` from background goroutines via `rebuildClusterSubsystem` → `buildRefreshSubsystemForSelection`. This race exists independently of the watcher. Fixing it requires coordinated `settingsMu` usage in the rebuild path, but that changes the lock ordering for auth/transport recovery (which already holds `kubeconfigChangeMu`). This is tracked separately.

**Step 12: Run full backend test suite with race detector**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -count=1 -race`

Expected: All tests PASS. No new watcher-related race conditions. A known pre-existing race in `resolveMetricsInterval()` may still appear until the separate follow-up is implemented.

> **Note on `clearKubeconfigSelection` callers:** After this task, all paths into `clearKubeconfigSelection` are covered by `kubeconfigChangeMu`:
> - `SetSelectedKubeconfigs([])` → acquires lock at top (Step 6)
> - `SetKubeconfig("")` → acquires lock before calling clear (Step 7)
> - `ClearAppState()` → acquires lock at top (Step 8)
>
> **Note on `rebuildClusterSubsystem` callers:** After this task, all runtime goroutine paths into `rebuildClusterSubsystem` are covered by `kubeconfigChangeMu`:
> - `handleClusterAuthStateChange` → wraps goroutine (Step 9)
> - `runClusterTransportRebuild` → wraps method body (Step 10)
> - `handleKubeconfigChange` → acquires lock at top (Task 4)

---

### Task 3: Create kubeconfig_watcher.go with core watcher logic

**Files:**
- Create: `backend/kubeconfig_watcher.go`
- Create: `backend/kubeconfig_watcher_test.go`

This is the core watcher component. It watches directories, accumulates changed file paths during the debounce window, and triggers a callback with those paths. Supports multiple file filters per directory via `map[string]map[string]struct{}`.

**Step 1: Write the failing tests**

Create `backend/kubeconfig_watcher_test.go`:

```go
package backend

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestKubeconfigWatcher_DetectsFileCreation(t *testing.T) {
	setTestConfigEnv(t)
	dir := t.TempDir()

	var called atomic.Int32
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) { called.Add(1) })
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir}}))

	createTempKubeconfig(t, dir, "new-config", "new-context")

	assert.Eventually(t, func() bool { return called.Load() > 0 }, 2*time.Second, 50*time.Millisecond,
		"watcher should have triggered callback after file creation")
}

func TestKubeconfigWatcher_DetectsFileModification(t *testing.T) {
	setTestConfigEnv(t)
	dir := t.TempDir()
	configPath := createTempKubeconfig(t, dir, "config", "test-context")

	var called atomic.Int32
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) { called.Add(1) })
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir}}))
	require.NoError(t, os.WriteFile(configPath, []byte("modified content"), 0644))

	assert.Eventually(t, func() bool { return called.Load() > 0 }, 2*time.Second, 50*time.Millisecond,
		"watcher should have triggered callback after file modification")
}

func TestKubeconfigWatcher_DebouncesBurstEvents(t *testing.T) {
	setTestConfigEnv(t)
	dir := t.TempDir()

	var callCount atomic.Int32
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) { callCount.Add(1) })
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir}}))

	for i := 0; i < 5; i++ {
		name := filepath.Base(t.TempDir())
		createTempKubeconfig(t, dir, name, "ctx")
	}

	time.Sleep(1500 * time.Millisecond)
	count := callCount.Load()
	assert.LessOrEqual(t, count, int32(2), "debounce should collapse burst events, got %d calls", count)
}

func TestKubeconfigWatcher_AccumulatesChangedPaths(t *testing.T) {
	setTestConfigEnv(t)
	dir := t.TempDir()

	var mu sync.Mutex
	var receivedPaths []string
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(paths []string) {
		mu.Lock()
		receivedPaths = append(receivedPaths, paths...)
		mu.Unlock()
	})
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir}}))

	createTempKubeconfig(t, dir, "config-a", "ctx-a")
	createTempKubeconfig(t, dir, "config-b", "ctx-b")

	assert.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(receivedPaths) >= 2
	}, 2*time.Second, 50*time.Millisecond,
		"callback should receive accumulated changed file paths")
}

func TestKubeconfigWatcher_SkipsHeuristicFiles(t *testing.T) {
	setTestConfigEnv(t)
	dir := t.TempDir()

	var called atomic.Int32
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) { called.Add(1) })
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir}}))

	require.NoError(t, os.WriteFile(filepath.Join(dir, ".config.swp"), []byte("swap"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "config.bak"), []byte("backup"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "config.tmp"), []byte("temp"), 0644))

	time.Sleep(1 * time.Second)
	assert.Equal(t, int32(0), called.Load(), "watcher should not trigger for heuristic-skipped files")
}

func TestKubeconfigWatcher_FileFilterOnlyTriggersForTargetFiles(t *testing.T) {
	setTestConfigEnv(t)
	dir := t.TempDir()

	targetFile := filepath.Join(dir, "my-kubeconfig")
	require.NoError(t, os.WriteFile(targetFile, []byte("initial"), 0644))

	var called atomic.Int32
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) { called.Add(1) })
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{
		{dir: dir, filterFiles: map[string]struct{}{"my-kubeconfig": {}}},
	}))

	// Non-target file should NOT trigger.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "other-file"), []byte("other"), 0644))
	time.Sleep(1 * time.Second)
	assert.Equal(t, int32(0), called.Load(), "non-target file should not trigger callback")

	// Target file should trigger.
	require.NoError(t, os.WriteFile(targetFile, []byte("modified"), 0644))
	assert.Eventually(t, func() bool { return called.Load() > 0 }, 2*time.Second, 50*time.Millisecond,
		"target file modification should trigger callback")
}

func TestKubeconfigWatcher_MultipleFileFiltersInSameDir(t *testing.T) {
	setTestConfigEnv(t)
	dir := t.TempDir()

	fileA := filepath.Join(dir, "config-a")
	fileB := filepath.Join(dir, "config-b")
	require.NoError(t, os.WriteFile(fileA, []byte("a"), 0644))
	require.NoError(t, os.WriteFile(fileB, []byte("b"), 0644))

	var callCount atomic.Int32
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) { callCount.Add(1) })
	require.NoError(t, err)
	defer w.stop()

	// Both files in the same directory, both filtered.
	require.NoError(t, w.updateWatchedPaths([]watchedPath{
		{dir: dir, filterFiles: map[string]struct{}{"config-a": {}, "config-b": {}}},
	}))

	// Modify file A.
	require.NoError(t, os.WriteFile(fileA, []byte("a-modified"), 0644))
	assert.Eventually(t, func() bool { return callCount.Load() > 0 }, 2*time.Second, 50*time.Millisecond,
		"first filtered file should trigger callback")

	// Wait for debounce to settle, then modify file B.
	time.Sleep(1 * time.Second)
	beforeB := callCount.Load()
	require.NoError(t, os.WriteFile(fileB, []byte("b-modified"), 0644))
	assert.Eventually(t, func() bool { return callCount.Load() > beforeB }, 2*time.Second, 50*time.Millisecond,
		"second filtered file should also trigger callback")
}

func TestKubeconfigWatcher_UpdateWatchedPathsAddsAndRemoves(t *testing.T) {
	setTestConfigEnv(t)
	dir1 := t.TempDir()
	dir2 := t.TempDir()

	var called atomic.Int32
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) { called.Add(1) })
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir1}}))
	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir2}}))

	// dir1 no longer watched.
	createTempKubeconfig(t, dir1, "old-config", "old-context")
	time.Sleep(1 * time.Second)
	assert.Equal(t, int32(0), called.Load(), "removed directory should not trigger callback")

	// dir2 now watched.
	createTempKubeconfig(t, dir2, "new-config", "new-context")
	assert.Eventually(t, func() bool { return called.Load() > 0 }, 2*time.Second, 50*time.Millisecond,
		"newly watched directory should trigger callback")
}

func TestKubeconfigWatcher_StopPreventsCallbacks(t *testing.T) {
	setTestConfigEnv(t)
	dir := t.TempDir()

	var called atomic.Int32
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) { called.Add(1) })
	require.NoError(t, err)

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir}}))
	w.stop()

	createTempKubeconfig(t, dir, "post-stop-config", "ctx")
	time.Sleep(1 * time.Second)

	assert.Equal(t, int32(0), called.Load(), "stopped watcher should not trigger callbacks")
}

func TestKubeconfigWatcher_SkipsNonExistentDirs(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	w, err := newKubeconfigWatcher(app, func(_ []string) {})
	require.NoError(t, err)
	defer w.stop()

	err = w.updateWatchedPaths([]watchedPath{{dir: "/nonexistent/path/that/does/not/exist"}})
	assert.NoError(t, err)
}

func TestKubeconfigWatcher_IntegrationRediscoversOnFileChange(t *testing.T) {
	setTestConfigEnv(t)
	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	require.NoError(t, os.MkdirAll(kubeDir, 0755))

	createTempKubeconfig(t, kubeDir, "config", "initial-context")
	t.Setenv("HOME", tempDir)

	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	require.NoError(t, app.discoverKubeconfigs())

	app.kubeconfigsMu.RLock()
	initialCount := len(app.availableKubeconfigs)
	app.kubeconfigsMu.RUnlock()
	require.Equal(t, 1, initialCount)

	require.NoError(t, app.startKubeconfigWatcher())
	defer app.stopKubeconfigWatcher()

	createTempKubeconfig(t, kubeDir, "new-cluster", "new-context")

	assert.Eventually(t, func() bool {
		app.kubeconfigsMu.RLock()
		defer app.kubeconfigsMu.RUnlock()
		return len(app.availableKubeconfigs) > initialCount
	}, 3*time.Second, 100*time.Millisecond,
		"watcher should have re-discovered kubeconfigs after new file was added")

	app.kubeconfigsMu.RLock()
	defer app.kubeconfigsMu.RUnlock()
	assert.True(t, hasKubeconfig(app.availableKubeconfigs, filepath.Join(kubeDir, "new-cluster"), "new-context"))
}

// writeMultiContextKubeconfig writes a kubeconfig file with multiple contexts to the given path.
func writeMultiContextKubeconfig(t *testing.T, path string, contexts []string) {
	t.Helper()
	var contextEntries, userEntries string
	for _, ctx := range contexts {
		contextEntries += fmt.Sprintf(`
- context:
    cluster: test-cluster
    user: %s-user
  name: %s`, ctx, ctx)
		userEntries += fmt.Sprintf(`
- name: %s-user
  user:
    token: test-token`, ctx)
	}
	content := fmt.Sprintf(`apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: https://127.0.0.1:6443
  name: test-cluster
contexts:%s
current-context: %s
kind: Config
preferences: {}
users:%s
`, contextEntries, contexts[0], userEntries)
	require.NoError(t, os.WriteFile(path, []byte(content), 0644))
}

func TestKubeconfigWatcher_ContextRemovedFromFileDeselectsCluster(t *testing.T) {
	// Verifies that when a selected cluster's context is removed from an existing
	// kubeconfig file (file still exists, but context gone), handleKubeconfigChange
	// classifies it for deselection rather than rebuild.
	setTestConfigEnv(t)
	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	require.NoError(t, os.MkdirAll(kubeDir, 0755))

	// Create initial kubeconfig with two contexts.
	configPath := filepath.Join(kubeDir, "config")
	writeMultiContextKubeconfig(t, configPath, []string{"ctx-keep", "ctx-remove"})
	t.Setenv("HOME", tempDir)

	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	require.NoError(t, app.discoverKubeconfigs())

	// Select both contexts.
	require.NoError(t, app.SetSelectedKubeconfigs([]string{
		configPath + ":ctx-keep",
		configPath + ":ctx-remove",
	}))

	require.NoError(t, app.startKubeconfigWatcher())
	defer app.stopKubeconfigWatcher()

	// Rewrite the file with only ctx-keep (ctx-remove is gone).
	writeMultiContextKubeconfig(t, configPath, []string{"ctx-keep"})

	// Wait for the watcher to fire and deselect the removed context.
	assert.Eventually(t, func() bool {
		selected := app.GetSelectedKubeconfigs()
		// ctx-remove should have been deselected.
		for _, sel := range selected {
			if sel == configPath+":ctx-remove" {
				return false
			}
		}
		return len(selected) == 1
	}, 3*time.Second, 100*time.Millisecond,
		"cluster with removed context should be deselected")
}

func TestDeselectClusters_AbortsOnReconciliationFailure(t *testing.T) {
	// Verifies that if updateRefreshSubsystemSelections fails, deselectClusters
	// does not commit any partial state: selectedKubeconfigs, clusterClients,
	// and appSettings all remain unchanged.
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// Set up app with two selected clusters and clusterClients entries.
	app.kubeconfigsMu.Lock()
	app.selectedKubeconfigs = []string{"/path/a:ctx-a", "/path/b:ctx-b"}
	app.kubeconfigsMu.Unlock()

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"a:ctx-a": {kubeconfigPath: "/path/a", kubeconfigContext: "ctx-a", meta: ClusterMeta{ID: "a:ctx-a"}},
		"b:ctx-b": {kubeconfigPath: "/path/b", kubeconfigContext: "ctx-b", meta: ClusterMeta{ID: "b:ctx-b"}},
	}
	app.clusterClientsMu.Unlock()

	app.settingsMu.Lock()
	app.appSettings = &AppSettings{SelectedKubeconfigs: []string{"/path/a:ctx-a", "/path/b:ctx-b"}}
	app.settingsMu.Unlock()

	// Put refreshAggregates in a nil state so updateRefreshSubsystemSelections fails
	// (it checks a.refreshAggregates == nil and calls setupRefreshSubsystem which
	// will fail without a full app context).
	app.refreshAggregates = nil
	app.refreshHTTPServer = nil

	// Try to deselect cluster "b:ctx-b". Reconciliation should fail.
	app.deselectClusters([]string{"b:ctx-b"})

	// Verify NO state was committed — everything should be unchanged.
	selected := app.GetSelectedKubeconfigs()
	assert.Equal(t, 2, len(selected), "selectedKubeconfigs should be unchanged after failed reconciliation")

	app.clusterClientsMu.Lock()
	assert.Equal(t, 2, len(app.clusterClients), "clusterClients should be unchanged after failed reconciliation")
	app.clusterClientsMu.Unlock()

	app.settingsMu.Lock()
	assert.Equal(t, 2, len(app.appSettings.SelectedKubeconfigs), "appSettings.SelectedKubeconfigs should be unchanged after failed reconciliation")
	app.settingsMu.Unlock()
}
```

Also add an integration test for the transient-write case: rewrite a selected kubeconfig file with temporarily invalid/truncated content (or an editor-style intermediate state), verify the watcher does **not** deselect the cluster on that event, then write a valid file and verify normal reconnect/deselect behavior proceeds on the subsequent event.

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestKubeconfigWatcher -v -count=1`

Expected: Compilation error — `newKubeconfigWatcher` is not defined.

**Step 3: Implement the kubeconfig watcher**

Create `backend/kubeconfig_watcher.go`:

```go
/*
 * backend/kubeconfig_watcher.go
 *
 * Watches kubeconfig search path directories for file changes using fsnotify.
 * Triggers a debounced callback when relevant files change, allowing the app
 * to re-discover kubeconfigs and reconnect affected clusters without restarting.
 *
 * The callback receives the list of changed file paths accumulated during the
 * debounce window, so the caller can determine which specific clusters need
 * reconnection rather than rebuilding everything.
 */

package backend

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// kubeconfigWatcherDebounceInterval controls how long to wait after the last
// file event before triggering the callback. Editors often perform multi-step
// writes (e.g., write temp file then rename), so this collapses them into one trigger.
const kubeconfigWatcherDebounceInterval = 500 * time.Millisecond

// watchedPath describes a directory to watch, optionally filtering to specific files.
// When filterFiles is nil/empty, all non-heuristic files in the directory trigger events.
// When filterFiles is non-empty, only events for those specific filenames trigger the callback.
// This supports both directory-based search paths (watch everything in ~/.kube)
// and file-based search paths (watch only specific files in their parent dir).
type watchedPath struct {
	dir         string                 // directory to watch via fsnotify
	filterFiles map[string]struct{}    // if non-empty, only these filenames within dir trigger events
}

// kubeconfigWatcher watches kubeconfig search path directories for file changes.
type kubeconfigWatcher struct {
	app       *App
	watcher   *fsnotify.Watcher
	onChange  func(changedPaths []string)
	stopCh    chan struct{}
	stoppedCh chan struct{}
	mu        sync.Mutex
	watched   []watchedPath
	// fileFilters maps directory path to the set of filenames to accept.
	// Directories not in this map accept all non-heuristic files.
	fileFilters map[string]map[string]struct{}
}

// newKubeconfigWatcher creates and starts a directory watcher. The onChange
// callback is invoked (debounced) with the list of changed file paths whenever
// relevant file changes are detected.
func newKubeconfigWatcher(app *App, onChange func(changedPaths []string)) (*kubeconfigWatcher, error) {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	w := &kubeconfigWatcher{
		app:         app,
		watcher:     fsWatcher,
		onChange:    onChange,
		stopCh:      make(chan struct{}),
		stoppedCh:   make(chan struct{}),
		fileFilters: make(map[string]map[string]struct{}),
	}

	go w.eventLoop()
	return w, nil
}

// eventLoop processes fsnotify events, debouncing them before calling onChange.
// Changed file paths are accumulated during the debounce window.
func (w *kubeconfigWatcher) eventLoop() {
	defer close(w.stoppedCh)

	var debounceTimer *time.Timer
	var debounceCh <-chan time.Time
	changedPaths := make(map[string]struct{})

	for {
		select {
		case <-w.stopCh:
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			return

		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if !isRelevantFSEvent(event) {
				continue
			}
			filename := filepath.Base(event.Name)
			dir := filepath.Dir(event.Name)

			w.mu.Lock()
			if filters, hasFilters := w.fileFilters[dir]; hasFilters {
				// Filtered directory: only accept events for target filenames.
				if _, accepted := filters[filename]; !accepted {
					w.mu.Unlock()
					continue
				}
			} else {
				// Unfiltered directory: apply heuristic skip patterns.
				if shouldSkipKubeconfigName(filename) {
					w.mu.Unlock()
					continue
				}
			}
			w.mu.Unlock()

			changedPaths[filepath.Clean(event.Name)] = struct{}{}
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.NewTimer(kubeconfigWatcherDebounceInterval)
			debounceCh = debounceTimer.C

		case _, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			if w.app != nil && w.app.logger != nil {
				w.app.logger.Warn("kubeconfig watcher error", "KubeconfigWatcher")
			}

		case <-debounceCh:
			debounceCh = nil
			paths := make([]string, 0, len(changedPaths))
			for p := range changedPaths {
				paths = append(paths, p)
			}
			changedPaths = make(map[string]struct{})
			w.onChange(paths)
		}
	}
}

// isRelevantFSEvent returns true for create, write, rename, and remove events.
func isRelevantFSEvent(event fsnotify.Event) bool {
	return event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Rename|fsnotify.Remove) != 0
}

// updateWatchedPaths replaces the set of watched paths.
// Non-existent directories are silently skipped.
// Multiple watchedPath entries for the same directory have their filterFiles merged.
func (w *kubeconfigWatcher) updateWatchedPaths(paths []watchedPath) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Build current dir set.
	currentDirs := make(map[string]struct{}, len(w.watched))
	for _, wp := range w.watched {
		currentDirs[wp.dir] = struct{}{}
	}

	// Merge desired paths by directory, combining filter sets.
	type mergedEntry struct {
		dir         string
		filterFiles map[string]struct{} // nil means unfiltered (watch all)
		unfiltered  bool
	}
	merged := make(map[string]*mergedEntry, len(paths))
	for _, wp := range paths {
		info, err := os.Stat(wp.dir)
		if err != nil || !info.IsDir() {
			continue
		}
		existing, ok := merged[wp.dir]
		if !ok {
			existing = &mergedEntry{dir: wp.dir}
			merged[wp.dir] = existing
		}
		if len(wp.filterFiles) == 0 {
			// No filter means watch all files in this dir.
			existing.unfiltered = true
		} else {
			if existing.filterFiles == nil {
				existing.filterFiles = make(map[string]struct{})
			}
			for f := range wp.filterFiles {
				existing.filterFiles[f] = struct{}{}
			}
		}
	}

	desiredDirs := make(map[string]struct{}, len(merged))
	for d := range merged {
		desiredDirs[d] = struct{}{}
	}

	// Remove directories that are no longer desired.
	for d := range currentDirs {
		if _, ok := desiredDirs[d]; !ok {
			_ = w.watcher.Remove(d)
		}
	}

	// Add newly desired directories.
	for d := range desiredDirs {
		if _, ok := currentDirs[d]; !ok {
			if err := w.watcher.Add(d); err != nil {
				if w.app != nil && w.app.logger != nil {
					w.app.logger.Warn("Failed to watch directory: "+d, "KubeconfigWatcher")
				}
			}
		}
	}

	// Build new watched list and file filters.
	w.watched = make([]watchedPath, 0, len(merged))
	w.fileFilters = make(map[string]map[string]struct{})
	for _, entry := range merged {
		wp := watchedPath{dir: entry.dir}
		if !entry.unfiltered && entry.filterFiles != nil {
			wp.filterFiles = entry.filterFiles
			w.fileFilters[entry.dir] = entry.filterFiles
		}
		// If unfiltered, don't add to fileFilters — eventLoop will use heuristic skip.
		w.watched = append(w.watched, wp)
	}

	return nil
}

// stop shuts down the watcher and waits for the event loop to exit.
func (w *kubeconfigWatcher) stop() {
	select {
	case <-w.stopCh:
		return
	default:
		close(w.stopCh)
	}
	w.watcher.Close()
	<-w.stoppedCh
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestKubeconfigWatcher -v -count=1`

Expected: All tests PASS.

---

### Task 4: Integrate watcher into App lifecycle with precise reconnect and deselect logic

**Files:**
- Modify: `backend/kubeconfigs.go` (add `handleKubeconfigChange`, `startKubeconfigWatcher`, `stopKubeconfigWatcher`, `resolvedKubeconfigWatchPaths`)
- Modify: `backend/app_lifecycle.go` (start watcher after `initKubernetesClient`, stop in `Shutdown`)

**Step 1: Add the watcher lifecycle and change handler methods**

Add to `backend/kubeconfigs.go` at the end of the file:

```go
// startKubeconfigWatcher creates and starts the kubeconfig directory watcher.
// It watches all resolved kubeconfig search path directories (and parent dirs
// of file-based search paths) for file changes. If the watcher cannot be
// created (e.g., OS limit), a warning is logged and the app continues without
// auto-reload.
func (a *App) startKubeconfigWatcher() error {
	w, err := newKubeconfigWatcher(a, a.handleKubeconfigChange)
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to create kubeconfig watcher: %v", err), "KubeconfigWatcher")
		return err
	}
	a.kubeconfigWatcher = w

	watchPaths := a.resolvedKubeconfigWatchPaths()
	if err := w.updateWatchedPaths(watchPaths); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to set watched paths: %v", err), "KubeconfigWatcher")
	}

	a.logger.Info(fmt.Sprintf("Kubeconfig watcher started, watching %d path(s)", len(watchPaths)), "KubeconfigWatcher")
	return nil
}

// stopKubeconfigWatcher stops the kubeconfig directory watcher if running.
func (a *App) stopKubeconfigWatcher() {
	if a.kubeconfigWatcher != nil {
		a.kubeconfigWatcher.stop()
		a.kubeconfigWatcher = nil
	}
}

// resolvedKubeconfigWatchPaths returns watchedPath entries for all configured
// search paths. Directory search paths are watched directly. File search paths
// are watched via their parent directory with a filename filter.
// File search paths that don't exist yet still watch their parent directory
// (if the parent exists) so that creating the file later triggers discovery.
func (a *App) resolvedKubeconfigWatchPaths() []watchedPath {
	searchPaths, err := a.loadKubeconfigSearchPaths()
	if err != nil {
		return nil
	}

	// Collect entries per directory, merging filters for the same parent dir.
	type dirEntry struct {
		unfiltered  bool
		filterFiles map[string]struct{}
	}
	dirMap := make(map[string]*dirEntry)

	for _, entry := range searchPaths {
		resolved := resolveKubeconfigSearchPath(entry)
		if resolved == "" {
			continue
		}
		info, statErr := os.Stat(resolved)

		if statErr == nil && info.IsDir() {
			// Directory search path: watch all files.
			key := kubeconfigPathKey(resolved)
			if existing, ok := dirMap[key]; ok {
				existing.unfiltered = true
			} else {
				dirMap[key] = &dirEntry{unfiltered: true}
			}
		} else {
			// File search path (may or may not exist yet).
			// Watch the parent directory with a filename filter.
			parentDir := filepath.Dir(resolved)
			parentInfo, parentErr := os.Stat(parentDir)
			if parentErr != nil || !parentInfo.IsDir() {
				continue // Parent dir doesn't exist, can't watch.
			}
			key := kubeconfigPathKey(parentDir)
			filename := filepath.Base(resolved)
			if existing, ok := dirMap[key]; ok {
				if !existing.unfiltered {
					if existing.filterFiles == nil {
						existing.filterFiles = make(map[string]struct{})
					}
					existing.filterFiles[filename] = struct{}{}
				}
				// If already unfiltered, adding a filter for the same dir is a no-op.
			} else {
				dirMap[key] = &dirEntry{
					filterFiles: map[string]struct{}{filename: {}},
				}
			}
		}
	}

	result := make([]watchedPath, 0, len(dirMap))
	for dir, entry := range dirMap {
		wp := watchedPath{dir: dir}
		if !entry.unfiltered && entry.filterFiles != nil {
			wp.filterFiles = entry.filterFiles
		}
		result = append(result, wp)
	}
	return result
}

// handleKubeconfigChange is called (debounced) when file changes are detected
// in watched kubeconfig directories. It acquires kubeconfigChangeMu to serialize
// against SetSelectedKubeconfigs, then re-discovers available kubeconfigs,
// identifies only the selected clusters whose kubeconfig file actually changed,
// reconnects affected clusters, deselects only when deletion/context removal is
// confirmed, and notifies the frontend.
func (a *App) handleKubeconfigChange(changedPaths []string) {
	a.kubeconfigChangeMu.Lock()
	defer a.kubeconfigChangeMu.Unlock()

	a.logger.Info(fmt.Sprintf("Kubeconfig file change detected (%d file(s)), refreshing...", len(changedPaths)), "KubeconfigWatcher")

	// Build a set of changed file paths for fast lookup.
	changedSet := make(map[string]struct{}, len(changedPaths))
	for _, p := range changedPaths {
		changedSet[kubeconfigPathKey(filepath.Clean(p))] = struct{}{}
	}

	// Identify selected clusters whose kubeconfig file is in the changed set.
	var affectedClusterIDs []string
	a.clusterClientsMu.Lock()
	for id, clients := range a.clusterClients {
		if clients == nil {
			continue
		}
		clientPathKey := kubeconfigPathKey(filepath.Clean(clients.kubeconfigPath))
		if _, changed := changedSet[clientPathKey]; changed {
			affectedClusterIDs = append(affectedClusterIDs, id)
		}
	}
	a.clusterClientsMu.Unlock()

	// Re-discover available kubeconfigs (acquires kubeconfigsMu write lock internally).
	// Safety: if rediscovery fails, do NOT mutate cluster state or emit the
	// available-changed event. discoverKubeconfigs rebuilds the cache, and
	// proceeding on a failed/partial refresh risks false deselection.
	if err := a.discoverKubeconfigs(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to re-discover kubeconfigs; skipping reconnect/deselect until next event: %v", err), "KubeconfigWatcher")
		return
	}

	a.kubeconfigsMu.RLock()
	count := len(a.availableKubeconfigs)
	a.kubeconfigsMu.RUnlock()
	a.logger.Info(fmt.Sprintf("Re-discovery complete, found %d kubeconfig(s)", count), "KubeconfigWatcher")

	// Handle affected selected clusters.
	// Fast path: rebuild when path:context is still discoverable after rediscovery.
	// If missing from the rediscovered list, directly inspect the file to confirm
	// deletion/context removal before deselecting. Temporary unreadable writes are
	// deferred until a later event.
	if len(affectedClusterIDs) > 0 {
		a.logger.Info(fmt.Sprintf("Processing %d affected cluster(s)", len(affectedClusterIDs)), "KubeconfigWatcher")

		// Build a set of discoverable path:context pairs from the refreshed list.
		type pathContextKey struct {
			path    string
			context string
		}
		a.kubeconfigsMu.RLock()
		discoverable := make(map[pathContextKey]struct{}, len(a.availableKubeconfigs))
		for _, kc := range a.availableKubeconfigs {
			discoverable[pathContextKey{path: kc.Path, context: kc.Context}] = struct{}{}
		}
		a.kubeconfigsMu.RUnlock()

		// Cache direct file inspections so multiple selected contexts from the
		// same kubeconfig file are classified from one on-disk snapshot.
		type fileInspection struct {
			missing  bool
			loadErr  error
			contexts map[string]struct{}
		}
		fileInspections := make(map[string]fileInspection)
		inspectFile := func(path string) fileInspection {
			clean := filepath.Clean(path)
			if cached, ok := fileInspections[clean]; ok {
				return cached
			}
			info, err := os.Stat(clean)
			if err != nil {
				if os.IsNotExist(err) {
					res := fileInspection{missing: true}
					fileInspections[clean] = res
					return res
				}
				res := fileInspection{loadErr: err}
				fileInspections[clean] = res
				return res
			}
			if info.IsDir() {
				res := fileInspection{loadErr: fmt.Errorf("path is a directory")}
				fileInspections[clean] = res
				return res
			}
			cfg, err := clientcmd.LoadFromFile(clean)
			if err != nil {
				res := fileInspection{loadErr: err}
				fileInspections[clean] = res
				return res
			}
			ctxs := make(map[string]struct{}, len(cfg.Contexts))
			for ctxName := range cfg.Contexts {
				ctxs[ctxName] = struct{}{}
			}
			res := fileInspection{contexts: ctxs}
			fileInspections[clean] = res
			return res
		}

		var toRebuild []string
		var toDeselect []string
		for _, clusterID := range affectedClusterIDs {
			clients := a.clusterClientsForID(clusterID)
			if clients == nil {
				continue
			}
			key := pathContextKey{
				path:    clients.kubeconfigPath,
				context: clients.kubeconfigContext,
			}
			if _, ok := discoverable[key]; ok {
				toRebuild = append(toRebuild, clusterID)
				continue
			}

			// Rediscovery did not find this path:context. Confirm before
			// deselecting so temporary editor writes / truncated intermediate
			// content do not cause destructive selection changes.
			inspection := inspectFile(clients.kubeconfigPath)
			switch {
			case inspection.missing:
				a.logger.Info(fmt.Sprintf("Kubeconfig file deleted/renamed for cluster %s, deselecting", clients.meta.Name), "KubeconfigWatcher")
				toDeselect = append(toDeselect, clusterID)
			case inspection.loadErr != nil:
				a.logger.Warn(fmt.Sprintf("Kubeconfig file for cluster %s changed but is temporarily unreadable (%v); keeping selection until next event", clients.meta.Name, inspection.loadErr), "KubeconfigWatcher")
			default:
				if _, exists := inspection.contexts[clients.kubeconfigContext]; exists {
					a.logger.Info(fmt.Sprintf("Kubeconfig context still present on disk for cluster %s; reconnecting", clients.meta.Name), "KubeconfigWatcher")
					toRebuild = append(toRebuild, clusterID)
				} else {
					a.logger.Info(fmt.Sprintf("Kubeconfig context removed/renamed for cluster %s, deselecting", clients.meta.Name), "KubeconfigWatcher")
					toDeselect = append(toDeselect, clusterID)
				}
			}
		}

			// Deselect clusters whose kubeconfig path:context is confirmed gone.
		if len(toDeselect) > 0 {
			a.deselectClusters(toDeselect)
		}

		// Rebuild clusters whose kubeconfig files were modified but path:context still valid.
		for _, clusterID := range toRebuild {
			clients := a.clusterClientsForID(clusterID)
			if clients == nil {
				continue
			}
			a.logger.Info(fmt.Sprintf("Reconnecting cluster %s after kubeconfig change", clients.meta.Name), "KubeconfigWatcher")
			a.teardownClusterSubsystem(clusterID)
			a.rebuildClusterSubsystem(clusterID)
		}
	}

	// Notify the frontend that the available kubeconfigs list may have changed.
	// (Only emitted after successful rediscovery.)
	a.emitEvent("kubeconfig:available-changed")
}

// deselectClusters removes the specified cluster IDs from the active selection.
// It matches selections by kubeconfigPath:kubeconfigContext from the clusterClients
// struct (NOT via clusterMetaForSelection, which depends on availableKubeconfigs
// and can produce mismatched IDs after rediscovery when files are deleted).
// It routes through updateRefreshSubsystemSelections for proper aggregate,
// object catalog, and subsystem lifecycle reconciliation.
// Caller must hold kubeconfigChangeMu.
func (a *App) deselectClusters(clusterIDs []string) {
	if len(clusterIDs) == 0 {
		return
	}

	// Build removal keys from clusterClients' kubeconfigPath and kubeconfigContext.
	// This avoids relying on clusterMetaForSelection which reads from
	// availableKubeconfigs — after rediscovery, a deleted file's entry is gone
	// and IDs may not match (e.g., "default:ctx" vs "config:ctx").
	type pathContextKey struct {
		path    string
		context string
	}
	removalKeys := make(map[pathContextKey]struct{}, len(clusterIDs))
	a.clusterClientsMu.Lock()
	for _, id := range clusterIDs {
		if clients, ok := a.clusterClients[id]; ok && clients != nil {
			removalKeys[pathContextKey{
				path:    clients.kubeconfigPath,
				context: clients.kubeconfigContext,
			}] = struct{}{}
		}
	}
	a.clusterClientsMu.Unlock()

	// Filter the selected kubeconfigs list, keeping only those NOT being removed.
	// Hold kubeconfigsMu to synchronize with GetSelectedKubeconfigs readers.
	a.kubeconfigsMu.RLock()
	currentSelections := append([]string(nil), a.selectedKubeconfigs...)
	a.kubeconfigsMu.RUnlock()

	var remainingSelections []string
	var remainingParsed []kubeconfigSelection
	for _, sel := range currentSelections {
		parsed, err := parseKubeconfigSelection(sel)
		if err != nil {
			continue
		}
		key := pathContextKey{path: parsed.Path, context: parsed.Context}
		if _, removed := removalKeys[key]; !removed {
			remainingSelections = append(remainingSelections, sel)
			remainingParsed = append(remainingParsed, parsed)
		}
	}

	// Reconcile refresh subsystems, aggregates, and object catalog through the
	// proper path BEFORE committing any state changes. If reconciliation fails,
	// abort without modifying selection or client state to avoid partial state
	// where selection/clients diverge from refresh/aggregate/catalog.
	if len(remainingParsed) > 0 {
		if err := a.updateRefreshSubsystemSelections(remainingParsed); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to reconcile refresh subsystems after deselect, aborting: %v", err), "KubeconfigWatcher")
			return
		}
	} else {
		// All clusters deselected — tear down the entire refresh subsystem.
		a.teardownRefreshSubsystem()
	}

	// Reconciliation succeeded — now commit the selection and client state.
	a.kubeconfigsMu.Lock()
	a.selectedKubeconfigs = remainingSelections
	a.kubeconfigsMu.Unlock()

	// Remove cluster client entries under lock, but shut down auth managers
	// AFTER releasing clusterClientsMu. authManager.Shutdown waits for auth
	// goroutines, and auth state callbacks may call clusterClientsForID(),
	// which also acquires clusterClientsMu.
	var authManagers []interface{ Shutdown() }
	a.clusterClientsMu.Lock()
	for _, id := range clusterIDs {
		if clients, ok := a.clusterClients[id]; ok {
			if clients != nil && clients.authManager != nil {
				authManagers = append(authManagers, clients.authManager)
			}
			delete(a.clusterClients, id)
		}
	}
	a.clusterClientsMu.Unlock()
	for _, mgr := range authManagers {
		mgr.Shutdown()
	}

	// Persist the updated selection under settingsMu to prevent racing with
	// concurrent settings RPCs (e.g., SetTheme) that also read/write appSettings.
	a.settingsMu.Lock()
	if a.appSettings != nil {
		a.appSettings.SelectedKubeconfigs = remainingSelections
		if err := a.saveAppSettings(); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to save updated selection: %v", err), "KubeconfigWatcher")
		}
	}
	a.settingsMu.Unlock()
}
```

**Step 2: Integrate into Startup — AFTER initKubernetesClient**

In `backend/app_lifecycle.go`, in the `Startup` method, add AFTER the cluster initialization block (after line 138, just before `a.startUpdateCheck()`):

```go
	// Start watching kubeconfig directories for file changes.
	// Placed after initKubernetesClient so that all cluster state is fully
	// built before the watcher can trigger teardown/rebuild operations.
	if err := a.startKubeconfigWatcher(); err != nil {
		a.logger.Warn(fmt.Sprintf("Kubeconfig directory watcher not available: %v", err), "App")
	}
```

**Step 3: Integrate into Shutdown — before teardownRefreshSubsystem**

In `backend/app_lifecycle.go`, in the `Shutdown` method, add before `a.teardownRefreshSubsystem()` (before line 203):

```go
	// Stop the kubeconfig directory watcher before tearing down cluster state.
	a.stopKubeconfigWatcher()
```

**Step 4: Update SetKubeconfigSearchPaths to refresh watched paths**

In `backend/kubeconfigs.go`, in `SetKubeconfigSearchPaths`, add after the `discoverKubeconfigs` call (after line 187):

```go
	// Update the directory watcher to watch the new search paths.
	if a.kubeconfigWatcher != nil {
		watchPaths := a.resolvedKubeconfigWatchPaths()
		if updateErr := a.kubeconfigWatcher.updateWatchedPaths(watchPaths); updateErr != nil {
			a.logger.Warn(fmt.Sprintf("Failed to update watched paths: %v", updateErr), "KubeconfigWatcher")
		}
	}
```

**Step 5: Run all tests with race detector**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -count=1 -race`

Expected: All tests PASS. No new watcher-related race conditions. If the known pre-existing `resolveMetricsInterval()` race is reported, document it as an existing gap rather than a watcher regression.

---

### Task 5: Add frontend listener for kubeconfig:available-changed event

**Files:**
- Modify: `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`

**Step 1: Add Wails event listener**

In `KubeconfigContext.tsx`, add import at top:

```typescript
import { EventsOn } from '@wailsjs/runtime/runtime';
```

Then add a new `useEffect` inside the `KubeconfigProvider` component, after the existing `// Load kubeconfigs on mount` useEffect (after line 361):

```typescript
  // Listen for backend kubeconfig directory watcher events.
  // When a kubeconfig file changes on disk, the backend re-discovers and emits this event.
  useEffect(() => {
    // Use only the cancel handle for cleanup — do NOT call EventsOff, which
    // would remove listeners registered by other components for the same event.
    const cancel = EventsOn('kubeconfig:available-changed', () => {
      loadKubeconfigs();
    });
    return () => {
      if (typeof cancel === 'function') {
        cancel();
      }
    };
  }, [loadKubeconfigs]);
```

**Step 2: Run TypeScript checks**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`

Expected: No type errors.

**Step 3: Run frontend tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`

Expected: All tests PASS.

---

### Task 6: Run full test suite and verify

**Step 1: Run full backend tests with race detector**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./... -count=1 -race`

Expected: All tests PASS. No new watcher-related race conditions. If the known pre-existing `resolveMetricsInterval()` race is reported, document it as an existing gap rather than a watcher regression.

**Step 2: Run full frontend tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`

Expected: All tests PASS.

**Step 3: Run TypeScript checks**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`

Expected: No type errors.

**Step 4: Build the full app**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./...`

Expected: Clean build.

**Step 5: Mark todo item as complete**

Update `docs/plans/todos.md` — mark the "Refresh kubeconfigs without restarting the app" item with ✅.
