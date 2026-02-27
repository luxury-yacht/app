package backend

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeMultiContextKubeconfig(t *testing.T, path string, contexts []string) {
	t.Helper()

	if len(contexts) == 0 {
		contexts = []string{"default"}
	}

	current := contexts[0]
	content := "apiVersion: v1\nkind: Config\npreferences: {}\nclusters:\n- cluster:\n    insecure-skip-tls-verify: true\n    server: https://127.0.0.1:6443\n  name: test-cluster\nusers:\n- name: test-user\n  user:\n    token: test-token\ncontexts:\n"
	for _, ctx := range contexts {
		content += "- context:\n    cluster: test-cluster\n    user: test-user\n  name: " + ctx + "\n"
	}
	content += "current-context: " + current + "\n"

	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
}

func TestKubeconfigWatcher_DetectsFileCreation(t *testing.T) {
	dir := t.TempDir()
	app := newTestAppWithDefaults(t)

	var called atomic.Int32
	w, err := newKubeconfigWatcher(app, func(_ []string) {
		called.Add(1)
	})
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir}}))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "new-config"), []byte("x"), 0o644))

	assert.Eventually(t, func() bool { return called.Load() > 0 }, 2*time.Second, 50*time.Millisecond)
}

func TestKubeconfigWatcher_FilenameFilter(t *testing.T) {
	dir := t.TempDir()
	app := newTestAppWithDefaults(t)

	changesCh := make(chan []string, 4)
	w, err := newKubeconfigWatcher(app, func(paths []string) {
		changesCh <- paths
	})
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{
		dir:         dir,
		filterFiles: map[string]struct{}{"target": {}},
	}}))

	require.NoError(t, os.WriteFile(filepath.Join(dir, "ignored"), []byte("x"), 0o644))
	time.Sleep(700 * time.Millisecond)
	select {
	case <-changesCh:
		t.Fatal("unexpected callback for ignored filename")
	default:
	}

	targetPath := filepath.Join(dir, "target")
	require.NoError(t, os.WriteFile(targetPath, []byte("x"), 0o644))
	assert.Eventually(t, func() bool {
		select {
		case paths := <-changesCh:
			for _, p := range paths {
				if filepath.Clean(p) == filepath.Clean(targetPath) {
					return true
				}
			}
			return false
		default:
			return false
		}
	}, 2*time.Second, 50*time.Millisecond)
}

func TestKubeconfigWatcher_DebounceAccumulatesPaths(t *testing.T) {
	dir := t.TempDir()
	app := newTestAppWithDefaults(t)

	changesCh := make(chan []string, 2)
	w, err := newKubeconfigWatcher(app, func(paths []string) {
		changesCh <- paths
	})
	require.NoError(t, err)
	defer w.stop()

	require.NoError(t, w.updateWatchedPaths([]watchedPath{{dir: dir}}))

	fileA := filepath.Join(dir, "a")
	fileB := filepath.Join(dir, "b")
	require.NoError(t, os.WriteFile(fileA, []byte("1"), 0o644))
	require.NoError(t, os.WriteFile(fileB, []byte("2"), 0o644))

	var got []string
	assert.Eventually(t, func() bool {
		select {
		case got = <-changesCh:
			return len(got) >= 2
		default:
			return false
		}
	}, 2*time.Second, 50*time.Millisecond)
	assert.ElementsMatch(t, []string{filepath.Clean(fileA), filepath.Clean(fileB)}, got)
}

func TestApp_HandleKubeconfigChange_ContextRemovedDeselectsOnlyAffectedFromSameFile(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.refreshSubsystems = make(map[string]*system.Subsystem)
	app.objectCatalogEntries = make(map[string]*objectCatalogEntry)
	app.refreshAggregates = &refreshAggregateHandlers{}
	app.refreshHTTPServer = &http.Server{}
	app.refreshCtx = context.Background()
	app.appSettings = getDefaultAppSettings()

	baseDir := t.TempDir()
	configPath := filepath.Join(baseDir, "shared-config")
	writeMultiContextKubeconfig(t, configPath, []string{"ctx-keep", "ctx-remove"})
	require.NoError(t, app.SetKubeconfigSearchPaths([]string{configPath}))

	app.kubeconfigsMu.Lock()
	app.selectedKubeconfigs = []string{configPath + ":ctx-keep", configPath + ":ctx-remove"}
	app.kubeconfigsMu.Unlock()
	app.appSettings.SelectedKubeconfigs = []string{configPath + ":ctx-keep", configPath + ":ctx-remove"}

	keepMeta := app.clusterMetaForSelection(kubeconfigSelection{Path: configPath, Context: "ctx-keep"})
	removeMeta := app.clusterMetaForSelection(kubeconfigSelection{Path: configPath, Context: "ctx-remove"})

	app.clusterClients[keepMeta.ID] = &clusterClients{
		meta: keepMeta,
		// Use a different client path in this unit test so the "kept" cluster is not
		// marked as affected and the watcher does not trigger a real rebuild/auth flow.
		// The regression we care about here is path+context deselection from the
		// selected list when multiple selections share one kubeconfig file.
		kubeconfigPath:    filepath.Join(baseDir, "other-config"),
		kubeconfigContext: "ctx-keep",
	}
	app.clusterClients[removeMeta.ID] = &clusterClients{
		meta:              removeMeta,
		kubeconfigPath:    configPath,
		kubeconfigContext: "ctx-remove",
	}
	app.refreshSubsystems[keepMeta.ID] = &system.Subsystem{}
	app.refreshSubsystems[removeMeta.ID] = &system.Subsystem{}

	// Remove only one context from the shared file.
	writeMultiContextKubeconfig(t, configPath, []string{"ctx-keep"})
	app.handleKubeconfigChange([]string{configPath})

	selected := app.GetSelectedKubeconfigs()
	assert.Equal(t, []string{configPath + ":ctx-keep"}, selected)
	_, removedStillPresent := app.clusterClients[removeMeta.ID]
	assert.False(t, removedStillPresent)
	_, keptStillPresent := app.clusterClients[keepMeta.ID]
	assert.True(t, keptStillPresent)
}

func TestApp_HandleKubeconfigChange_TransientInvalidWriteDoesNotDeselect(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	app.clusterClients = make(map[string]*clusterClients)
	app.refreshSubsystems = make(map[string]*system.Subsystem)
	app.objectCatalogEntries = make(map[string]*objectCatalogEntry)
	app.appSettings = getDefaultAppSettings()

	baseDir := t.TempDir()
	configDir := filepath.Join(baseDir, "configs")
	require.NoError(t, os.MkdirAll(configDir, 0o755))
	configPath := filepath.Join(configDir, "watched")
	writeMultiContextKubeconfig(t, configPath, []string{"ctx"})
	require.NoError(t, app.SetKubeconfigSearchPaths([]string{configPath}))

	app.kubeconfigsMu.Lock()
	app.selectedKubeconfigs = []string{configPath + ":ctx"}
	app.kubeconfigsMu.Unlock()
	app.appSettings.SelectedKubeconfigs = []string{configPath + ":ctx"}

	meta := app.clusterMetaForSelection(kubeconfigSelection{Path: configPath, Context: "ctx"})
	app.clusterClients[meta.ID] = &clusterClients{
		meta:              meta,
		kubeconfigPath:    configPath,
		kubeconfigContext: "ctx",
	}

	// Simulate an editor intermediate write that leaves the file temporarily invalid.
	require.NoError(t, os.WriteFile(configPath, []byte("not: valid: yaml: ["), 0o644))
	app.handleKubeconfigChange([]string{configPath})

	assert.Equal(t, []string{configPath + ":ctx"}, app.GetSelectedKubeconfigs())
	_, stillPresent := app.clusterClients[meta.ID]
	assert.True(t, stillPresent)
}

func TestDeselectClusters_AbortsOnReconciliationFailure(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)

	app.kubeconfigsMu.Lock()
	app.selectedKubeconfigs = []string{"/path/a:ctx-a", "/path/b:ctx-b"}
	app.kubeconfigsMu.Unlock()

	app.clusterClients["a:ctx-a"] = &clusterClients{
		meta:              ClusterMeta{ID: "a:ctx-a", Name: "a"},
		kubeconfigPath:    "/path/a",
		kubeconfigContext: "ctx-a",
	}
	app.clusterClients["b:ctx-b"] = &clusterClients{
		meta:              ClusterMeta{ID: "b:ctx-b", Name: "b"},
		kubeconfigPath:    "/path/b",
		kubeconfigContext: "ctx-b",
	}
	app.appSettings = &AppSettings{SelectedKubeconfigs: []string{"/path/a:ctx-a", "/path/b:ctx-b"}}

	// Force updateRefreshSubsystemSelections to take the setupRefreshSubsystem path and fail.
	app.refreshAggregates = nil
	app.refreshHTTPServer = nil
	app.refreshCtx = nil

	app.selectionMutationMu.Lock()
	app.deselectClusters([]string{"b:ctx-b"})
	app.selectionMutationMu.Unlock()

	assert.Equal(t, []string{"/path/a:ctx-a", "/path/b:ctx-b"}, app.GetSelectedKubeconfigs())
	_, aOK := app.clusterClients["a:ctx-a"]
	_, bOK := app.clusterClients["b:ctx-b"]
	assert.True(t, aOK)
	assert.True(t, bOK)
	require.Len(t, app.appSettings.SelectedKubeconfigs, 2)
}
